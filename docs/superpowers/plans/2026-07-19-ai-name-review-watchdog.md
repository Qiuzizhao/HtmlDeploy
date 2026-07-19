# AI Name Review Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent all-project AI name reviews from becoming permanent zombie jobs and resume the current production batch from site `be953c47` without reprocessing the first 210 completed sites.

**Architecture:** Keep the existing in-process serial job model, but wrap each complete site review in a hard watchdog and invalidate timed-out attempts before any write. Track the worker Promise, expire jobs with stale heartbeats, and add an admin-only `resumeFromSiteId` cursor for the one-time production continuation.

**Tech Stack:** Node.js 20 CommonJS, Express, built-in `fetch`/`AbortController`, SQLite runtime store, Node test runner, Supertest, PM2, Nginx.

## Global Constraints

- Default complete-site timeout: 60,000 ms.
- Default stale-heartbeat threshold: 90,000 ms.
- Continue to process sites serially; do not add concurrent AI requests.
- A timed-out attempt must never write a late AI result.
- Do not persist jobs to SQLite or implement automatic restart recovery.
- Production continuation starts at and includes site ID `be953c47` (number `00355`).
- Preserve the database results from the first 210 completed sites.

---

### Task 1: Hard timeout and late-write protection

**Files:**
- Modify: `test/app.test.js`
- Modify: `src/app.js:1710-1760`
- Modify: `src/app.js:2160-2230`
- Modify: `src/app.js:3870-3950`

**Interfaces:**
- Consumes: existing `reviewAndMaybeRenameSite(id, llmConfigOverride)` and `runAiNameReviewJob(job)`.
- Produces: `withTimeout(promise, timeoutMs, createError)`, `reviewAndMaybeRenameSite(id, llmConfigOverride, { isActive })`, and `options.aiNameReviewSiteTimeoutMs`.

- [ ] **Step 1: Write a failing timeout-continuation test**

Add a test that creates two sites and a fake LLM server. The first request remains open; the second returns a related result. Build the app with `aiNameReviewSiteTimeoutMs: 1000`, start the batch, and assert the final job is:

```js
assert.deepEqual(
  {
    status: job.status,
    total: job.total,
    finished: job.finished,
    preserved: job.preserved,
    failed: job.failed
  },
  { status: 'success', total: 2, finished: 2, preserved: 1, failed: 1 }
);
assert.ok(job.events.some((event) => event.text.includes('完整流程超时')));
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern="continues after a site review watchdog timeout" test/app.test.js
```

Expected: FAIL because the first unresolved request prevents the job from finishing.

- [ ] **Step 3: Implement the complete-site watchdog**

In `createApp`, normalize `options.aiNameReviewSiteTimeoutMs ?? process.env.AI_NAME_REVIEW_SITE_TIMEOUT_MS` with a 60-second fallback and 300-second maximum. Add a Promise race helper whose timer is cleared on settlement and whose timeout creates:

```js
new Error(`AI 命名审核完整流程超时（超过 ${Math.round(aiNameReviewSiteTimeoutMs / 1000)} 秒）`)
```

For each site, create `{ active: true }`, store it as `job.activeAttempt`, and call:

```js
const result = await withTimeout(
  reviewAndMaybeRenameSite(siteSnapshot.id, job.llmConfig, {
    isActive: () => attempt.active && job.activeAttempt === attempt && job.status === 'running'
  }),
  aiNameReviewSiteTimeoutMs,
  () => new Error(timeoutMessage)
);
```

Set `attempt.active = false` in the per-site `finally`, then continue through the existing failure accounting.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same `node --test --test-name-pattern` command. Expected: PASS and process exits without an unhandled rejection.

- [ ] **Step 5: Write a failing late-write regression test**

Use a delayed fake LLM response that returns an unrelated verdict after the 1-second watchdog, while a second site completes. Wait for the delayed response and assert the first site's stored title is unchanged:

