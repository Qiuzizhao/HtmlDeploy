const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const compression = require('compression');
const express = require('express');
const multer = require('multer');
const { createRuntimeStore } = require('./db/runtime-store');

const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const DEFAULT_ADMIN_PASSWORD = 'qqqyyy';
const ADMIN_COOKIE_NAME = 'html_deploy_admin';
const CLASS_COOKIE_PREFIX = 'html_deploy_class_';
const ALL_COOKIE_NAME = 'html_deploy_all';
const MAX_FORBIDDEN_WORDS = 100000;
const THUMBNAIL_URL_CACHE_TTL_MS = 30000;
const THUMBNAIL_EXTENSION = 'jpg';
const THUMBNAIL_SCREENSHOT_TYPE = 'jpeg';
const THUMBNAIL_JPEG_QUALITY = 76;
const LEGACY_THUMBNAIL_EXTENSION = 'png';

const thumbnailUrlCache = new Map();

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

function validateBasicHtmlDocument(htmlContent) {
  const content = String(htmlContent || '').trim();
  if (!content) {
    return '';
  }

  const hasStructuralMarker = /<!doctype\s+html\b|<html[\s>]|<head[\s>]|<body[\s>]/i.test(content);
  const hasHtmlElement = /<\/?(?:html|head|title|meta|link|style|body|main|section|article|nav|header|footer|div|span|p|h[1-6]|canvas|script|button|input|form|label|ul|ol|li|table|thead|tbody|tr|td|th|img|video|audio|svg)\b[^>]*>/i.test(content);

  if (!hasStructuralMarker || !hasHtmlElement) {
    return 'HTML 代码结构不完整，请上传包含 <!doctype html>、<html>、<head>/<body> 等基本结构的完整 HTML 页面。';
  }

  return '';
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
    thinkingOptimize: options.llmThinkingOptimize || process.env.LLM_THINKING_OPTIMIZE || '',
    thinkingName: options.llmThinkingName || process.env.LLM_THINKING_NAME || '',
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
    thinkingOptimize: String(settings.thinkingOptimize || '').trim(),
    thinkingName: String(settings.thinkingName || '').trim(),
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
    thinkingType: normalized.thinkingType || environment.thinkingType || 'enabled',
    thinkingOptimize: normalized.thinkingOptimize || environment.thinkingOptimize,
    thinkingName: normalized.thinkingName || environment.thinkingName,
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
    thinkingType: llmConfig.thinkingType,
    thinkingOptimize: llmConfig.thinkingOptimize,
    thinkingName: llmConfig.thinkingName
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

  const thinkingType = llmConfig.thinkingOptimize || llmConfig.thinkingType;
  if (thinkingType) {
    requestBody.thinking = { type: thinkingType };
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

  const thinkingType = llmConfig.thinkingName || llmConfig.thinkingType;
  if (thinkingType) {
    requestBody.thinking = { type: thinkingType };
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

function parseLlmJsonObject(value) {
  const content = String(value || '').trim();
  const unfenced = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end < start) {
    throw new Error('AI 命名审核没有返回有效 JSON');
  }
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new Error('AI 命名审核返回的 JSON 无法解析');
  }
}

function reviewReasonClearlySaysUnrelated(reason) {
  const content = String(reason || '').replace(/\s+/g, '');
  if (!content) {
    return false;
  }
  if (/(?:无法|不能|难以)(?:准确)?(?:判断|确定).{0,12}(?:关联|相关)/.test(content)) {
    return false;
  }
  return [
    '无明显关联',
    '没有明显关联',
    '无关联',
    '没有关联',
    '无直接关联',
    '没有直接关联',
    '毫无关联',
    '明显无关',
    '完全无关',
    '不相关',
    '与代码无关',
    '与项目无关',
    '与内容无关',
    '标题是乱取',
    '名称是乱取'
  ].some((signal) => content.includes(signal));
}

async function reviewSiteNameWithLlm({ codeSnapshot, currentTitle, author, llmConfig }) {
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
          '你是网页项目名称审核员。请快速阅读项目代码，判断当前名称是否真实描述或关联项目内容。',
          '只有代码中存在可指出的具体内容、功能或可见文案证据时，才能判定名称相关。',
          '猜测作者可能使用缩写、代号或个人意图，不属于相关证据；没有具体证据就应判定无关。',
          '单个无含义字母、随机字符或明显乱取的名称，如果代码没有明确赋予其含义，应判定 related 为 false 且 confidence 为 high。',
          'reason 与 related 必须一致；reason 中出现“无明显关联”“无关”“不相关”时，related 必须为 false。',
          '名称虽然宽泛但仍有关联，或证据不足、无法确定时，应保留名称。',
          '只返回一个 JSON 对象，不要 Markdown，不要额外说明。',
          '格式：{"related":true或false,"confidence":"high或medium或low","reason":"简短中文理由","suggestedTitle":"无论结论如何，都填写一个根据代码生成的最佳名称"}。',
          '建议名称应简短具体，最好 2 到 12 个中文字符，最长不超过 20 个中文字符。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          `当前名称：${currentTitle || '未命名项目'}`,
          author ? `作者：${author}` : '',
          '请审核当前名称与下面项目代码的关联性：',
          String(codeSnapshot || '').slice(0, 60000)
        ].filter(Boolean).join('\n\n')
      }
    ]
  };

  const thinkingType = llmConfig.thinkingName || llmConfig.thinkingType;
  if (thinkingType) {
    requestBody.thinking = { type: thinkingType };
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
    `AI 命名审核服务响应超时（超过 ${Math.round(llmConfig.timeoutMs / 1000)} 秒），请稍后重试`
  );

  if (!response.ok) {
    throw new Error(result.error?.message || result.rawText || `AI 命名审核接口调用失败：${response.status}`);
  }

  const parsed = parseLlmJsonObject(result.choices?.[0]?.message?.content || '');
  if (typeof parsed.related !== 'boolean') {
    throw new Error('AI 命名审核结果缺少有效的 related 字段');
  }
  const confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low';
  return {
    related: parsed.related,
    confidence,
    reason: String(parsed.reason || '').trim().slice(0, 300) || 'AI 未提供具体理由',
    suggestedTitle: normalizeSiteTitle(parsed.suggestedTitle || '')
  };
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

const jsonWriteQueues = new Map();
const runtimeStoresByFile = new Map();

function getDefaultDbFileForDataFile(dataFile) {
  return path.join(path.dirname(dataFile), 'app.db');
}

function registerRuntimeStore(runtimeStore, files) {
  for (const file of files) {
    if (file) {
      runtimeStoresByFile.set(path.resolve(file), runtimeStore);
    }
  }
}

function getRuntimeStoreForFile(file) {
  const resolved = path.resolve(file);
  const existing = runtimeStoresByFile.get(resolved);
  if (existing) {
    return existing;
  }

  const dataDir = path.dirname(resolved);
  const store = createRuntimeStore({
    dataDir,
    dbFile: path.join(dataDir, 'app.db')
  });
  registerRuntimeStore(store, [file]);
  return store;
}

