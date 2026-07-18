# Batch AI Name Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resumable server-side batch task that reviews and, when required, renames every undeleted project from one admin toolbar action.

**Architecture:** Extract the current single-project review into one internal service used by both the existing endpoint and a serial batch worker. Keep batch jobs in the app process for 24 hours, expose progress and ordered log events through an admin status endpoint, and let the admin page store the active job ID and last event index so a browser refresh reconnects without restarting work.

**Tech Stack:** Node.js CommonJS, Express, vanilla HTML/CSS/JavaScript, `node:test`, Supertest.

## Global Constraints

- Review all undeleted projects regardless of current pagination, search, class, or starred filters.
- Process exactly one project at a time and allow only one active all-project review job.
- Continue after per-project failures and report renamed, preserved, and failed counts.
- Reuse the existing single-project review, forbidden-word, concurrency-protection, and persistence rules.
- Browser refresh must reconnect to an in-process task; server-process restart recovery is out of scope.
- Keep the existing per-row `AI命名审核` behavior unchanged.

---

### Task 1: Shared single-project review service

**Files:**
- Modify: `src/app.js` around the existing `/api/sites/:id/ai-name-review` handler
- Test: `test/app.test.js` existing AI name review tests

**Interfaces:**
- Consumes: `reviewSiteNameWithLlm`, `reviewReasonClearlySaysUnrelated`, `nameSiteWithLlm`, `readProjectCodeSnapshot`, site/settings/class storage helpers.
- Produces: `reviewAndMaybeRenameSite(id, llmConfigOverride)` returning `{ renamed, related, confidence, reason, originalTitle, title, site, model }`; thrown errors carry `statusCode` when the correct HTTP response is not 502.

- [ ] **Step 1: Strengthen the existing endpoint test before refactoring**

Add assertions to the existing three-verdict test so its response contract is explicit:

```js
assert.deepEqual(Object.keys(mismatch.body).sort(), [
  'confidence', 'model', 'originalTitle', 'reason', 'related', 'renamed', 'site', 'title'
].sort());
assert.equal(mismatch.body.site.title, '贪吃蛇游戏');
```

- [ ] **Step 2: Run the focused test and establish the current green baseline**

Run: `node --test --test-name-pattern="AI name review preserves" test/app.test.js`

Expected: PASS before refactoring; this is a characterization test, not the new-feature red test.

- [ ] **Step 3: Extract the service without changing behavior**

Inside `createApp`, add a status error helper and move the handler body into:

```js
function createStatusError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function reviewAndMaybeRenameSite(id, llmConfigOverride = null) {
  const sites = await readSites(dataFile);
  const siteIndex = sites.findIndex((item) => item.id === id);
  if (siteIndex === -1) throw createStatusError(404, '项目不存在');

  const projectDir = path.join(storageDir, id);
  if (!fs.existsSync(projectDir)) throw createStatusError(404, '项目文件不存在');
  const { combinedText } = await readProjectCodeSnapshot(projectDir);
  if (!combinedText.trim()) throw createStatusError(400, '项目代码为空');

  // Continue with the existing handler statements from `const originalTitle`
  // through construction of the final response object, changing only
  // `const llmConfig = await getLlmConfig()` to the line below.
  const llmConfig = llmConfigOverride || await getLlmConfig();
}
```

The extraction is mechanical: retain every existing contradiction check, fallback naming call, latest-site re-read, concurrent-title guard, forbidden-word check, write, public-site conversion, and return field. Convert the existing 404/400 response branches to `throw createStatusError(status, message)`; do not change their messages.

Replace the endpoint with:

