const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const request = require('supertest');

const { createApp, __test } = require('../src/app');
const { RuntimeStore } = require('../src/db/runtime-store');
const { createRepositories } = require('../src/db/repositories');

test('public index uses a single HTML file picker', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /<input[^>]+id="fileInput"[^>]+type="file"/);
  assert.match(html, /<input[^>]+id="fileInput"[^>]+accept="\.html,text\/html"/);
  assert.doesNotMatch(html, /<input[^>]+id="fileInput"[^>]+multiple/);
  assert.doesNotMatch(html, /<input[^>]+id="fileInput"[^>]+webkitdirectory/);
});

test('pages expose a shared favicon', async () => {
  const publicDir = path.join(__dirname, '..', 'public');
  const indexHtml = await fsp.readFile(path.join(publicDir, 'index.html'), 'utf8');
  const adminHtml = await fsp.readFile(path.join(publicDir, 'admin.html'), 'utf8');
  const { app } = await makeTestApp({ publicDir });

  assert.match(indexHtml, /<link rel="icon" href="\/favicon-site-mark\.svg" type="image\/svg\+xml">/);
  assert.match(adminHtml, /<link rel="icon" href="\/favicon-site-mark\.svg" type="image\/svg\+xml">/);

  const loginPage = await request(app).get('/admin.html').expect(200);
  assert.match(loginPage.text, /<link rel="icon" href="\/favicon-site-mark\.svg" type="image\/svg\+xml">/);

  const favicon = await request(app).get('/favicon-site-mark.svg').expect(200);
  assert.match(favicon.text || favicon.body.toString('utf8'), /<svg[^>]+viewBox="0 0 64 64"/);
});

test('public pages are compressed when the browser supports it', async () => {
  const publicDir = path.join(__dirname, '..', 'public');
  const { app } = await makeTestApp({ publicDir });

  const response = await request(app)
    .get('/')
    .set('Accept-Encoding', 'gzip')
    .expect(200);

  assert.equal(response.headers['content-encoding'], 'gzip');
});

test('public index does not show the project list heading or helper copy', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.doesNotMatch(html, /项目列表/);
  assert.doesNotMatch(html, /上传项目文件后，点击卡片可在大窗口中预览。/);
});

test('public index shows a loading spinner before project cards resolve', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /class="loading-state" id="loadingState"/);
  assert.match(html, /class="loading-spinner"/);
  assert.match(html, /<span>正在加载项目\.\.\.<\/span>/);
  assert.match(html, /<div class="empty" id="emptyState" hidden>/);
  assert.match(html, /function showLoadingState\(\)/);
  assert.match(html, /showLoadingState\(\);\s+const sitesUrl/);
  assert.match(html, /function hideLoadingState\(\)/);
});

test('public index shows loading feedback on interactive buttons', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /button\.is-loading::before/);
  assert.match(html, /function setButtonLoading/);
  assert.match(html, /setButtonLoading\(refreshClassSitesButton, true, '刷新中\.\.\.'\)/);
  assert.match(html, /setButtonLoading\(previewUploadButton, true, '预览中\.\.\.'\)/);
  assert.match(html, /setButtonLoading\(uploadSubmitButton, true, '上传中\.\.\.'\)/);
  assert.match(html, /setButtonLoading\(button, true, '解锁中\.\.\.'\)/);
});

test('public index defers upload rule loading until upload interaction', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const bootMatch = html.match(/async function boot\(\) \{([\s\S]*?)\n    \}/);

  assert.ok(bootMatch);
  assert.doesNotMatch(bootMatch[1], /loadUploadRules|ensureUploadRulesLoaded/);
  assert.match(html, /function openUpload\(\) \{[\s\S]*?ensureUploadRulesLoaded\(\)\.catch/);
  assert.match(html, /await ensureUploadRulesLoaded\(\)/);
});

test('public index renders a visible upload-order number on each project card', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /function appendSiteCardBatch/);
  assert.match(html, /for \(let index = startIndex; index < endIndex; index \+= 1\)/);
  assert.match(html, /const site = sites\[index\]/);
  assert.match(html, /className = 'site-heading'/);
  assert.match(html, /className = 'site-number'/);
  assert.match(html, /textContent = site\.number/);
  assert.ok(html.indexOf("heading.append(number, title)") < html.indexOf("content.append(heading, tagsContainer)"));
  assert.doesNotMatch(html, /cardMain\.append\(number, content\)/);
  assert.doesNotMatch(html, /textContent = String\(index \+ 1\)/);
});

test('public index shows the class name tag on project cards', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /className = 'site-class-tag'/);
  assert.match(html, /textContent = site\.className \|\| '未分配'/);
  assert.ok(html.indexOf("className = 'site-class-tag'") < html.indexOf("url.className = 'site-url'"));
});

test('public index shows total usage count on project cards', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /\.site-usage-tag/);
  assert.match(html, /const usageTag = document\.createElement\('div'\)/);
  assert.match(html, /usageTag\.className = 'site-usage-tag'/);
  assert.match(html, /const usageCount = Math\.max\(0, Number\(site\.usageCount\) \|\| 0\)/);
  assert.match(html, /usageTag\.textContent = `\$\{usageCount\} 次`/);
  assert.doesNotMatch(html, /总次数 \$\{usageCount\}/);
  assert.ok(html.indexOf("usageTag.className = 'site-usage-tag'") < html.indexOf("url.className = 'site-url'"));
});

test('public index highlights starred project cards with a star icon', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /site-card is-starred/);
  assert.match(html, /\.site-card\.is-starred/);
  assert.match(html, /className = 'site-star-icon'/);
  assert.match(html, /if \(site\.starred === true\)/);
  assert.match(html, /starIcon\.textContent = '★'/);
  assert.doesNotMatch(html, /星标作品/);
  assert.doesNotMatch(html, /site-star-badge/);
  assert.ok(html.indexOf("heading.append(number, title)") < html.indexOf("className = 'site-star-icon'"));
  assert.ok(html.indexOf("className = 'site-star-icon'") < html.indexOf("className = 'site-class-tag'"));
});

test('public index loads class buttons and uploads to the selected class', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /id="classTabs"/);
  assert.match(html, /id="refreshClassSites"[^>]*>刷新<\/button>/);
  assert.match(html, /function refreshCurrentClassSites/);
  assert.match(html, /refreshClassSitesButton\.addEventListener\('click', refreshCurrentClassSites\)/);
  assert.match(html, /function hasCurrentClassAccess/);
  assert.match(html, /currentClass\.passwordEnabled === false/);
  assert.doesNotMatch(html, /id="classPasswordOverlay"/);
  assert.match(html, /function renderClassPasswordPrompt/);
  assert.match(html, /className = 'unlock-panel'/);
  assert.match(html, /fetch\('\/api\/classes'\)/);
  assert.match(html, /\/api\/classes\/\$\{encodeURIComponent\(classId\)\}\/unlock/);
  assert.match(html, /\/api\/sites\?classId=/);
  assert.match(html, /formData\.append\('classId', currentClassId\)/);
});

test('public index keeps the selected class after refresh', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /const CLASS_SELECTION_STORAGE_KEY = 'project-site-selected-class-id'/);
  assert.match(html, /function getStoredClassId/);
  assert.match(html, /localStorage\.getItem\(CLASS_SELECTION_STORAGE_KEY\)/);
  assert.match(html, /let currentClassId = getStoredClassId\(\)/);
  assert.match(html, /function rememberSelectedClassId\(classId\)/);
  assert.match(html, /localStorage\.setItem\(CLASS_SELECTION_STORAGE_KEY, classId\)/);
  assert.match(html, /localStorage\.removeItem\(CLASS_SELECTION_STORAGE_KEY\)/);
  assert.match(html, /rememberSelectedClassId\(classId\)/);
  assert.match(html, /rememberSelectedClassId\(''\)/);
});

test('public index renders class password entry inside the project grid', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /siteGrid\.append\(panel\)/);
  assert.match(html, /input\.type = 'password'/);
  assert.match(html, /button\.textContent = currentClassId \? '解锁班级' : '解锁全部'/);
  assert.match(html, /renderClassPasswordPrompt\('请输入班级密码后查看项目。', data\.count \|\| 0\)/);
  assert.doesNotMatch(html, /openClassPassword\(\)/);
  assert.doesNotMatch(html, /closeClassPassword\(\)/);
});

test('public index upload accepts either an HTML file or pasted code', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /<textarea[^>]+id="uploadHtmlContent"/);
  assert.doesNotMatch(html, /<input[^>]+id="fileInput"[^>]+required/);
  assert.match(html, /const htmlContent = uploadHtmlContent\.value\.trim\(\)/);
  assert.match(html, /if \(!file && !htmlContent\)/);
  assert.match(html, /formData\.append\('htmlContent', htmlContent\)/);
});

test('public index validates basic HTML structure before upload', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /function validateBasicHtmlDocument\(htmlContent\)/);
  assert.match(html, /<!doctype\\s\+html\\b\|<html\[\\s>\]\|<head\[\\s>\]\|<body\[\\s>\]/);
  assert.match(html, /HTML 代码结构不完整/);
  assert.match(html, /const htmlStructureMessage = validateBasicHtmlDocument\(submittedHtmlContent\)/);
  assert.match(html, /submittedHtmlContent = await file\.text\(\)/);
});

test('public index can preview upload draft before submitting', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /id="previewUpload"[^>]*>预览<\/button>/);
  assert.ok(html.indexOf('id="previewUpload"') < html.indexOf('type="submit">确定上传'));
  assert.match(html, /const previewUploadButton = document\.getElementById\('previewUpload'\)/);
  assert.match(html, /async function getUploadPreviewHtml/);
  assert.match(html, /fileInput\.files && fileInput\.files\[0\]/);
  assert.match(html, /await file\.text\(\)/);
  assert.match(html, /function openUploadDraftPreview/);
  assert.match(html, /new Blob\(\[htmlContent\], \{ type: 'text\/html' \}\)/);
  assert.match(html, /URL\.createObjectURL/);
  assert.match(html, /URL\.revokeObjectURL\(currentPreviewObjectUrl\)/);
  assert.match(html, /previewUploadButton\.addEventListener\('click', previewUploadDraft\)/);
});

test('public index shows a success dialog after upload completes', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /id="uploadSuccessOverlay"/);
  assert.match(html, /上传成功，请勿重复上传/);
  assert.match(html, /id="closeUploadSuccess"[^>]*>我知道了<\/button>/);
  assert.match(html, /const uploadSuccessOverlay = document\.getElementById\('uploadSuccessOverlay'\)/);
  assert.match(html, /function openUploadSuccess/);
  assert.match(html, /openOverlay\(uploadSuccessOverlay\)/);
  assert.match(html, /function closeUploadSuccess/);
  assert.match(html, /closeOverlay\(uploadSuccessOverlay\)/);
  assert.match(html, /await loadSites\(\);\s+openUploadSuccess\(\);/);
  assert.match(html, /document\.getElementById\('closeUploadSuccess'\)\.addEventListener\('click', closeUploadSuccess\)/);
});

test('public index renders an all tab before class buttons', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /allButton\.textContent = '全部作品'/);
  assert.match(html, /allButton\.addEventListener\('click', \(\) => selectClass\(''\)\)/);
  assert.ok(html.indexOf('classTabs.append(allButton)') < html.indexOf('classes.forEach'));
});

test('public index separates class tabs from the project grid', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /class="class-filter-bar"/);
  assert.match(html, /<nav class="class-tabs" id="classTabs"/);
  assert.ok(html.indexOf('class="class-filter-bar"') < html.indexOf('id="siteGrid"'));
  assert.doesNotMatch(html, /<main>\s*<nav class="class-tabs"/);
});

test('public refresh button aligns with the all projects tab', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /\.class-filter-row\s*\{[^}]*align-items:\s*flex-start;/s);
  assert.match(html, /class="secondary-button class-refresh-button" id="refreshClassSites"/);
});