```js
const sites = await __test.readSites(path.join(dataDir, 'sites.json'));
assert.equal(sites.find((site) => site.id === 'slow-site').title, '慢任务原名');
```

- [ ] **Step 6: Run the late-write test and verify RED**

Run:

```bash
node --test --test-name-pattern="ignores a late AI name review result after timeout" test/app.test.js
```

Expected: FAIL because the delayed result still reaches the existing write path.

- [ ] **Step 7: Guard every post-AI write boundary**

Change `reviewAndMaybeRenameSite` to accept `{ isActive = () => true } = {}`. Check `isActive()` after the review response, after any fallback naming response, and immediately before `writeSites`. Throw a 409 status error with `AI 命名审核尝试已过期，已忽略迟到结果` when inactive.

- [ ] **Step 8: Run both watchdog tests and the existing batch test**

Run:

```bash
node --test --test-name-pattern="site review watchdog timeout|late AI name review result|all-project AI name review processes serially" test/app.test.js
```

Expected: all selected tests PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/app.js test/app.test.js
git commit -m "fix: keep batch name reviews moving"
```

---

### Task 2: Worker tracking, stale-job expiry, and explicit continuation

**Files:**
- Modify: `test/app.test.js`
- Modify: `public/admin.html:2240-2270`
- Modify: `src/app.js:1710-1760`
- Modify: `src/app.js:2110-2240`
- Modify: `src/app.js:3730-3810`

**Interfaces:**
- Consumes: Task 1's `job.activeAttempt` and watchdog behavior.
- Produces: `options.aiNameReviewStaleTimeoutMs`, `options.aiNameReviewNow`, tracked `job.workerPromise`, stale finalization, and request body `{ resumeFromSiteId?: string }`.

- [ ] **Step 1: Write failing stale-job behavior tests**

Create the app with an injected clock and an unresolved LLM request. After job creation, advance the clock past 90 seconds. Assert:

```js
await agent.get('/api/admin/ai-name-review-jobs/current').expect(404);
const expired = await agent.get(`/api/admin/ai-name-review-jobs/${jobId}`).expect(200);
assert.equal(expired.body.status, 'error');
assert.match(expired.body.events.at(-1).text, /长时间无进展，已自动结束/);
```

- [ ] **Step 2: Run the stale-job test and verify RED**

Run:

```bash
node --test --test-name-pattern="expires a stale all-project AI name review job" test/app.test.js
```

Expected: FAIL because `/current` still returns the stale running job.

- [ ] **Step 3: Implement a single stale finalizer**

Use `options.aiNameReviewNow || Date.now` for job timestamps and stale comparisons. Add a helper that invalidates `job.activeAttempt`, updates the job to `error`, clears `current`, sets `finishedAt`, appends the stale event once, releases `activeAiNameReviewJobId`, and clears sensitive/worker references. Call it from cleanup before active-job lookup in create, current-status, and job-status routes.

- [ ] **Step 4: Track and guard the worker Promise**

Replace the discarded timer callback with a starter that assigns `job.workerPromise`. Its `.catch` must finalize a still-active job as `error`; its `.finally` must clear the stored worker reference without exposing it in `toAiNameReviewJobResponse`. Support `options.aiNameReviewWorkerRunner` only as a dependency-injection seam, defaulting to `runAiNameReviewJob`.

- [ ] **Step 5: Add and verify a failing worker-rejection test**

Inject `aiNameReviewWorkerRunner: async () => { throw new Error('simulated worker crash'); }`, start a job, poll it, and assert `status === 'error'` plus an event containing `simulated worker crash`. Run the focused test first to observe RED, implement the worker catch, then rerun for GREEN.

- [ ] **Step 6: Write failing `resumeFromSiteId` tests**

Create three sites and start with:

```js
const created = await agent
  .post('/api/admin/sites/ai-name-review-all')
  .send({ resumeFromSiteId: 'second-site' })
  .expect(202);