function renderAdminLoginPage(errorMessage = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>后台登录 - 项目站</title>
  <link rel="icon" href="/favicon-site-mark.svg" type="image/svg+xml">
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
    await atomicWriteJson(dataFile, []);
  }
}

function createJsonDataError(file, message) {
  const error = new Error(`${path.basename(file)} 数据文件损坏：${message}`);
  error.code = 'JSON_DATA_INVALID';
  return error;
}

async function atomicWriteJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  const content = `${JSON.stringify(value, null, 2)}\n`;
  let handle;

  try {
    handle = await fsp.open(tempFile, 'w');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(tempFile, file);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fsp.rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

function withJsonWriteQueue(file, task) {
  const key = path.resolve(file);
  const previous = jsonWriteQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  const queued = current.finally(() => {
    if (jsonWriteQueues.get(key) === queued) {
      jsonWriteQueues.delete(key);
    }
  });
  jsonWriteQueues.set(key, queued);
  return current;
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
  try {
    const store = getRuntimeStoreForFile(dataFile);
    const sites = store.listSites();

    const normalized = normalizeSiteNumbers(sites);
    if (normalized.changed) {
      await writeSites(dataFile, normalized.sites);
    }

    return normalized.sites;
  } catch (error) {
    if (error.code === 'JSON_DATA_INVALID') {
      throw error;
    }
    throw createJsonDataError(dataFile, error.message);
  }
}

async function readSite(dataFile, id) {
  try {
    return getRuntimeStoreForFile(dataFile).getSite(id);
  } catch (error) {
    if (error.code === 'JSON_DATA_INVALID') {
      throw error;
    }
    throw createJsonDataError(dataFile, error.message);
  }
}

async function readClasses(classesFile) {
  try {
    const store = getRuntimeStoreForFile(classesFile);
    const classes = store.listClasses();

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
      await writeClasses(classesFile, normalizedClasses);
    }

    return normalizedClasses;
  } catch (error) {
    if (error.code === 'JSON_DATA_INVALID') {
      throw error;
    }
    throw createJsonDataError(classesFile, error.message);
  }
}

async function readClass(classesFile, id) {
  try {
    return getRuntimeStoreForFile(classesFile).getClass(id);
  } catch (error) {
    if (error.code === 'JSON_DATA_INVALID') {
      throw error;
    }
    throw createJsonDataError(classesFile, error.message);
  }
}

async function readClassGroups(classesFile) {
  try {
    return getRuntimeStoreForFile(classesFile).listClassGroups();
  } catch (error) {
    throw createJsonDataError(classesFile, error.message);
  }
}

async function readSettings(settingsFile, { includeForbiddenWords = false, includeForbiddenWordsCount = true } = {}) {
  const store = getRuntimeStoreForFile(settingsFile);
  let settings = store.getSettings({ includeForbiddenWords, includeForbiddenWordsCount });

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
    ...(includeForbiddenWords
      ? { forbiddenWords: normalizeForbiddenWords(settings.forbiddenWords) }
      : {})
  };
}

async function readAiSettings(aiSettingsFile) {
  return getRuntimeStoreForFile(aiSettingsFile).getAiSettings();
}

async function writeAiSettings(aiSettingsFile, settings) {
  return getRuntimeStoreForFile(aiSettingsFile).writeAiSettings(settings);
}

async function readSitesForWrite(dataFile) {
  try {
    return normalizeSiteNumbers(await readSites(dataFile)).sites;
  } catch (error) {
    if (error.code === 'JSON_DATA_INVALID') {
      throw error;
    }
    throw createJsonDataError(dataFile, error.message);
  }
}

function compareSitesByNumberDesc(left, right) {
  const leftNumber = getSiteNumberValue(left);
  const rightNumber = getSiteNumberValue(right);
  if (leftNumber !== rightNumber) {
    return rightNumber - leftNumber;
  }

  const leftTime = Date.parse(left.createdAt || '');
  const rightTime = Date.parse(right.createdAt || '');
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return String(left.id || '').localeCompare(String(right.id || ''));
}

function mergeUsageFields(currentSite, nextSite) {
  const currentPreview = Math.max(0, Number(currentSite.usagePreviewCount) || 0);
  const nextPreview = Math.max(0, Number(nextSite.usagePreviewCount) || 0);
  const currentCode = Math.max(0, Number(currentSite.usageCodeCount) || 0);
  const nextCode = Math.max(0, Number(nextSite.usageCodeCount) || 0);
  const currentLastUsed = Date.parse(currentSite.usageLastUsedAt || '');
  const nextLastUsed = Date.parse(nextSite.usageLastUsedAt || '');

  return {
    ...nextSite,
    usagePreviewCount: Math.max(currentPreview, nextPreview),
    usageCodeCount: Math.max(currentCode, nextCode),
    usageLastUsedAt: Number.isFinite(currentLastUsed) && currentLastUsed > (Number.isFinite(nextLastUsed) ? nextLastUsed : 0)
      ? currentSite.usageLastUsedAt
      : nextSite.usageLastUsedAt
  };
}

function hasSiteNumberIssues(sites) {
  const usedNumbers = new Set();
  for (const site of sites) {
    const numberValue = getSiteNumberValue(site);
    if (!numberValue || usedNumbers.has(numberValue)) {
      return true;
    }
    usedNumbers.add(numberValue);
  }
  return false;
}

function normalizeMergedSites(sites) {
  if (!hasSiteNumberIssues(sites)) {
    return sites;
  }
  return normalizeSiteNumbers(sites).sites.sort(compareSitesByNumberDesc);
}

function mergeSitesForWrite(currentSites, nextSites, { allowSiteRemoval = false } = {}) {
  if (allowSiteRemoval) {
    return normalizeMergedSites(nextSites);
  }

  const currentById = new Map(currentSites.map((site) => [site.id, site]));
  const nextById = new Map(nextSites.map((site) => [site.id, site]));
  const missingCurrentSites = currentSites.filter((site) => !nextById.has(site.id));

  if (missingCurrentSites.length > 0) {
    const currentIds = new Set(currentSites.map((site) => site.id));
    const merged = currentSites.map((site) => {
      const nextSite = nextById.get(site.id);
      return nextSite ? mergeUsageFields(site, nextSite) : site;
    });
    for (const nextSite of nextSites) {
      if (!currentIds.has(nextSite.id)) {
        merged.push(nextSite);
      }
    }
    return normalizeMergedSites(merged);
  }

  const merged = nextSites.map((site) => {
    const currentSite = currentById.get(site.id);
    return currentSite ? mergeUsageFields(currentSite, site) : site;
  });

  return normalizeMergedSites(merged);
}