test('public index can search projects and filter starred projects', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /id="projectSearchInput"/);
  assert.match(html, /placeholder="搜索项目名称、作者、编号"/);
  assert.match(html, /class="[^"]*is-descending[^"]*" id="projectOrderButton"/);
  assert.match(html, /id="projectOrderButton"[^>]*>降序<\/button>/);
  assert.match(html, /id="starredFilterButton"[^>]*>星标<\/button>/);
  assert.ok(html.indexOf('id="classTabs"') < html.indexOf('id="projectSearchInput"'));
  assert.ok(html.indexOf('id="projectOrderButton"') < html.indexOf('id="starredFilterButton"'));
  assert.ok(html.indexOf('id="projectSearchInput"') < html.indexOf('id="siteGrid"'));
  assert.match(html, /let loadedSites = \[\]/);
  assert.match(html, /let siteSearchQuery = ''/);
  assert.match(html, /let starredOnly = false/);
  assert.match(html, /let projectOrderMode = 'descending'/);
  assert.match(html, /function getFilteredSites/);
  assert.match(html, /if \(starredOnly && site\.starred !== true\)/);
  assert.match(html, /function resetRandomSiteOrder/);
  assert.match(html, /function sortSitesForDisplay/);
  assert.match(html, /projectOrderMode === 'ascending'/);
  assert.match(html, /projectOrderMode === 'descending'/);
  assert.match(html, /getSiteNumberValue\(a\) - getSiteNumberValue\(b\)/);
  assert.match(html, /projectOrderMode === 'descending' \? -numberDiff : numberDiff/);
  assert.match(html, /function renderFilteredSites/);
  assert.match(html, /projectSearchInput\.addEventListener\('input'/);
  assert.match(html, /projectOrderButton\.addEventListener\('click'/);
  assert.match(html, /starredFilterButton\.addEventListener\('click'/);
  assert.match(html, /projectOrderButton\.setAttribute\('aria-pressed'/);
  assert.match(html, /starredFilterButton\.setAttribute\('aria-pressed'/);
});

test('public index debounces search and renders cards in batches', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /const SITE_RENDER_BATCH_SIZE = 12/);
  assert.match(html, /let siteSearchDebounceTimer = null/);
  assert.match(html, /let siteRenderToken = 0/);
  assert.match(html, /function debounceProjectSearchRender/);
  assert.match(html, /window\.setTimeout\(\(\) => \{/);
  assert.match(html, /window\.clearTimeout\(siteSearchDebounceTimer\)/);
  assert.match(html, /function appendSiteCardBatch/);
  assert.match(html, /requestAnimationFrame\(\(\) => appendSiteCardBatch/);
  assert.match(html, /for \(let index = startIndex; index < endIndex; index \+= 1\)/);
  assert.doesNotMatch(html, /sites\.slice\(startIndex, endIndex\)/);
  assert.match(html, /const renderToken = \+\+siteRenderToken/);
  assert.match(html, /projectSearchInput\.addEventListener\('input', debounceProjectSearchRender\)/);
});

test('public index only shows the new-page button in the preview header', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.doesNotMatch(html, /在新页面打开/);
  assert.doesNotMatch(html, /id="openExternal"/);
  assert.match(html, /id="openPreviewExternal"[^>]*>新页面打开<\/button>/);
  assert.match(html, /let currentPreviewUrl = ''/);
  assert.match(html, /window\.open\(currentPreviewExternalUrl, '_blank', 'noopener'\)/);
  assert.match(html, /actions\.append\(previewButton, codeButton\)/);
});

test('public index opens preview only from the preview button', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /previewButton\.addEventListener\('click', \(\) => openProjectWindow\(site\)\)/);
  assert.doesNotMatch(html, /card\.addEventListener\('click'/);
});

test('public index exposes a read-only project code viewer', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /id="codeOverlay"/);
  assert.match(html, /id="codeViewer"[^>]+readonly/);
  assert.match(html, /codeButton\.textContent = '查看代码'/);
  assert.match(html, /codeButton\.addEventListener\('click', \(\) => openCodeWindow\(site\)\)/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/public-code/);
  assert.match(html, /navigator\.clipboard\?\.writeText/);
  assert.doesNotMatch(html, /id="saveCodeButton"/);
});

test('public admin page exposes project CRUD controls', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /class="admin-shell"/);
  assert.match(html, /class="admin-sidebar"/);
  assert.match(html, /data-view-target="projects"/);
  assert.match(html, /data-view-target="create"/);
  assert.match(html, /data-view-target="ranking"/);
  assert.match(html, /data-view-target="classes"/);
  assert.match(html, /data-view-target="settings"/);
  assert.match(html, /data-admin-view="projects"[^>]+class="workspace is-active"/);
  assert.match(html, /data-admin-view="ranking"[^>]+class="workspace"/);
  assert.match(html, /data-admin-view="create"[^>]+class="workspace"/);
  assert.match(html, /data-admin-view="classes"[^>]+class="workspace"/);
  assert.match(html, /data-admin-view="settings"[^>]+class="workspace"/);
  assert.match(html, /function switchView/);
  assert.match(html, /projectCount/);
  assert.match(html, /classCount/);
  assert.match(html, /storageUsage/);
  assert.match(html, /id="rankingSearchInput"/);
  assert.match(html, /id="rankingClassFilter"/);
  assert.match(html, /id="rankingRows"/);
  assert.match(html, /function renderRanking/);
  assert.match(html, /site\.enabled !== false/);
  assert.match(html, /getTotalUsage\(right\) - getTotalUsage\(left\)/);
  assert.match(html, /previewButton\.textContent = '预览'/);
  assert.match(html, /previewButton\.addEventListener\('click', \(\) => \{/);
  assert.match(html, /if \(!openProjectWindow\(site\)\) \{/);
  assert.match(html, /rankingSearchInput\.addEventListener\('input', renderRanking\)/);
  assert.match(html, /rankingClassFilter\.addEventListener\('change', renderRanking\)/);
  assert.match(html, /function formatBytes/);
  assert.match(html, /id="createForm"/);
  assert.match(html, /fetch\('\/api\/admin\/sites'/);
  assert.match(html, /method: 'PUT'/);
  assert.match(html, /method: 'DELETE'/);
  assert.match(html, /id="auditForbiddenSitesButton"[^>]*>违禁词审查<\/button>/);
  assert.match(html, /id="dedupeSitesButton"[^>]*>查重<\/button>/);
  assert.match(html, /id="enableAllSitesButton"[^>]*>全部解禁<\/button>/);
  assert.match(html, /id="aiOptimizeLog"/);
  assert.match(html, /id="taskStatusPanel"/);
  assert.match(html, /id="taskStatusRows"/);
  assert.match(html, /function loadTaskStatuses/);
  assert.match(html, /\/api\/admin\/thumbnail-jobs\/\$\{encodeURIComponent\(jobId\)\}/);
  assert.match(html, /\/api\/admin\/jobs\/logs/);
  assert.match(html, /function addAiOptimizeLog/);
  assert.match(html, /const AI_OPTIMIZE_LOG_STORAGE_KEY/);
  assert.match(html, /function loadAiOptimizeLog/);
  assert.match(html, /function saveAiOptimizeLog/);
  assert.match(html, /async function readResponseError/);
  assert.match(html, /const AI_REQUEST_TIMEOUT_MS = 60000/);
  assert.match(html, /async function fetchWithTimeout/);
  assert.match(html, /response\.status === 504/);
  assert.match(html, /公网代理已超时/);
  assert.match(html, /AI 请求超过/);
  assert.match(html, /await readResponseError\(response, 'AI 优化失败'\)/);
  assert.match(html, /async function pollAiOptimizeJob/);
  assert.match(html, /\/api\/admin\/ai-optimize-jobs\/\$\{encodeURIComponent\(jobId\)\}/);
  assert.match(html, /AI 优化任务已创建，后台会继续执行/);
  assert.match(html, /localStorage\.getItem\(AI_OPTIMIZE_LOG_STORAGE_KEY\)/);
  assert.match(html, /localStorage\.setItem\(AI_OPTIMIZE_LOG_STORAGE_KEY/);
  assert.match(html, /aiOptimizeLogItems = loadAiOptimizeLog\(\)/);
  assert.match(html, /async function boot\(\) \{\s+renderAiOptimizeLog\(\);/);
  assert.match(html, /runningAiOptimizations/);
  assert.match(html, /\/api\/admin\/sites\/forbidden-audit/);
  assert.match(html, /\/api\/admin\/sites\/dedupe/);
  assert.match(html, /\/api\/admin\/sites\/enable-all/);
  assert.match(html, /function dedupeSites/);
  assert.match(html, /function enableAllSites/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/download/);
  assert.match(html, /textContent = '下载'/);
  assert.match(html, /textContent = aiOptimizeButton\.disabled \? '优化中\.\.\.' : 'AI优化'/);
  assert.match(html, /textContent = directedAiOptimizeButton\.disabled \? '优化中\.\.\.' : '定向AI优化'/);
  assert.match(html, /id="directedAiOverlay"/);
  assert.match(html, /function openDirectedAiWindow/);
  assert.match(html, /textContent = aiNameButton\.disabled \? '命名中\.\.\.' : 'AI命名'/);
  assert.match(html, /function nameSiteWithAi/);
  assert.match(html, /textContent = enabled \? '禁用' : '启用'/);
  assert.match(html, /textContent = forbiddenWhitelisted \? '移出白名单' : '白名单'/);
  assert.match(html, /const starred = site\.starred === true/);
  assert.match(html, /starButton\.className = starred \? 'warning-button' : 'button'/);
  assert.match(html, /starButton\.textContent = '星标'/);
  assert.doesNotMatch(html, /starButton\.textContent = starred \? '取消星标' : '星标'/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/ai-name/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/ai-optimize-save/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/enabled/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/forbidden-whitelist/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/starred/);
  assert.match(html, /function toggleSiteStarred/);
  assert.match(html, /project-disabled-warning/);
  assert.match(html, /\.index-cell \{[\s\S]*font-size: 18px;/);
  assert.match(html, /forbidden-audit-note/);
  assert.match(html, /site\.forbiddenAuditMessage/);
  assert.match(html, /duplicate-audit-note/);
  assert.match(html, /site\.duplicateAuditMessage/);
  assert.match(html, /project-class-column/);
  assert.match(html, /project-class-cell/);
  assert.match(html, /<th>存储占用<\/th>/);
  assert.match(html, /className = 'storage-cell'/);
  assert.match(html, /storageCell\.textContent = formatBytes\(site\.storageBytes \|\| 0\)/);
  assert.match(html, /搜索项目名称、ID 或序号/);
  assert.match(html, /id="adminPageSize"/);
  assert.match(html, /id="prevSitesPage"/);
  assert.match(html, /id="nextSitesPage"/);
  assert.match(html, /id="sitesPageInfo"/);
  assert.match(html, /let adminSitesPage = 1/);
  assert.match(html, /let adminSitesPageSize = 50/);
  assert.match(html, /let adminSitesTotal = 0/);
  assert.match(html, /fetch\(`\/api\/admin\/sites\?\$\{params\.toString\(\)\}`\)/);
  assert.match(html, /params\.set\('pageSize', String\(adminSitesPageSize\)\)/);
  assert.match(html, /sites = result\.items \|\| \[\]/);
  assert.match(html, /adminSitesTotal = result\.total \|\| sites\.length/);
  assert.match(html, /function replaceSiteInState/);
  assert.match(html, /function refreshVisibleRows/);
  assert.match(html, /function loadCurrentViewData/);
  assert.match(html, /const loadedAdminViews = new Set\(\)/);
  assert.match(html, /if \(!loadedAdminViews\.has\(viewName\)\)/);
  assert.match(html, /id="classForm"/);
  assert.match(html, /id="classPasswordInput"/);
  assert.match(html, /id="generateClassPassword"/);
  assert.match(html, /id="createClassId"/);
  assert.match(html, /id="createHtmlContent"/);
  assert.match(html, /fetch\('\/api\/admin\/classes'/);
  assert.match(html, /function generatePassword/);
  assert.match(html, /formData\.append\('classId'/);
  assert.match(html, /formData\.append\('htmlContent'/);
});

test('public admin shows loading feedback for tables and actions', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /button\.is-loading::before/);
  assert.match(html, /\.message\.is-loading::before/);
  assert.match(html, /className = 'table-loading-cell'/);
  assert.match(html, /function setButtonLoading/);
  assert.match(html, /function renderTableLoading/);
  assert.match(html, /function renderListLoading/);
  assert.match(html, /renderTableLoading\(siteRows, 9, '正在加载项目\.\.\.'\)/);
  assert.match(html, /renderTableLoading\(rankingRows, 9, '正在加载排行榜\.\.\.'\)/);
  assert.match(html, /renderListLoading\(forbiddenWordsResults, '正在加载违禁词\.\.\.'\)/);
  assert.match(html, /setButtonLoading\(auditForbiddenSitesButton, true, '审查中\.\.\.'\)/);
  assert.match(html, /setButtonLoading\(dedupeSitesButton, true, '查重中\.\.\.'\)/);
  assert.match(html, /setButtonLoading\(generateThumbnailsButton, true, '加入中\.\.\.'\)/);
});

test('public admin uses compact horizontal page padding', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /\.admin-main\s*\{[\s\S]*padding: 24px clamp\(10px, 2vw, 20px\) 48px;/);
  assert.match(html, /@media \(max-width: 860px\)[\s\S]*\.admin-main\s*\{[\s\S]*padding: 18px 10px 40px;/);
});

test('public admin exposes AI settings controls', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /data-view-target="settings"[^>]*>设置<\/button>/);
  assert.match(html, /data-admin-view="settings"[^>]+class="workspace"/);
  assert.match(html, /后台密码设置/);
  assert.match(html, /id="adminPasswordForm"/);
  assert.match(html, /id="adminPasswordInput"[^>]+type="password"/);
  assert.match(html, /id="adminPasswordConfirmInput"[^>]+type="password"/);
  assert.match(html, /async function saveAdminPassword/);
  assert.match(html, /body: JSON\.stringify\(\{ adminPassword \}\)/);
  assert.match(html, /AI 功能设置/);
  assert.match(html, /id="aiSettingsForm"/);
  assert.match(html, /id="aiApiKeyInput"[^>]+type="password"/);
  assert.match(html, /id="aiBaseUrlInput"/);
  assert.match(html, /id="aiModelInput"/);
  assert.match(html, /id="aiTemperatureInput"/);
  assert.match(html, /id="aiNameTemperatureInput"/);
  assert.match(html, /id="aiThinkingTypeInput"/);
  assert.match(html, /id="clearAiApiKey"/);
  assert.match(html, /\/api\/admin\/ai-settings/);
  assert.match(html, /function loadAiSettings/);
  assert.match(html, /async function saveAiSettings/);
  assert.match(html, /async function clearAiApiKey/);
  assert.match(html, /apiKeyPreview/);
  assert.match(html, /await loadAiSettings\(\)/);
});

test('public admin explains runtime data backups instead of GitHub data sync', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /运行数据备份/);
  assert.match(html, /SQLite 与服务器备份保护/);
  assert.doesNotMatch(html, /GitHub 数据同步/);
  assert.doesNotMatch(html, /id="syncGithubButton"/);
  assert.doesNotMatch(html, /\/api\/admin\/github-sync/);
});

test('public admin class passwords are hidden by default with one show-hide toggle before random', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /id="classPasswordInput"[^>]+type="password"/);
  assert.match(html, /id="toggleClassPassword"[^>]*>显示<\/button>/);
  assert.doesNotMatch(html, /id="showClassPassword"/);
  assert.doesNotMatch(html, /id="hideClassPassword"/);
  assert.match(html, /密码已启用/);
  assert.match(html, /密码已解除/);
  assert.match(html, /\/api\/classes\/\$\{encodeURIComponent\(classItem\.id\)\}\/password-enabled/);
  assert.ok(html.indexOf('id="toggleClassPassword"') < html.indexOf('id="generateClassPassword"'));
  assert.match(html, /togglePasswordVisibility\(classPasswordInput, toggleClassPassword\)/);

  assert.match(html, /passwordInput\.type = 'password'/);
  assert.match(html, /toggleButton\.textContent = '显示'/);
  assert.match(html, /togglePasswordVisibility\(passwordInput, toggleButton\)/);
  assert.ok(html.indexOf('actions.append(toggleButton, generateButton') !== -1);
});