assert.equal(created.body.total, 2);
```

Assert only the second and third sites reach the fake LLM. In a separate assertion, send `{ resumeFromSiteId: 'missing-site' }` and expect 400 with `续跑起点项目不存在`.

- [ ] **Step 7: Implement explicit continuation filtering**

Build the active-site snapshot first, then locate the trimmed `resumeFromSiteId`. When supplied, reject `-1`; otherwise replace the snapshot with `sites.slice(resumeIndex)`. Set `total` from the filtered snapshot and leave the no-body route unchanged.

- [ ] **Step 8: Update frontend terminal error copy**

Change the `job.status === 'error'` message to `全部命名审核任务已结束，请查看日志后重新发起`. Extend the static admin-page test to assert this copy exists.

- [ ] **Step 9: Run focused Task 2 tests**

Run:

```bash
node --test --test-name-pattern="stale all-project|worker rejection|resumeFromSiteId|admin can run and resume" test/app.test.js
```

Expected: all selected tests PASS.

- [ ] **Step 10: Commit Task 2**

```bash
git add src/app.js public/admin.html test/app.test.js
git commit -m "fix: recover stalled batch name reviews"
```

---

### Task 3: Full verification, GitHub delivery, production continuation

**Files:**
- Verify: `src/app.js`
- Verify: `public/admin.html`
- Verify: `test/app.test.js`
- Verify: `docs/superpowers/specs/2026-07-19-ai-name-review-watchdog-design.md`
- Verify: `docs/superpowers/plans/2026-07-19-ai-name-review-watchdog.md`

**Interfaces:**
- Consumes: completed Task 1 and Task 2 behavior.
- Produces: pushed `main`, updated PM2 deployment, and a completed continuation job beginning at `be953c47`.

- [ ] **Step 1: Run syntax and whitespace verification**

```bash
node --check src/app.js
git diff --check
```

Expected: both commands exit 0 with no output.

- [ ] **Step 2: Run the complete test suite**

```bash
npm test
```

Expected: exit 0, zero failed tests, and no unhandled rejections.

- [ ] **Step 3: Inspect scope and commit any final verified changes**

```bash
git status --short --branch
git diff HEAD~2 --stat
```

Only the watchdog, continuation, tests, admin copy, spec, and plan may be included. Leave `.DS_Store` untracked.

- [ ] **Step 4: Push `main`**

```bash
git push origin main
```

Expected: remote `main` advances to the verified local HEAD.

- [ ] **Step 5: Back up production runtime data**

On `/home/ubuntu/HtmlDeploy`, run the existing `scripts/backup-runtime-data.sh` and verify it creates a current archive before restarting PM2.

- [ ] **Step 6: Deploy and clear the zombie job**

On the production server:

```bash
git pull --ff-only origin main
node --check src/app.js
pm2 restart html-deploy --update-env
pm2 save
```

Verify `pm2 status html-deploy` is `online`, local port 3005 returns HTTP 200, and the old current-job endpoint returns 404.

- [ ] **Step 7: Start exactly the remaining production batch**

Using an authenticated admin request, POST:

```json
{"resumeFromSiteId":"be953c47"}
```

to `/api/admin/sites/ai-name-review-all`. Assert the response is 202, `total` is 282, and the first current event names number `00355`.

- [ ] **Step 8: Monitor the continuation to a terminal state**

Poll `/api/admin/ai-name-review-jobs/:jobId` without restarting PM2. Confirm `finished` advances beyond zero, then continue until status is `success` or `error`. A successful batch may contain per-site failures, but the job must reach a terminal state with `finished === total` when status is `success`.

- [ ] **Step 9: Final production verification**

Confirm production HEAD equals `origin/main`, PM2 remains online, local and public HTTP checks return 200, `/current` returns 404 after completion, and the old job `00b8562d` is absent. Record the continuation job totals (`renamed`, `preserved`, `failed`) in the handoff.