async function writeSites(dataFile, sites, { sync = true, allowSiteRemoval = false } = {}) {
  return withJsonWriteQueue(dataFile, async () => {
    const store = getRuntimeStoreForFile(dataFile);
    const currentSites = await readSitesForWrite(dataFile);
    const normalized = normalizeSiteNumbers(Array.isArray(sites) ? sites : []).sites;
    const nextSites = mergeSitesForWrite(currentSites, normalized, { allowSiteRemoval });
    if (!allowSiteRemoval && nextSites.length > normalized.length) {
      console.warn('[Data Guard] Preserved site records missing from a stale write.');
    }
    store.replaceSites(nextSites);
    return store.listSites();
  });
}

async function writeClasses(classesFile, classes) {
  await withJsonWriteQueue(classesFile, () => getRuntimeStoreForFile(classesFile).replaceClasses(classes));
}

async function writeClassGroups(classesFile, groups) {
  await withJsonWriteQueue(classesFile, () => getRuntimeStoreForFile(classesFile).replaceClassGroups(groups));
}

async function writeSettings(settingsFile, settings) {
  await withJsonWriteQueue(settingsFile, async () => {
    const store = getRuntimeStoreForFile(settingsFile);
    const currentSettings = store.getSettings({ includeForbiddenWords: true });

    const nextSettings = {
      ...currentSettings,
      ...settings,
      lastUsedSiteNumber: Math.max(
        Number(currentSettings.lastUsedSiteNumber) || 0,
        Number(settings.lastUsedSiteNumber) || 0
      )
    };
    store.writeSettings(nextSettings);
  });
}

function normalizeSiteUsageEntry(entry = {}) {
  return {
    siteId: String(entry.siteId || entry.id || '').trim(),
    usagePreviewCount: Math.max(0, Number(entry.usagePreviewCount) || 0),
    usageCodeCount: Math.max(0, Number(entry.usageCodeCount) || 0),
    usageLastUsedAt: String(entry.usageLastUsedAt || '')
  };
}

async function readSiteUsage(usageFile) {
  return getRuntimeStoreForFile(usageFile).getUsageById();
}

async function writeSiteUsage(usageFile, usageById, { sync = false } = {}) {
  await withJsonWriteQueue(usageFile, () => getRuntimeStoreForFile(usageFile).replaceUsage(usageById));
}

function withSiteUsage(site, usageById = {}) {
  const usage = usageById[site.id] || {};
  const legacyPreview = Math.max(0, Number(site.usagePreviewCount) || 0);
  const legacyCode = Math.max(0, Number(site.usageCodeCount) || 0);
  const usagePreviewCount = Math.max(legacyPreview, Math.max(0, Number(usage.usagePreviewCount) || 0));
  const usageCodeCount = Math.max(legacyCode, Math.max(0, Number(usage.usageCodeCount) || 0));
  const legacyLastUsed = Date.parse(site.usageLastUsedAt || '');
  const usageLastUsed = Date.parse(usage.usageLastUsedAt || '');

  return {
    ...site,
    usagePreviewCount,
    usageCodeCount,
    usageLastUsedAt: Number.isFinite(usageLastUsed) && usageLastUsed > (Number.isFinite(legacyLastUsed) ? legacyLastUsed : 0)
      ? usage.usageLastUsedAt
      : site.usageLastUsedAt || usage.usageLastUsedAt || ''
  };
}

function withSitesUsage(sites, usageById = {}) {
  return sites.map((site) => withSiteUsage(site, usageById));
}

async function incrementSiteUsage(usageFile, site, type) {
  if (!site || !['preview', 'code'].includes(type)) {
    return null;
  }

  return withJsonWriteQueue(usageFile, async () => {
    return getRuntimeStoreForFile(usageFile).incrementUsage(site, type);
  });
}

function isSiteDeleted(site) {
  return Boolean(site.deletedAt);
}

function activeSitesOnly(sites) {
  return sites.filter((site) => !isSiteDeleted(site));
}

async function updateSitesMetadata(dataFile, updater, options = {}) {
  const sites = await readSites(dataFile);
  const nextSites = await updater(sites);
  return writeSites(dataFile, nextSites, options);
}

async function updateSiteMetadata(dataFile, id, updater, options = {}) {
  let updatedSite = null;
  await updateSitesMetadata(dataFile, async (sites) => {
    const siteIndex = sites.findIndex((site) => site.id === id && !isSiteDeleted(site));
    if (siteIndex === -1) {
      return sites;
    }
    const nextSite = await updater(sites[siteIndex], sites);
    const nextSites = [...sites];
    nextSites[siteIndex] = nextSite;
    updatedSite = nextSite;
    return nextSites;
  }, options);
  return updatedSite;
}

function normalizeAuditLog(log = {}) {
  const createdAt = log.createdAt || new Date().toISOString();
  return {
    id: String(log.id || createDefaultId()),
    type: String(log.type || 'general').trim() || 'general',
    action: String(log.action || '').trim(),
    summary: String(log.summary || '').trim(),
    siteIds: Array.isArray(log.siteIds) ? log.siteIds.map(String) : [],
    details: log.details && typeof log.details === 'object' && !Array.isArray(log.details) ? log.details : {},
    createdAt
  };
}

async function readAuditLogs(auditFile) {
  return getRuntimeStoreForFile(auditFile).listAuditLogs();
}

async function appendAuditLog(auditFile, log) {
  return withJsonWriteQueue(auditFile, () => getRuntimeStoreForFile(auditFile).appendAuditLog(log));
}

function normalizeJobLog(log = {}) {
  const createdAt = log.createdAt || new Date().toISOString();
  return {
    id: String(log.id || createDefaultId()),
    type: String(log.type || 'general').trim() || 'general',
    text: String(log.text || '').trim(),
    status: ['running', 'success', 'error'].includes(log.status) ? log.status : 'running',
    time: String(log.time || new Date(createdAt).toLocaleTimeString('zh-CN', { hour12: false })),
    createdAt
  };
}

async function readJobLogs(jobsFile) {
  return getRuntimeStoreForFile(jobsFile).listJobLogs();
}

async function writeJobLogs(jobsFile, logs) {
  await withJsonWriteQueue(jobsFile, () => getRuntimeStoreForFile(jobsFile).replaceJobLogs(logs));
}

async function appendJobLog(jobsFile, log) {
  return withJsonWriteQueue(jobsFile, () => getRuntimeStoreForFile(jobsFile).appendJobLog(log));
}

function toAdminSettingsResponse(settings, { includeForbiddenWords = true } = {}) {
  const { adminPassword, forbiddenWords, ...summarySettings } = settings;
  const forbiddenWordsCount = Array.isArray(forbiddenWords)
    ? forbiddenWords.length
    : (Number.isFinite(Number(settings.forbiddenWordsCount)) ? Number(settings.forbiddenWordsCount) : 0);
  const response = {
    ...summarySettings,
    adminPasswordConfigured: isValidAdminPassword(adminPassword),
    forbiddenWordsCount
  };

  if (includeForbiddenWords) {
    response.forbiddenWords = forbiddenWords;
  }

  return response;
}