```js
app.post('/api/sites/:id/ai-name-review', requireAdmin, async (req, res) => {
  try {
    return res.json(await reviewAndMaybeRenameSite(req.params.id));
  } catch (error) {
    const statusCode = error.statusCode || (error.message.includes('配置') ? 400 : 502);
    return res.status(statusCode).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Re-run all focused name-review tests**

Run: `node --test --test-name-pattern="AI name review" test/app.test.js`

Expected: all matching tests PASS and the public response shape remains unchanged.

- [ ] **Step 5: Commit the refactor**

```bash
git add src/app.js test/app.test.js
git commit -m "refactor: share AI name review service"
```

### Task 2: Serial all-project review job API

**Files:**
- Modify: `src/app.js` inside `createApp` job state/helpers and admin routes
- Test: `test/app.test.js` job polling helper and batch API tests

**Interfaces:**
- Consumes: `reviewAndMaybeRenameSite(id, llmConfigOverride)` from Task 1 and `getLlmConfig()`.
- Produces: `POST /api/admin/sites/ai-name-review-all`, `GET /api/admin/ai-name-review-jobs/:jobId`, and responses shaped as `{ jobId, status, total, finished, renamed, preserved, failed, current, events, createdAt, updatedAt, finishedAt }`.

- [ ] **Step 1: Write the failing batch-job test**

Create three projects and a fake LLM server that returns, in request order, one related verdict, one unrelated verdict with a suggested name, and one HTTP 500 response. Add:

```js
async function waitForAiNameReviewJob(agent, jobId, { attempts = 120 } = {}) {
  let latest;
  for (let index = 0; index < attempts; index += 1) {
    latest = await agent.get(`/api/admin/ai-name-review-jobs/${jobId}`).expect(200);
    if (['success', 'error'].includes(latest.body.status)) return latest.body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`AI name review job did not finish; latest status: ${latest?.body?.status}`);
}
```

The test must assert:

```js
const created = await agent.post('/api/admin/sites/ai-name-review-all').send({}).expect(202);
const duplicate = await agent.post('/api/admin/sites/ai-name-review-all').send({}).expect(202);
assert.equal(duplicate.body.jobId, created.body.jobId);

const job = await waitForAiNameReviewJob(agent, created.body.jobId);
assert.equal(job.status, 'success');
assert.deepEqual(
  { total: job.total, finished: job.finished, renamed: job.renamed, preserved: job.preserved, failed: job.failed },
  { total: 3, finished: 3, renamed: 1, preserved: 1, failed: 1 }
);
assert.ok(job.events.some((event) => event.status === 'error'));
assert.ok(job.events.some((event) => event.text.includes('已自动命名为')));
```

- [ ] **Step 2: Run the batch test and verify RED**

Run: `node --test --test-name-pattern="all-project AI name review" test/app.test.js`

Expected: FAIL because `/api/admin/sites/ai-name-review-all` returns 404.

- [ ] **Step 3: Implement job state, event log, and serial worker**

Add inside `createApp`:

```js
const aiNameReviewJobs = new Map();
let activeAiNameReviewJobId = '';

function cleanupAiNameReviewJobs() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [jobId, job] of aiNameReviewJobs.entries()) {
    if (['success', 'error'].includes(job.status)
      && Date.parse(job.finishedAt || job.updatedAt || job.createdAt) < cutoff) {
      aiNameReviewJobs.delete(jobId);
    }
  }
}

function toAiNameReviewJobResponse(job) {
  return {
    jobId: job.id,
    status: job.status,
    total: job.total,
    finished: job.finished,
    renamed: job.renamed,
    preserved: job.preserved,
    failed: job.failed,
    current: job.current,
    events: job.events,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt || ''
  };
}