test('public admin exposes class bulk controls for uploads and passwords', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /id="enableAllClassUploads"[^>]*>启用全部上传<\/button>/);
  assert.match(html, /id="disableAllClassUploads"[^>]*>关闭全部上传<\/button>/);
  assert.match(html, /id="enableAllClassPasswords"[^>]*>启用全部密码<\/button>/);
  assert.match(html, /id="disableAllClassPasswords"[^>]*>解除全部密码<\/button>/);
  assert.match(html, /async function setAllClassesState\(kind, enabled, button\)/);
  assert.match(html, /confirm\(`确定要\$\{actionText\}吗？此操作将影响所有班级。`\)/);
  assert.match(html, /`\/api\/classes\/\$\{kind\}-enabled`/);
  assert.match(html, /enableAllClassUploads\.addEventListener\('click'/);
  assert.match(html, /disableAllClassPasswords\.addEventListener\('click'/);
  assert.match(html, /button\.disabled = classes\.length === 0 \|\| classBulkOperationRunning/);
});

test('public admin can edit the all-projects password in class management', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /<h2 class="panel-title">全部作品页访问设置<\/h2>/);
  assert.match(html, /id="allPasswordMessage"/);
  assert.match(html, /全部作品页访问设置[\s\S]*?id="allPasswordForm"[\s\S]*?<\/div>\s*<div class="panel">[\s\S]*?<h2 class="panel-title">班级管理<\/h2>/);
  assert.match(html, /全部作品页密码/);
  assert.match(html, /id="allPasswordInput"[^>]+type="password"/);
  assert.match(html, /id="toggleAllPassword"[^>]*>显示<\/button>/);
  assert.match(html, /id="generateAllPassword"[^>]*>随机生成<\/button>/);
  assert.match(html, /id="saveAllPassword"[^>]*>保存作品页密码<\/button>/);
  assert.match(html, /id="toggleAllPasswordEnabled"[^>]*>访问密码已启用<\/button>/);
  assert.match(html, /访问密码已启用/);
  assert.match(html, /访问密码已解除/);
  assert.match(html, /function toggleAllProjectsPasswordEnabled/);
  assert.match(html, /fetch\('\/api\/admin\/settings\?includeForbiddenWords=false'\)/);
  assert.match(html, /\/api\/admin\/forbidden-words\?\$\{params\.toString\(\)\}/);
  assert.match(html, /method: 'DELETE'/);
  assert.match(html, /function deleteForbiddenWord/);
  assert.match(html, /id="forbiddenWordsSearchInput"/);
  assert.match(html, /id="forbiddenWordsResults"/);
  assert.match(html, /method: 'PUT'/);
  assert.match(html, /body: JSON\.stringify\(\{ allPassword \}\)/);
  assert.match(html, /body: JSON\.stringify\(\{ allPasswordEnabled: nextEnabled \}\)/);
});

test('public admin can preview edited project code before saving', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /id="previewCodeButton"[^>]*>预览<\/button>/);
  assert.ok(html.indexOf('id="previewCodeButton"') < html.indexOf('id="saveCodeButton"'));
  assert.match(html, /const previewCodeButton = document\.getElementById\('previewCodeButton'\)/);
  assert.match(html, /function previewCurrentCode\(\)/);
  assert.match(html, /new Blob\(\[htmlContent\], \{ type: 'text\/html' \}\)/);
  assert.match(html, /window\.URL\.createObjectURL\(previewBlob\)/);
  assert.match(html, /previewCodeButton\.addEventListener\('click', previewCurrentCode\)/);
  assert.match(html, /window\.URL\.revokeObjectURL\(previewUrl\)/);
});

test('runtime data is excluded from Git sync paths', async () => {
  const source = await fsp.readFile(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

  assert.doesNotMatch(source, new RegExp('syncData' + 'ToGithub'));
  assert.doesNotMatch(source, /GIT_SYNC_DELAY_MS/);
  assert.doesNotMatch(source, /removeStaleGitIndexLock/);
  assert.doesNotMatch(source, /writeGitBackupPathspecFile/);
  assert.doesNotMatch(source, /git add -u -- data/);
  assert.doesNotMatch(source, /git add .*storage\/sites/);
  assert.doesNotMatch(source, new RegExp('Auto backup' + ' data'));
  assert.doesNotMatch(source, /git add \./);
  assert.match(source, /createRuntimeStore/);
  assert.match(source, /incrementSiteUsage\(usageFile, site, 'preview'\)/);
  assert.match(source, /incrementSiteUsage\(usageFile, site, 'code'\)/);
});

test('site list endpoints avoid redundant work on every request', async () => {
  const source = await fsp.readFile(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const publicSitesRoute = source.slice(
    source.indexOf("app.get('/api/sites'"),
    source.indexOf("app.get('/api/classes'")
  );
  const adminSitesRoute = source.slice(
    source.indexOf("app.get('/api/admin/sites'"),
    source.indexOf("app.get('/api/admin/thumbnail-jobs")
  );

  assert.match(source, /const compression = require\('compression'\)/);
  assert.match(source, /app\.use\(compression\(\)\)/);
  assert.match(source, /const THUMBNAIL_URL_CACHE_TTL_MS = 30000/);
  assert.match(source, /const thumbnailUrlCache = new Map\(\)/);
  assert.match(source, /function invalidateThumbnailUrlCache/);
  assert.match(source, /function createClassMap/);
  assert.doesNotMatch(publicSitesRoute, /readSiteUsage\(usageFile\)/);
  assert.doesNotMatch(publicSitesRoute, /withSitesUsage/);
  assert.doesNotMatch(adminSitesRoute, /readSiteUsage\(usageFile\)/);
  assert.doesNotMatch(adminSitesRoute, /withSitesUsage/);
});

test('project preview routes avoid full site list scans', async () => {
  const source = await fsp.readFile(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const siteRoute = source.slice(
    source.indexOf("app.get('/site/:id'"),
    source.indexOf("app.get('/site/:id/*'")
  );
  const siteAssetRoute = source.slice(
    source.indexOf("app.get('/site/:id/*'"),
    source.indexOf('app.use((error')
  );
  const previewRoute = source.slice(
    source.indexOf("app.get('/preview/:id'"),
    source.indexOf("app.get('/site/:id'")
  );
  const canReadSiteFunction = source.slice(
    source.indexOf('async function canReadSite'),
    source.indexOf('function cleanupThumbnailJobs')
  );
  const runtimeSource = await fsp.readFile(path.join(__dirname, '..', 'src', 'db', 'runtime-store.js'), 'utf8');

  assert.match(runtimeSource, /getSite\(siteId\)/);
  assert.match(runtimeSource, /WHERE s\.id = \?/);
  assert.match(runtimeSource, /return this\.getSite\(siteId\)/);
  assert.match(source, /async function readSite/);
  assert.match(source, /async function readClass/);
  assert.match(canReadSiteFunction, /knownSite = null/);
  assert.match(canReadSiteFunction, /const classItem = await readClass\(classesFile, site\.classId\)/);
  assert.doesNotMatch(canReadSiteFunction, /readSites\(dataFile\)/);
  assert.doesNotMatch(siteRoute, /readSites\(dataFile\)/);
  assert.doesNotMatch(siteAssetRoute, /readSites\(dataFile\)/);
  assert.doesNotMatch(previewRoute, /readSites\(dataFile\)/);
  assert.match(siteRoute, /await readSite\(dataFile, id\)/);
  assert.match(siteRoute, /canReadSite\(req, id, site\)/);
});

test('sqlite repositories expose runtime store operations', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-deploy-repositories-'));
  const store = new RuntimeStore({ dataDir: root, dbFile: path.join(root, 'app.db') });
  const repositories = createRepositories(store);

  try {
    repositories.classes.replace([{
      id: 'class-a',
      name: '六5',
      password: '123456',
      uploadEnabled: true,
      passwordEnabled: false
    }]);
    repositories.settings.write({
      allPassword: '000000',
      allPasswordEnabled: false,
      forbiddenWords: ['bad-word'],
      lastUsedSiteNumber: 1
    });
    repositories.sites.replace([{
      id: 'site-a',
      number: '00001',
      title: '示例项目',
      author: '学生',
      classId: 'class-a',
      createdAt: '2026-06-09T00:00:00.000Z'
    }]);
    repositories.usage.increment({ id: 'site-a' }, 'preview');
    repositories.auditLogs.append({ type: 'audit', action: 'check', summary: 'ok', siteIds: ['site-a'] });
    repositories.jobLogs.append({ type: 'ai', text: 'AI 优化完成', status: 'success' });

    assert.equal(repositories.classes.list()[0].name, '六5');
    assert.deepEqual(repositories.forbiddenWords.list(), ['bad-word']);
    assert.equal(repositories.sites.list()[0].usagePreviewCount, 1);
    assert.equal(repositories.usage.getById()['site-a'].usagePreviewCount, 1);
    assert.equal(repositories.auditLogs.list()[0].summary, 'ok');
    assert.equal(repositories.jobLogs.list()[0].text, 'AI 优化完成');
  } finally {
    store.db.close();
  }
});

test('site writes preserve records that were added after a stale read', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-deploy-data-guard-'));
  const sitesPath = path.join(root, 'sites.json');
  const original = {
    id: 'old-site',
    number: '00001',
    title: '旧项目',
    createdAt: '2026-06-01T00:00:00.000Z',
    usagePreviewCount: 1,
    usageCodeCount: 0
  };
  const fresh = {
    id: 'fresh-site',
    number: '00002',
    title: '新项目',
    createdAt: '2026-06-02T00:00:00.000Z'
  };

  await fsp.writeFile(sitesPath, JSON.stringify([fresh, original], null, 2));
  await __test.writeSites(sitesPath, [{
    ...original,
    usagePreviewCount: 2,
    usageLastUsedAt: '2026-06-03T00:00:00.000Z'
  }], { sync: false });

  const savedSites = await __test.readSites(sitesPath);
  assert.deepEqual(savedSites.map((site) => site.id), ['fresh-site', 'old-site']);
  assert.equal(savedSites.find((site) => site.id === 'old-site').usagePreviewCount, 2);
});

test('site data corruption fails closed instead of returning an empty project list', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-deploy-corrupt-'));
  const sitesPath = path.join(root, 'sites.json');
  await fsp.writeFile(sitesPath, '{"not valid json"');

  await assert.rejects(
    () => __test.readSites(sitesPath),
    /sites\.json 数据文件损坏/
  );
});

test('manual GitHub data sync endpoint is removed', async () => {
  const { app } = await makeTestApp();
  const agent = request.agent(app);

  await request(app).post('/api/admin/github-sync').send({}).expect(404);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/admin/github-sync').send({}).expect(404);
});

async function makeTestApp(options = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-deploy-'));
  const dataDir = path.join(root, 'data');
  const storageDir = path.join(root, 'storage', 'sites');
  const thumbnailDir = options.thumbnailDir || path.join(root, 'storage', 'thumbnails');
  const publicDir = path.join(root, 'public');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(storageDir, { recursive: true });
  await fsp.mkdir(thumbnailDir, { recursive: true });
  await fsp.mkdir(publicDir, { recursive: true });
  await fsp.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>Test Shell</title>');
  await fsp.writeFile(path.join(publicDir, 'admin.html'), '<!doctype html><title>Admin Shell</title><form id="createForm"></form>');

  const app = createApp({
    dataFile: path.join(dataDir, 'sites.json'),
    classesFile: path.join(dataDir, 'classes.json'),
    settingsFile: path.join(dataDir, 'settings.json'),
    aiSettingsFile: path.join(dataDir, 'private-ai-settings.json'),
    storageDir,
    thumbnailDir,
    publicDir,
    ...options
  });

  return { app, root, dataDir, storageDir, thumbnailDir, publicDir };
}