function attachClassName(site, classes) {
  const classItem = classes instanceof Map
    ? classes.get(site.classId)
    : classes.find((item) => item.id === site.classId);
  return {
    ...site,
    className: classItem?.name || ''
  };
}

function createClassMap(classes) {
  return new Map(classes.map((classItem) => [classItem.id, classItem]));
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

function getHtmlContentFingerprint(htmlContent) {
  return crypto
    .createHash('sha256')
    .update(String(htmlContent || ''), 'utf8')
    .digest('hex');
}

async function findDuplicateSiteForHtml(storageDir, sites, htmlContent) {
  const submittedFingerprint = getHtmlContentFingerprint(htmlContent);
  for (const site of activeSitesOnly(sites)) {
    const fingerprint = await getSiteHtmlFingerprint(storageDir, site.id);
    if (fingerprint && fingerprint === submittedFingerprint) {
      return site;
    }
  }
  return null;
}

function createDuplicateUploadError(site) {
  const title = String(site?.title || '').trim();
  const number = String(site?.number || '').trim();
  const label = title
    ? `「${title}${number ? `（${number}）` : ''}」`
    : '已有项目';
  return `上传失败：代码与${label}重复，请修改后再上传。`;
}

function toPublicClass(classItem) {
  return {
    id: classItem.id,
    name: classItem.name,
    uploadEnabled: classItem.uploadEnabled !== false,
    passwordEnabled: classItem.passwordEnabled !== false,
    groupId: classItem.groupId || '',
    createdAt: classItem.createdAt,
    updatedAt: classItem.updatedAt
  };
}

function getThumbnailPath(thumbnailDir, id, extension = THUMBNAIL_EXTENSION) {
  return path.join(thumbnailDir, `${id}.${extension}`);
}

function getThumbnailCacheKey(thumbnailDir, id) {
  return path.resolve(thumbnailDir, id);
}

function invalidateThumbnailUrlCache(thumbnailDir, id) {
  thumbnailUrlCache.delete(getThumbnailCacheKey(thumbnailDir, id));
}

function getExistingThumbnail(thumbnailDir, id) {
  const candidates = [
    THUMBNAIL_EXTENSION,
    LEGACY_THUMBNAIL_EXTENSION
  ];

  for (const extension of candidates) {
    const thumbnailPath = getThumbnailPath(thumbnailDir, id, extension);
    try {
      const stat = fs.statSync(thumbnailPath);
      return { extension, path: thumbnailPath, stat };
    } catch {
      // Keep looking for a supported thumbnail format.
    }
  }

  return null;
}

function getThumbnailUrl(thumbnailDir, id) {
  const cacheKey = getThumbnailCacheKey(thumbnailDir, id);
  const cached = thumbnailUrlCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.checkedAt < THUMBNAIL_URL_CACHE_TTL_MS) {
    return cached.url;
  }

  const thumbnail = getExistingThumbnail(thumbnailDir, id);
  if (thumbnail) {
    const url = `/thumbnails/${encodeURIComponent(id)}.${thumbnail.extension}?v=${Math.round(thumbnail.stat.mtimeMs)}`;
    thumbnailUrlCache.set(cacheKey, { checkedAt: now, url });
    return url;
  }

  thumbnailUrlCache.set(cacheKey, { checkedAt: now, url: '' });
  return '';
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

function normalizeStorageBytes(value) {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0;
}

async function attachFreshStorageCache(site, storageDir) {
  return {
    ...site,
    storageBytes: await getDirectorySize(path.join(storageDir, site.id)),
    storageUpdatedAt: new Date().toISOString()
  };
}

function toPublicSite(site, classes, thumbnailDir, storageBytes = site.storageBytes) {
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
    storageBytes: normalizeStorageBytes(storageBytes),
    storageUpdatedAt: site.storageUpdatedAt || '',
    url: `/site/${site.id}`,
    previewUrl: `/preview/${site.id}`,
    thumbnailUrl: getThumbnailUrl(thumbnailDir, site.id)
  };
}

async function toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir) {
  return toPublicSite(site, classes, thumbnailDir);
}

function parsePositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(max, number);
}

function createAdminSitesSummary(sites) {
  return {
    totalProjects: sites.length,
    enabledProjects: sites.filter((site) => site.enabled !== false).length,
    disabledProjects: sites.filter((site) => site.enabled === false).length,
    totalStorageBytes: sites.reduce((total, site) => total + normalizeStorageBytes(site.storageBytes), 0)
  };
}

function filterAdminSites(sites, query) {
  const keyword = String(query.q || '').trim().toLocaleLowerCase();
  const classId = String(query.classId || '').trim();
  const starred = String(query.starred || '').trim();
  const enabled = String(query.enabled || '').trim();

  return sites.filter((site) => {
    if (classId && site.classId !== classId) {
      return false;
    }

    if (starred === 'true' && site.starred !== true) {
      return false;
    }

    if (starred === 'false' && site.starred === true) {
      return false;
    }

    if (enabled === 'true' && site.enabled === false) {
      return false;
    }

    if (enabled === 'false' && site.enabled !== false) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    return [
      site.title,
      site.author,
      site.className,
      site.number,
      site.id,
      site.url
    ].some((value) => String(value || '').toLocaleLowerCase().includes(keyword));
  });
}

