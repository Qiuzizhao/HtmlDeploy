const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { exec } = require('node:child_process');

const express = require('express');
const multer = require('multer');

const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const DEFAULT_ADMIN_PASSWORD = 'qqqyyy';
const ADMIN_COOKIE_NAME = 'html_deploy_admin';
const CLASS_COOKIE_PREFIX = 'html_deploy_class_';
const ALL_COOKIE_NAME = 'html_deploy_all';
const MAX_FORBIDDEN_WORDS = 100000;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createDefaultId() {
  return crypto.randomBytes(4).toString('hex');
}

function createAdminToken(password) {
  return crypto.createHash('sha256').update(`html-deploy:${password}`).digest('hex');
}

function createClassPassword() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function isValidClassPassword(password) {
  return /^\d{6}$/.test(password);
}

function isValidAdminPassword(password) {
  return /^\S{4,40}$/.test(String(password || ''));
}

function normalizeForbiddenWords(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,，、;；]+/);
  const seen = new Set();
  const words = [];

  items.forEach((item) => {
    const word = String(item || '').trim();
    const key = word.toLocaleLowerCase();
    if (!word || seen.has(key)) {
      return;
    }

    seen.add(key);
    words.push(word);
  });

  return words.slice(0, MAX_FORBIDDEN_WORDS);
}

function rankForbiddenWordMatch(word, normalizedQuery, originalIndex) {
  const normalizedWord = String(word || '').toLocaleLowerCase();
  const matchIndex = normalizedWord.indexOf(normalizedQuery);
  return {
    exact: normalizedWord === normalizedQuery ? 0 : 1,
    prefix: normalizedWord.startsWith(normalizedQuery) ? 0 : 1,
    matchIndex,
    length: normalizedWord.length,
    originalIndex
  };
}

function compareForbiddenWordMatches(left, right) {
  return left.rank.exact - right.rank.exact
    || left.rank.prefix - right.rank.prefix
    || left.rank.matchIndex - right.rank.matchIndex
    || left.rank.length - right.rank.length
    || left.rank.originalIndex - right.rank.originalIndex;
}

function findForbiddenWordMatch({ title, author }, forbiddenWords) {
  const fields = [
    { label: '网页名字', value: title },
    { label: '作者署名', value: author }
  ];

  for (const field of fields) {
    const text = String(field.value || '').toLocaleLowerCase();
    for (const word of forbiddenWords) {
      if (text.includes(String(word).toLocaleLowerCase())) {
        return { field: field.label, word };
      }
    }
  }

  return null;
}

function createForbiddenWordError(match) {
  return `${match.field}不能包含违禁词「${match.word}」`;
}

function createForbiddenAuditMessage(match) {
  return `${match.field}包含违禁词「${match.word}」`;
}

function clearForbiddenAudit(site) {
  if (!site.forbiddenAuditMessage && !site.forbiddenAuditField && !site.forbiddenAuditWord) {
    return site;
  }

  const {
    forbiddenAuditMessage,
    forbiddenAuditField,
    forbiddenAuditWord,
    ...rest
  } = site;
  return rest;
}

function createDuplicateAuditMessage(keepSite) {
  const keepTitle = String(keepSite.title || '').trim() || keepSite.id;
  const keepNumber = String(keepSite.number || '').trim();
  const keepLabel = keepNumber ? `${keepTitle}（${keepNumber}）` : keepTitle;
  return `与「${keepLabel}」代码重复`;
}

function clearDuplicateAudit(site) {
  if (!site.duplicateAuditMessage && !site.duplicateAuditKeepId && !site.duplicateAuditKeepTitle) {
    return site;
  }

  const {
    duplicateAuditMessage,
    duplicateAuditKeepId,
    duplicateAuditKeepTitle,
    ...rest
  } = site;
  return rest;
}

function stripCodeFence(value) {
  const content = String(value || '').trim();
  const fenced = content.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i)
    || content.match(/```(?:html)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : content).trim();
}

function normalizeSiteTitle(value) {
  return String(value || '')
    .replace(/^["'“”‘’「」《》]+|["'“”‘’「」《》]+$/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 80)
    .trim() || '';
}

function normalizeTemperature(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(2, Math.max(0, Math.round(number * 100) / 100));
}

function normalizeTimeoutMs(value, fallback, max = 60000) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.min(max, Math.max(1000, Math.round(number)));
}

function getEnvironmentLlmConfig(options = {}) {
  return {
    apiKey: options.llmApiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: options.llmApiBaseUrl || process.env.LLM_API_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: options.llmModel || process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    thinkingType: options.llmThinkingType || process.env.LLM_THINKING_TYPE || '',
    temperature: normalizeTemperature(options.llmTemperature ?? process.env.LLM_TEMPERATURE, 0.2),
    nameTemperature: normalizeTemperature(options.llmNameTemperature ?? process.env.LLM_NAME_TEMPERATURE, 0.3),
    timeoutMs: normalizeTimeoutMs(options.llmTimeoutMs ?? process.env.LLM_TIMEOUT_MS, 45000)
  };
}

function normalizeAiSettings(settings = {}) {
  return {
    apiKey: String(settings.apiKey || '').trim(),
    baseUrl: String(settings.baseUrl || '').trim(),
    model: String(settings.model || '').trim(),
    thinkingType: String(settings.thinkingType || '').trim(),
    temperature: normalizeTemperature(settings.temperature, undefined),
    nameTemperature: normalizeTemperature(settings.nameTemperature, undefined)
  };
}

function mergeLlmConfig(options = {}, aiSettings = {}) {
  const environment = getEnvironmentLlmConfig(options);
  const normalized = normalizeAiSettings(aiSettings);

  return {
    apiKey: normalized.apiKey || environment.apiKey,
    baseUrl: normalized.baseUrl || environment.baseUrl,
    model: normalized.model || environment.model,
    thinkingType: normalized.thinkingType || environment.thinkingType,
    temperature: normalized.temperature ?? environment.temperature,
    nameTemperature: normalized.nameTemperature ?? environment.nameTemperature,
    timeoutMs: environment.timeoutMs
  };
}

function maskSecret(value) {
  const secret = String(value || '').trim();
  if (!secret) {
    return '';
  }

  if (secret.length <= 8) {
    return `${secret.slice(0, 2)}...`;
  }

  return `${secret.slice(0, 3)}...${secret.slice(-4)}`;
}

function toPublicAiSettings({ aiSettings, llmConfig }) {
  const hasApiKey = Boolean(llmConfig.apiKey);
  return {
    hasApiKey,
    apiKeyPreview: hasApiKey ? maskSecret(llmConfig.apiKey) : '',
    apiKeySource: aiSettings.apiKey ? 'settings' : hasApiKey ? 'environment' : 'none',
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model,
    temperature: llmConfig.temperature,
    nameTemperature: llmConfig.nameTemperature,
    thinkingType: llmConfig.thinkingType
  };
}

function getChatCompletionsUrl(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  return normalizedBaseUrl.endsWith('/chat/completions')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/chat/completions`;
}

async function fetchJsonWithTimeout(url, options, timeoutMs, timeoutMessage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const responseText = await response.text();
    let result = {};
    if (responseText) {
      try {
        result = JSON.parse(responseText);
      } catch {
        result = { rawText: responseText };
      }
    }
    return { response, result };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function optimizeHtmlWithLlm({ htmlContent, siteTitle, instruction, llmConfig }) {
  if (!llmConfig.apiKey) {
    throw new Error('请先在后台设置中配置 API Key，或在服务器环境变量中配置 LLM_API_KEY / OPENAI_API_KEY');
  }

  const requestBody = {
    model: llmConfig.model,
    temperature: llmConfig.temperature,
    stream: false,
    messages: [
      {
        role: 'system',
        content: [
          '你是资深前端工程师，负责优化单个 HTML 项目的代码。',
          '目标是提升性能、稳定性、可读性和兼容性，同时保留原有玩法、视觉风格、交互和页面文案。',
          '不要添加新的外部网络依赖；除非原代码已经依赖，否则保持单文件 HTML 可运行。',
          '只返回完整 HTML 源码，不要解释，不要 Markdown，不要代码块包裹。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          `项目名称：${siteTitle || '未命名项目'}`,
          instruction ? `额外要求：${instruction}` : '',
          '请优化下面的 HTML 代码，并返回完整可运行 HTML：',
          htmlContent
        ].filter(Boolean).join('\n\n')
      }
    ]
  };

  if (llmConfig.thinkingType) {
    requestBody.thinking = { type: llmConfig.thinkingType };
  }

  const { response, result } = await fetchJsonWithTimeout(
    getChatCompletionsUrl(llmConfig.baseUrl),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llmConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    },
    llmConfig.timeoutMs,
    `AI 优化服务响应超时（超过 ${Math.round(llmConfig.timeoutMs / 1000)} 秒），请稍后重试`
  );

  if (!response.ok) {
    throw new Error(result.error?.message || result.rawText || `AI 优化接口调用失败：${response.status}`);
  }

  const optimizedContent = stripCodeFence(result.choices?.[0]?.message?.content || '');
  if (!optimizedContent) {
    throw new Error('AI 没有返回可用代码');
  }

  return optimizedContent;
}