async function waitForAiOptimizeJob(agent, jobId, { status = 'success', attempts = 80 } = {}) {
  let latest;
  for (let index = 0; index < attempts; index += 1) {
    latest = await agent.get(`/api/admin/ai-optimize-jobs/${jobId}`).expect(200);
    if (latest.body.status === status) {
      return latest.body;
    }
    if (latest.body.status === 'error' && status !== 'error') {
      throw new Error(latest.body.error || latest.body.message || 'AI optimize job failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`AI optimize job did not reach ${status}; latest status: ${latest?.body?.status}`);
}

async function waitForThumbnailJob(agent, jobId, { attempts = 80 } = {}) {
  let latest;
  for (let index = 0; index < attempts; index += 1) {
    latest = await agent.get(`/api/admin/thumbnail-jobs/${jobId}`).expect(200);
    if (['success', 'error'].includes(latest.body.status)) {
      return latest.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Thumbnail job did not finish; latest status: ${latest?.body?.status}`);
}

test('GET /api/sites returns an empty list before uploads', async () => {
  const { app } = await makeTestApp();

  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  const response = await agent.get('/api/admin/sites').expect(200);

  assert.deepEqual(response.body, []);
});

test('GET /api/sites assigns five-digit numbers to existing projects by creation order', async () => {
  const { app, dataDir } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await fsp.writeFile(
    path.join(dataDir, 'sites.json'),
    JSON.stringify(
      [
        { id: 'newer', title: '后添加', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'older', title: '先添加', createdAt: '2026-01-01T00:00:00.000Z' }
      ],
      null,
      2
    )
  );

  const response = await agent.get('/api/admin/sites').expect(200);
  assert.deepEqual(
    response.body.map((site) => [site.id, site.number]),
    [
      ['newer', '00002'],
      ['older', '00001']
    ]
  );

  const sites = await __test.readSites(path.join(dataDir, 'sites.json'));
  assert.deepEqual(
    sites.map((site) => [site.id, site.number]),
    [
      ['newer', '00002'],
      ['older', '00001']
    ]
  );
});

test('GET /api/admin/sites supports pagination with cached storage summaries', async () => {
  const { app, dataDir, storageDir } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await fsp.writeFile(
    path.join(dataDir, 'sites.json'),
    JSON.stringify([
      { id: 'site-3', title: '第三个', author: '作者', classId: 'class-a', storageBytes: 30, createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 'site-2', title: '第二个', author: '作者', classId: 'class-a', storageBytes: 20, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'site-1', title: '第一个', author: '作者', classId: 'class-b', storageBytes: 10, createdAt: '2026-01-01T00:00:00.000Z' }
    ], null, 2)
  );
  await fsp.mkdir(path.join(storageDir, 'site-3'), { recursive: true });
  await fsp.writeFile(path.join(storageDir, 'site-3', 'index.html'), 'this-file-size-should-not-be-used');

  const response = await agent.get('/api/admin/sites?page=2&pageSize=2').expect(200);

  assert.equal(response.body.page, 2);
  assert.equal(response.body.pageSize, 2);
  assert.equal(response.body.total, 3);
  assert.equal(response.body.summary.totalProjects, 3);
  assert.equal(response.body.summary.totalStorageBytes, 60);
  assert.deepEqual(response.body.items.map((site) => [site.id, site.storageBytes]), [
    ['site-1', 10]
  ]);
});

test('admin AI settings require admin access and mask saved API keys', async () => {
  const secretKey = 'sk-test-secret-1234567890';
  const { app, dataDir } = await makeTestApp();
  const agent = request.agent(app);

  await agent.get('/api/admin/ai-settings').expect(401);
  await agent.put('/api/admin/ai-settings').send({ model: 'deepseek-chat' }).expect(401);

  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  const saved = await agent
    .put('/api/admin/ai-settings')
    .send({
      apiKey: secretKey,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      temperature: 0.7,
      nameTemperature: 0.4,
      thinkingType: 'disabled'
    })
    .expect(200);

  assert.equal(saved.body.hasApiKey, true);
  assert.notEqual(saved.body.apiKeyPreview, secretKey);
  assert.match(saved.body.apiKeyPreview, /^sk-/);
  assert.equal(saved.body.baseUrl, 'https://api.deepseek.com');
  assert.equal(saved.body.model, 'deepseek-chat');
  assert.equal(saved.body.temperature, 0.7);
  assert.equal(saved.body.nameTemperature, 0.4);
  assert.equal(saved.body.thinkingType, 'disabled');

  const loaded = await agent.get('/api/admin/ai-settings').expect(200);
  assert.equal(loaded.body.hasApiKey, true);
  assert.equal(loaded.body.apiKeyPreview, saved.body.apiKeyPreview);
  assert.equal(loaded.body.apiKey, undefined);

  const settingsPath = path.join(dataDir, 'settings.json');
  const settingsRaw = fs.existsSync(settingsPath) ? await fsp.readFile(settingsPath, 'utf8') : '{}';
  assert.doesNotMatch(settingsRaw, /sk-test-secret/);
  assert.doesNotMatch(settingsRaw, /apiKey/);
});

test('admin AI settings can keep and clear the private API key', async () => {
  const { app } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await agent
    .put('/api/admin/ai-settings')
    .send({ apiKey: 'sk-keep-secret-123456', model: 'first-model' })
    .expect(200);

  const kept = await agent
    .put('/api/admin/ai-settings')
    .send({ apiKey: '', model: 'second-model' })
    .expect(200);

  assert.equal(kept.body.hasApiKey, true);
  assert.equal(kept.body.model, 'second-model');

  const cleared = await agent
    .put('/api/admin/ai-settings')
    .send({ clearApiKey: true })
    .expect(200);

  assert.equal(cleared.body.hasApiKey, false);
  assert.equal(cleared.body.apiKeyPreview, '');
});

test('POST /api/sites saves cached storage usage for each project', async () => {
  const validHtml = '<!doctype html><h1>1</h1>';
  const { app } = await makeTestApp({
    idGenerator: (() => {
      const ids = ['class-a', 'with-files'];
      return () => ids.shift() || 'fallback';
    })()
  });
  const admin = request.agent(app);
  const visitor = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await admin.post('/api/classes').send({ name: '一班', password: '123456' }).expect(201);
  await visitor.post('/api/classes/class-a/unlock').send({ password: '123456' }).expect(200);

  const upload = await visitor
    .post('/api/sites')
    .field('title', '有文件')
    .field('author', '作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from(validHtml), 'index.html')
    .expect(201);

  assert.equal(upload.body.storageBytes, Buffer.byteLength(validHtml));

  const response = await admin.get('/api/admin/sites?page=1&pageSize=50').expect(200);
  assert.equal(response.body.items[0].id, 'with-files');
  assert.equal(response.body.items[0].storageBytes, Buffer.byteLength(validHtml));
  assert.equal(response.body.summary.totalStorageBytes, Buffer.byteLength(validHtml));
});

test('GET /api/admin/sites uses cached storage usage for each project', async () => {
  const { app, dataDir, storageDir } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await fsp.writeFile(
    path.join(dataDir, 'sites.json'),
    JSON.stringify([
      { id: 'with-files', title: '有文件', author: '作者', classId: 'class-a', storageBytes: 99, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'missing-files', title: '无文件', author: '作者', classId: 'class-a', createdAt: '2026-01-02T00:00:00.000Z' }
    ], null, 2)
  );
  await fsp.mkdir(path.join(storageDir, 'with-files', 'assets'), { recursive: true });
  await fsp.writeFile(path.join(storageDir, 'with-files', 'index.html'), '12345');
  await fsp.writeFile(path.join(storageDir, 'with-files', 'assets', 'style.css'), '1234567');

  const response = await agent.get('/api/admin/sites').expect(200);

  assert.deepEqual(
    response.body.map((site) => [site.id, site.storageBytes]),
    [
      ['with-files', 99],
      ['missing-files', 0]
    ]
  );
});

test('site APIs expose and serve compressed JPEG thumbnails', async () => {
  const { app, dataDir, thumbnailDir } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await fsp.writeFile(
    path.join(dataDir, 'sites.json'),
    JSON.stringify([
      { id: 'good-site', title: '好项目', author: '作者', classId: 'class-a', createdAt: '2026-01-01T00:00:00.000Z' }
    ], null, 2)
  );
  await fsp.writeFile(path.join(thumbnailDir, 'good-site.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const sites = await agent.get('/api/admin/sites').expect(200);
  assert.match(sites.body[0].thumbnailUrl, /^\/thumbnails\/good-site\.jpg\?v=\d+$/);

  const thumbnail = await agent.get('/thumbnails/good-site.jpg').expect(200);
  assert.match(thumbnail.headers['content-type'], /^image\/jpeg\b/);
  assert.deepEqual(thumbnail.body, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
});

test('thumbnail generation runs as background jobs with progress', async () => {
  const generatedIds = [];
  const { app, dataDir } = await makeTestApp({
    thumbnailGenerator: async ({ id }) => {
      generatedIds.push(id);
      if (id === 'bad-site') {
        throw new Error('截图失败');
      }
      return { id, thumbnailUrl: `/thumbnails/${id}.png?v=1` };
    }
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await fsp.writeFile(
    path.join(dataDir, 'sites.json'),
    JSON.stringify([
      { id: 'good-site', title: '好项目', author: '作者', classId: 'class-a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'bad-site', title: '坏项目', author: '作者', classId: 'class-a', createdAt: '2026-01-02T00:00:00.000Z' }
    ], null, 2)
  );

  const single = await agent.post('/api/sites/good-site/thumbnail').send({}).expect(202);
  assert.equal(single.body.status, 'queued');
  assert.equal(single.body.total, 1);
  assert.ok(single.body.jobId);

  const singleDone = await waitForThumbnailJob(agent, single.body.jobId);
  assert.equal(singleDone.status, 'success');
  assert.equal(singleDone.success, 1);
  assert.equal(singleDone.failed, 0);

  const batch = await agent.post('/api/admin/thumbnails').send({}).expect(202);
  assert.equal(batch.body.status, 'queued');
  assert.equal(batch.body.total, 2);
  assert.ok(batch.body.jobId);

  const batchDone = await waitForThumbnailJob(agent, batch.body.jobId);
  assert.equal(batchDone.status, 'error');
  assert.equal(batchDone.finished, 2);
  assert.equal(batchDone.success, 1);
  assert.equal(batchDone.failed, 1);
  assert.equal(batchDone.errors[0].id, 'bad-site');
  assert.deepEqual(generatedIds, ['good-site', 'good-site', 'bad-site']);
});

test('admin job logs persist AI optimize messages', async () => {
  const { app } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await agent.post('/api/admin/jobs/logs').send({
    text: 'AI 优化已开始',
    status: 'running',
    type: 'ai-optimize'
  }).expect(201);

  const logs = await agent.get('/api/admin/jobs/logs?limit=10').expect(200);

  assert.equal(logs.body.logs.length, 1);
  assert.equal(logs.body.logs[0].text, 'AI 优化已开始');
  assert.equal(logs.body.logs[0].status, 'running');
  assert.equal(logs.body.logs[0].type, 'ai-optimize');
});

test('admin can set the all-projects password and visitors must unlock all projects', async () => {
  const { app } = await makeTestApp({
    idGenerator: (() => {
      const ids = ['class-a', 'site-a', 'site-b'];
      return () => ids.shift() || 'fallback';
    })()
  });
  const admin = request.agent(app);
  const visitor = request.agent(app);

  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  const initialSettings = await admin.get('/api/admin/settings').expect(200);
  assert.match(initialSettings.body.allPassword, /^\d{6}$/);

  await admin.put('/api/admin/settings').send({ allPassword: '654321' }).expect(200);
  await admin.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);
  await admin
    .post('/api/sites')
    .field('title', '项目一')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>项目一</title>')
    .expect(201);

  await visitor.get('/api/sites').expect(401);
  await visitor.post('/api/all/unlock').send({ password: '000000' }).expect(401);
  await visitor.post('/api/all/unlock').send({ password: '654321' }).expect(200);

  const response = await visitor.get('/api/sites').expect(200);
  assert.deepEqual(response.body.map((site) => site.title), ['项目一']);
  await visitor.get('/site/site-a').expect(200);
});

test('admin settings keeps large forbidden word lists', async () => {
  const { app } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  const forbiddenWords = Array.from({ length: 250 }, (_, index) => `word-${index}`);
  const response = await agent
    .put('/api/admin/settings')
    .send({ allPassword: '111111', forbiddenWords })
    .expect(200);

  assert.equal(response.body.forbiddenWords.length, 250);

  const rules = await request(app).get('/api/upload-rules').expect(200);
  assert.equal(rules.body.forbiddenWords.length, 250);
});

test('admin can query forbidden words without loading the full list', async () => {
  const { app } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  const forbiddenWords = Array.from({ length: 250 }, (_, index) => `blocked-${index}`);
  forbiddenWords.push('special-target');
  await agent
    .put('/api/admin/settings')
    .send({ allPassword: '111111', forbiddenWords })
    .expect(200);

  const summary = await agent.get('/api/admin/settings?includeForbiddenWords=false').expect(200);
  assert.equal(summary.body.forbiddenWords, undefined);
  assert.equal(summary.body.forbiddenWordsCount, 251);

  const page = await agent.get('/api/admin/forbidden-words?offset=100&limit=25').expect(200);
  assert.equal(page.body.words.length, 25);
  assert.equal(page.body.total, 251);
  assert.equal(page.body.allTotal, 251);
  assert.equal(page.body.words[0], 'blocked-100');

  const filtered = await agent.get('/api/admin/forbidden-words?q=target&limit=10').expect(200);
  assert.deepEqual(filtered.body.words, ['special-target']);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.allTotal, 251);
});

test('admin forbidden word search ranks exact and short matches first', async () => {
  const { app } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await agent
    .put('/api/admin/settings')
    .send({
      allPassword: '111111',
      forbiddenWords: ['abc1', '110', '21', '1号', '1', 'x1', '10']
    })
    .expect(200);

  const response = await agent.get('/api/admin/forbidden-words?q=1&limit=10').expect(200);
  assert.deepEqual(response.body.words, ['1', '1号', '10', '110', '21', 'x1', 'abc1']);
  assert.equal(response.body.total, 7);
});

test('admin can delete forbidden words', async () => {
  const { app } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await agent
    .put('/api/admin/settings')
    .send({ allPassword: '111111', forbiddenWords: ['保留词', '删除词', '另一个词'] })
    .expect(200);

  await request(app)
    .delete('/api/admin/forbidden-words')
    .send({ word: '删除词' })
    .expect(401);

  const response = await agent
    .delete('/api/admin/forbidden-words')
    .send({ word: '删除词' })
    .expect(200);

  assert.equal(response.body.removed, 1);
  assert.equal(response.body.total, 2);

  const page = await agent.get('/api/admin/forbidden-words?limit=10').expect(200);
  assert.deepEqual(page.body.words, ['保留词', '另一个词']);
  assert.equal(page.body.total, 2);
  assert.equal(page.body.allTotal, 2);

  const rules = await request(app).get('/api/upload-rules').expect(200);
  assert.deepEqual(rules.body.forbiddenWords, ['保留词', '另一个词']);

  await agent
    .delete('/api/admin/forbidden-words')
    .send({ word: '不存在' })
    .expect(404);
});

test('admin can create classes and public APIs expose class buttons', async () => {
  const { app } = await makeTestApp({
    idGenerator: () => 'classone'
  });
  const agent = request.agent(app);

  await agent
    .post('/api/classes')
    .send({ name: '三年级一班' })
    .expect(401);

  await agent
    .post('/admin-login')
    .type('form')
    .send({ password: 'qqqyyy' })
    .expect(303);

  const created = await agent
    .post('/api/classes')
    .send({ name: '三年级一班', password: '123456' })
    .expect(201);

  assert.equal(created.body.id, 'classone');
  assert.equal(created.body.name, '三年级一班');
  assert.equal(created.body.password, '123456');

  const response = await request(app).get('/api/classes').expect(200);
  assert.deepEqual(response.body.map((item) => item.name), ['三年级一班']);
  assert.equal(response.body[0].password, undefined);

  const adminResponse = await agent.get('/api/admin/classes').expect(200);
  assert.equal(adminResponse.body[0].password, '123456');
});

test('public index groups class buttons while keeping all projects first', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /fetch\('\/api\/class-groups'\)/);
  assert.match(html, /classGroups/);
  assert.match(html, /public-class-group/);
  assert.match(html, /未分组/);
  assert.ok(html.indexOf("classTabs.append(allButton)") < html.indexOf("classGroups.forEach"));
});

test('public admin manages class groups and persists cross-group dragging', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /id="classGroupForm"/);
  assert.match(html, /id="classGroupNameInput"/);
  assert.match(html, /id="classGroupSelect"/);
  assert.match(html, /class-group-section/);
  assert.match(html, /async function createClassGroup/);
  assert.match(html, /async function updateClassGroup/);
  assert.match(html, /async function deleteClassGroup/);
  assert.match(html, /\/api\/class-groups\/order/);
  assert.match(html, /body: JSON\.stringify\(\{ items \}\)/);
  assert.match(html, /groupId: container\.dataset\.groupId/);
});

test('admin class order persists and is reflected by public class buttons', async () => {
  const ids = ['class-a', 'class-b', 'class-c'];
  const { app } = await makeTestApp({ idGenerator: () => ids.shift() });
  const admin = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await admin.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);
  await admin.post('/api/classes').send({ name: '二班', password: '222222' }).expect(201);
  await admin.post('/api/classes').send({ name: '三班', password: '333333' }).expect(201);

  await admin
    .put('/api/classes/order')
    .send({ classIds: ['class-c', 'class-a', 'class-b'] })
    .expect(200);

  const publicClasses = await request(app).get('/api/classes').expect(200);
  assert.deepEqual(publicClasses.body.map((item) => item.id), ['class-c', 'class-a', 'class-b']);

  const adminClasses = await admin.get('/api/admin/classes').expect(200);
  assert.deepEqual(adminClasses.body.map((item) => item.id), ['class-c', 'class-a', 'class-b']);
});

test('admin manages ordered class groups and persists cross-group class moves', async () => {
  const ids = ['group-a', 'group-b', 'class-a', 'class-b', 'class-c'];
  const { app } = await makeTestApp({ idGenerator: () => ids.shift() });
  const admin = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  await request(app).post('/api/class-groups').send({ name: '未授权' }).expect(401);
  const gradeFive = await admin.post('/api/class-groups').send({ name: '五年级' }).expect(201);
  const gradeSix = await admin.post('/api/class-groups').send({ name: '六年级' }).expect(201);
  assert.equal(gradeFive.body.id, 'group-a');
  assert.equal(gradeSix.body.id, 'group-b');

  await admin
    .put('/api/class-groups/order')
    .send({ groupIds: ['group-b', 'group-a'] })
    .expect(200);
  const groups = await request(app).get('/api/class-groups').expect(200);
  assert.deepEqual(groups.body.map((item) => item.id), ['group-b', 'group-a']);

  await admin.post('/api/classes').send({ name: '五1', password: '111111', groupId: 'group-a' }).expect(201);
  await admin.post('/api/classes').send({ name: '五2', password: '222222', groupId: 'group-a' }).expect(201);
  await admin.post('/api/classes').send({ name: '六1', password: '333333', groupId: 'group-b' }).expect(201);

  await admin
    .put('/api/classes/order')
    .send({
      items: [
        { id: 'class-c', groupId: 'group-b' },
        { id: 'class-b', groupId: 'group-b' },
        { id: 'class-a', groupId: 'group-a' }
      ]
    })
    .expect(200);
  const movedClasses = await request(app).get('/api/classes').expect(200);
  assert.deepEqual(movedClasses.body.map((item) => [item.id, item.groupId]), [
    ['class-c', 'group-b'],
    ['class-b', 'group-b'],
    ['class-a', 'group-a']
  ]);

  const renamed = await admin.put('/api/class-groups/group-b').send({ name: '六年级新' }).expect(200);
  assert.equal(renamed.body.name, '六年级新');

  await admin.delete('/api/class-groups/group-b').expect(200);
  const afterDelete = await request(app).get('/api/classes').expect(200);
  assert.equal(afterDelete.body.find((item) => item.id === 'class-c').groupId, '');
  assert.equal(afterDelete.body.find((item) => item.id === 'class-b').groupId, '');
});

test('POST /api/sites requires title and files', async () => {
  const { app } = await makeTestApp();

  await request(app).post('/api/sites').expect(400);

  await request(app)
    .post('/api/sites')
    .field('title', 'No files')
    .expect(400);
});

test('POST /api/sites saves one HTML file as index.html and records metadata', async () => {
  const ids = ['class-a', 'abc123'];
  const { app, storageDir, dataDir } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班' }).expect(201);

  const response = await request(app)
    .post('/api/sites')
    .field('title', '我的小游戏')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Game</h1>'), { filename: 'game.html' })
    .expect(201);

  assert.equal(response.body.id, 'abc123');
  assert.equal(response.body.title, '我的小游戏');
  assert.equal(response.body.classId, 'class-a');
  assert.equal(response.body.className, '一班');
  assert.equal(response.body.url, '/site/abc123');
  assert.equal(response.body.number, '00001');

  assert.equal(
    await fsp.readFile(path.join(storageDir, 'abc123', 'index.html'), 'utf8'),
    '<!doctype html><h1>Game</h1>'
  );

  const sites = await __test.readSites(path.join(dataDir, 'sites.json'));
  assert.equal(sites.length, 1);
  assert.equal(sites[0].id, 'abc123');
  assert.equal(sites[0].title, '我的小游戏');
  assert.equal(sites[0].classId, 'class-a');
  assert.equal(sites[0].number, '00001');
});

test('POST /api/sites can create a project from pasted HTML code', async () => {
  const ids = ['class-a', 'code123'];
  const { app, storageDir } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班' }).expect(201);

  const response = await request(app)
    .post('/api/sites')
    .field('title', '代码作品')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><h1>Code</h1>')
    .expect(201);

  assert.equal(response.body.id, 'code123');
  assert.equal(response.body.title, '代码作品');
  assert.equal(
    await fsp.readFile(path.join(storageDir, 'code123', 'index.html'), 'utf8'),
    '<!doctype html><h1>Code</h1>'
    );
  });

test('POST /api/sites rejects duplicate HTML code before creating a project', async () => {
  const ids = ['class-a', 'first-site', 'second-site'];
  const { app, storageDir, dataDir } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班' }).expect(201);

  const duplicateHtml = '<!doctype html><html><body><h1>Same project</h1></body></html>';
  await request(app)
    .post('/api/sites')
    .field('title', '原始作品')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', duplicateHtml)
    .expect(201);

  const duplicate = await request(app)
    .post('/api/sites')
    .field('title', '重复作品')
    .field('author', '另一个作者')
    .field('classId', 'class-a')
    .field('htmlContent', duplicateHtml)
    .expect(400);
  assert.match(duplicate.body.error, /代码与「原始作品（00001）」重复/);

  const savedAfterReject = await __test.readSites(path.join(dataDir, 'sites.json'));
  assert.deepEqual(savedAfterReject.map((site) => site.id), ['first-site']);
  assert.deepEqual(
    (await fsp.readdir(storageDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
    ['first-site']
  );

  const unique = await request(app)
    .post('/api/sites')
    .field('title', '不同作品')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><html><body><h1>Different project</h1></body></html>')
    .expect(201);
  assert.equal(unique.body.id, 'second-site');
});

test('POST /api/sites rejects content that is not a basic HTML document', async () => {
  const ids = ['class-a', 'bad-a', 'bad-b', 'bad-c'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班' }).expect(201);

  const chineseOnly = await request(app)
    .post('/api/sites')
    .field('title', '随便写写')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', '这里随便输入几句中文，不是网页代码')
    .expect(400);
  assert.match(chineseOnly.body.error, /HTML 代码结构不完整/);

  const pythonCode = await request(app)
    .post('/api/sites')
    .field('title', 'Python 代码')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', 'import random\nprint("hello")')
    .expect(400);
  assert.match(pythonCode.body.error, /HTML 代码结构不完整/);

  const fakeHtmlFile = await request(app)
    .post('/api/sites')
    .field('title', '伪装文件')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('def hello():\n    print("not html")'), { filename: 'fake.html' })
    .expect(400);
  assert.match(fakeHtmlFile.body.error, /HTML 代码结构不完整/);
});

test('GET /api/sites can filter projects by class', async () => {
  const ids = ['class-a', 'class-b', 'site-a', 'site-b'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);
  await agent.post('/api/classes').send({ name: '二班', password: '222222' }).expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', '一班作品')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Test</h1>'), { filename: 'one.html' })
    .expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', '二班作品')
    .field('author', '测试作者')
    .field('classId', 'class-b')
    .attach('file', Buffer.from('<!doctype html><h1>Class B Test</h1>'), { filename: 'two.html' })
    .expect(201);

  await request(app).get('/api/sites?classId=class-a').expect(401);

  const visitor = request.agent(app);
  await visitor.post('/api/classes/class-a/unlock').send({ password: '000000' }).expect(401);
  await visitor.post('/api/classes/class-a/unlock').send({ password: '111111' }).expect(200);

  const response = await visitor.get('/api/sites?classId=class-a').expect(200);
  assert.deepEqual(response.body.map((site) => site.title), ['一班作品']);
});

test('admin can disable a class password so visitors can read it without unlocking', async () => {
  const ids = ['class-a', 'site-a'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const admin = request.agent(app);
  const visitor = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await admin.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);
  await request(app)
    .post('/api/sites')
    .field('title', '免密码项目')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>免密码项目</title>')
    .expect(201);

  await visitor.get('/api/sites?classId=class-a').expect(401);

  const toggle = await admin
    .patch('/api/classes/class-a/password-enabled')
    .send({ passwordEnabled: false })
    .expect(200);
  assert.equal(toggle.body.passwordEnabled, false);

  const classes = await request(app).get('/api/classes').expect(200);
  assert.equal(classes.body[0].passwordEnabled, false);

  const response = await visitor.get('/api/sites?classId=class-a').expect(200);
  assert.deepEqual(response.body.map((site) => site.title), ['免密码项目']);
  await visitor.get('/site/site-a').expect(200);
});

test('admin can bulk update every class upload state', async () => {
  const ids = ['class-a', 'class-b'];
  const { app } = await makeTestApp({ idGenerator: () => ids.shift() });
  const admin = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await admin.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);
  await admin.post('/api/classes').send({ name: '二班', password: '222222' }).expect(201);

  await request(app)
    .patch('/api/classes/upload-enabled')
    .send({ uploadEnabled: false })
    .expect(401);
  await admin.patch('/api/classes/upload-enabled').send({ uploadEnabled: 'false' }).expect(400);

  const disabled = await admin
    .patch('/api/classes/upload-enabled')
    .send({ uploadEnabled: false })
    .expect(200);
  assert.equal(disabled.body.length, 2);
  assert.ok(disabled.body.every((item) => item.uploadEnabled === false));

  const enabled = await admin
    .patch('/api/classes/upload-enabled')
    .send({ uploadEnabled: true })
    .expect(200);
  assert.ok(enabled.body.every((item) => item.uploadEnabled === true));
});

test('admin can bulk update every class password state including an empty list', async () => {
  const ids = ['class-a', 'class-b'];
  const { app } = await makeTestApp({ idGenerator: () => ids.shift() });
  const admin = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  const empty = await admin
    .patch('/api/classes/password-enabled')
    .send({ passwordEnabled: false })
    .expect(200);
  assert.deepEqual(empty.body, []);

  await admin.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);
  await admin.post('/api/classes').send({ name: '二班', password: '222222' }).expect(201);

  const disabled = await admin
    .patch('/api/classes/password-enabled')
    .send({ passwordEnabled: false })
    .expect(200);
  assert.ok(disabled.body.every((item) => item.passwordEnabled === false));

  const listed = await request(app).get('/api/classes').expect(200);
  assert.ok(listed.body.every((item) => item.passwordEnabled === false));

  const enabled = await admin
    .patch('/api/classes/password-enabled')
    .send({ passwordEnabled: true })
    .expect(200);
  assert.ok(enabled.body.every((item) => item.passwordEnabled === true));
});

test('admin can disable a project so public lists and pages hide it', async () => {
  const ids = ['class-a', 'visible-site', 'hidden-site'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const admin = request.agent(app);
  const visitor = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await admin.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);
  await admin.patch('/api/classes/class-a/password-enabled').send({ passwordEnabled: false }).expect(200);

  await request(app)
    .post('/api/sites')
    .field('title', '可见项目')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>可见项目</title>')
    .expect(201);
  await request(app)
    .post('/api/sites')
    .field('title', '隐藏项目')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>隐藏项目</title>')
    .expect(201);

  const disabled = await admin
    .patch('/api/sites/hidden-site/enabled')
    .send({ enabled: false })
    .expect(200);
  assert.equal(disabled.body.enabled, false);

  const publicSites = await visitor.get('/api/sites?classId=class-a').expect(200);
  assert.deepEqual(publicSites.body.map((site) => site.title), ['可见项目']);
  await visitor.get('/site/visible-site').expect(200);
  await visitor.get('/site/hidden-site').expect(404);

  const adminSites = await admin.get('/api/admin/sites').expect(200);
  assert.deepEqual(
    adminSites.body.map((site) => [site.id, site.enabled]),
    [
      ['hidden-site', false],
      ['visible-site', true]
    ]
  );
});

test('admin can enable all disabled projects', async () => {
  const { app, dataDir } = await makeTestApp();
  const admin = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  const sites = [
    {
      id: 'enabled-site',
      number: '00001',
      title: '已启用',
      author: '作者A',
      enabled: true,
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'disabled-site',
      number: '00002',
      title: '已禁用',
      author: '作者B',
      enabled: false,
      updatedAt: '2026-01-02T00:00:00.000Z'
    },
    {
      id: 'implicit-enabled-site',
      number: '00003',
      title: '默认启用',
      author: '作者C',
      updatedAt: '2026-01-03T00:00:00.000Z'
    }
  ];
  await fsp.writeFile(path.join(dataDir, 'sites.json'), JSON.stringify(sites, null, 2));

  await request(app).post('/api/admin/sites/enable-all').send({}).expect(401);

  const response = await admin.post('/api/admin/sites/enable-all').send({}).expect(200);
  assert.deepEqual(response.body, {
    checked: 3,
    enabled: 1
  });

  const savedSites = await __test.readSites(path.join(dataDir, 'sites.json'));
  assert.deepEqual(
    savedSites.map((site) => [site.id, site.enabled !== false]),
    [
      ['enabled-site', true],
      ['disabled-site', true],
      ['implicit-enabled-site', true]
    ]
  );
  assert.equal(savedSites.find((site) => site.id === 'enabled-site').updatedAt, '2026-01-01T00:00:00.000Z');
  assert.notEqual(savedSites.find((site) => site.id === 'disabled-site').updatedAt, '2026-01-02T00:00:00.000Z');
});

test('admin can star a project and public APIs expose the star state', async () => {
  const ids = ['class-a', 'starred-site'];
  const { app, dataDir } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const admin = request.agent(app);
  const visitor = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await admin.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);
  await admin.patch('/api/classes/class-a/password-enabled').send({ passwordEnabled: false }).expect(200);

  const created = await request(app)
    .post('/api/sites')
    .field('title', '优秀作品')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>优秀作品</title>')
    .expect(201);
  assert.equal(created.body.starred, false);

  await request(app)
    .patch('/api/sites/starred-site/starred')
    .send({ starred: true })
    .expect(401);

  const starred = await admin
    .patch('/api/sites/starred-site/starred')
    .send({ starred: true })
    .expect(200);
  assert.equal(starred.body.starred, true);

  const publicSites = await visitor.get('/api/sites?classId=class-a').expect(200);
  assert.deepEqual(
    publicSites.body.map((site) => [site.id, site.starred]),
    [['starred-site', true]]
  );

  const unstarred = await admin
    .patch('/api/sites/starred-site/starred')
    .send({ starred: false })
    .expect(200);
  assert.equal(unstarred.body.starred, false);

  const savedSites = await __test.readSites(path.join(dataDir, 'sites.json'));
  assert.equal(savedSites.find((site) => site.id === 'starred-site').starred, false);
});

test('admin forbidden audit disables projects with forbidden title or author', async () => {
  const ids = ['class-a', 'safe-site', 'bad-title-site', 'bad-author-site'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const admin = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await admin.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', '安全项目')
    .field('author', '普通作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>安全项目</title>')
    .expect(201);
  await request(app)
    .post('/api/sites')
    .field('title', '包含坏词项目')
    .field('author', '普通作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>包含坏词项目</title>')
    .expect(201);
  await request(app)
    .post('/api/sites')
    .field('title', '普通项目')
    .field('author', '坏作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>普通项目</title>')
    .expect(201);

  await admin
    .put('/api/admin/settings')
    .send({ allPassword: '111111', forbiddenWords: ['坏词', '坏作者'] })
    .expect(200);

  const audit = await admin.post('/api/admin/sites/forbidden-audit').send({}).expect(200);
  assert.equal(audit.body.checked, 3);
  assert.equal(audit.body.matched, 2);
  assert.equal(audit.body.disabled, 2);
  assert.deepEqual(
    audit.body.matches.map((match) => [match.id, match.field, match.word, match.message]),
    [
      ['bad-author-site', '作者署名', '坏作者', '作者署名包含违禁词「坏作者」'],
      ['bad-title-site', '网页名字', '坏词', '网页名字包含违禁词「坏词」']
    ]
  );

  const sites = await admin.get('/api/admin/sites').expect(200);
  assert.deepEqual(
    sites.body.map((site) => [site.id, site.enabled, site.forbiddenAuditWord || '', site.forbiddenAuditMessage || '']),
    [
      ['bad-author-site', false, '坏作者', '作者署名包含违禁词「坏作者」'],
      ['bad-title-site', false, '坏词', '网页名字包含违禁词「坏词」'],
      ['safe-site', true, '', '']
    ]
  );

  await admin
    .put('/api/sites/bad-title-site')
    .field('title', '修正后的项目')
    .field('author', '普通作者')
    .field('classId', 'class-a')
    .expect(200);
  const secondAudit = await admin.post('/api/admin/sites/forbidden-audit').send({}).expect(200);
  assert.equal(secondAudit.body.matched, 1);
  const refreshedSites = await admin.get('/api/admin/sites').expect(200);
  const fixedSite = refreshedSites.body.find((site) => site.id === 'bad-title-site');
  assert.equal(fixedSite.forbiddenAuditMessage, undefined);
});

test('admin dedupe disables later projects with identical HTML code', async () => {
  const { app, dataDir, storageDir } = await makeTestApp();
  const admin = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  const sites = [
    {
      id: 'keep-original',
      number: '00001',
      title: '先上传',
      author: '作者A',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'disable-later',
      number: '00002',
      title: '后上传重复',
      author: '作者B',
      enabled: true,
      createdAt: '2026-01-02T00:00:00.000Z'
    },
    {
      id: 'unique-site',
      number: '00003',
      title: '不同代码',
      author: '作者C',
      enabled: true,
      createdAt: '2026-01-03T00:00:00.000Z'
    },
    {
      id: 'already-disabled',
      number: '00004',
      title: '已禁用重复',
      author: '作者D',
      enabled: false,
      createdAt: '2026-01-04T00:00:00.000Z'
    }
  ];
  await fsp.writeFile(path.join(dataDir, 'sites.json'), JSON.stringify(sites, null, 2));

  const duplicateHtml = '<!doctype html><html><body><h1>Same</h1></body></html>';
  const uniqueHtml = '<!doctype html><html><body><h1>Different</h1></body></html>';
  for (const site of sites) {
    await fsp.mkdir(path.join(storageDir, site.id), { recursive: true });
    await fsp.writeFile(
      path.join(storageDir, site.id, 'index.html'),
      site.id === 'unique-site' ? uniqueHtml : duplicateHtml
    );
  }

  await request(app).post('/api/admin/sites/dedupe').send({}).expect(401);

  const result = await admin.post('/api/admin/sites/dedupe').send({}).expect(200);
  assert.equal(result.body.checked, 4);
  assert.equal(result.body.duplicateGroups, 1);
  assert.equal(result.body.duplicates, 2);
  assert.equal(result.body.disabled, 1);
  assert.deepEqual(
    result.body.matches.map((match) => [match.id, match.keepId, match.wasEnabled, match.message]),
    [
      ['disable-later', 'keep-original', true, '与「先上传（00001）」代码重复'],
      ['already-disabled', 'keep-original', false, '与「先上传（00001）」代码重复']
    ]
  );

  const savedSites = await __test.readSites(path.join(dataDir, 'sites.json'));
  assert.deepEqual(
    savedSites.map((site) => [site.id, site.enabled, site.duplicateAuditMessage || '']),
    [
      ['keep-original', true, ''],
      ['disable-later', false, '与「先上传（00001）」代码重复'],
      ['unique-site', true, ''],
      ['already-disabled', false, '与「先上传（00001）」代码重复']
    ]
  );

  await fsp.writeFile(
    path.join(storageDir, 'disable-later', 'index.html'),
    '<!doctype html><html><body><h1>Changed</h1></body></html>'
  );
  const secondResult = await admin.post('/api/admin/sites/dedupe').send({}).expect(200);
  assert.equal(secondResult.body.duplicateGroups, 1);
  const savedSitesAfterSecondRun = await __test.readSites(path.join(dataDir, 'sites.json'));
  const changedSite = savedSitesAfterSecondRun.find((site) => site.id === 'disable-later');
  assert.equal(changedSite.duplicateAuditMessage, undefined);
});

test('admin can whitelist a project from forbidden audits and edits', async () => {
  const ids = ['class-a', 'safe-site', 'whitelist-site', 'blocked-site'];
  const { app, dataDir } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const admin = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await admin.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', '安全项目')
    .field('author', '普通作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>安全项目</title>')
    .expect(201);
  await request(app)
    .post('/api/sites')
    .field('title', '包含坏词但白名单')
    .field('author', '普通作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>包含坏词但白名单</title>')
    .expect(201);
  await request(app)
    .post('/api/sites')
    .field('title', '普通项目')
    .field('author', '坏作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>普通项目</title>')
    .expect(201);

  await admin
    .put('/api/admin/settings')
    .send({ allPassword: '111111', forbiddenWords: ['坏词', '坏作者'] })
    .expect(200);

  await request(app)
    .patch('/api/sites/whitelist-site/forbidden-whitelist')
    .send({ forbiddenWhitelist: true })
    .expect(401);

  const whitelisted = await admin
    .patch('/api/sites/whitelist-site/forbidden-whitelist')
    .send({ forbiddenWhitelist: true })
    .expect(200);
  assert.equal(whitelisted.body.forbiddenWhitelist, true);

  const audit = await admin.post('/api/admin/sites/forbidden-audit').send({}).expect(200);
  assert.equal(audit.body.checked, 2);
  assert.equal(audit.body.skipped, 1);
  assert.equal(audit.body.matched, 1);
  assert.equal(audit.body.disabled, 1);
  assert.deepEqual(
    audit.body.matches.map((match) => [match.id, match.field, match.word]),
    [['blocked-site', '作者署名', '坏作者']]
  );

  const sites = await admin.get('/api/admin/sites').expect(200);
  assert.deepEqual(
    sites.body.map((site) => [site.id, site.enabled, site.forbiddenWhitelist === true]),
    [
      ['blocked-site', false, false],
      ['whitelist-site', true, true],
      ['safe-site', true, false]
    ]
  );

  const edited = await admin
    .put('/api/sites/whitelist-site')
    .field('title', '坏词标题仍允许')
    .field('author', '坏作者也允许')
    .field('classId', 'class-a')
    .expect(200);
  assert.equal(edited.body.title, '坏词标题仍允许');
  assert.equal(edited.body.author, '坏作者也允许');
  assert.equal(edited.body.forbiddenWhitelist, true);

  const savedSites = await __test.readSites(path.join(dataDir, 'sites.json'));
  assert.equal(savedSites.find((site) => site.id === 'whitelist-site').forbiddenWhitelist, true);
});

test('admin login does not unlock public class project lists', async () => {
  const ids = ['class-a', 'site-a'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', '一班作品')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Test</h1>'), { filename: 'one.html' })
    .expect(201);

  await agent.get('/api/sites?classId=class-a').expect(401);
  await agent.post('/api/classes/class-a/unlock').send({ password: '111111' }).expect(200);

  const response = await agent.get('/api/sites?classId=class-a').expect(200);
  assert.deepEqual(response.body.map((site) => site.title), ['一班作品']);
});

test('admin login does not unlock the all-projects public list', async () => {
  const ids = ['class-a', 'site-a'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.put('/api/admin/settings').send({ allPassword: '333333' }).expect(200);
  await agent.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', '一班作品')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Test</h1>'), { filename: 'one.html' })
    .expect(201);

  await agent.get('/api/sites').expect(401);
  await agent.post('/api/all/unlock').send({ password: '333333' }).expect(200);

  const response = await agent.get('/api/sites').expect(200);
  assert.deepEqual(response.body.map((site) => site.title), ['一班作品']);
});

test('GET /api/sites without a class filter requires the all-projects password', async () => {
  const ids = ['class-a', 'class-b', 'site-a', 'site-b'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.put('/api/admin/settings').send({ allPassword: '333333' }).expect(200);
  await agent.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);
  await agent.post('/api/classes').send({ name: '二班', password: '222222' }).expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', '一班作品')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Test</h1>'), { filename: 'one.html' })
    .expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', '二班作品')
    .field('author', '测试作者')
    .field('classId', 'class-b')
    .attach('file', Buffer.from('<!doctype html><h1>Class B Test</h1>'), { filename: 'two.html' })
    .expect(201);

  const visitor = request.agent(app);
  await visitor.get('/api/sites').expect(401);
  await visitor.post('/api/all/unlock').send({ password: '333333' }).expect(200);

  const response = await visitor.get('/api/sites').expect(200);
  assert.deepEqual(response.body.map((site) => site.title), ['二班作品', '一班作品']);
});

test('admin can disable the all-projects password so visitors can read all projects without unlocking', async () => {
  const ids = ['class-a', 'site-a'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const admin = request.agent(app);
  const visitor = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await admin.put('/api/admin/settings').send({ allPassword: '333333' }).expect(200);
  await admin.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);
  await request(app)
    .post('/api/sites')
    .field('title', '全部免密码项目')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .field('htmlContent', '<!doctype html><title>全部免密码项目</title>')
    .expect(201);

  await visitor.get('/api/sites').expect(401);

  const settings = await admin
    .put('/api/admin/settings')
    .send({ allPasswordEnabled: false })
    .expect(200);
  assert.equal(settings.body.allPasswordEnabled, false);

  const response = await visitor.get('/api/sites').expect(200);
  assert.deepEqual(response.body.map((site) => site.title), ['全部免密码项目']);
  await visitor.post('/api/all/unlock').send({ password: '' }).expect(200);
});

test('POST /api/sites rejects non-HTML files and multiple files', async () => {
  const { app } = await makeTestApp();

  await request(app)
    .post('/api/sites')
    .field('title', 'Not HTML')
    .attach('file', Buffer.from('hello'), { filename: 'README.md' })
    .expect(400);

  await request(app)
    .post('/api/sites')
    .field('title', 'Too many')
    .attach('file', Buffer.from('<!doctype html><h1>Test</h1>'), { filename: 'one.html' })
    .attach('file', Buffer.from('<!doctype html><h1>Test</h1>'), { filename: 'two.html' })
    .expect(400);
});

test('POST /api/sites regenerates IDs that already exist', async () => {
  const ids = ['class-a', 'taken', 'freeid'];
  const { app, storageDir } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班' }).expect(201);
  await fsp.mkdir(path.join(storageDir, 'taken'), { recursive: true });

  const response = await request(app)
    .post('/api/sites')
    .field('title', 'Unique ID')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Hello</h1>'), { filename: 'index.html' })
    .expect(201);

  assert.equal(response.body.id, 'freeid');
  assert.equal(fs.existsSync(path.join(storageDir, 'freeid', 'index.html')), true);
});

test('GET /admin.html requires the admin password before showing backend page', async () => {
  const { app } = await makeTestApp();
  const agent = request.agent(app);

  const blocked = await agent.get('/admin.html').expect(200);
  assert.match(blocked.text, /请输入后台密码/);
  assert.doesNotMatch(blocked.text, /id="createForm"/);

  await agent
    .post('/admin-login')
    .type('form')
    .send({ password: 'wrong' })
    .expect(401);

  await agent
    .post('/admin-login')
    .type('form')
    .send({ password: 'qqqyyy' })
    .expect(303)
    .expect('Location', '/admin.html');

  const unlocked = await agent.get('/admin.html').expect(200);
  assert.match(unlocked.text, /id="createForm"/);
});

test('admin can change the backend password from settings', async () => {
  const { app, dataDir } = await makeTestApp();
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);

  const response = await agent
    .put('/api/admin/settings?includeForbiddenWords=false')
    .send({ adminPassword: 'newAdmin123' })
    .expect(200);

  assert.equal(response.body.adminPasswordConfigured, true);
  assert.equal(Object.hasOwn(response.body, 'adminPassword'), false);

  const settings = await __test.readSettings(path.join(dataDir, 'settings.json'));
  assert.equal(settings.adminPassword, 'newAdmin123');

  await agent.get('/admin.html').expect(200);

  const oldPasswordAgent = request.agent(app);
  await oldPasswordAgent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(401);

  const newPasswordAgent = request.agent(app);
  await newPasswordAgent.post('/admin-login').type('form').send({ password: 'newAdmin123' }).expect(303);
  const unlocked = await newPasswordAgent.get('/admin.html').expect(200);
  assert.match(unlocked.text, /id="createForm"/);
});

test('PUT /api/sites/:id updates project title and optionally replaces HTML', async () => {
  const ids = ['class-a', 'class-b', 'editable'];
  const { app, storageDir, dataDir } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班' }).expect(201);
  await agent.post('/api/classes').send({ name: '二班' }).expect(201);

  await agent
    .post('/api/sites')
    .field('title', '旧名字')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Old</h1>'), { filename: 'old.html' })
    .expect(201);

  const unauthenticated = request.agent(app);
  await agent
    .get('/admin.html')
    .expect(200);

  await unauthenticated.put('/api/sites/editable').field('title', '未登录修改').field('classId', 'class-b').expect(401);

  const response = await agent
    .put('/api/sites/editable')
    .field('title', '新名字')
    .field('author', '测试作者')
    .field('classId', 'class-b')
    .attach('file', Buffer.from('<!doctype html><h1>New</h1>'), { filename: 'new.html' })
    .expect(200);

  assert.equal(response.body.id, 'editable');
  assert.equal(response.body.title, '新名字');
  assert.equal(response.body.classId, 'class-b');
  assert.equal(response.body.className, '二班');
  assert.equal(response.body.url, '/site/editable');
  assert.ok(response.body.updatedAt);
  assert.equal(
    await fsp.readFile(path.join(storageDir, 'editable', 'index.html'), 'utf8'),
    '<!doctype html><h1>New</h1>'
  );

  const sites = await __test.readSites(path.join(dataDir, 'sites.json'));
  assert.equal(sites[0].title, '新名字');
  assert.equal(sites[0].classId, 'class-b');
  assert.ok(sites[0].updatedAt);
});

test('POST /api/sites/:id/ai-optimize-save optimizes and saves project HTML', async () => {
  const optimizedHtml = '<!doctype html><html><body><h1>Optimized</h1></body></html>';
  let requestPayload = null;
  const llmServer = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.writeHead(404).end();
      return;
    }

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    requestPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: optimizedHtml
          }
        }
      ]
    }));
  });

  await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
  try {
    const ids = ['class-a', 'ai-save'];
    const { app, storageDir, dataDir } = await makeTestApp({
      idGenerator: () => ids.shift(),
      llmApiKey: 'test-key',
      llmApiBaseUrl: `http://127.0.0.1:${llmServer.address().port}`,
      llmModel: 'fake-model'
    });
    const agent = request.agent(app);
    await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
    await agent.post('/api/classes').send({ name: '一班' }).expect(201);
    await agent
      .post('/api/sites')
      .field('title', 'AI 项目')
      .field('author', '测试作者')
      .field('classId', 'class-a')
      .attach('file', Buffer.from('<!doctype html><h1>Original</h1>'), { filename: 'old.html' })
      .expect(201);

    const response = await agent
      .post('/api/sites/ai-save/ai-optimize-save')
      .send({ instruction: '重点优化移动端性能，减少动画掉帧。' })
      .expect(202);

    assert.equal(response.body.siteId, 'ai-save');
    assert.equal(response.body.status, 'queued');
    assert.ok(response.body.jobId);

    const job = await waitForAiOptimizeJob(agent, response.body.jobId);
    assert.equal(job.result.site.id, 'ai-save');
    assert.equal(job.result.site.title, 'AI 项目');
    assert.equal(job.result.model, 'fake-model');
    assert.equal(
      await fsp.readFile(path.join(storageDir, 'ai-save', 'index.html'), 'utf8'),
      optimizedHtml
    );

    const sites = await __test.readSites(path.join(dataDir, 'sites.json'));
    assert.ok(sites[0].updatedAt);
    assert.equal(requestPayload.model, 'fake-model');
    assert.equal(requestPayload.stream, false);
    assert.match(requestPayload.messages[1].content, /Original/);
    assert.match(requestPayload.messages[1].content, /重点优化移动端性能，减少动画掉帧。/);
  } finally {
    llmServer.closeAllConnections?.();
    await new Promise((resolve) => llmServer.close(resolve));
  }
});

test('POST /api/sites/:id/ai-optimize-save reports LLM timeout clearly', async () => {
  const llmServer = http.createServer(async (req, res) => {
    for await (const chunk of req) {
      void chunk;
    }
  });

  await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
  try {
    const ids = ['class-a', 'ai-timeout'];
    const { app } = await makeTestApp({
      idGenerator: () => ids.shift(),
      llmApiKey: 'test-key',
      llmApiBaseUrl: `http://127.0.0.1:${llmServer.address().port}`,
      llmModel: 'fake-model',
      llmOptimizeJobTimeoutMs: 1000
    });
    const agent = request.agent(app);
    await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
    await agent.post('/api/classes').send({ name: '一班' }).expect(201);
    await agent
      .post('/api/sites')
      .field('title', 'AI 超时项目')
      .field('author', '测试作者')
      .field('classId', 'class-a')
      .attach('file', Buffer.from('<!doctype html><h1>Original</h1>'), { filename: 'old.html' })
      .expect(201);

    const response = await agent
      .post('/api/sites/ai-timeout/ai-optimize-save')
      .send({})
      .expect(202);

    const job = await waitForAiOptimizeJob(agent, response.body.jobId, { status: 'error' });
    assert.match(job.error, /AI 优化服务响应超时/);
  } finally {
    llmServer.closeAllConnections?.();
    await new Promise((resolve) => llmServer.close(resolve));
  }
});

test('POST /api/sites/:id/ai-name names and saves a project title', async () => {
  let requestPayload = null;
  const llmServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    requestPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: '霓虹星跃'
          }
        }
      ]
    }));
  });

  await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
  try {
    const ids = ['class-a', 'ai-name'];
    const { app, dataDir } = await makeTestApp({
      idGenerator: () => ids.shift(),
      llmApiKey: 'test-key',
      llmApiBaseUrl: `http://127.0.0.1:${llmServer.address().port}`,
      llmModel: 'fake-model',
      llmThinkingType: 'disabled'
    });
    const agent = request.agent(app);
    await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
    await agent.post('/api/classes').send({ name: '一班' }).expect(201);
    await agent
      .post('/api/sites')
      .field('title', '旧名字')
      .field('author', '测试作者')
      .field('classId', 'class-a')
      .attach('file', Buffer.from('<!doctype html><canvas id="game"></canvas><script>let score=0;</script>'), { filename: 'game.html' })
      .expect(201);

    const response = await agent.post('/api/sites/ai-name/ai-name').send({}).expect(200);

    assert.equal(response.body.site.id, 'ai-name');
    assert.equal(response.body.site.title, '霓虹星跃');
    assert.equal(response.body.title, '霓虹星跃');
    assert.equal(response.body.model, 'fake-model');
    assert.equal(requestPayload.model, 'fake-model');
    assert.equal(requestPayload.stream, false);
    assert.equal(requestPayload.thinking.type, 'disabled');
    assert.match(requestPayload.messages[1].content, /canvas/);

    const sites = await __test.readSites(path.join(dataDir, 'sites.json'));
    assert.equal(sites[0].title, '霓虹星跃');
    assert.ok(sites[0].updatedAt);
  } finally {
    llmServer.closeAllConnections?.();
    await new Promise((resolve) => llmServer.close(resolve));
  }
});