function addAiNameReviewJobEvent(job, text, status = 'running') {
  job.nextEventIndex += 1;
  job.events.push({ index: job.nextEventIndex, text, status, createdAt: new Date().toISOString() });
  job.events = job.events.slice(-200);
  job.updatedAt = new Date().toISOString();
}
```

Implement `runAiNameReviewJob(job)` with a `for...of` loop. For each snapshot item: set `current`, append a running event, `await reviewAndMaybeRenameSite(site.id, job.llmConfig)`, increment exactly one of `renamed` or `preserved`, append a success event, catch and increment `failed` with an error event, then increment `finished`. When the loop ends, set `status = 'success'`, clear `current`, set `finishedAt`, append the summary event, clear the API key reference, and release `activeAiNameReviewJobId` in `finally`.

- [ ] **Step 4: Implement authenticated create/status endpoints**

Creation must validate AI configuration before storing a job and snapshot every `!isSiteDeleted(site)` item. If `activeAiNameReviewJobId` points to a queued/running job, return that job. Schedule the worker with an unref'ed zero-delay timer. The status route returns 404 for unknown or expired job IDs.

```js
app.post('/api/admin/sites/ai-name-review-all', requireAdmin, async (req, res) => {
  try {
    cleanupAiNameReviewJobs();
    const activeJob = aiNameReviewJobs.get(activeAiNameReviewJobId);
    if (activeJob && ['queued', 'running'].includes(activeJob.status)) {
      return res.status(202).json(toAiNameReviewJobResponse(activeJob));
    }

    const llmConfig = await getLlmConfig();
    if (!llmConfig.apiKey) {
      return res.status(400).json({ error: '请先在后台设置中配置 API Key，或在服务器环境变量中配置 LLM_API_KEY / OPENAI_API_KEY' });
    }

    const sites = (await readSites(dataFile))
      .filter((site) => !isSiteDeleted(site))
      .map((site) => ({ id: site.id, title: site.title || site.id, number: site.number || '' }));
    const now = new Date().toISOString();
    const job = {
      id: createDefaultId(), status: 'queued', sites, total: sites.length,
      finished: 0, renamed: 0, preserved: 0, failed: 0, current: '',
      events: [], nextEventIndex: 0, llmConfig,
      createdAt: now, updatedAt: now, finishedAt: ''
    };
    aiNameReviewJobs.set(job.id, job);
    activeAiNameReviewJobId = job.id;
    const timer = setTimeout(() => runAiNameReviewJob(job), 0);
    timer.unref?.();
    return res.status(202).json(toAiNameReviewJobResponse(job));
  } catch (error) {
    return res.status(error.message.includes('配置') ? 400 : 500).json({ error: error.message });
  }
});