function shouldReturnPaginatedAdminSites(query) {
  return ['page', 'pageSize', 'q', 'classId', 'starred', 'enabled']
    .some((key) => query[key] !== undefined);
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
      type: THUMBNAIL_SCREENSHOT_TYPE,
      quality: THUMBNAIL_JPEG_QUALITY,
      fullPage: false
    });
    await context.close();
    invalidateThumbnailUrlCache(thumbnailDir, id);

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
  <link rel="icon" href="/favicon-site-mark.svg" type="image/svg+xml">
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
  <link rel="icon" href="/favicon-site-mark.svg" type="image/svg+xml">
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
  const jobsFile = options.jobsFile || path.join(path.dirname(dataFile), 'jobs.json');
  const usageFile = options.usageFile || path.join(path.dirname(dataFile), 'site-usage.json');
  const auditFile = options.auditFile || path.join(path.dirname(dataFile), 'audit-log.json');
  const storageDir = options.storageDir || path.join(process.cwd(), 'storage', 'sites');
  const thumbnailDir = options.thumbnailDir || path.join(process.cwd(), 'storage', 'thumbnails');
  const publicDir = options.publicDir || path.join(process.cwd(), 'public');
  const idGenerator = options.idGenerator || createDefaultId;
  const maxTotalBytes = options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES;
  const fallbackAdminPassword = options.adminPassword || DEFAULT_ADMIN_PASSWORD;
  const dataDir = path.dirname(dataFile);
  const dbFile = options.dbFile || getDefaultDbFileForDataFile(dataFile);
  const runtimeStore = options.runtimeStore || createRuntimeStore({ dataDir, dbFile });
  registerRuntimeStore(runtimeStore, [
    dataFile,
    classesFile,
    settingsFile,
    aiSettingsFile,
    jobsFile,
    usageFile,
    auditFile
  ]);
  const thumbnailGenerator = options.thumbnailGenerator || generateSiteThumbnail;
  const thumbnailConcurrency = Math.max(1, Math.min(2, Number.parseInt(
    options.thumbnailConcurrency ?? process.env.THUMBNAIL_CONCURRENCY ?? '1',
    10
  ) || 1));
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
  const thumbnailJobs = new Map();
  const thumbnailQueue = [];
  let runningAiOptimizeJobs = 0;
  let runningThumbnailJobs = 0;

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

  async function canReadSite(req, id, knownSite = null) {
    const site = knownSite || await readSite(dataFile, id);
    if (!site) {
      return false;
    }
    if (isSiteDeleted(site)) {
      return false;
    }

    if (!site.classId) {
      return true;
    }

    const classItem = await readClass(classesFile, site.classId);
    if (!classItem) {
      return true;
    }

    if (hasClassAccess(req, classItem)) {
      return true;
    }

    if (await hasAdminAccess(req)) {
      return true;
    }

    const settings = await readSettings(settingsFile);
    if (hasAllAccess(req, settings)) {
      return true;
    }

    return false;
  }

  function cleanupThumbnailJobs() {
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [jobId, job] of thumbnailJobs.entries()) {
      if (['success', 'error'].includes(job.status) && now - Date.parse(job.finishedAt || job.updatedAt || job.createdAt) > maxAgeMs) {
        thumbnailJobs.delete(jobId);
      }
    }
  }

  function toThumbnailJobResponse(job) {
    return {
      jobId: job.id,
      type: job.type,
      status: job.status,
      total: job.total,
      finished: job.finished,
      success: job.success,
      failed: job.failed,
      current: job.current,
      generated: job.generated,
      errors: job.errors,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt || ''
    };
  }

  function createThumbnailJob(siteItems, origin) {
    const now = new Date().toISOString();
    const normalizedSites = siteItems
      .filter((site) => site?.id)
      .map((site) => ({
        id: String(site.id),
        title: String(site.title || site.id)
      }));
    return {
      id: createDefaultId(),
      type: 'thumbnail',
      status: 'queued',
      total: normalizedSites.length,
      finished: 0,
      success: 0,
      failed: 0,
      current: '',
      sites: normalizedSites,
      origin,
      generated: [],
      errors: [],
      createdAt: now,
      updatedAt: now,
      finishedAt: ''
    };
  }

  function updateThumbnailJob(job, patch = {}) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    thumbnailJobs.set(job.id, job);
    return job;
  }

  function enqueueThumbnailJob(job) {
    cleanupThumbnailJobs();
    thumbnailJobs.set(job.id, job);
    thumbnailQueue.push(job);
    const timer = setTimeout(processThumbnailQueue, 0);
    timer.unref?.();
    return toThumbnailJobResponse(job);
  }

  function processThumbnailQueue() {
    while (runningThumbnailJobs < thumbnailConcurrency && thumbnailQueue.length > 0) {
      const job = thumbnailQueue.shift();
      runningThumbnailJobs += 1;
      runThumbnailJob(job)
        .catch((error) => {
          updateThumbnailJob(job, {
            status: 'error',
            failed: job.total,
            finished: job.total,
            errors: [{ error: error.message || '封面任务失败' }],
            finishedAt: new Date().toISOString()
          });
        })
        .finally(() => {
          runningThumbnailJobs -= 1;
          processThumbnailQueue();
        });
    }
  }

  async function runThumbnailJob(job) {
    updateThumbnailJob(job, {
      status: job.total > 0 ? 'running' : 'success'
    });

    if (job.total === 0) {
      updateThumbnailJob(job, {
        finishedAt: new Date().toISOString()
      });
      return;
    }

    const adminToken = createAdminToken(await getAdminPassword());
    for (const site of job.sites) {
      updateThumbnailJob(job, {
        current: site.title || site.id
      });

      try {
        const result = await thumbnailGenerator({
          id: site.id,
          origin: job.origin,
          thumbnailDir,
          adminToken
        });
        job.generated.push(result);
        job.success += 1;
      } catch (error) {
        const message = error.message || '封面生成失败';
        job.errors.push({
          id: site.id,
          title: site.title || site.id,
          error: message
        });
        job.failed += 1;
        console.warn(`[Thumbnail] Failed to generate ${site.id}: ${message}`);
      }

      job.finished += 1;
      updateThumbnailJob(job);
    }

    updateThumbnailJob(job, {
      status: job.failed > 0 ? 'error' : 'success',
      current: '',
      finishedAt: new Date().toISOString()
    });
  }

  function generateThumbnailLater(id, origin) {
    const job = createThumbnailJob([{ id }], origin);
    enqueueThumbnailJob(job);
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

      const site = await attachFreshStorageCache(clearDuplicateAudit({
        ...latestSites[latestSiteIndex],
        updatedAt: new Date().toISOString()
      }), storageDir);
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

  app.use(compression());
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
      const sites = activeSitesOnly(await readSites(dataFile));
      const classes = await readClasses(classesFile);
      const classMap = createClassMap(classes);
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
        return res.status(401).json({ error: '请输入全部作品页密码', count: sites.filter((site) => site.enabled !== false).length });
      }

      const filteredSites = classId
        ? sites.filter((site) => site.classId === classId && site.enabled !== false)
        : sites.filter((site) => site.enabled !== false);
      res.json(filteredSites.map((site) => toPublicSite(site, classMap, thumbnailDir)));
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

  app.get('/api/class-groups', async (req, res, next) => {
    try {
      res.json(await readClassGroups(classesFile));
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
      const sites = activeSitesOnly(await readSites(dataFile));
      const classes = await readClasses(classesFile);
      const classMap = createClassMap(classes);
      const publicSites = sites.map((site) => toPublicSite(site, classMap, thumbnailDir));

      if (!shouldReturnPaginatedAdminSites(req.query)) {
        return res.json(publicSites);
      }

      const filteredSites = filterAdminSites(publicSites, req.query);
      const pageSize = parsePositiveInteger(req.query.pageSize, 50, 200);
      const page = parsePositiveInteger(req.query.page, 1);
      const start = (page - 1) * pageSize;
      return res.json({
        items: filteredSites.slice(start, start + pageSize),
        total: filteredSites.length,
        page,
        pageSize,
        summary: createAdminSitesSummary(publicSites)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/thumbnail-jobs/:jobId', requireAdmin, (req, res) => {
    cleanupThumbnailJobs();
    const job = thumbnailJobs.get(String(req.params.jobId));
    if (!job) {
      return res.status(404).json({ error: '封面任务不存在' });
    }

    return res.json(toThumbnailJobResponse(job));
  });

  app.get('/api/admin/jobs/logs', requireAdmin, async (req, res, next) => {
    try {
      const type = String(req.query.type || '').trim();
      const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit || '30', 10) || 30));
      const logs = await readJobLogs(jobsFile);
      const filteredLogs = type ? logs.filter((log) => log.type === type) : logs;
      return res.json({ logs: filteredLogs.slice(0, limit) });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/admin/jobs/logs', requireAdmin, async (req, res, next) => {
    try {
      const log = await appendJobLog(jobsFile, req.body || {});
      return res.status(201).json(log);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/audit-logs', requireAdmin, async (req, res, next) => {
    try {
      const type = String(req.query.type || '').trim();
      const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit || '50', 10) || 50));
      const logs = await readAuditLogs(auditFile);
      const filteredLogs = type ? logs.filter((log) => log.type === type || log.action === type) : logs;
      return res.json({ logs: filteredLogs.slice(0, limit) });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/admin/settings', requireAdmin, async (req, res, next) => {
    try {
      if (req.query.includeForbiddenWords === 'false') {
        const settings = await readSettings(settingsFile, { includeForbiddenWords: false });
        return res.json(toAdminSettingsResponse(settings, { includeForbiddenWords: false }));
      }

      const settings = await readSettings(settingsFile, { includeForbiddenWords: true });
      return res.json(toAdminSettingsResponse(settings));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/forbidden-words', requireAdmin, async (req, res, next) => {
    try {
      const settings = await readSettings(settingsFile, { includeForbiddenWords: true });
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
      const previousSettings = await readSettings(settingsFile, { includeForbiddenWords: true });
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

      const previousSettings = await readSettings(settingsFile, { includeForbiddenWords: true });
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
      const settings = await readSettings(settingsFile, { includeForbiddenWords: true });
      return res.json({
        forbiddenWords: settings.forbiddenWords
      });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/admin/settings', requireAdmin, async (req, res, next) => {
    try {
      const previousSettings = await readSettings(settingsFile, { includeForbiddenWords: true });
      const allPassword = req.body.allPassword === undefined
        ? previousSettings.allPassword
        : String(req.body.allPassword || '').trim();
      const adminPassword = req.body.adminPassword === undefined
        ? previousSettings.adminPassword
        : String(req.body.adminPassword || '').trim();
      if (!isValidClassPassword(allPassword)) {
        return res.status(400).json({ error: '全部作品页密码必须是 6 位数字' });
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

      if (req.body.thinkingOptimize !== undefined) {
        nextSettings.thinkingOptimize = String(req.body.thinkingOptimize || '').trim();
      }

      if (req.body.thinkingName !== undefined) {
        nextSettings.thinkingName = String(req.body.thinkingName || '').trim();
      }

      const savedSettings = await writeAiSettings(aiSettingsFile, nextSettings);
      const llmConfig = mergeLlmConfig(options, savedSettings);
      return res.json(toPublicAiSettings({ aiSettings: savedSettings, llmConfig }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/class-groups', requireAdmin, async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim();
      if (!name) {
        return res.status(400).json({ error: '分组名称不能为空' });
      }
      if (name === '未分组') {
        return res.status(400).json({ error: '“未分组”是系统保留名称' });
      }

      const groups = await readClassGroups(classesFile);
      if (groups.some((group) => group.name === name)) {
        return res.status(400).json({ error: '分组名称已存在' });
      }
      const group = {
        id: idGenerator(),
        name,
        position: groups.length,
        createdAt: new Date().toISOString()
      };
      groups.push(group);
      await writeClassGroups(classesFile, groups);
      return res.status(201).json(group);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/class-groups/order', requireAdmin, async (req, res, next) => {
    try {
      const { groupIds } = req.body;
      if (!Array.isArray(groupIds)) {
        return res.status(400).json({ error: '无效的分组排序数据' });
      }
      const groups = await readClassGroups(classesFile);
      const byId = new Map(groups.map((group) => [group.id, group]));
      const ordered = groupIds.map((id) => byId.get(String(id || ''))).filter(Boolean);
      for (const group of groups) {
        if (!ordered.some((item) => item.id === group.id)) {
          ordered.push(group);
        }
      }
      await writeClassGroups(classesFile, ordered);
      return res.json(await readClassGroups(classesFile));
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/class-groups/:id', requireAdmin, async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim();
      const groups = await readClassGroups(classesFile);
      const index = groups.findIndex((group) => group.id === req.params.id);
      if (index === -1) {
        return res.status(404).json({ error: '分组不存在' });
      }
      if (!name) {
        return res.status(400).json({ error: '分组名称不能为空' });
      }
      if (name === '未分组' || groups.some((group) => group.id !== req.params.id && group.name === name)) {
        return res.status(400).json({ error: '分组名称已存在或不可使用' });
      }
      groups[index] = { ...groups[index], name, updatedAt: new Date().toISOString() };
      await writeClassGroups(classesFile, groups);
      return res.json(groups[index]);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/class-groups/:id', requireAdmin, async (req, res, next) => {
    try {
      const groups = await readClassGroups(classesFile);
      if (!groups.some((group) => group.id === req.params.id)) {
        return res.status(404).json({ error: '分组不存在' });
      }
      await withJsonWriteQueue(classesFile, () => getRuntimeStoreForFile(classesFile).deleteClassGroup(req.params.id));
      return res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/classes', requireAdmin, async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim();
      const password = String(req.body.password || createClassPassword()).trim();
      const groupId = String(req.body.groupId || '').trim();
      if (!name) {
        return res.status(400).json({ error: '班级名称不能为空' });
      }

      if (!isValidClassPassword(password)) {
        return res.status(400).json({ error: '班级密码必须是 6 位数字' });
      }

      if (groupId && !(await readClassGroups(classesFile)).some((group) => group.id === groupId)) {
        return res.status(400).json({ error: '所属分组不存在' });
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
        groupId,
        createdAt: new Date().toISOString()
      };
      classes.push(classItem);
      await writeClasses(classesFile, classes);

      return res.status(201).json(classItem);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/classes/upload-enabled', requireAdmin, async (req, res, next) => {
    try {
      if (typeof req.body.uploadEnabled !== 'boolean') {
        return res.status(400).json({ error: '上传状态必须是布尔值' });
      }

      const updatedAt = new Date().toISOString();
      const classes = (await readClasses(classesFile)).map((classItem) => ({
        ...classItem,
        uploadEnabled: req.body.uploadEnabled,
        updatedAt
      }));
      await writeClasses(classesFile, classes);
      return res.json(classes);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/classes/password-enabled', requireAdmin, async (req, res, next) => {
    try {
      if (typeof req.body.passwordEnabled !== 'boolean') {
        return res.status(400).json({ error: '密码状态必须是布尔值' });
      }

      const updatedAt = new Date().toISOString();
      const classes = (await readClasses(classesFile)).map((classItem) => ({
        ...classItem,
        passwordEnabled: req.body.passwordEnabled,
        updatedAt
      }));
      await writeClasses(classesFile, classes);
      return res.json(classes);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/classes/order', requireAdmin, async (req, res, next) => {
    try {
      const { classIds, items } = req.body;
      if (!Array.isArray(classIds) && !Array.isArray(items)) {
        return res.status(400).json({ error: '无效的排序数据' });
      }

      const classes = await readClasses(classesFile);
      const newClasses = [];
      const validGroupIds = new Set((await readClassGroups(classesFile)).map((group) => group.id));

      if (Array.isArray(items)) {
        const seen = new Set();
        for (const entry of items) {
          const id = String(entry?.id || '').trim();
          const groupId = String(entry?.groupId || '').trim();
          if (!id || seen.has(id) || (groupId && !validGroupIds.has(groupId))) {
            return res.status(400).json({ error: '班级排序或分组数据无效' });
          }
          const classItem = classes.find((item) => item.id === id);
          if (classItem) {
            newClasses.push({ ...classItem, groupId });
            seen.add(id);
          }
        }
      } else {
        for (const id of classIds) {
          const classItem = classes.find(c => c.id === id);
          if (classItem) {
            newClasses.push(classItem);
          }
        }
      }

      for (const classItem of classes) {
        if (!newClasses.some((item) => item.id === classItem.id)) {
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
      const requestedGroupId = req.body.groupId === undefined ? undefined : String(req.body.groupId || '').trim();
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

      if (requestedGroupId && !(await readClassGroups(classesFile)).some((group) => group.id === requestedGroupId)) {
        return res.status(400).json({ error: '所属分组不存在' });
      }

      classes[classIndex] = {
        ...classes[classIndex],
        name,
        password: password || classes[classIndex].password || createClassPassword(),
        uploadEnabled: classes[classIndex].uploadEnabled !== false,
        passwordEnabled: classes[classIndex].passwordEnabled !== false,
        groupId: requestedGroupId === undefined ? (classes[classIndex].groupId || '') : requestedGroupId,
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
        return res.status(401).json({ error: '全部作品页密码不正确' });
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

      if (sites.some((site) => !isSiteDeleted(site) && site.classId === id)) {
        return res.status(400).json({ error: '班级下还有项目，不能删除' });
      }

      await writeClasses(classesFile, classes.filter((item) => item.id !== id));
      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get('/thumbnails/:id.:extension', async (req, res, next) => {
    try {
      const { id, extension } = req.params;
      const normalizedExtension = String(extension || '').toLowerCase();
      if (![THUMBNAIL_EXTENSION, LEGACY_THUMBNAIL_EXTENSION].includes(normalizedExtension)) {
        return res.status(404).send('Not found');
      }

      const site = await readSite(dataFile, id);
      if (!(await canReadSite(req, id, site))) {
        return res.status(401).send('请输入班级密码');
      }

      const thumbnailPath = getThumbnailPath(thumbnailDir, id, normalizedExtension);
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

      const settings = await readSettings(settingsFile, { includeForbiddenWords: true });
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

        const submittedHtmlContent = file ? file.buffer.toString('utf8') : htmlContent;
        const htmlStructureError = validateBasicHtmlDocument(submittedHtmlContent);
        if (htmlStructureError) {
          return res.status(400).json({ error: htmlStructureError });
        }

        const sites = await readSites(dataFile);
        const duplicateSite = await findDuplicateSiteForHtml(storageDir, sites, submittedHtmlContent);
        if (duplicateSite) {
          return res.status(400).json({ error: createDuplicateUploadError(duplicateSite) });
        }

        const id = await createUniqueId({ dataFile, storageDir, idGenerator });
        const projectDir = path.join(storageDir, id);
        await fsp.mkdir(projectDir, { recursive: true });
        await fsp.writeFile(path.join(projectDir, 'index.html'), submittedHtmlContent);

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
      const siteWithStorage = await attachFreshStorageCache(site, storageDir);
      sites.unshift(siteWithStorage);
      await writeSites(dataFile, sites);

      settings.lastUsedSiteNumber = nextNumberValue;
      await writeSettings(settingsFile, settings);

      generateThumbnailLater(id, getRequestOrigin(req));

      return res.status(201).json(await toPublicSiteWithStorage(siteWithStorage, classes, thumbnailDir, storageDir));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sites/:id/thumbnail', requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const sites = await readSites(dataFile);
      const site = sites.find((item) => item.id === id && !isSiteDeleted(item));

      if (!site) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const job = createThumbnailJob([site], getRequestOrigin(req));
      return res.status(202).json(enqueueThumbnailJob(job));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/thumbnails', requireAdmin, async (req, res, next) => {
    try {
      const sites = activeSitesOnly(await readSites(dataFile));
      const requestedIds = Array.isArray(req.body.siteIds)
        ? new Set(req.body.siteIds.map((id) => String(id)))
        : null;
      const targetSites = requestedIds
        ? sites.filter((site) => requestedIds.has(site.id))
        : sites;
      const job = createThumbnailJob(targetSites, getRequestOrigin(req));
      return res.status(202).json(enqueueThumbnailJob(job));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/sites/forbidden-audit', requireAdmin, async (req, res, next) => {
    try {
      const sites = await readSites(dataFile);
      const settings = await readSettings(settingsFile, { includeForbiddenWords: true });
      const forbiddenWords = Array.isArray(settings.forbiddenWords) ? settings.forbiddenWords : [];
      const matches = [];
      let disabledCount = 0;
      let changed = false;

      const activeSites = activeSitesOnly(sites);
      const nextSites = sites.map((site) => {
        if (isSiteDeleted(site)) {
          return site;
        }

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
        await appendAuditLog(auditFile, {
          type: 'site-audit',
          action: 'forbidden-audit',
          summary: `违禁词审查完成，命中 ${matches.length} 个项目，禁用 ${disabledCount} 个项目`,
          siteIds: matches.map((match) => match.id),
          details: { matched: matches.length, disabled: disabledCount }
        });
      }

      return res.json({
        checked: activeSites.filter((site) => site.forbiddenWhitelist !== true).length,
        skipped: activeSites.filter((site) => site.forbiddenWhitelist === true).length,
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
      const activeSites = activeSitesOnly(sites);
      const groups = new Map();

      for (const site of activeSites) {
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
        if (isSiteDeleted(site)) {
          return site;
        }

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
        await appendAuditLog(auditFile, {
          type: 'site-audit',
          action: 'dedupe',
          summary: `查重完成，发现 ${matches.length} 个重复项目，禁用 ${disabledCount} 个项目`,
          siteIds: matches.map((match) => match.id),
          details: { duplicateGroups, duplicates: matches.length, disabled: disabledCount }
        });
      }

      return res.json({
        checked: activeSites.length,
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
      const activeSites = activeSitesOnly(sites);
      const now = new Date().toISOString();
      let enabledCount = 0;
      const nextSites = sites.map((site) => {
        if (isSiteDeleted(site)) {
          return site;
        }

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
        await appendAuditLog(auditFile, {
          type: 'site-audit',
          action: 'enable-all',
          summary: `全部解禁完成，启用 ${enabledCount} 个项目`,
          siteIds: activeSites.filter((site) => site.enabled === false).map((site) => site.id),
          details: { enabled: enabledCount }
        });
      }

      return res.json({
        checked: activeSites.length,
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
      const siteIndex = sites.findIndex((site) => site.id === id && !isSiteDeleted(site));

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
      const siteIndex = sites.findIndex((site) => site.id === id && !isSiteDeleted(site));

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
      const siteIndex = sites.findIndex((site) => site.id === id && !isSiteDeleted(site));

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
      const site = sites.find((item) => item.id === id && !isSiteDeleted(item));
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
      const site = sites.find((item) => item.id === id && !isSiteDeleted(item));
      if (!site) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const indexPath = path.join(storageDir, id, 'index.html');
      if (!fs.existsSync(indexPath)) {
        return res.status(404).json({ error: '项目文件不存在' });
      }

      const htmlContent = await fsp.readFile(indexPath, 'utf8');
      const updatedSite = await incrementSiteUsage(usageFile, site, 'code') || site;
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
      const site = await readSite(dataFile, id);

      if (!site || isSiteDeleted(site)) {
        return res.status(404).json({ error: '项目不存在' });
      }

      if (site.enabled === false && !(await hasAdminAccess(req))) {
        return res.status(404).json({ error: '项目不存在' });
      }

      if (!(await canReadSite(req, id, site))) {
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
      const updatedSite = await incrementSiteUsage(usageFile, site, 'code') || site;
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
      const siteIndex = sites.findIndex((site) => site.id === id && !isSiteDeleted(site));

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

      const site = await attachFreshStorageCache(clearDuplicateAudit({
        ...sites[siteIndex],
        updatedAt: new Date().toISOString()
      }), storageDir);
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
      const site = sites.find((item) => item.id === id && !isSiteDeleted(item));

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
        const settings = await readSettings(settingsFile, { includeForbiddenWords: true });
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

  app.post('/api/sites/:id/ai-name-review', requireAdmin, async (req, res) => {
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

      const originalTitle = sites[siteIndex].title;
      const llmConfig = await getLlmConfig();
      const review = await reviewSiteNameWithLlm({
        codeSnapshot: combinedText,
        currentTitle: originalTitle,
        author: sites[siteIndex].author,
        llmConfig
      });
      const contradictedByReason = review.related === true && reviewReasonClearlySaysUnrelated(review.reason);
      const effectiveRelated = contradictedByReason ? false : review.related;
      if (contradictedByReason && !review.suggestedTitle) {
        review.suggestedTitle = await nameSiteWithLlm({
          codeSnapshot: combinedText,
          currentTitle: originalTitle,
          author: sites[siteIndex].author,
          llmConfig
        });
      }
      let renamed = effectiveRelated === false && (review.confidence === 'high' || contradictedByReason);
      if (renamed && !review.suggestedTitle) {
        throw new Error('AI 判定名称无关，但没有返回可用的新名称');
      }

      const latestSites = await readSites(dataFile);
      const latestSiteIndex = latestSites.findIndex((item) => item.id === id);
      if (latestSiteIndex === -1) {
        return res.status(404).json({ error: '项目不存在' });
      }

      let reason = contradictedByReason
        ? `审核结论与理由矛盾，理由已明确表示名称无关：${review.reason}`
        : review.reason;
      let site = latestSites[latestSiteIndex];
      if (site.title !== originalTitle) {
        renamed = false;
        reason = '审核期间项目名称已被更新，为避免覆盖人工修改，已保留最新名称';
      } else if (renamed) {
        if (site.forbiddenWhitelist !== true) {
          const settings = await readSettings(settingsFile, { includeForbiddenWords: true });
          const forbiddenMatch = findForbiddenWordMatch(
            { title: review.suggestedTitle, author: site.author || '' },
            settings.forbiddenWords
          );
          if (forbiddenMatch) {
            return res.status(400).json({ error: createForbiddenWordError(forbiddenMatch) });
          }
        }
        site = clearForbiddenAudit({
          ...site,
          title: review.suggestedTitle,
          updatedAt: new Date().toISOString()
        });
        latestSites[latestSiteIndex] = site;
        await writeSites(dataFile, latestSites);
      }

      const classes = await readClasses(classesFile);
      return res.json({
        renamed,
        related: effectiveRelated,
        confidence: review.confidence,
        reason,
        originalTitle,
        title: site.title,
        site: await toPublicSiteWithStorage(site, classes, thumbnailDir, storageDir),
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
      const siteIndex = sites.findIndex((site) => site.id === id && !isSiteDeleted(site));

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
        const settings = await readSettings(settingsFile, { includeForbiddenWords: true });
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

      let site = clearForbiddenAudit(file ? clearDuplicateAudit({
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
        site = await attachFreshStorageCache(site, storageDir);
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
      const deletedAt = new Date().toISOString();
      const sites = await readSites(dataFile);
      const deletedSite = sites.find((site) => site.id === id && !isSiteDeleted(site));

      if (!deletedSite) {
        return res.status(404).json({ error: '项目不存在' });
      }

      const nextSites = sites.map((site) => {
        if (site.id !== id) {
          return site;
        }
        return {
          ...site,
          enabled: false,
          deletedAt,
          updatedAt: deletedAt
        };
      });
      await writeSites(dataFile, nextSites);

      await appendAuditLog(auditFile, {
        type: 'site-delete',
        action: 'soft-delete',
        summary: `软删除项目「${deletedSite.title || id}」`,
        siteIds: [id],
        details: { id, title: deletedSite.title || '', deletedAt }
      });

      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get('/preview/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const site = await readSite(dataFile, id);
      const projectDir = path.join(storageDir, id);

      if (!site || isSiteDeleted(site) || !fs.existsSync(projectDir)) {
        return res.status(404).send('Not found');
      }

      if (site.enabled === false && !(await hasAdminAccess(req))) {
        return res.status(404).send('Not found');
      }

      if (!(await canReadSite(req, id, site))) {
        return res.status(401).send('请输入班级密码');
      }

      await incrementSiteUsage(usageFile, site, 'preview');
      return res.type('html').send(renderPreviewPage({ id, title: site.title }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/site/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const projectDir = path.join(storageDir, id);
      const site = await readSite(dataFile, id);

      if (!site || isSiteDeleted(site) || !fs.existsSync(projectDir)) {
        return res.status(404).send('Not found');
      }

      if (site.enabled === false && !(await hasAdminAccess(req))) {
        return res.status(404).send('Not found');
      }

      if (!(await canReadSite(req, id, site))) {
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
    const site = await readSite(dataFile, id);

    if (!site || isSiteDeleted(site) || !fs.existsSync(projectDir)) {
      return res.status(404).send('Not found');
    }

    if (site.enabled === false && !(await hasAdminAccess(req))) {
      return res.status(404).send('Not found');
    }

    if (!(await canReadSite(req, id, site))) {
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
  resolveInside,
  __test: {
    readSites,
    writeSites,
    readSettings,
    writeSettings,
    readSiteUsage
  }
};