async function nameSiteWithLlm({ codeSnapshot, currentTitle, author, llmConfig }) {
  if (!llmConfig.apiKey) {
    throw new Error('请先在后台设置中配置 API Key，或在服务器环境变量中配置 LLM_API_KEY / OPENAI_API_KEY');
  }

  const requestBody = {
    model: llmConfig.model,
    temperature: llmConfig.nameTemperature,
    stream: false,
    messages: [
      {
        role: 'system',
        content: [
          '你是网页项目命名助手。',
          '请根据项目代码判断它是什么网页、小游戏或作品，并给出适合展示在项目卡片上的中文名称。',
          '只返回一个名称，不要解释，不要标点包裹，不要 Markdown。',
          '名称应简短具体，最好 2 到 12 个中文字符，最长不超过 20 个中文字符。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          `当前名称：${currentTitle || '未命名项目'}`,
          author ? `作者：${author}` : '',
          '请阅读下面的项目代码并重新命名：',
          String(codeSnapshot || '').slice(0, 60000)
        ].filter(Boolean).join('\n\n')
      }
    ]
  };

  if (llmConfig.thinkingType) {
    requestBody.thinking = { type: llmConfig.thinkingType };
  }

  const { response, result } = await fetchJsonWithTimeout(
    getChatCompletionsUrl(llmConfig.baseUrl),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llmConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    },
    llmConfig.timeoutMs,
    `AI 命名服务响应超时（超过 ${Math.round(llmConfig.timeoutMs / 1000)} 秒），请稍后重试`
  );

  if (!response.ok) {
    throw new Error(result.error?.message || result.rawText || `AI 命名接口调用失败：${response.status}`);
  }

  const title = normalizeSiteTitle(stripCodeFence(result.choices?.[0]?.message?.content || ''));
  if (!title) {
    throw new Error('AI 没有返回可用名称');
  }

  return title;
}

function getClassCookieName(classId) {
  const digest = crypto.createHash('sha256').update(String(classId)).digest('hex').slice(0, 16);
  return `${CLASS_COOKIE_PREFIX}${digest}`;
}

function createClassToken(classItem) {
  return crypto
    .createHash('sha256')
    .update(`html-deploy-class:${classItem.id}:${classItem.password || ''}`)
    .digest('hex');
}

function createAllToken(settings) {
  return crypto
    .createHash('sha256')
    .update(`html-deploy-all:${settings.allPassword || ''}`)
    .digest('hex');
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf('=');
        if (separator === -1) {
          return [item, ''];
        }

        return [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
      })
  );
}

let syncTimeout = null;
let syncInProgress = false;
let syncQueued = false;

function removeStaleGitIndexLock(cwd) {
  const lockPath = path.join(cwd, '.git', 'index.lock');
  try {
    const stats = fs.statSync(lockPath);
    if (Date.now() - stats.mtimeMs < 60 * 1000) {
      return false;
    }

    fs.unlinkSync(lockPath);
    console.warn('[Git Sync] Removed stale .git/index.lock.');
    return true;
  } catch {
    return false;
  }
}

function runGitSyncNow() {
  if (syncInProgress) {
    const error = new Error('已有同步任务正在执行，请稍后再试');
    error.code = 'SYNC_BUSY';
    return Promise.reject(error);
  }

  syncInProgress = true;
  removeStaleGitIndexLock(process.cwd());
  console.log('[Git Sync] Starting backup to GitHub...');

  return new Promise((resolve, reject) => {
    exec('git add . && git commit -m "Auto backup data" && git push', {
      cwd: process.cwd(),
      timeout: 120000
    }, (error, stdout, stderr) => {
      syncInProgress = false;
      const hasNoChanges = stdout.includes('nothing to commit') || stderr.includes('nothing to commit');

      if (error) {
        if (hasNoChanges) {
          console.log('[Git Sync] No changes to backup.');
          resolve({
            status: 'clean',
            message: '当前没有需要同步的数据'
          });
        } else {
          console.error('[Git Sync] Error:', error.message);
          reject(error);
        }
      } else {
        console.log('[Git Sync] Backup successful!');
        resolve({
          status: 'success',
          message: '同步完成，数据已推送到 GitHub'
        });
      }

      if (syncQueued) {
        syncQueued = false;
        syncDataToGithub();
      }
    });
  });
}

function runGitSync() {
  syncTimeout = null;
  runGitSyncNow().catch(() => {});
}

function syncDataToGithub() {
  if (syncInProgress) {
    syncQueued = true;
    return;
  }

  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  syncTimeout = setTimeout(runGitSync, 3000);
}

function syncDataToGithubNow() {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }

  return runGitSyncNow();
}