app.get('/api/admin/ai-name-review-jobs/:jobId', requireAdmin, (req, res) => {
  cleanupAiNameReviewJobs();
  const job = aiNameReviewJobs.get(String(req.params.jobId));
  if (!job) return res.status(404).json({ error: 'AI 命名审核任务不存在或已过期' });
  return res.json(toAiNameReviewJobResponse(job));
});
```

- [ ] **Step 5: Run batch and existing single-review tests**

Run: `node --test --test-name-pattern="(all-project AI name review|AI name review preserves|corrects a keep verdict)" test/app.test.js`

Expected: all matching tests PASS; fake LLM requests occur serially and the third-item error does not stop completion.

- [ ] **Step 6: Commit the backend feature**

```bash
git add src/app.js test/app.test.js
git commit -m "feat: add batch AI name review job"
```

### Task 3: Admin button, progress polling, logs, and refresh recovery

**Files:**
- Modify: `public/admin.html` toolbar, state declarations, job helpers, event listeners, and `boot()`
- Test: `test/app.test.js` public admin source contract

**Interfaces:**
- Consumes: the two Task 2 endpoints and existing `addAiOptimizeLog`, `setButtonLoading`, `loadSites`, `sleep`, and `readResponseError` functions.
- Produces: `startAllSiteNameReviews()`, `pollAllSiteNameReviewJob(jobId)`, `resumeAllSiteNameReviewJob()`, local storage key `project-site-ai-name-review-job`, and toolbar button `reviewAllSiteNamesButton`.

- [ ] **Step 1: Write the failing page contract test**

Add assertions to a new test named `admin can run and resume all-project AI name reviews`:

```js
assert.match(html, /id="reviewAllSiteNamesButton"[^>]*>全部命名审核<\/button>/);
assert.match(html, /const AI_NAME_REVIEW_JOB_STORAGE_KEY = 'project-site-ai-name-review-job'/);
assert.match(html, /async function startAllSiteNameReviews/);
assert.match(html, /async function pollAllSiteNameReviewJob/);
assert.match(html, /async function resumeAllSiteNameReviewJob/);
assert.match(html, /\/api\/admin\/sites\/ai-name-review-all/);
assert.match(html, /\/api\/admin\/ai-name-review-jobs\/\$\{encodeURIComponent\(jobId\)\}/);
assert.match(html, /`审核 \$\{job\.finished\}\/\$\{job\.total\}`/);
assert.match(html, /lastEventIndex/);
assert.match(html, /已改名 \$\{job\.renamed\} 个，已保留 \$\{job\.preserved\} 个，失败 \$\{job\.failed\} 个/);
```

- [ ] **Step 2: Run the page test and verify RED**

Run: `node --test --test-name-pattern="admin can run and resume" test/app.test.js`

Expected: FAIL because the toolbar button and functions do not exist.

- [ ] **Step 3: Add toolbar control and persisted client state**

Insert the button beside the other project-wide actions:

```html
<button class="button" id="reviewAllSiteNamesButton" type="button">全部命名审核</button>
```

Add the DOM reference, storage key, and state:

```js
const reviewAllSiteNamesButton = document.getElementById('reviewAllSiteNamesButton');
const AI_NAME_REVIEW_JOB_STORAGE_KEY = 'project-site-ai-name-review-job';
let allSiteNameReviewPolling = false;
```

Store `{ jobId, lastEventIndex }` in local storage. Clearing a completed, failed, missing, or expired job removes this key.

- [ ] **Step 4: Implement start, poll, event consumption, and resume**

`startAllSiteNameReviews()` posts once, saves the returned job ID, logs task creation, and starts polling. `pollAllSiteNameReviewJob(jobId)` must have a single-loop guard, fetch every 1500ms, update the button through `setButtonLoading(reviewAllSiteNamesButton, true, `审核 ${job.finished}/${job.total}`)`, append only events with `event.index > lastEventIndex`, and save the new index after consumption.

On `status === 'success'`, restore the button, clear saved task state, reload the visible project list, and show:

```js
`全部命名审核完成：已改名 ${job.renamed} 个，已保留 ${job.preserved} 个，失败 ${job.failed} 个`
```

`resumeAllSiteNameReviewJob()` reads saved state during `boot()` and invokes the same poller. A 404 clears stale state and restores the button without affecting the rest of page startup.

- [ ] **Step 5: Bind the button and resume during boot**

```js
reviewAllSiteNamesButton.addEventListener('click', startAllSiteNameReviews);
```

Call `resumeAllSiteNameReviewJob()` after initial settings/classes/projects load so the toolbar and log container already exist.

- [ ] **Step 6: Run page and focused API tests**

Run: `node --test --test-name-pattern="(admin can run and resume|all-project AI name review|AI name review action)" test/app.test.js`

Expected: all matching tests PASS.

- [ ] **Step 7: Commit the frontend feature**

```bash
git add public/admin.html test/app.test.js
git commit -m "feat: add all-project name review control"
```

### Task 4: Full verification and deployment

**Files:**
- Verify only: `src/app.js`, `public/admin.html`, `test/app.test.js`

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: pushed `main` commit and verified PM2 deployment.

- [ ] **Step 1: Run syntax and whitespace checks**

```bash
node --check src/app.js
git diff --check
```

Expected: both exit 0.

- [ ] **Step 2: Run the full suite and compare against baseline**

Run: `node --test`

Expected: new tests pass; the known baseline remains 8 unrelated failures and no new failure names appear.

- [ ] **Step 3: Push main**

```bash
git push origin main
```

- [ ] **Step 4: Deploy and verify Ubuntu**

On `/home/ubuntu/HtmlDeploy`: fast-forward `origin/main`, run `node --check src/app.js`, restart `html-deploy` with PM2, save PM2 state, and verify the deployed HEAD, `online` status, localhost HTTP 200, public-IP HTTP 200, unauthenticated create-job HTTP 401, and presence of `reviewAllSiteNamesButton` in the served admin asset.
