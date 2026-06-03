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

function stripCodeFence(value) {
  const content = String(value || '').trim();
  const fenced = content.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i)
    || content.match(/```(?:html)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : content).trim();
}

function getLlmConfig(options = {}) {
  return {
    apiKey: options.llmApiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: options.llmApiBaseUrl || process.env.LLM_API_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: options.llmModel || process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    thinkingType: options.llmThinkingType || process.env.LLM_THINKING_TYPE || '',
    reasoningEffort: options.llmReasoningEffort || process.env.LLM_REASONING_EFFORT || ''
  };
}

function getChatCompletionsUrl(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  return normalizedBaseUrl.endsWith('/chat/completions')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/chat/completions`;
}

async function optimizeHtmlWithLlm({ htmlContent, siteTitle, instruction, llmConfig }) {
  if (!llmConfig.apiKey) {
    throw new Error('请先在服务器环境变量中配置 LLM_API_KEY 或 OPENAI_API_KEY');
  }

  const requestBody = {
    model: llmConfig.model,
    temperature: 0.2,
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

  if (llmConfig.reasoningEffort) {
    requestBody.reasoning_effort = llmConfig.reasoningEffort;
  }

  const response = await fetch(getChatCompletionsUrl(llmConfig.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${llmConfig.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error?.message || `AI 优化接口调用失败：${response.status}`);
  }

  const optimizedContent = stripCodeFence(result.choices?.[0]?.message?.content || '');
  if (!optimizedContent) {
    throw new Error('AI 没有返回可用代码');
  }

  return optimizedContent;
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
function syncDataToGithub() {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  syncTimeout = setTimeout(() => {
    console.log('[Git Sync] Starting backup to GitHub...');
    exec('git add . && git commit -m "Auto backup data" && git push', { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        if (stdout.includes('nothing to commit') || stderr.includes('nothing to commit')) {
          console.log('[Git Sync] No changes to backup.');
        } else {
          console.error('[Git Sync] Error:', error.message);
        }
      } else {
        console.log('[Git Sync] Backup successful!');
      }
    });
  }, 3000);
}

function renderAdminLoginPage(errorMessage = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>后台登录 - HtmlDeploy</title>
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
    <div class="brand"><span class="brand-mark">H</span><span>HtmlDeploy</span></div>
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

      if (passwordIsValid && hasUploadEnabled) {
        return classItem;
      }

      changed = true;
      return {
        ...classItem,
        password: passwordIsValid ? classItem.password : createClassPassword(),
        uploadEnabled: classItem.uploadEnabled !== false
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
    forbiddenWords: normalizeForbiddenWords(settings.forbiddenWords)
  };
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

function toPublicClass(classItem) {
  return {
    id: classItem.id,
    name: classItem.name,
    uploadEnabled: classItem.uploadEnabled !== false,
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

function toPublicSite(site, classes, thumbnailDir) {
  return {
    ...attachClassName(site, classes),
    url: `/site/${site.id}`,
    previewUrl: `/preview/${site.id}`,
    thumbnailUrl: getThumbnailUrl(thumbnailDir, site.id)
  };
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
  const storageDir = options.storageDir || path.join(process.cwd(), 'storage', 'sites');
  const thumbnailDir = options.thumbnailDir || path.join(process.cwd(), 'storage', 'thumbnails');
  const publicDir = options.publicDir || path.join(process.cwd(), 'public');
  const idGenerator = options.idGenerator || createDefaultId;
  const maxTotalBytes = options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES;
  const adminPassword = options.adminPassword || DEFAULT_ADMIN_PASSWORD;
  const adminToken = createAdminToken(adminPassword);
  const llmConfig = getLlmConfig(options);

  const upload = multer({
    storage: multer.memoryStorage(),
    preservePath: true,
    limits: {
      files: 1,
      fileSize: maxTotalBytes
    }
  });

  function hasAdminAccess(req) {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[ADMIN_COOKIE_NAME] === adminToken;
  }

  function hasClassAccess(req, classItem) {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[getClassCookieName(classItem.id)] === createClassToken(classItem);
  }

  function hasAllAccess(req, settings) {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[ALL_COOKIE_NAME] === createAllToken(settings);
  }

  function requireAdmin(req, res, next) {
    if (!hasAdminAccess(req)) {
      return res.status(401).json({ error: '请先输入后台密码' });
    }

    return next();
  }

  async function canReadSite(req, id) {
    const sites = await readSites(dataFile);
    const site = sites.find((item) => item.id === id);
    if (!site?.classId) {
      return true;
    }

    if (hasAdminAccess(req)) {
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
    setTimeout(() => {
      generateSiteThumbnail({ id, origin, thumbnailDir, adminToken }).catch((error) => {
        console.warn(`[Thumbnail] Failed to generate ${id}: ${error.message}`);
      });
    }, 0);
  }

  app.use(express.json({ limit: maxTotalBytes }));
  app.use(express.urlencoded({ extended: false, limit: maxTotalBytes }));

  app.get('/admin.html', (req, res) => {
    if (!hasAdminAccess(req)) {
      return res.type('html').send(renderAdminLoginPage());
    }

    return res.sendFile(path.join(publicDir, 'admin.html'));
  });

  app.post('/admin-login', (req, res) => {
    const password = String(req.body.password || '');
    if (password !== adminPassword) {
      return res.status(401).type('html').send(renderAdminLoginPage('密码不正确'));
    }

    res.cookie(ADMIN_COOKIE_NAME, adminToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    return res.redirect(303, '/admin.html');
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
          const count = sites.filter((site) => site.classId === classId).length;
          return res.status(401).json({ error: '请输入班级密码', count });
        }
      } else if (!hasAllAccess(req, settings)) {
        return res.status(401).json({ error: '请输入全部密码', count: sites.length });
      }

      const filteredSites = classId
        ? sites.filter((site) => site.classId === classId)
        : sites;
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
      res.json(sites.map((site) => toPublicSite(site, classes, thumbnailDir)));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/settings', requireAdmin, async (req, res, next) => {
    try {
      const settings = await readSettings(settingsFile);
      if (req.query.includeForbiddenWords === 'false') {
        const { forbiddenWords, ...summarySettings } = settings;
        return res.json({
          ...summarySettings,
          forbiddenWordsCount: forbiddenWords?.length || 0
        });
      }

      return res.json(settings);
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
        ? words.filter((word) => String(word).toLocaleLowerCase().includes(normalizedQuery))
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
      if (!isValidClassPassword(allPassword)) {
        return res.status(400).json({ error: '全部密码必须是 6 位数字' });
      }

      const settings = {
        ...previousSettings,
        allPassword,
        forbiddenWords: req.body.forbiddenWords === undefined
          ? previousSettings.forbiddenWords
          : normalizeForbiddenWords(req.body.forbiddenWords),
        updatedAt: new Date().toISOString()
      };
      await writeSettings(settingsFile, settings);
      if (req.query.includeForbiddenWords === 'false') {
        const { forbiddenWords, ...summarySettings } = settings;
        return res.json({
          ...summarySettings,
          forbiddenWordsCount: forbiddenWords?.length || 0
        });
      }

      return res.json(settings);
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

  app.post('/api/classes/:id/unlock', async (req, res, next) => {
    try {
      const { id } = req.params;
      const password = String(req.body.password || '').trim();
      const classes = await readClasses(classesFile);
      const classItem = classes.find((item) => item.id === id);

      if (!classItem) {
        return res.status(404).json({ error: '班级不存在' });
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
        createdAt: new Date().toISOString()
      };
      sites.unshift(site);
      await writeSites(dataFile, sites);

      settings.lastUsedSiteNumber = nextNumberValue;
      await writeSettings(settingsFile, settings);

      generateThumbnailLater(id, getRequestOrigin(req));

      return res.status(201).json(toPublicSite(site, classes, thumbnailDir));
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
        adminToken
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
      return res.json({
        ...toPublicSite(site, await readClasses(classesFile), thumbnailDir),
        htmlContent
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

      const site = {
        ...sites[siteIndex],
        updatedAt: new Date().toISOString()
      };
      sites[siteIndex] = site;
      await writeSites(dataFile, sites);
      generateThumbnailLater(id, getRequestOrigin(req));

      const classes = await readClasses(classesFile);
      return res.json(toPublicSite(site, classes, thumbnailDir));
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

      const optimizedContent = await optimizeHtmlWithLlm({
        htmlContent,
        siteTitle: sites[siteIndex].title,
        instruction,
        llmConfig
      });

      await fsp.writeFile(indexPath, optimizedContent);

      const site = {
        ...sites[siteIndex],
        updatedAt: new Date().toISOString()
      };
      sites[siteIndex] = site;
      await writeSites(dataFile, sites);
      generateThumbnailLater(id, getRequestOrigin(req));

      const classes = await readClasses(classesFile);
      return res.json({
        site: toPublicSite(site, classes, thumbnailDir),
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

      const settings = await readSettings(settingsFile);
      const forbiddenMatch = findForbiddenWordMatch({ title, author }, settings.forbiddenWords);
      if (forbiddenMatch) {
        return res.status(400).json({ error: createForbiddenWordError(forbiddenMatch) });
      }

      if (!classItem) {
        return res.status(400).json({ error: '请选择有效班级' });
      }

      if (file && !isHtmlFile(file)) {
        return res.status(400).json({ error: '当前版本只支持上传 HTML 文件' });
      }

      const site = {
        ...sites[siteIndex],
        title,
        author,
        classId,
        updatedAt: new Date().toISOString()
      };

      if (file) {
        const projectDir = path.join(storageDir, id);
        await fsp.mkdir(projectDir, { recursive: true });
        await fsp.writeFile(path.join(projectDir, 'index.html'), file.buffer);
        generateThumbnailLater(id, getRequestOrigin(req));
      }

      sites[siteIndex] = site;
      await writeSites(dataFile, sites);

      return res.json(toPublicSite(site, classes, thumbnailDir));
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

      if (!(await canReadSite(req, id))) {
        return res.status(401).send('请输入班级密码');
      }

      return res.type('html').send(renderPreviewPage({ id, title: site.title }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/site/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const projectDir = path.join(storageDir, id);

      if (!fs.existsSync(projectDir)) {
        return res.status(404).send('Not found');
      }

      if (!(await canReadSite(req, id))) {
        return res.status(401).send('请输入班级密码');
      }

      const indexPath = path.join(projectDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }

      const sites = await readSites(dataFile);
      const site = sites.find((item) => item.id === id);
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

    if (!fs.existsSync(projectDir)) {
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