function renderAdminLoginPage(errorMessage = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>后台登录 - 项目站</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root { color-scheme: light; --bg: #f4f6f2; --panel: #fff; --text: #1f2726; --muted: #68736f; --line: #dce3dd; --brand: #24715b; --danger: #b42318; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .login { width: min(400px, calc(100vw - 32px)); padding: 26px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); box-shadow: 0 18px 42px rgba(31, 39, 38, 0.1); }
    .brand { display: flex; align-items: center; gap: 11px; margin-bottom: 22px; font-size: 20px; font-weight: 750; }
    .brand-mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 8px; background: var(--text); color: #fff; font-weight: 800; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0 0 20px; color: var(--muted); }
    label { display: grid; gap: 8px; color: var(--muted); font-size: 13px; font-weight: 650; }
    input { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; font: inherit; }
    button { width: 100%; min-height: 42px; margin-top: 16px; border: 0; border-radius: 8px; background: var(--brand); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    .error { min-height: 20px; margin-top: 12px; color: var(--danger); font-size: 13px; }
  </style>
</head>
<body>
  <form class="login" action="/admin-login" method="post">
    <div class="brand"><span class="brand-mark">项</span><span>项目站</span></div>
    <h1>请输入后台密码</h1>
    <p>验证后进入项目管理后台。</p>
    <label>
      后台密码
      <input name="password" type="password" autocomplete="current-password" autofocus required>
    </label>
    <button type="submit">进入后台</button>
    <div class="error">${escapeHtml(errorMessage)}</div>
  </form>
</body>
</html>`;
}

function isHtmlFile(file) {
  if (!file) {
    return false;
  }

  const extension = path.extname(file.originalname || '').toLowerCase();
  return extension === '.html' || extension === '.htm' || file.mimetype === 'text/html';
}

function resolveInside(baseDir, relativePath) {
  const target = path.resolve(baseDir, relativePath);
  const base = path.resolve(baseDir);

  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Path escapes project directory');
  }

  return target;
}

async function ensureJsonFile(dataFile) {
  await fsp.mkdir(path.dirname(dataFile), { recursive: true });
  try {
    await fsp.access(dataFile, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(dataFile, '[]');
  }
}

function formatSiteNumber(value) {
  return String(value).padStart(5, '0');
}

function getSiteNumberValue(site) {
  const value = Number.parseInt(site.number, 10);
  return /^\d{5}$/.test(String(site.number || '')) && value > 0 ? value : 0;
}

function normalizeSiteNumbers(sites) {
  let changed = false;
  const usedNumbers = new Set();
  const normalizedSites = sites.map((site, originalIndex) => {
    const numberValue = getSiteNumberValue(site);
    if (numberValue && !usedNumbers.has(numberValue)) {
      usedNumbers.add(numberValue);
      return { site, originalIndex, needsNumber: false };
    }

    if (site.number !== undefined) {
      changed = true;
    }

    return {
      site: { ...site },
      originalIndex,
      needsNumber: true
    };
  });

  let nextNumber = usedNumbers.size ? Math.max(...usedNumbers) + 1 : 1;
  const sitesNeedingNumbers = normalizedSites
    .filter((item) => item.needsNumber)
    .sort((left, right) => {
      const leftTime = Date.parse(left.site.createdAt || '');
      const rightTime = Date.parse(right.site.createdAt || '');
      const leftHasTime = Number.isFinite(leftTime);
      const rightHasTime = Number.isFinite(rightTime);

      if (leftHasTime && rightHasTime && leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      if (leftHasTime !== rightHasTime) {
        return leftHasTime ? -1 : 1;
      }

      return left.originalIndex - right.originalIndex;
    });

  for (const item of sitesNeedingNumbers) {
    item.site.number = formatSiteNumber(nextNumber);
    usedNumbers.add(nextNumber);
    nextNumber += 1;
    changed = true;
  }

  return {
    sites: normalizedSites.map((item) => item.site),
    changed
  };
}


async function readSites(dataFile) {
  await ensureJsonFile(dataFile);
  const raw = await fsp.readFile(dataFile, 'utf8');
  try {
    const sites = JSON.parse(raw);
    if (!Array.isArray(sites)) {
      return [];
    }

    const normalized = normalizeSiteNumbers(sites);
    if (normalized.changed) {
      await writeSites(dataFile, normalized.sites);
    }

    return normalized.sites;
  } catch {
    return [];
  }
}

async function readClasses(classesFile) {
  await ensureJsonFile(classesFile);
  const raw = await fsp.readFile(classesFile, 'utf8');
  try {
    const classes = JSON.parse(raw);
    if (!Array.isArray(classes)) {
      return [];
    }

    let changed = false;
    const normalizedClasses = classes.map((classItem) => {
      const passwordIsValid = isValidClassPassword(String(classItem.password || ''));
      const hasUploadEnabled = typeof classItem.uploadEnabled === 'boolean';
      const hasPasswordEnabled = typeof classItem.passwordEnabled === 'boolean';

      if (passwordIsValid && hasUploadEnabled && hasPasswordEnabled) {
        return classItem;
      }

      changed = true;
      return {
        ...classItem,
        password: passwordIsValid ? classItem.password : createClassPassword(),
        uploadEnabled: classItem.uploadEnabled !== false,
        passwordEnabled: classItem.passwordEnabled !== false
      };
    });

    if (changed) {
      await fsp.writeFile(classesFile, JSON.stringify(normalizedClasses, null, 2));
    }

    return normalizedClasses;
  } catch {
    return [];
  }
}

async function readSettings(settingsFile) {
  await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
  let settings = {};

  try {
    const raw = await fsp.readFile(settingsFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      settings = parsed;
    }
  } catch {
    settings = {};
  }

  if (!isValidClassPassword(String(settings.allPassword || ''))) {
    settings = {
      ...settings,
      allPassword: createClassPassword()
    };
    await writeSettings(settingsFile, settings);
  }

  return {
    ...settings,
    allPasswordEnabled: settings.allPasswordEnabled !== false,
    forbiddenWords: normalizeForbiddenWords(settings.forbiddenWords)
  };
}

async function readAiSettings(aiSettingsFile) {
  await fsp.mkdir(path.dirname(aiSettingsFile), { recursive: true });
  try {
    const raw = await fsp.readFile(aiSettingsFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return normalizeAiSettings(parsed);
    }
  } catch {
    // Missing or invalid private AI settings fall back to environment config.
  }

  return normalizeAiSettings();
}

async function writeAiSettings(aiSettingsFile, settings) {
  const normalized = normalizeAiSettings(settings);
  await fsp.mkdir(path.dirname(aiSettingsFile), { recursive: true });
  await fsp.writeFile(aiSettingsFile, JSON.stringify(normalized, null, 2));
  return normalized;
}

async function writeSites(dataFile, sites) {
  await fsp.mkdir(path.dirname(dataFile), { recursive: true });
  await fsp.writeFile(dataFile, JSON.stringify(sites, null, 2));
  syncDataToGithub();
}

async function writeClasses(classesFile, classes) {
  await fsp.mkdir(path.dirname(classesFile), { recursive: true });
  await fsp.writeFile(classesFile, JSON.stringify(classes, null, 2));
  syncDataToGithub();
}

async function writeSettings(settingsFile, settings) {
  await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
  await fsp.writeFile(settingsFile, JSON.stringify(settings, null, 2));
  syncDataToGithub();
}

function toAdminSettingsResponse(settings, { includeForbiddenWords = true } = {}) {
  const { adminPassword, forbiddenWords, ...summarySettings } = settings;
  const response = {
    ...summarySettings,
    adminPasswordConfigured: isValidAdminPassword(adminPassword),
    forbiddenWordsCount: forbiddenWords?.length || 0
  };

  if (includeForbiddenWords) {
    response.forbiddenWords = forbiddenWords;
  }

  return response;
}

function attachClassName(site, classes) {
  const classItem = classes.find((item) => item.id === site.classId);
  return {
    ...site,
    className: classItem?.name || ''
  };
}

function createDownloadFileName(site) {
  const title = String(site.title || site.id || 'project').trim() || 'project';
  const safeTitle = title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  return /\.(html|htm)$/i.test(safeTitle) ? safeTitle : `${safeTitle}.html`;
}

function compareSitesByCreatedAt(left, right) {
  const leftTime = Date.parse(left.createdAt || '');
  const rightTime = Date.parse(right.createdAt || '');
  const leftHasTime = Number.isFinite(leftTime);
  const rightHasTime = Number.isFinite(rightTime);

  if (leftHasTime && rightHasTime && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  if (leftHasTime !== rightHasTime) {
    return leftHasTime ? -1 : 1;
  }

  return String(left.id || '').localeCompare(String(right.id || ''));
}

async function getSiteHtmlFingerprint(storageDir, siteId) {
  const indexPath = path.join(storageDir, siteId, 'index.html');
  try {
    const content = await fsp.readFile(indexPath);
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex');
  } catch {
    return '';
  }
}

function toPublicClass(classItem) {
  return {
    id: classItem.id,
    name: classItem.name,
    uploadEnabled: classItem.uploadEnabled !== false,
    passwordEnabled: classItem.passwordEnabled !== false,
    createdAt: classItem.createdAt,
    updatedAt: classItem.updatedAt
  };
}

function getThumbnailPath(thumbnailDir, id) {
  return path.join(thumbnailDir, `${id}.png`);
}

function getThumbnailUrl(thumbnailDir, id) {
  const thumbnailPath = getThumbnailPath(thumbnailDir, id);
  try {
    const stat = fs.statSync(thumbnailPath);
    return `/thumbnails/${encodeURIComponent(id)}.png?v=${Math.round(stat.mtimeMs)}`;
  } catch {
    return '';
  }
}

async function getDirectorySize(directory) {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }

  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
    } else if (entry.isFile()) {
      const stat = await fsp.stat(entryPath);
      total += stat.size;
    }
  }

  return total;
}

function toPublicSite(site, classes, thumbnailDir, storageBytes = 0) {
  const usagePreviewCount = Math.max(0, Number(site.usagePreviewCount) || 0);
  const usageCodeCount = Math.max(0, Number(site.usageCodeCount) || 0);

  return {
    ...attachClassName(site, classes),
    starred: site.starred === true,
    enabled: site.enabled !== false,
    usagePreviewCount,
    usageCodeCount,
    usageCount: usagePreviewCount + usageCodeCount,
    usageLastUsedAt: site.usageLastUsedAt || '',
    storageBytes,
    url: `/site/${site.id}`,
    previewUrl: `/preview/${site.id}`,
    thumbnailUrl: getThumbnailUrl(thumbnailDir, site.id)
  };
}

async function toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir) {
  const storageBytes = await getDirectorySize(path.join(storageDir, site.id));
  return toPublicSite(site, classes, thumbnailDir, storageBytes);
}

async function incrementSiteUsage(dataFile, id, type) {
  if (!['preview', 'code'].includes(type)) {
    return null;
  }

  const sites = await readSites(dataFile);
  const siteIndex = sites.findIndex((site) => site.id === id);
  if (siteIndex === -1) {
    return null;
  }

  const site = sites[siteIndex];
  const nextSite = {
    ...site,
    usagePreviewCount: Math.max(0, Number(site.usagePreviewCount) || 0) + (type === 'preview' ? 1 : 0),
    usageCodeCount: Math.max(0, Number(site.usageCodeCount) || 0) + (type === 'code' ? 1 : 0),
    usageLastUsedAt: new Date().toISOString()
  };
  sites[siteIndex] = nextSite;
  await writeSites(dataFile, sites);
  return nextSite;
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

async function loadChromium() {
  try {
    return require('playwright').chromium;
  } catch {
    throw new Error('缺少 Playwright 依赖，请先运行 npm install 并安装 Chromium 浏览器');
  }
}

async function generateSiteThumbnail({ id, origin, thumbnailDir, adminToken }) {
  const chromium = await loadChromium();
  await fsp.mkdir(thumbnailDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 576 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true
    });

    await context.addCookies([{
      name: ADMIN_COOKIE_NAME,
      value: adminToken,
      url: origin,
      httpOnly: true,
      sameSite: 'Lax'
    }]);

    const page = await context.newPage();
    await page.goto(`${origin}/site/${encodeURIComponent(id)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    await page.waitForTimeout(1400);

    const thumbnailPath = getThumbnailPath(thumbnailDir, id);
    await page.screenshot({
      path: thumbnailPath,
      type: 'png',
      fullPage: false
    });
    await context.close();

    return {
      id,
      thumbnailUrl: getThumbnailUrl(thumbnailDir, id)
    };
  } finally {
    await browser.close();
  }
}

async function createUniqueId({ dataFile, storageDir, idGenerator }) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = idGenerator();
    const sites = await readSites(dataFile);
    const inData = sites.some((site) => site.id === id);
    const siteDir = path.join(storageDir, id);
    const inStorage = fs.existsSync(siteDir);

    if (!inData && !inStorage) {
      return id;
    }
  }

  throw new Error('Unable to create unique project ID');
}

async function listProjectFiles(projectDir) {
  const result = [];

  async function walk(currentDir, prefix = '') {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, relative);
      } else {
        result.push(relative.replaceAll('\\', '/'));
      }
    }
  }

  await walk(projectDir);
  return result.sort((a, b) => a.localeCompare(b));
}

