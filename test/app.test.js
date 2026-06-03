const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const request = require('supertest');

const { createApp } = require('../src/app');

test('public index uses a single HTML file picker', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /<input[^>]+id="fileInput"[^>]+type="file"/);
  assert.match(html, /<input[^>]+id="fileInput"[^>]+accept="\.html,text\/html"/);
  assert.doesNotMatch(html, /<input[^>]+id="fileInput"[^>]+multiple/);
  assert.doesNotMatch(html, /<input[^>]+id="fileInput"[^>]+webkitdirectory/);
});

test('public index does not show the project list heading or helper copy', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.doesNotMatch(html, /项目列表/);
  assert.doesNotMatch(html, /上传项目文件后，点击卡片可在大窗口中预览。/);
});

test('public index renders a visible upload-order number on each project card', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /sites\.forEach\(\(site, index\)/);
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

test('public index renders an all tab before class buttons', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /allButton\.textContent = '全部'/);
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
  assert.match(html, /data-view-target="classes"/);
  assert.match(html, /data-admin-view="projects"[^>]+class="workspace is-active"/);
  assert.match(html, /data-admin-view="create"[^>]+class="workspace"/);
  assert.match(html, /data-admin-view="classes"[^>]+class="workspace"/);
  assert.match(html, /function switchView/);
  assert.match(html, /projectCount/);
  assert.match(html, /classCount/);
  assert.match(html, /id="createForm"/);
  assert.match(html, /fetch\('\/api\/admin\/sites'/);
  assert.match(html, /method: 'PUT'/);
  assert.match(html, /method: 'DELETE'/);
  assert.match(html, /id="auditForbiddenSitesButton"[^>]*>违禁词审查<\/button>/);
  assert.match(html, /id="aiOptimizeLog"/);
  assert.match(html, /function addAiOptimizeLog/);
  assert.match(html, /runningAiOptimizations/);
  assert.match(html, /\/api\/admin\/sites\/forbidden-audit/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/download/);
  assert.match(html, /textContent = '下载'/);
  assert.match(html, /textContent = 'AI优化'/);
  assert.match(html, /textContent = directedAiOptimizeButton\.disabled \? '优化中\.\.\.' : '定向AI优化'/);
  assert.match(html, /id="directedAiOverlay"/);
  assert.match(html, /function openDirectedAiWindow/);
  assert.match(html, /textContent = aiNameButton\.disabled \? '命名中\.\.\.' : 'AI命名'/);
  assert.match(html, /function nameSiteWithAi/);
  assert.match(html, /textContent = enabled \? '禁用' : '启用'/);
  assert.match(html, /textContent = forbiddenWhitelisted \? '移出白名单' : '白名单'/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/ai-name/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/ai-optimize-save/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/enabled/);
  assert.match(html, /\/api\/sites\/\$\{encodeURIComponent\(site\.id\)\}\/forbidden-whitelist/);
  assert.match(html, /project-disabled-warning/);
  assert.match(html, /搜索项目名称、ID 或序号/);
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

test('public admin can edit the all-projects password in class management', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(html, /全部密码/);
  assert.match(html, /id="allPasswordInput"[^>]+type="password"/);
  assert.match(html, /id="toggleAllPassword"[^>]*>显示<\/button>/);
  assert.match(html, /id="generateAllPassword"[^>]*>随机生成<\/button>/);
  assert.match(html, /id="saveAllPassword"[^>]*>保存全部密码<\/button>/);
  assert.match(html, /id="toggleAllPasswordEnabled"[^>]*>密码已启用<\/button>/);
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

async function makeTestApp(options = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-deploy-'));
  const dataDir = path.join(root, 'data');
  const storageDir = path.join(root, 'storage', 'sites');
  const publicDir = path.join(root, 'public');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(storageDir, { recursive: true });
  await fsp.mkdir(publicDir, { recursive: true });
  await fsp.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>Test Shell</title>');
  await fsp.writeFile(path.join(publicDir, 'admin.html'), '<!doctype html><title>Admin Shell</title><form id="createForm"></form>');

  const app = createApp({
    dataFile: path.join(dataDir, 'sites.json'),
    classesFile: path.join(dataDir, 'classes.json'),
    settingsFile: path.join(dataDir, 'settings.json'),
    storageDir,
    publicDir,
    ...options
  });

  return { app, root, dataDir, storageDir, publicDir };
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

  const sites = JSON.parse(await fsp.readFile(path.join(dataDir, 'sites.json'), 'utf8'));
  assert.deepEqual(
    sites.map((site) => [site.id, site.number]),
    [
      ['newer', '00002'],
      ['older', '00001']
    ]
  );
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

  const sites = JSON.parse(await fsp.readFile(path.join(dataDir, 'sites.json'), 'utf8'));
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
    .attach('file', Buffer.from('<!doctype html>'), { filename: 'one.html' })
    .expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', '二班作品')
    .field('author', '测试作者')
    .field('classId', 'class-b')
    .attach('file', Buffer.from('<!doctype html>'), { filename: 'two.html' })
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
    audit.body.matches.map((match) => [match.id, match.field, match.word]),
    [
      ['bad-author-site', '作者署名', '坏作者'],
      ['bad-title-site', '网页名字', '坏词']
    ]
  );

  const sites = await admin.get('/api/admin/sites').expect(200);
  assert.deepEqual(
    sites.body.map((site) => [site.id, site.enabled]),
    [
      ['bad-author-site', false],
      ['bad-title-site', false],
      ['safe-site', true]
    ]
  );
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

  const savedSites = JSON.parse(await fsp.readFile(path.join(dataDir, 'sites.json'), 'utf8'));
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
    .attach('file', Buffer.from('<!doctype html>'), { filename: 'one.html' })
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
    .attach('file', Buffer.from('<!doctype html>'), { filename: 'one.html' })
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
    .attach('file', Buffer.from('<!doctype html>'), { filename: 'one.html' })
    .expect(201);

  await request(app)
    .post('/api/sites')
    .field('title', '二班作品')
    .field('author', '测试作者')
    .field('classId', 'class-b')
    .attach('file', Buffer.from('<!doctype html>'), { filename: 'two.html' })
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
    .attach('file', Buffer.from('<!doctype html>'), { filename: 'one.html' })
    .attach('file', Buffer.from('<!doctype html>'), { filename: 'two.html' })
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

  const sites = JSON.parse(await fsp.readFile(path.join(dataDir, 'sites.json'), 'utf8'));
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
      .expect(200);

    assert.equal(response.body.site.id, 'ai-save');
    assert.equal(response.body.site.title, 'AI 项目');
    assert.equal(response.body.model, 'fake-model');
    assert.equal(
      await fsp.readFile(path.join(storageDir, 'ai-save', 'index.html'), 'utf8'),
      optimizedHtml
    );

    const sites = JSON.parse(await fsp.readFile(path.join(dataDir, 'sites.json'), 'utf8'));
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

    const sites = JSON.parse(await fsp.readFile(path.join(dataDir, 'sites.json'), 'utf8'));
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

    const sites = JSON.parse(await fsp.readFile(path.join(dataDir, 'sites.json'), 'utf8'));
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

    const optimizePromise = new Promise((resolve, reject) => {
      agent
        .post('/api/sites/ai-race/ai-optimize-save')
        .send({})
        .expect(200)
        .end((error, response) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(response);
        });
    });
    await llmReceivedPromise;

    const sitesPath = path.join(dataDir, 'sites.json');
    const sites = JSON.parse(await fsp.readFile(sitesPath, 'utf8'));
    sites[0] = {
      ...sites[0],
      title: '并发修改后的标题',
      author: '并发修改作者'
    };
    await fsp.writeFile(sitesPath, JSON.stringify(sites, null, 2));

    releaseLlm();
    const response = await optimizePromise;

    assert.equal(response.body.site.title, '并发修改后的标题');
    assert.equal(response.body.site.author, '并发修改作者');
    assert.equal(
      await fsp.readFile(path.join(storageDir, 'ai-race', 'index.html'), 'utf8'),
      optimizedHtml
    );

    const savedSites = JSON.parse(await fsp.readFile(sitesPath, 'utf8'));
    assert.equal(savedSites[0].title, '并发修改后的标题');
    assert.equal(savedSites[0].author, '并发修改作者');
    assert.ok(savedSites[0].updatedAt);
  } finally {
    llmServer.closeAllConnections?.();
    await new Promise((resolve) => llmServer.close(resolve));
  }
});

test('DELETE /api/sites/:id removes project metadata and files', async () => {
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

  const sites = JSON.parse(await fsp.readFile(path.join(dataDir, 'sites.json'), 'utf8'));
  assert.deepEqual(sites, []);
  assert.equal(fs.existsSync(path.join(storageDir, 'deleted')), false);
  await request(app).get('/site/deleted').expect(404);
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
    .attach('file', Buffer.from('<!doctype html>'), { filename: 'one.html' })
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