test('POST /api/sites/:id/ai-name rejects forbidden AI titles', async () => {
  const llmServer = http.createServer(async (req, res) => {
    for await (const _chunk of req) {
      // Drain request body.
    }
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: '坏词游戏'
          }
        }
      ]
    }));
  });

  await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
  try {
    const ids = ['class-a', 'bad-ai-name'];
    const { app, dataDir } = await makeTestApp({
      idGenerator: () => ids.shift(),
      llmApiKey: 'test-key',
      llmApiBaseUrl: `http://127.0.0.1:${llmServer.address().port}`,
      llmModel: 'fake-model'
    });
    const agent = request.agent(app);
    await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
    await agent.post('/api/classes').send({ name: '一班' }).expect(201);
    await agent
      .post('/api/sites')
      .field('title', '原名')
      .field('author', '测试作者')
      .field('classId', 'class-a')
      .field('htmlContent', '<!doctype html><title>原名</title>')
      .expect(201);
    await agent
      .put('/api/admin/settings')
      .send({ allPassword: '111111', forbiddenWords: ['坏词'] })
      .expect(200);

    const response = await agent.post('/api/sites/bad-ai-name/ai-name').send({}).expect(400);
    assert.match(response.body.error, /违禁词/);

    const sites = await __test.readSites(path.join(dataDir, 'sites.json'));
    assert.equal(sites[0].title, '原名');
  } finally {
    llmServer.closeAllConnections?.();
    await new Promise((resolve) => llmServer.close(resolve));
  }
});