function isTextProjectFile(filePath, buffer) {
  const textExtensions = new Set([
    '.html',
    '.htm',
    '.css',
    '.js',
    '.mjs',
    '.cjs',
    '.json',
    '.txt',
    '.md',
    '.svg',
    '.xml',
    '.csv',
    '.ts',
    '.tsx',
    '.jsx',
    '.vue'
  ]);

  if (textExtensions.has(path.extname(filePath).toLowerCase())) {
    return true;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return !sample.includes(0);
}

async function readProjectCodeSnapshot(projectDir) {
  const filePaths = await listProjectFiles(projectDir);
  const files = [];

  for (const filePath of filePaths) {
    const absolutePath = resolveInside(projectDir, filePath);
    const buffer = await fsp.readFile(absolutePath);
    const isText = isTextProjectFile(filePath, buffer);
    files.push({
      path: filePath,
      size: buffer.length,
      binary: !isText,
      content: isText ? buffer.toString('utf8') : ''
    });
  }

  const combinedText = files
    .map((file) => [
      `===== ${file.path} =====`,
      file.binary ? `[二进制文件，无法以文本显示：${file.size} bytes]` : file.content
    ].join('\n'))
    .join('\n\n');

  return { files, combinedText };
}

async function renderFileList({ id, title, projectDir }) {
  const files = await listProjectFiles(projectDir);
  const items = files
    .map((file) => {
      const href = `/site/${encodeURIComponent(id)}/${file
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')}`;
      return `<li><a href="${href}">${escapeHtml(file)}</a></li>`;
    })
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title || id)} - 文件列表</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #172033; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    ul { line-height: 1.9; padding-left: 22px; }
    a { color: #2456d6; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title || id)}</h1>
  <ul>${items || '<li>暂无文件</li>'}</ul>
</body>
</html>`;
}

function renderPreviewPage({ id, title }) {
  const siteUrl = `/site/${encodeURIComponent(id)}`;
  const pageTitle = `${title || id} - 预览`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root { color-scheme: dark; --bar: #101418; --line: rgba(255, 255, 255, 0.12); --text: #f4f7f8; --muted: #aeb9bd; --button: rgba(255, 255, 255, 0.1); --button-hover: rgba(255, 255, 255, 0.18); }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #050608; color: var(--text); font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { display: grid; grid-template-rows: 46px minmax(0, 1fr); }
    .toolbar { height: 46px; display: flex; align-items: center; gap: 10px; padding: 6px 10px 6px 14px; border-bottom: 1px solid var(--line); background: var(--bar); contain: layout paint style; }
    .title { min-width: 0; flex: 1; display: grid; gap: 1px; }
    .name, .url { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .name { font-size: 14px; font-weight: 720; }
    .url { font-size: 11px; color: var(--muted); }
    .actions { display: flex; align-items: center; gap: 6px; }
    button, a { min-height: 32px; padding: 0 11px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line); border-radius: 7px; background: var(--button); color: var(--text); font: inherit; font-size: 13px; font-weight: 650; text-decoration: none; cursor: pointer; }
    button:hover, a:hover { background: var(--button-hover); }
    iframe { width: 100%; height: 100%; border: 0; display: block; background: #fff; }
    @media (max-width: 560px) {
      body { grid-template-rows: 42px minmax(0, 1fr); }
      .toolbar { height: 42px; padding: 5px 6px 5px 10px; }
      .url, .open-original { display: none; }
      button, a { min-height: 30px; padding: 0 9px; font-size: 12px; }
    }
  </style>
</head>
<body>
  <header class="toolbar">
    <div class="title">
      <div class="name">${escapeHtml(title || id)}</div>
      <div class="url">${escapeHtml(siteUrl)}</div>
    </div>
    <div class="actions">
      <button id="refreshButton" type="button">刷新</button>
      <a class="open-original" href="${siteUrl}" target="_blank" rel="noopener">原页面</a>
      <button id="closeButton" type="button">关闭</button>
    </div>
  </header>
  <iframe id="previewFrame" src="${siteUrl}" title="${escapeHtml(title || id)}" allow="fullscreen; autoplay; gamepad; clipboard-read; clipboard-write" data-src="${siteUrl}"></iframe>
  <script>
    const frame = document.getElementById('previewFrame');
    const baseUrl = frame.dataset.src;
    document.getElementById('refreshButton').addEventListener('click', () => {
      frame.src = baseUrl + (baseUrl.includes('?') ? '&' : '?') + '_refresh=' + Date.now();
      requestAnimationFrame(() => frame.focus());
    });
    document.getElementById('closeButton').addEventListener('click', () => {
      window.close();
    });
    window.addEventListener('load', () => {
      requestAnimationFrame(() => frame.focus());
    });
  </script>
</body>
</html>`;
}

