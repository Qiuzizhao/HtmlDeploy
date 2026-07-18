# Upload Modal AI Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI naming button to the public upload modal that reads the selected HTML file or pasted code, obtains a suggested title, and fills the title input without uploading the project.

**Architecture:** The browser reuses `getUploadPreviewHtml()` so file priority exactly matches preview and upload. A new JSON endpoint validates class access, upload availability, HTML structure, AI configuration, and forbidden words before reusing `nameSiteWithLlm`; it returns a title only and never writes project data.

**Tech Stack:** Node.js, Express, browser JavaScript, HTML/CSS, `node:test`, Supertest

## Global Constraints

- If both a selected file and pasted code exist, the selected file takes priority.
- AI naming must not create a project, write an HTML file, or submit the upload form.
- The generated title remains editable before the user manually uploads.
- Existing preview and upload behavior must remain unchanged.
- Do not add dependencies.

---

### Task 1: Public AI naming endpoint

**Files:**
- Modify: `test/app.test.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `hasClassAccess(req, classItem)`, `validateBasicHtmlDocument(htmlContent)`, `getLlmConfig()`, `nameSiteWithLlm({ codeSnapshot, currentTitle, author, llmConfig })`, `findForbiddenWordMatch(fields, words)`
- Produces: `POST /api/upload-ai-name` accepting `{ classId: string, htmlContent: string }` and returning `{ title: string, model: string }`

- [ ] **Step 1: Write failing endpoint tests**

Add tests that start the existing fake `/chat/completions` HTTP server, create `class-a` with password `111111`, and assert:

```js
await request(app)
  .post('/api/upload-ai-name')
  .send({ classId: 'class-a', htmlContent: '<!doctype html><canvas id="game"></canvas>' })
  .expect(401);

const visitor = request.agent(app);
await visitor.post('/api/classes/class-a/unlock').send({ password: '111111' }).expect(200);
const response = await visitor.post('/api/upload-ai-name').send({
  classId: 'class-a',
  htmlContent: '<!doctype html><html><body><canvas id="game"></canvas></body></html>'
}).expect(200);
assert.deepEqual(response.body, { title: '霓虹星跃', model: 'fake-model' });
assert.match(requestPayload.messages[1].content, /canvas/);
assert.deepEqual(await __test.readSites(path.join(dataDir, 'sites.json')), []);
```

Also assert invalid HTML returns 400 without another AI request, disabled upload returns 403, and an AI title matching configured forbidden words returns 400.

- [ ] **Step 2: Run endpoint tests and confirm the red state**

Run: `node --test --test-name-pattern="upload AI name" test/app.test.js`

Expected: FAIL because `POST /api/upload-ai-name` returns 404.

- [ ] **Step 3: Implement the endpoint**

Add the route before `POST /api/sites`:

```js
app.post('/api/upload-ai-name', async (req, res, next) => {
  try {
    const classId = String(req.body.classId || '').trim();
    const htmlContent = String(req.body.htmlContent || '').trim();
    const classes = await readClasses(classesFile);
    const classItem = classes.find((item) => item.id === classId);

    if (!classItem) return res.status(400).json({ error: '请选择有效班级' });
    if (!hasClassAccess(req, classItem)) return res.status(401).json({ error: '请先输入班级访问密码' });
    if (classItem.uploadEnabled === false) return res.status(403).json({ error: '当前班级已禁用上传网页功能' });
    if (!htmlContent) return res.status(400).json({ error: '请上传 HTML 文件或填写 HTML 代码' });

    const htmlStructureError = validateBasicHtmlDocument(htmlContent);
    if (htmlStructureError) return res.status(400).json({ error: htmlStructureError });

    const llmConfig = await getLlmConfig();
    const title = await nameSiteWithLlm({ codeSnapshot: htmlContent, currentTitle: '', author: '', llmConfig });
    const settings = await readSettings(settingsFile, { includeForbiddenWords: true });
    const forbiddenMatch = findForbiddenWordMatch({ title, author: '' }, settings.forbiddenWords);
    if (forbiddenMatch) return res.status(400).json({ error: createForbiddenWordError(forbiddenMatch) });

    return res.json({ title, model: llmConfig.model });
  } catch (error) {
    if (/API Key|配置/.test(error.message)) return res.status(400).json({ error: error.message });
    return res.status(502).json({ error: error.message || 'AI 命名失败，请稍后重试' });
  }
});
```

- [ ] **Step 4: Run focused endpoint tests**

Run: `node --test --test-name-pattern="upload AI name" test/app.test.js`

Expected: all matching tests PASS.

- [ ] **Step 5: Commit the endpoint**

```bash
git add src/app.js test/app.test.js
git commit -m "feat: add upload AI naming endpoint"
```

### Task 2: Upload modal AI naming control

**Files:**
- Modify: `test/app.test.js`
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `getUploadPreviewHtml(): Promise<string>`, `validateBasicHtmlDocument(string): string`, `setButtonLoading(button, loading, text)`
- Produces: `#uploadAiNameButton`, which calls `POST /api/upload-ai-name` and assigns `titleInput.value`