test('POST /api/sites/:id/ai-optimize-save preserves metadata changed while LLM is running', async () => {
  const optimizedHtml = '<!doctype html><html><body><h1>Optimized Later</h1></body></html>';
  let releaseLlm;
  let llmReceived;
  const llmReceivedPromise = new Promise((resolve) => {
    llmReceived = resolve;
  });
  const releasePromise = new Promise((resolve) => {
    releaseLlm = resolve;
  });
  const llmServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    llmReceived();
    await releasePromise;
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: optimizedHtml
          }
        }
      ]
    }));
  });

  await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
  try {
    const ids = ['class-a', 'ai-race'];
    const { app, storageDir, dataDir } = await makeTestApp({
      idGenerator: () => ids.shift(),
      llmApiKey: 'test-key',
      llmApiBaseUrl: `http://127.0.0.1:${llmServer.address().port}`,
      llmModel: 'fake-model'
    });
    const agent = request.agent(app);
    await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
    await agent.post('/api/classes').send({ name: '一班' }).expect(201);
    await agent
      .post('/api/sites')
      .field('title', 'AI 并发项目')
      .field('author', '测试作者')
      .field('classId', 'class-a')
      .attach('file', Buffer.from('<!doctype html><h1>Original</h1>'), { filename: 'old.html' })
      .expect(201);

    const optimizeResponse = await agent
      .post('/api/sites/ai-race/ai-optimize-save')
      .send({})
      .expect(202);
    await llmReceivedPromise;

    const sitesPath = path.join(dataDir, 'sites.json');
    const sites = await __test.readSites(sitesPath);
    sites[0] = {
      ...sites[0],
      title: '并发修改后的标题',
      author: '并发修改作者'
    };
    await __test.writeSites(sitesPath, sites, { sync: false });

    releaseLlm();
    const job = await waitForAiOptimizeJob(agent, optimizeResponse.body.jobId);

    assert.equal(job.result.site.title, '并发修改后的标题');
    assert.equal(job.result.site.author, '并发修改作者');
    assert.equal(
      await fsp.readFile(path.join(storageDir, 'ai-race', 'index.html'), 'utf8'),
      optimizedHtml
    );

    const savedSites = await __test.readSites(sitesPath);
    assert.equal(savedSites[0].title, '并发修改后的标题');
    assert.equal(savedSites[0].author, '并发修改作者');
    assert.ok(savedSites[0].updatedAt);
  } finally {
    llmServer.closeAllConnections?.();
    await new Promise((resolve) => llmServer.close(resolve));
  }
});