function createApp(options = {}) {
  const app = express();
  const dataFile = options.dataFile || path.join(process.cwd(), 'data', 'sites.json');
  const classesFile = options.classesFile || path.join(process.cwd(), 'data', 'classes.json');
  const settingsFile = options.settingsFile || path.join(process.cwd(), 'data', 'settings.json');
  const aiSettingsFile = options.aiSettingsFile || path.join(process.cwd(), 'data', 'private-ai-settings.json');
  const storageDir = options.storageDir || path.join(process.cwd(), 'storage', 'sites');
  const thumbnailDir = options.thumbnailDir || path.join(process.cwd(), 'storage', 'thumbnails');
  const publicDir = options.publicDir || path.join(process.cwd(), 'public');
  const idGenerator = options.idGenerator || createDefaultId;
  const maxTotalBytes = options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES;
  const fallbackAdminPassword = options.adminPassword || DEFAULT_ADMIN_PASSWORD;
  const gitSyncNow = options.gitSyncNow || syncDataToGithubNow;
  const aiOptimizeJobTimeoutMs = normalizeTimeoutMs(
    options.llmOptimizeJobTimeoutMs ?? process.env.LLM_OPTIMIZE_JOB_TIMEOUT_MS,
    300000,
    600000
  );
  const aiOptimizeConcurrency = Math.max(1, Math.min(2, Number.parseInt(
    options.aiOptimizeConcurrency ?? process.env.AI_OPTIMIZE_CONCURRENCY ?? '1',
    10
  ) || 1));
  const aiOptimizeJobs = new Map();
  const aiOptimizeQueue = [];
  let runningAiOptimizeJobs = 0;

  const upload = multer({
    storage: multer.memoryStorage(),
    preservePath: true,
    limits: {
      files: 1,
      fileSize: maxTotalBytes
    }
  });

  async function getAdminPassword() {
    const settings = await readSettings(settingsFile);
    return isValidAdminPassword(settings.adminPassword) ? settings.adminPassword : fallbackAdminPassword;
  }

  async function hasAdminAccess(req) {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[ADMIN_COOKIE_NAME] === createAdminToken(await getAdminPassword());
  }

  function hasClassAccess(req, classItem) {
    if (classItem.passwordEnabled === false) {
      return true;
    }

    const cookies = parseCookies(req.headers.cookie);
    return cookies[getClassCookieName(classItem.id)] === createClassToken(classItem);
  }

  function hasAllAccess(req, settings) {
    if (settings.allPasswordEnabled === false) {
      return true;
    }

    const cookies = parseCookies(req.headers.cookie);
    return cookies[ALL_COOKIE_NAME] === createAllToken(settings);
  }

  async function requireAdmin(req, res, next) {
    try {
      if (!(await hasAdminAccess(req))) {
        return res.status(401).json({ error: '请先输入后台密码' });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function getLlmConfig() {
    const aiSettings = await readAiSettings(aiSettingsFile);
    return mergeLlmConfig(options, aiSettings);
  }

  async function getPublicAiSettings() {
    const aiSettings = await readAiSettings(aiSettingsFile);
    const llmConfig = mergeLlmConfig(options, aiSettings);
    return toPublicAiSettings({ aiSettings, llmConfig });
  }

  async function canReadSite(req, id) {
    const sites = await readSites(dataFile);
    const site = sites.find((item) => item.id === id);
    if (!site?.classId) {
      return true;
    }

    if (await hasAdminAccess(req)) {
      return true;
    }

    const settings = await readSettings(settingsFile);
    if (hasAllAccess(req, settings)) {
      return true;
    }

    const classes = await readClasses(classesFile);
    const classItem = classes.find((item) => item.id === site.classId);
    return classItem ? hasClassAccess(req, classItem) : true;
  }

  function generateThumbnailLater(id, origin) {
    setTimeout(async () => {
      try {
        const adminToken = createAdminToken(await getAdminPassword());
        await generateSiteThumbnail({ id, origin, thumbnailDir, adminToken });
      } catch (error) {
        console.warn(`[Thumbnail] Failed to generate ${id}: ${error.message}`);
      }
    }, 0);
  }

  function cleanupAiOptimizeJobs() {
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [jobId, job] of aiOptimizeJobs.entries()) {
      if (['success', 'error'].includes(job.status) && now - Date.parse(job.finishedAt || job.updatedAt || job.createdAt) > maxAgeMs) {
        aiOptimizeJobs.delete(jobId);
      }
    }
  }

  function toAiOptimizeJobResponse(job) {
    return {
      jobId: job.id,
      siteId: job.siteId,
      siteTitle: job.siteTitle,
      status: job.status,
      phase: job.phase,
      message: job.message,
      error: job.error || '',
      model: job.model || '',
      result: job.result || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt || ''
    };
  }

  function findActiveAiOptimizeJob(siteId) {
    return Array.from(aiOptimizeJobs.values()).find((job) => (
      job.siteId === siteId && ['queued', 'running'].includes(job.status)
    ));
  }

  function updateAiOptimizeJob(job, patch) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  }

  function enqueueAiOptimizeJob(job) {
    aiOptimizeQueue.push(job.id);
    setTimeout(processAiOptimizeQueue, 0);
  }

  function processAiOptimizeQueue() {
    while (runningAiOptimizeJobs < aiOptimizeConcurrency && aiOptimizeQueue.length) {
      const jobId = aiOptimizeQueue.shift();
      const job = aiOptimizeJobs.get(jobId);
      if (!job || job.status !== 'queued') {
        continue;
      }

      runningAiOptimizeJobs += 1;
      runAiOptimizeJob(job).finally(() => {
        runningAiOptimizeJobs = Math.max(0, runningAiOptimizeJobs - 1);
        cleanupAiOptimizeJobs();
        processAiOptimizeQueue();
      });
    }
  }

  async function runAiOptimizeJob(job) {
    updateAiOptimizeJob(job, {
      status: 'running',
      phase: 'calling_ai',
      message: `正在调用 AI 优化「${job.siteTitle}」`
    });

    try {
      const optimizedContent = await optimizeHtmlWithLlm({
        htmlContent: job.htmlContent,
        siteTitle: job.siteTitle,
        instruction: job.instruction,
        llmConfig: {
          ...job.llmConfig,
          timeoutMs: aiOptimizeJobTimeoutMs
        }
      });

      updateAiOptimizeJob(job, {
        phase: 'saving',
        message: `AI 已返回，正在保存「${job.siteTitle}」`
      });

      const latestSites = await readSites(dataFile);
      const latestSiteIndex = latestSites.findIndex((item) => item.id === job.siteId);
      if (latestSiteIndex === -1) {
        throw new Error('项目不存在');
      }

      await fsp.writeFile(path.join(storageDir, job.siteId, 'index.html'), optimizedContent);

      const site = clearDuplicateAudit({
        ...latestSites[latestSiteIndex],
        updatedAt: new Date().toISOString()
      });
      latestSites[latestSiteIndex] = site;
      await writeSites(dataFile, latestSites);
      generateThumbnailLater(job.siteId, job.origin);

      const classes = await readClasses(classesFile);
      updateAiOptimizeJob(job, {
        status: 'success',
        phase: 'done',
        message: `「${site.title}」AI 优化完成并已保存`,
        finishedAt: new Date().toISOString(),
        result: {
          site: await toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir),
          model: job.llmConfig.model
        }
      });
    } catch (error) {
      updateAiOptimizeJob(job, {
        status: 'error',
        phase: 'error',
        message: `「${job.siteTitle}」AI 优化失败`,
        error: error.message || 'AI 优化失败',
        finishedAt: new Date().toISOString()
      });
    } finally {
      job.htmlContent = '';
    }
  }

  app.use(express.json({ limit: maxTotalBytes }));
  app.use(express.urlencoded({ extended: false, limit: maxTotalBytes }));

  app.get('/admin.html', async (req, res, next) => {
    try {
      if (!(await hasAdminAccess(req))) {
        return res.type('html').send(renderAdminLoginPage());
      }

      return res.sendFile(path.join(publicDir, 'admin.html'));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/admin-login', async (req, res, next) => {
    try {
      const adminPassword = await getAdminPassword();
      const password = String(req.body.password || '');
      if (password !== adminPassword) {
        return res.status(401).type('html').send(renderAdminLoginPage('密码不正确'));
      }

      res.cookie(ADMIN_COOKIE_NAME, createAdminToken(adminPassword), {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });
      return res.redirect(303, '/admin.html');
    } catch (error) {
      return next(error);
    }
  });

  app.use(express.static(publicDir));

  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('/api/sites', async (req, res, next) => {
    try {
      const { classId } = req.query;
      const sites = await readSites(dataFile);
      const classes = await readClasses(classesFile);
      const settings = await readSettings(settingsFile);

      if (classId) {
        const classItem = classes.find((item) => item.id === classId);
        if (!classItem) {
          return res.status(404).json({ error: '班级不存在' });
        }

        if (!hasClassAccess(req, classItem)) {
          const count = sites.filter((site) => site.classId === classId && site.enabled !== false).length;
          return res.status(401).json({ error: '请输入班级密码', count });
        }
      } else if (!hasAllAccess(req, settings)) {
        return res.status(401).json({ error: '请输入全部密码', count: sites.filter((site) => site.enabled !== false).length });
      }

      const filteredSites = classId
        ? sites.filter((site) => site.classId === classId && site.enabled !== false)
        : sites.filter((site) => site.enabled !== false);
      res.json(filteredSites.map((site) => toPublicSite(site, classes, thumbnailDir)));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/classes', async (req, res, next) => {
    try {
      const classes = await readClasses(classesFile);
      res.json(classes.map(toPublicClass));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/classes', requireAdmin, async (req, res, next) => {
    try {
      const classes = await readClasses(classesFile);
      res.json(classes);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/sites', requireAdmin, async (req, res, next) => {
    try {
      const sites = await readSites(dataFile);
      const classes = await readClasses(classesFile);
      const sitesWithStorage = await Promise.all(
        sites.map((site) => toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir))
      );
      res.json(sitesWithStorage);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/settings', requireAdmin, async (req, res, next) => {
    try {
      const settings = await readSettings(settingsFile);
      if (req.query.includeForbiddenWords === 'false') {
        return res.json(toAdminSettingsResponse(settings, { includeForbiddenWords: false }));
      }

      return res.json(toAdminSettingsResponse(settings));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/forbidden-words', requireAdmin, async (req, res, next) => {
    try {
      const settings = await readSettings(settingsFile);
      const words = Array.isArray(settings.forbiddenWords) ? settings.forbiddenWords : [];
      const query = String(req.query.q || '').trim();
      const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
      const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
      const normalizedQuery = query.toLocaleLowerCase();
      const filteredWords = normalizedQuery
        ? words
          .map((word, originalIndex) => ({ word, rank: rankForbiddenWordMatch(word, normalizedQuery, originalIndex) }))
          .filter((item) => item.rank.matchIndex !== -1)
          .sort(compareForbiddenWordMatches)
          .map((item) => item.word)
        : words;

      return res.json({
        words: filteredWords.slice(offset, offset + limit),
        total: filteredWords.length,
        allTotal: words.length,
        query,
        offset,
        limit
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/forbidden-words', requireAdmin, async (req, res, next) => {
    try {
      const previousSettings = await readSettings(settingsFile);
      const previousWords = Array.isArray(previousSettings.forbiddenWords) ? previousSettings.forbiddenWords : [];
      const addedWords = normalizeForbiddenWords(req.body.forbiddenWords);
      const forbiddenWords = normalizeForbiddenWords([...previousWords, ...addedWords]);
      const settings = {
        ...previousSettings,
        forbiddenWords,
        updatedAt: new Date().toISOString()
      };

      await writeSettings(settingsFile, settings);
      return res.status(201).json({
        added: forbiddenWords.length - previousWords.length,
        total: forbiddenWords.length
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/admin/forbidden-words', requireAdmin, async (req, res, next) => {
    try {
      const word = String(req.body.word || '').trim();
      if (!word) {
        return res.status(400).json({ error: '请选择要删除的违禁词' });
      }

      const previousSettings = await readSettings(settingsFile);
      const previousWords = Array.isArray(previousSettings.forbiddenWords) ? previousSettings.forbiddenWords : [];
      const normalizedWord = word.toLocaleLowerCase();
      const forbiddenWords = previousWords.filter((item) => String(item).toLocaleLowerCase() !== normalizedWord);
      const removed = previousWords.length - forbiddenWords.length;

      if (!removed) {
        return res.status(404).json({ error: '违禁词不存在' });
      }

      const settings = {
        ...previousSettings,
        forbiddenWords,
        updatedAt: new Date().toISOString()
      };

      await writeSettings(settingsFile, settings);
      return res.json({
        removed,
        total: forbiddenWords.length
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/upload-rules', async (req, res, next) => {
    try {
      const settings = await readSettings(settingsFile);
      return res.json({
        forbiddenWords: settings.forbiddenWords
      });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/admin/settings', requireAdmin, async (req, res, next) => {
    try {
      const previousSettings = await readSettings(settingsFile);
      const allPassword = req.body.allPassword === undefined
        ? previousSettings.allPassword
        : String(req.body.allPassword || '').trim();
      const adminPassword = req.body.adminPassword === undefined
        ? previousSettings.adminPassword
        : String(req.body.adminPassword || '').trim();
      if (!isValidClassPassword(allPassword)) {
        return res.status(400).json({ error: '全部密码必须是 6 位数字' });
      }
      if (req.body.adminPassword !== undefined && !isValidAdminPassword(adminPassword)) {
        return res.status(400).json({ error: '后台密码必须是 4 到 40 位，且不能包含空格' });
      }

      const settings = {
        ...previousSettings,
        allPassword,
        adminPassword,
        allPasswordEnabled: req.body.allPasswordEnabled === undefined
          ? previousSettings.allPasswordEnabled !== false
          : Boolean(req.body.allPasswordEnabled),
        forbiddenWords: req.body.forbiddenWords === undefined
          ? previousSettings.forbiddenWords
          : normalizeForbiddenWords(req.body.forbiddenWords),
        updatedAt: new Date().toISOString()
      };
      await writeSettings(settingsFile, settings);
      if (req.body.adminPassword !== undefined) {
        res.cookie(ADMIN_COOKIE_NAME, createAdminToken(adminPassword), {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 24 * 60 * 60 * 1000
        });
      }
      if (req.query.includeForbiddenWords === 'false') {
        return res.json(toAdminSettingsResponse(settings, { includeForbiddenWords: false }));
      }

      return res.json(toAdminSettingsResponse(settings));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/github-sync', requireAdmin, async (req, res) => {
    try {
      const result = await gitSyncNow();
      return res.json(result);
    } catch (error) {
      const status = error.code === 'SYNC_BUSY' ? 409 : 500;
      return res.status(status).json({
        error: error.code === 'SYNC_BUSY'
          ? error.message
          : `同步到 GitHub 失败：${error.message}`
      });
    }
  });

  app.get('/api/admin/ai-settings', requireAdmin, async (req, res, next) => {
    try {
      return res.json(await getPublicAiSettings());
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/admin/ai-settings', requireAdmin, async (req, res, next) => {
    try {
      const previousSettings = await readAiSettings(aiSettingsFile);
      const nextSettings = {
        ...previousSettings
      };

      if (req.body.clearApiKey === true) {
        nextSettings.apiKey = '';
      } else if (typeof req.body.apiKey === 'string' && req.body.apiKey.trim()) {
        nextSettings.apiKey = req.body.apiKey.trim();
      }

      if (req.body.baseUrl !== undefined) {
        nextSettings.baseUrl = String(req.body.baseUrl || '').trim();
      }

      if (req.body.model !== undefined) {
        nextSettings.model = String(req.body.model || '').trim();
      }

      if (req.body.temperature !== undefined) {
        nextSettings.temperature = normalizeTemperature(req.body.temperature, previousSettings.temperature);
      }

      if (req.body.nameTemperature !== undefined) {
        nextSettings.nameTemperature = normalizeTemperature(req.body.nameTemperature, previousSettings.nameTemperature);
      }

      if (req.body.thinkingType !== undefined) {
        nextSettings.thinkingType = String(req.body.thinkingType || '').trim();
      }

      const savedSettings = await writeAiSettings(aiSettingsFile, nextSettings);
      const llmConfig = mergeLlmConfig(options, savedSettings);
      return res.json(toPublicAiSettings({ aiSettings: savedSettings, llmConfig }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/classes', requireAdmin, async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim();
      const password = String(req.body.password || createClassPassword()).trim();
      if (!name) {
        return res.status(400).json({ error: '班级名称不能为空' });
      }

      if (!isValidClassPassword(password)) {
        return res.status(400).json({ error: '班级密码必须是 6 位数字' });
      }

      const classes = await readClasses(classesFile);
      if (classes.some((item) => item.name === name)) {
        return res.status(400).json({ error: '班级名称已存在' });
      }

      const classItem = {
        id: idGenerator(),
        name,
        password,
        uploadEnabled: true,
        passwordEnabled: true,
        createdAt: new Date().toISOString()
      };
      classes.push(classItem);
      await writeClasses(classesFile, classes);

      return res.status(201).json(classItem);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/classes/order', requireAdmin, async (req, res, next) => {
    try {
      const { classIds } = req.body;
      if (!Array.isArray(classIds)) {
        return res.status(400).json({ error: '无效的排序数据' });
      }

      const classes = await readClasses(classesFile);
      const newClasses = [];
      
      for (const id of classIds) {
        const classItem = classes.find(c => c.id === id);
        if (classItem) {
          newClasses.push(classItem);
        }
      }

      for (const classItem of classes) {
        if (!classIds.includes(classItem.id)) {
          newClasses.push(classItem);
        }
      }

      await writeClasses(classesFile, newClasses);
      return res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/classes/:id', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const name = String(req.body.name || '').trim();
      const password = String(req.body.password || '').trim();
      const classes = await readClasses(classesFile);
      const classIndex = classes.findIndex((item) => item.id === id);

      if (classIndex === -1) {
        return res.status(404).json({ error: '班级不存在' });
      }

      if (!name) {
        return res.status(400).json({ error: '班级名称不能为空' });
      }

      if (classes.some((item) => item.id !== id && item.name === name)) {
        return res.status(400).json({ error: '班级名称已存在' });
      }

      if (password && !isValidClassPassword(password)) {
        return res.status(400).json({ error: '班级密码必须是 6 位数字' });
      }

      classes[classIndex] = {
        ...classes[classIndex],
        name,
        password: password || classes[classIndex].password || createClassPassword(),
        uploadEnabled: classes[classIndex].uploadEnabled !== false,
        passwordEnabled: classes[classIndex].passwordEnabled !== false,
        updatedAt: new Date().toISOString()
      };
      await writeClasses(classesFile, classes);

      return res.json(classes[classIndex]);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/classes/:id/upload-enabled', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const uploadEnabled = Boolean(req.body.uploadEnabled);
      const classes = await readClasses(classesFile);
      const classIndex = classes.findIndex((item) => item.id === id);

      if (classIndex === -1) {
        return res.status(404).json({ error: '班级不存在' });
      }

      classes[classIndex] = {
        ...classes[classIndex],
        uploadEnabled,
        updatedAt: new Date().toISOString()
      };
      await writeClasses(classesFile, classes);

      return res.json(classes[classIndex]);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/classes/:id/password-enabled', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const passwordEnabled = Boolean(req.body.passwordEnabled);
      const classes = await readClasses(classesFile);
      const classIndex = classes.findIndex((item) => item.id === id);

      if (classIndex === -1) {
        return res.status(404).json({ error: '班级不存在' });
      }

      classes[classIndex] = {
        ...classes[classIndex],
        passwordEnabled,
        updatedAt: new Date().toISOString()
      };
      await writeClasses(classesFile, classes);

      return res.json(classes[classIndex]);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/classes/:id/unlock', async (req, res, next) => {
    try {
      const { id } = req.params;
      const password = String(req.body.password || '').trim();
      const classes = await readClasses(classesFile);
      const classItem = classes.find((item) => item.id === id);

      if (!classItem) {
        return res.status(404).json({ error: '班级不存在' });
      }

      if (classItem.passwordEnabled === false) {
        return res.json({ ok: true });
      }

      if (password !== classItem.password) {
        return res.status(401).json({ error: '班级密码不正确' });
      }

      res.cookie(getClassCookieName(id), createClassToken(classItem), {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });
      return res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/all/unlock', async (req, res, next) => {
    try {
      const password = String(req.body.password || '').trim();
      const settings = await readSettings(settingsFile);

      if (settings.allPasswordEnabled === false) {
        return res.json({ ok: true });
      }

      if (password !== settings.allPassword) {
        return res.status(401).json({ error: '全部密码不正确' });
      }

      res.cookie(ALL_COOKIE_NAME, createAllToken(settings), {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });
      return res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/classes/:id', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const classes = await readClasses(classesFile);
      const sites = await readSites(dataFile);

      if (!classes.some((item) => item.id === id)) {
        return res.status(404).json({ error: '班级不存在' });
      }

      if (sites.some((site) => site.classId === id)) {
        return res.status(400).json({ error: '班级下还有项目，不能删除' });
      }

      await writeClasses(classesFile, classes.filter((item) => item.id !== id));
      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get('/thumbnails/:id.png', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!(await canReadSite(req, id))) {
        return res.status(401).send('请输入班级密码');
      }

      const thumbnailPath = getThumbnailPath(thumbnailDir, id);
      if (!fs.existsSync(thumbnailPath)) {
        return res.status(404).send('Not found');
      }

      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(thumbnailPath);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sites', upload.single('file'), async (req, res, next) => {
      try {
        const title = String(req.body.title || '').trim();
        const author = String(req.body.author || '').trim();
        const classId = String(req.body.classId || '').trim();
      const htmlContent = String(req.body.htmlContent || '').trim();
      const file = req.file;
      const classes = await readClasses(classesFile);
      const classItem = classes.find((item) => item.id === classId);

      if (!title) {
        return res.status(400).json({ error: '网页名字不能为空' });
      }

      if (!author) {
        return res.status(400).json({ error: '作者署名不能为空' });
      }

      const settings = await readSettings(settingsFile);
      const forbiddenMatch = findForbiddenWordMatch({ title, author }, settings.forbiddenWords);
      if (forbiddenMatch) {
        return res.status(400).json({ error: createForbiddenWordError(forbiddenMatch) });
      }

      if (!classItem) {
        return res.status(400).json({ error: '请选择有效班级' });
      }

      if (classItem.uploadEnabled === false) {
        return res.status(403).json({ error: '当前班级已禁用上传网页功能' });
      }

      if (!file && !htmlContent) {
        return res.status(400).json({ error: '请上传 HTML 文件或填写 HTML 代码' });
      }

      if (file && !isHtmlFile(file)) {
        return res.status(400).json({ error: '当前版本只支持上传 HTML 文件' });
      }

      const id = await createUniqueId({ dataFile, storageDir, idGenerator });
      const projectDir = path.join(storageDir, id);
      await fsp.mkdir(projectDir, { recursive: true });
      await fsp.writeFile(path.join(projectDir, 'index.html'), file ? file.buffer : htmlContent);

      const sites = await readSites(dataFile);
      const currentMax = sites.reduce((max, s) => Math.max(max, getSiteNumberValue(s)), 0);
      const nextNumberValue = Math.max(currentMax, settings.lastUsedSiteNumber || 0) + 1;

      const site = {
        id,
        number: formatSiteNumber(nextNumberValue),
        title,
        author,
        classId,
        enabled: true,
        starred: false,
        forbiddenWhitelist: false,
        createdAt: new Date().toISOString()
      };
      sites.unshift(site);
      await writeSites(dataFile, sites);

      settings.lastUsedSiteNumber = nextNumberValue;
      await writeSettings(settingsFile, settings);

      generateThumbnailLater(id, getRequestOrigin(req));

      return res.status(201).json(await toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sites/:id/thumbnail', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const sites = await readSites(dataFile);
      const site = sites.find((item) => item.id === id);

      if (!site) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const result = await generateSiteThumbnail({
        id,
        origin: getRequestOrigin(req),
        thumbnailDir,
        adminToken: createAdminToken(await getAdminPassword())
      });
      return res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/thumbnails', requireAdmin, async (req, res, next) => {
    try {
      const sites = await readSites(dataFile);
      const requestedIds = Array.isArray(req.body.siteIds)
        ? new Set(req.body.siteIds.map((id) => String(id)))
        : null;
      const targetSites = requestedIds
        ? sites.filter((site) => requestedIds.has(site.id))
        : sites;
      const generated = [];
      const failed = [];
      const origin = getRequestOrigin(req);
      const adminToken = createAdminToken(await getAdminPassword());

      for (const site of targetSites) {
        try {
          generated.push(await generateSiteThumbnail({
            id: site.id,
            origin,
            thumbnailDir,
            adminToken
          }));
        } catch (error) {
          failed.push({ id: site.id, error: error.message });
        }
      }

      return res.json({ generated, failed });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/sites/forbidden-audit', requireAdmin, async (req, res, next) => {
    try {
      const sites = await readSites(dataFile);
      const settings = await readSettings(settingsFile);
      const forbiddenWords = Array.isArray(settings.forbiddenWords) ? settings.forbiddenWords : [];
      const matches = [];
      let disabledCount = 0;
      let changed = false;

      const nextSites = sites.map((site) => {
        if (site.forbiddenWhitelist === true) {
          const clearedSite = clearForbiddenAudit(site);
          if (clearedSite !== site) {
            changed = true;
          }
          return clearedSite;
        }

        const match = findForbiddenWordMatch(
          { title: site.title || '', author: site.author || '' },
          forbiddenWords
        );

        if (!match) {
          const clearedSite = clearForbiddenAudit(site);
          if (clearedSite !== site) {
            changed = true;
          }
          return clearedSite;
        }

        const auditMessage = createForbiddenAuditMessage(match);
        matches.push({
          id: site.id,
          title: site.title,
          author: site.author || '',
          field: match.field,
          word: match.word,
          message: auditMessage,
          wasEnabled: site.enabled !== false
        });

        const nextSite = {
          ...site,
          forbiddenAuditField: match.field,
          forbiddenAuditWord: match.word,
          forbiddenAuditMessage: auditMessage
        };

        if (site.enabled !== false) {
          disabledCount += 1;
          nextSite.enabled = false;
        }

        if (
          site.enabled !== nextSite.enabled
          || site.forbiddenAuditField !== nextSite.forbiddenAuditField
          || site.forbiddenAuditWord !== nextSite.forbiddenAuditWord
          || site.forbiddenAuditMessage !== nextSite.forbiddenAuditMessage
        ) {
          changed = true;
          nextSite.updatedAt = new Date().toISOString();
        }

        return nextSite;
      });

      if (changed) {
        await writeSites(dataFile, nextSites);
      }

      return res.json({
        checked: sites.filter((site) => site.forbiddenWhitelist !== true).length,
        skipped: sites.filter((site) => site.forbiddenWhitelist === true).length,
        matched: matches.length,
        disabled: disabledCount,
        matches
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/sites/dedupe', requireAdmin, async (req, res, next) => {
    try {
      const sites = await readSites(dataFile);
      const groups = new Map();

      for (const site of sites) {
        const fingerprint = await getSiteHtmlFingerprint(storageDir, site.id);
        if (!fingerprint) {
          continue;
        }

        if (!groups.has(fingerprint)) {
          groups.set(fingerprint, []);
        }
        groups.get(fingerprint).push(site);
      }

      let disabledCount = 0;
      let duplicateGroups = 0;
      const matches = [];
      const duplicateAuditById = new Map();

      for (const groupSites of groups.values()) {
        if (groupSites.length < 2) {
          continue;
        }

        duplicateGroups += 1;
        const orderedSites = [...groupSites].sort(compareSitesByCreatedAt);
        const keepSite = orderedSites[0];
        const auditMessage = createDuplicateAuditMessage(keepSite);
        for (const duplicateSite of orderedSites.slice(1)) {
          duplicateAuditById.set(duplicateSite.id, {
            duplicateAuditKeepId: keepSite.id,
            duplicateAuditKeepTitle: keepSite.title || '',
            duplicateAuditMessage: auditMessage
          });
          matches.push({
            id: duplicateSite.id,
            title: duplicateSite.title || '',
            keepId: keepSite.id,
            keepTitle: keepSite.title || '',
            message: auditMessage,
            wasEnabled: duplicateSite.enabled !== false
          });
        }
      }

      const now = new Date().toISOString();
      const nextSites = sites.map((site) => {
        const duplicateAudit = duplicateAuditById.get(site.id);
        if (!duplicateAudit) {
          return clearDuplicateAudit(site);
        }

        const nextSite = {
          ...site,
          ...duplicateAudit,
          enabled: false
        };

        if (site.enabled !== false) {
          disabledCount += 1;
        }

        if (
          site.enabled !== nextSite.enabled
          || site.duplicateAuditKeepId !== nextSite.duplicateAuditKeepId
          || site.duplicateAuditKeepTitle !== nextSite.duplicateAuditKeepTitle
          || site.duplicateAuditMessage !== nextSite.duplicateAuditMessage
        ) {
          return {
            ...nextSite,
            updatedAt: now
          };
        }

        return site;
      });

      if (JSON.stringify(nextSites) !== JSON.stringify(sites)) {
        await writeSites(dataFile, nextSites);
      }

      return res.json({
        checked: sites.length,
        duplicateGroups,
        duplicates: matches.length,
        disabled: disabledCount,
        matches
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/sites/enable-all', requireAdmin, async (req, res, next) => {
    try {
      const sites = await readSites(dataFile);
      const now = new Date().toISOString();
      let enabledCount = 0;
      const nextSites = sites.map((site) => {
        if (site.enabled !== false) {
          return site;
        }

        enabledCount += 1;
        return {
          ...site,
          enabled: true,
          updatedAt: now
        };
      });

      if (enabledCount) {
        await writeSites(dataFile, nextSites);
      }

      return res.json({
        checked: sites.length,
        enabled: enabledCount
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/sites/:id/enabled', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const enabled = Boolean(req.body.enabled);
      const sites = await readSites(dataFile);
      const siteIndex = sites.findIndex((site) => site.id === id);

      if (siteIndex === -1) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const site = {
        ...sites[siteIndex],
        enabled,
        updatedAt: new Date().toISOString()
      };
      sites[siteIndex] = site;
      await writeSites(dataFile, sites);

      const classes = await readClasses(classesFile);
      return res.json(await toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir));
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/sites/:id/forbidden-whitelist', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const forbiddenWhitelist = Boolean(req.body.forbiddenWhitelist);
      const sites = await readSites(dataFile);
      const siteIndex = sites.findIndex((site) => site.id === id);

      if (siteIndex === -1) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const site = clearForbiddenAudit({
        ...sites[siteIndex],
        forbiddenWhitelist,
        updatedAt: new Date().toISOString()
      });
      sites[siteIndex] = site;
      await writeSites(dataFile, sites);

      const classes = await readClasses(classesFile);
      return res.json(await toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir));
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/sites/:id/starred', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const starred = Boolean(req.body.starred);
      const sites = await readSites(dataFile);
      const siteIndex = sites.findIndex((site) => site.id === id);

      if (siteIndex === -1) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const site = {
        ...sites[siteIndex],
        starred,
        updatedAt: new Date().toISOString()
      };
      sites[siteIndex] = site;
      await writeSites(dataFile, sites);

      const classes = await readClasses(classesFile);
      return res.json(await toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/sites/:id/download', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const sites = await readSites(dataFile);
      const site = sites.find((item) => item.id === id);
      if (!site) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const indexPath = path.join(storageDir, id, 'index.html');
      if (!fs.existsSync(indexPath)) {
        return res.status(404).json({ error: '项目文件不存在' });
      }

      return res.download(indexPath, createDownloadFileName(site), (error) => {
        if (error && !res.headersSent) {
          next(error);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/sites/:id/code', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const sites = await readSites(dataFile);
      const site = sites.find((item) => item.id === id);
      if (!site) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const indexPath = path.join(storageDir, id, 'index.html');
      if (!fs.existsSync(indexPath)) {
        return res.status(404).json({ error: '项目文件不存在' });
      }

      const htmlContent = await fsp.readFile(indexPath, 'utf8');
      const updatedSite = await incrementSiteUsage(dataFile, id, 'code') || site;
      return res.json({
        ...(await toPublicSiteWithStorage(updatedSite, await readClasses(classesFile), thumbnailDir, storageDir)),
        htmlContent
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/sites/:id/public-code', async (req, res, next) => {
    try {
      const { id } = req.params;
      const sites = await readSites(dataFile);
      const site = sites.find((item) => item.id === id);

      if (!site) {
        return res.status(404).json({ error: '项目不存在' });
      }

      if (site.enabled === false && !(await hasAdminAccess(req))) {
        return res.status(404).json({ error: '项目不存在' });
      }

      if (!(await canReadSite(req, id))) {
        return res.status(401).json({ error: '请输入班级密码' });
      }

      let projectDir;
      try {
        projectDir = resolveInside(storageDir, id);
      } catch {
        return res.status(404).json({ error: '项目不存在' });
      }

      if (!fs.existsSync(projectDir)) {
        return res.status(404).json({ error: '项目文件不存在' });
      }

      const { files, combinedText } = await readProjectCodeSnapshot(projectDir);
      const updatedSite = await incrementSiteUsage(dataFile, id, 'code') || site;
      const classes = await readClasses(classesFile);
      return res.json({
        ...toPublicSite(updatedSite, classes, thumbnailDir),
        files,
        combinedText
      });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/sites/:id/code', requireAdmin, upload.single('file'), async (req, res, next) => {
    try {
      const { id } = req.params;
      const file = req.file;
      const htmlContent = String(req.body.htmlContent || '');
      const sites = await readSites(dataFile);
      const siteIndex = sites.findIndex((site) => site.id === id);

      if (siteIndex === -1) {
        return res.status(404).json({ error: '项目不存在' });
      }

      if (file && !isHtmlFile(file)) {
        return res.status(400).json({ error: '当前版本只支持替换 HTML 文件' });
      }

      if (!file && !htmlContent.trim()) {
        return res.status(400).json({ error: '代码不能为空' });
      }

      const projectDir = path.join(storageDir, id);
      await fsp.mkdir(projectDir, { recursive: true });
      await fsp.writeFile(path.join(projectDir, 'index.html'), file ? file.buffer : htmlContent);

      const site = clearDuplicateAudit({
        ...sites[siteIndex],
        updatedAt: new Date().toISOString()
      });
      sites[siteIndex] = site;
      await writeSites(dataFile, sites);
      generateThumbnailLater(id, getRequestOrigin(req));

      const classes = await readClasses(classesFile);
      return res.json(await toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sites/:id/ai-optimize-code', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const htmlContent = String(req.body.htmlContent || '');
      const instruction = String(req.body.instruction || '').trim();
      const sites = await readSites(dataFile);
      const site = sites.find((item) => item.id === id);

      if (!site) {
        return res.status(404).json({ error: '项目不存在' });
      }

      if (!htmlContent.trim()) {
        return res.status(400).json({ error: '代码不能为空' });
      }

      const llmConfig = await getLlmConfig();
      const optimizedContent = await optimizeHtmlWithLlm({
        htmlContent,
        siteTitle: site.title,
        instruction,
        llmConfig
      });

      return res.json({
        htmlContent: optimizedContent,
        model: llmConfig.model
      });
    } catch (error) {
      return res.status(error.message.includes('配置') ? 400 : 502).json({ error: error.message });
    }
  });

  app.post('/api/sites/:id/ai-optimize-save', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const instruction = String(req.body?.instruction || '').trim();
      const sites = await readSites(dataFile);
      const siteIndex = sites.findIndex((item) => item.id === id);

      if (siteIndex === -1) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const indexPath = path.join(storageDir, id, 'index.html');
      if (!fs.existsSync(indexPath)) {
        return res.status(404).json({ error: '项目文件不存在' });
      }

      const htmlContent = await fsp.readFile(indexPath, 'utf8');
      if (!htmlContent.trim()) {
        return res.status(400).json({ error: '代码不能为空' });
      }

      const llmConfig = await getLlmConfig();
      if (!llmConfig.apiKey) {
        return res.status(400).json({ error: '请先在后台设置中配置 API Key，或在服务器环境变量中配置 LLM_API_KEY / OPENAI_API_KEY' });
      }

      const activeJob = findActiveAiOptimizeJob(id);
      if (activeJob) {
        return res.status(202).json(toAiOptimizeJobResponse(activeJob));
      }

      const now = new Date().toISOString();
      const job = {
        id: createDefaultId(),
        siteId: id,
        siteTitle: sites[siteIndex].title || id,
        instruction,
        htmlContent,
        llmConfig,
        origin: getRequestOrigin(req),
        model: llmConfig.model,
        status: 'queued',
        phase: 'queued',
        message: `「${sites[siteIndex].title || id}」已加入 AI 优化队列`,
        createdAt: now,
        updatedAt: now,
        finishedAt: '',
        result: null,
        error: ''
      };
      aiOptimizeJobs.set(job.id, job);
      enqueueAiOptimizeJob(job);
      return res.status(202).json(toAiOptimizeJobResponse(job));
    } catch (error) {
      return res.status(error.message.includes('配置') ? 400 : 502).json({ error: error.message });
    }
  });

  app.get('/api/admin/ai-optimize-jobs/:jobId', requireAdmin, async (req, res) => {
    const job = aiOptimizeJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'AI 优化任务不存在或已过期' });
    }

    return res.json(toAiOptimizeJobResponse(job));
  });

  app.post('/api/sites/:id/ai-name', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const sites = await readSites(dataFile);
      const siteIndex = sites.findIndex((item) => item.id === id);

      if (siteIndex === -1) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const projectDir = path.join(storageDir, id);
      if (!fs.existsSync(projectDir)) {
        return res.status(404).json({ error: '项目文件不存在' });
      }

      const { combinedText } = await readProjectCodeSnapshot(projectDir);
      if (!combinedText.trim()) {
        return res.status(400).json({ error: '项目代码为空' });
      }

      const llmConfig = await getLlmConfig();
      const title = await nameSiteWithLlm({
        codeSnapshot: combinedText,
        currentTitle: sites[siteIndex].title,
        author: sites[siteIndex].author,
        llmConfig
      });

      if (sites[siteIndex].forbiddenWhitelist !== true) {
        const settings = await readSettings(settingsFile);
        const forbiddenMatch = findForbiddenWordMatch(
          { title, author: sites[siteIndex].author || '' },
          settings.forbiddenWords
        );
        if (forbiddenMatch) {
          return res.status(400).json({ error: createForbiddenWordError(forbiddenMatch) });
        }
      }

      const latestSites = await readSites(dataFile);
      const latestSiteIndex = latestSites.findIndex((item) => item.id === id);
      if (latestSiteIndex === -1) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const site = clearForbiddenAudit({
        ...latestSites[latestSiteIndex],
        title,
        updatedAt: new Date().toISOString()
      });
      latestSites[latestSiteIndex] = site;
      await writeSites(dataFile, latestSites);

      const classes = await readClasses(classesFile);
      return res.json({
        site: await toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir),
        title,
        model: llmConfig.model
      });
    } catch (error) {
      return res.status(error.message.includes('配置') ? 400 : 502).json({ error: error.message });
    }
  });

  app.put('/api/sites/:id', requireAdmin, upload.single('file'), async (req, res, next) => {
      try {
        const { id } = req.params;
        const title = String(req.body.title || '').trim();
        const author = String(req.body.author || '').trim();
        const classId = String(req.body.classId || '').trim();
      const file = req.file;
      const sites = await readSites(dataFile);
      const classes = await readClasses(classesFile);
      const classItem = classes.find((item) => item.id === classId);
      const siteIndex = sites.findIndex((site) => site.id === id);

      if (siteIndex === -1) {
        return res.status(404).json({ error: '项目不存在' });
      }

      if (!title) {
        return res.status(400).json({ error: '网页名字不能为空' });
      }

      if (!author) {
        return res.status(400).json({ error: '作者署名不能为空' });
      }

      if (sites[siteIndex].forbiddenWhitelist !== true) {
        const settings = await readSettings(settingsFile);
        const forbiddenMatch = findForbiddenWordMatch({ title, author }, settings.forbiddenWords);
        if (forbiddenMatch) {
          return res.status(400).json({ error: createForbiddenWordError(forbiddenMatch) });
        }
      }

      if (!classItem) {
        return res.status(400).json({ error: '请选择有效班级' });
      }

      if (file && !isHtmlFile(file)) {
        return res.status(400).json({ error: '当前版本只支持上传 HTML 文件' });
      }

      const site = clearForbiddenAudit(file ? clearDuplicateAudit({
        ...sites[siteIndex],
        title,
        author,
        classId,
        updatedAt: new Date().toISOString()
      }) : {
        ...sites[siteIndex],
        title,
        author,
        classId,
        updatedAt: new Date().toISOString()
      });

      if (file) {
        const projectDir = path.join(storageDir, id);
        await fsp.mkdir(projectDir, { recursive: true });
        await fsp.writeFile(path.join(projectDir, 'index.html'), file.buffer);
        generateThumbnailLater(id, getRequestOrigin(req));
      }

      sites[siteIndex] = site;
      await writeSites(dataFile, sites);

      return res.json(await toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir));
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/sites/:id', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const sites = await readSites(dataFile);
      const nextSites = sites.filter((site) => site.id !== id);

      if (nextSites.length === sites.length) {
        return res.status(404).json({ error: '项目不存在' });
      }

      await writeSites(dataFile, nextSites);
      await fsp.rm(path.join(storageDir, id), { recursive: true, force: true });
      await fsp.rm(getThumbnailPath(thumbnailDir, id), { force: true });

      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get('/preview/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const sites = await readSites(dataFile);
      const site = sites.find((item) => item.id === id);
      const projectDir = path.join(storageDir, id);

      if (!site || !fs.existsSync(projectDir)) {
        return res.status(404).send('Not found');
      }

      if (site.enabled === false && !(await hasAdminAccess(req))) {
        return res.status(404).send('Not found');
      }

      if (!(await canReadSite(req, id))) {
        return res.status(401).send('请输入班级密码');
      }

      await incrementSiteUsage(dataFile, id, 'preview');
      return res.type('html').send(renderPreviewPage({ id, title: site.title }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/site/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const projectDir = path.join(storageDir, id);
      const sites = await readSites(dataFile);
      const site = sites.find((item) => item.id === id);

      if (!site || !fs.existsSync(projectDir)) {
        return res.status(404).send('Not found');
      }

      if (site.enabled === false && !(await hasAdminAccess(req))) {
        return res.status(404).send('Not found');
      }

      if (!(await canReadSite(req, id))) {
        return res.status(401).send('请输入班级密码');
      }

      const indexPath = path.join(projectDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }

      const html = await renderFileList({ id, title: site?.title, projectDir });
      return res.type('html').send(html);
    } catch (error) {
      next(error);
    }
  });

  app.get('/site/:id/*', async (req, res) => {
    const { id } = req.params;
    const requestedPath = req.params[0] || '';
    const projectDir = path.join(storageDir, id);
    const sites = await readSites(dataFile);
    const site = sites.find((item) => item.id === id);

    if (!site || !fs.existsSync(projectDir)) {
      return res.status(404).send('Not found');
    }

    if (site.enabled === false && !(await hasAdminAccess(req))) {
      return res.status(404).send('Not found');
    }

    if (!(await canReadSite(req, id))) {
      return res.status(401).send('请输入班级密码');
    }

    let targetPath;
    try {
      targetPath = resolveInside(projectDir, requestedPath);
    } catch {
      return res.status(404).send('Not found');
    }

    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      return res.status(404).send('Not found');
    }

    return res.sendFile(targetPath);
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message || '服务器错误' });
  });

  return app;
}

module.exports = {
  createApp,
  resolveInside
};