- [ ] **Step 1: Write a failing public-page source contract test**

Read `public/index.html` and assert the title input and button share a wrapper, the handler reads existing preview input, validates it, calls the endpoint, fills the input, and has a click listener:

```js
assert.match(html, /class="upload-title-row"[\s\S]*id="titleInput"[\s\S]*id="uploadAiNameButton"/);
assert.match(html, /const uploadAiNameButton = document\.getElementById\('uploadAiNameButton'\)/);
assert.match(html, /const htmlContent = await getUploadPreviewHtml\(\)/);
assert.match(html, /validateBasicHtmlDocument\(htmlContent\)/);
assert.match(html, /fetch\('\/api\/upload-ai-name'/);
assert.match(html, /titleInput\.value = result\.title/);
assert.match(html, /uploadAiNameButton\.addEventListener\('click'/);
```

- [ ] **Step 2: Run the public-page test and confirm the red state**

Run: `node --test --test-name-pattern="upload modal exposes AI naming" test/app.test.js`

Expected: FAIL because `#uploadAiNameButton` does not exist.

- [ ] **Step 3: Add responsive markup and styles**

Wrap the title input and new button:

```html
<div class="upload-title-row">
  <input id="titleInput" name="title" type="text" maxlength="80" placeholder="例如：我的小游戏" required>
  <button class="secondary-button" id="uploadAiNameButton" type="button">AI命名</button>
</div>
```

Use a two-column grid and switch to one column under 640px:

```css
.upload-title-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
.upload-title-row button { min-width: 104px; }
@media (max-width: 640px) { .upload-title-row { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: Add the click handler**

The handler must use existing input priority and never submit the form:

```js
uploadAiNameButton.addEventListener('click', async () => {
  uploadMessage.textContent = '';
  setButtonLoading(uploadAiNameButton, true, '命名中...');
  try {
    const htmlContent = await getUploadPreviewHtml();
    if (!htmlContent) throw new Error('请上传 HTML 文件或填写 HTML 代码后再进行 AI 命名。');
    const htmlStructureMessage = validateBasicHtmlDocument(htmlContent);
    if (htmlStructureMessage) throw new Error(htmlStructureMessage);
    const response = await fetch('/api/upload-ai-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: currentClassId, htmlContent })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'AI 命名失败，请稍后重试');
    titleInput.value = result.title;
    uploadMessage.textContent = 'AI 已生成网页名字，可继续修改后上传。';
    titleInput.focus();
    titleInput.select();
  } catch (error) {
    uploadMessage.textContent = error.message;
  } finally {
    setButtonLoading(uploadAiNameButton, false);
  }
});
```

- [ ] **Step 5: Run the focused test and commit**

Run: `node --test --test-name-pattern="upload modal exposes AI naming" test/app.test.js`

Expected: PASS.

```bash
git add public/index.html test/app.test.js
git commit -m "feat: add AI naming to upload modal"
```

### Task 3: Regression verification and deployment

**Files:**
- Verify: `src/app.js`
- Verify: `public/index.html`
- Verify: `test/app.test.js`

**Interfaces:**
- Consumes: completed endpoint and browser control
- Produces: deployed `main` revision on the Ubuntu PM2 service

- [ ] **Step 1: Run static and focused verification**

```bash
node --check src/app.js
node --test --test-name-pattern="upload AI name|upload modal exposes AI naming" test/app.test.js
git diff --check
```

Expected: syntax check succeeds, new tests pass, and no whitespace errors are reported.

- [ ] **Step 2: Run the full suite**

Run: `npm test`

Expected: all new tests pass; compare any failures with the documented baseline of 8 existing failures and investigate any new failure.

- [ ] **Step 3: Push and deploy**

Push `main`, back up the production directory, update `/home/ubuntu/HtmlDeploy` to the pushed commit, install production dependencies if the lockfile changed, and restart PM2 process `html-deploy`.

- [ ] **Step 4: Production smoke checks**

Confirm the server commit matches the local pushed commit, PM2 reports `html-deploy` online, local port `3005` and the public URL return HTTP 200, and production `public/index.html` contains `uploadAiNameButton`. Do not invoke the production AI endpoint during smoke testing.