test('DELETE /api/sites/:id soft deletes project metadata and keeps files', async () => {
  const ids = ['class-a', 'deleted'];
  const { app, storageDir, dataDir } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班' }).expect(201);

  await agent
    .post('/api/sites')
    .field('title', '要删除')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Delete</h1>'), { filename: 'index.html' })
    .expect(201);

  await request(app).delete('/api/sites/deleted').expect(401);

  await agent.delete('/api/sites/deleted').expect(204);

  const sites = await __test.readSites(path.join(dataDir, 'sites.json'));
  assert.equal(sites.length, 1);
  assert.equal(sites[0].id, 'deleted');
  assert.equal(sites[0].enabled, false);
  assert.ok(sites[0].deletedAt);
  assert.equal(fs.existsSync(path.join(storageDir, 'deleted', 'index.html')), true);
  await request(app).get('/site/deleted').expect(404);

  const adminSites = await agent.get('/api/admin/sites').expect(200);
  assert.deepEqual(adminSites.body, []);

  const auditLogs = await agent.get('/api/admin/audit-logs').expect(200);
  assert.equal(auditLogs.body.logs[0].action, 'soft-delete');
  assert.deepEqual(auditLogs.body.logs[0].siteIds, ['deleted']);
});

test('admin can download a project HTML file', async () => {
  const ids = ['class-a', 'downloadable'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班' }).expect(201);

  await agent
    .post('/api/sites')
    .field('title', '下载作品')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Download</h1>'), { filename: 'download.html' })
    .expect(201);

  await request(app).get('/api/sites/downloadable/download').expect(401);

  const response = await agent.get('/api/sites/downloadable/download').expect(200);
  assert.match(response.headers['content-disposition'], /attachment/);
  assert.match(response.headers['content-disposition'], /html/);
  assert.equal(response.text, '<!doctype html><h1>Download</h1>');
});

test('preview and code opens are counted for admin rankings', async () => {
  const ids = ['class-a', 'usage-site'];
  const { app, dataDir } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班' }).expect(201);
  await agent
    .post('/api/sites')
    .field('title', '计数项目')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Usage</h1>'), { filename: 'index.html' })
    .expect(201);

  const before = await agent.get('/api/admin/sites').expect(200);
  assert.equal(before.body[0].usagePreviewCount, 0);
  assert.equal(before.body[0].usageCodeCount, 0);
  assert.equal(before.body[0].usageCount, 0);

  await agent.get('/preview/usage-site').expect(200);
  await agent.get('/api/sites/usage-site/code').expect(200);

  assert.equal(fs.existsSync(path.join(dataDir, 'site-usage.json')), false);
  const usage = await __test.readSiteUsage(path.join(dataDir, 'site-usage.json'));
  assert.equal(usage['usage-site'].usagePreviewCount, 1);
  assert.equal(usage['usage-site'].usageCodeCount, 1);

  const after = await agent.get('/api/admin/sites').expect(200);
  const site = after.body.find((item) => item.id === 'usage-site');
  assert.equal(site.usagePreviewCount, 1);
  assert.equal(site.usageCodeCount, 1);
  assert.equal(site.usageCount, 2);
  assert.ok(site.usageLastUsedAt);
});

test('public project code endpoint returns read-only files with class access', async () => {
  const { app, storageDir, dataDir } = await makeTestApp();
  await fsp.writeFile(path.join(dataDir, 'classes.json'), JSON.stringify([
    {
      id: 'class-a',
      name: '一班',
      password: '123456',
      uploadEnabled: true,
      passwordEnabled: false,
      createdAt: '2026-06-03T00:00:00.000Z'
    }
  ], null, 2));
  await fsp.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
    allPassword: '111111',
    allPasswordEnabled: true,
    forbiddenWords: [],
    lastUsedSiteNumber: 1
  }, null, 2));
  await fsp.writeFile(path.join(dataDir, 'sites.json'), JSON.stringify([
    {
      id: 'code-site',
      number: '001',
      title: '代码作品',
      author: '测试作者',
      classId: 'class-a',
      enabled: true,
      createdAt: '2026-06-03T00:00:00.000Z'
    }
  ], null, 2));
  await fsp.mkdir(path.join(storageDir, 'code-site', 'scripts'), { recursive: true });
  await fsp.writeFile(path.join(storageDir, 'code-site', 'index.html'), '<!doctype html><h1>Code</h1>');
  await fsp.writeFile(path.join(storageDir, 'code-site', 'scripts', 'app.js'), 'console.log("ok");');

  const response = await request(app).get('/api/sites/code-site/public-code').expect(200);
  assert.equal(response.body.id, 'code-site');
  assert.deepEqual(
    response.body.files.map((file) => file.path),
    ['index.html', 'scripts/app.js']
  );
  assert.match(response.body.combinedText, /===== index\.html =====/);
  assert.match(response.body.combinedText, /<!doctype html><h1>Code<\/h1>/);
  assert.match(response.body.combinedText, /===== scripts\/app\.js =====/);
  assert.match(response.body.combinedText, /console\.log\("ok"\);/);
});

test('public project code endpoint respects passwords and disabled projects', async () => {
  const { app, storageDir, dataDir } = await makeTestApp();
  await fsp.writeFile(path.join(dataDir, 'classes.json'), JSON.stringify([
    {
      id: 'class-a',
      name: '一班',
      password: '123456',
      uploadEnabled: true,
      passwordEnabled: true,
      createdAt: '2026-06-03T00:00:00.000Z'
    },
    {
      id: 'class-b',
      name: '二班',
      password: '654321',
      uploadEnabled: true,
      passwordEnabled: false,
      createdAt: '2026-06-03T00:00:00.000Z'
    }
  ], null, 2));
  await fsp.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
    allPassword: '111111',
    allPasswordEnabled: true,
    forbiddenWords: [],
    lastUsedSiteNumber: 2
  }, null, 2));
  await fsp.writeFile(path.join(dataDir, 'sites.json'), JSON.stringify([
    {
      id: 'locked-code',
      number: '001',
      title: '锁定作品',
      author: '测试作者',
      classId: 'class-a',
      enabled: true,
      createdAt: '2026-06-03T00:00:00.000Z'
    },
    {
      id: 'disabled-code',
      number: '002',
      title: '禁用作品',
      author: '测试作者',
      classId: 'class-b',
      enabled: false,
      createdAt: '2026-06-03T00:00:00.000Z'
    }
  ], null, 2));
  await fsp.mkdir(path.join(storageDir, 'locked-code'), { recursive: true });
  await fsp.mkdir(path.join(storageDir, 'disabled-code'), { recursive: true });
  await fsp.writeFile(path.join(storageDir, 'locked-code', 'index.html'), '<!doctype html><h1>Locked</h1>');
  await fsp.writeFile(path.join(storageDir, 'disabled-code', 'index.html'), '<!doctype html><h1>Disabled</h1>');

  await request(app).get('/api/sites/locked-code/public-code').expect(401);
  await request(app).get('/api/sites/disabled-code/public-code').expect(404);
});

test('admin cannot delete a class that still has projects', async () => {
  const ids = ['class-a', 'site-a'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班' }).expect(201);
  await request(app)
    .post('/api/sites')
    .field('title', '一班作品')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Test</h1>'), { filename: 'one.html' })
    .expect(201);

  await agent.delete('/api/classes/class-a').expect(400);
});

test('GET /site/:id returns index.html when present', async () => {
  const ids = ['class-a', 'withindex'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', 'Has index')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Hello</h1>'), { filename: 'index.html' })
    .expect(201);

  await request(app).get('/site/withindex').expect(401);

  const visitor = request.agent(app);
  await visitor.post('/api/classes/class-a/unlock').send({ password: '111111' }).expect(200);
  const response = await visitor.get('/site/withindex').expect(200);

  assert.match(response.text, /<h1>Hello<\/h1>/);
});

test('GET /site/:id/* blocks traversal for uploaded HTML projects', async () => {
  const ids = ['class-a', 'files'];
  const { app } = await makeTestApp({
    idGenerator: () => ids.shift()
  });
  const agent = request.agent(app);
  await agent.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await agent.post('/api/classes').send({ name: '一班', password: '111111' }).expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', 'Files')
    .field('author', '测试作者')
    .field('classId', 'class-a')
    .attach('file', Buffer.from('<!doctype html><h1>Only HTML</h1>'), { filename: 'index.html' })
    .expect(201);

  const visitor = request.agent(app);
  await visitor.post('/api/classes/class-a/unlock').send({ password: '111111' }).expect(200);
  await visitor.get('/site/files/../data/config.json').expect(404);
});
