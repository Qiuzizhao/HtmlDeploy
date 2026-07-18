# AI Name Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conservative per-project AI name review that renames only clearly unrelated titles and reports progress in the existing admin AI log.

**Architecture:** A new synchronous admin endpoint reads the existing project snapshot and calls the configured chat-completions model once for structured JSON. The admin UI adds one row action and reuses the existing local AI log/state rendering.

**Tech Stack:** Node.js, Express, SQLite runtime store, vanilla HTML/CSS/JavaScript, `node:test`, Supertest.

## Global Constraints

- Keep the existing `AI命名` action unchanged.
- Rename only when `related` is false and `confidence` is exactly `high`.
- Reuse existing forbidden-word validation and AI configuration.
- Log start, decision, rename, model, and errors in the existing project-management AI log.

---

### Task 1: Service-side AI name review

**Files:**
- Modify: `src/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: `readProjectCodeSnapshot`, `getLlmConfig`, `fetchJsonWithTimeout`, `normalizeSiteTitle`, `findForbiddenWordMatch`.
- Produces: `reviewSiteNameWithLlm({ codeSnapshot, currentTitle, author, llmConfig })` and `POST /api/sites/:id/ai-name-review`.

- [ ] **Step 1: Write failing endpoint tests**

Add tests whose fake LLM returns `{"related":true,"confidence":"high","reason":"标题描述了画布游戏","suggestedTitle":""}` and `{"related":false,"confidence":"high","reason":"标题与代码主题无关","suggestedTitle":"霓虹星跃"}`. Assert the first preserves the title and the second persists the new title.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test --test-name-pattern="AI name review" test/app.test.js`
Expected: FAIL because `/api/sites/:id/ai-name-review` does not exist.

- [ ] **Step 3: Implement structured review and endpoint**

Require one JSON object from the model, parse fenced or plain JSON, normalize `related`, `confidence`, `reason`, and `suggestedTitle`, then set `renamed = review.related === false && review.confidence === 'high'`. Only the renamed branch validates and persists `suggestedTitle`.

- [ ] **Step 4: Run endpoint tests and verify GREEN**

Run: `node --test --test-name-pattern="AI name review" test/app.test.js`
Expected: all AI name review tests pass.

### Task 2: Admin row action and logging

**Files:**
- Modify: `public/admin.html`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: `addAiOptimizeLog`, `getSiteLogName`, `replaceSiteInState`, `refreshVisibleRows`, `/api/sites/:id/ai-name-review`.
- Produces: `reviewSiteNameWithAi(site, button)`, `runningAiNameReviews`, and the `AI命名审核` row button.

- [ ] **Step 1: Write failing page contract test**

Assert the admin HTML contains `AI命名审核`, `reviewSiteNameWithAi`, `runningAiNameReviews`, the review endpoint, and log messages for both related and renamed outcomes.

- [ ] **Step 2: Run the page test and verify RED**

Run: `node --test --test-name-pattern="AI name review action" test/app.test.js`
Expected: FAIL because the action is absent.

- [ ] **Step 3: Implement the action**

Add a per-row button with `审核中...` state. Log start, preserve/rename conclusion, model, and failure; update local site state only from the endpoint response.

- [ ] **Step 4: Run related tests and verify GREEN**

Run: `node --test --test-name-pattern="(AI name review|AI project actions)" test/app.test.js`
Expected: all selected tests pass.

### Task 3: Regression, delivery, and deployment

**Files:**
- Modify: none
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: completed backend and frontend behavior.
- Produces: verified production deployment.

- [ ] **Step 1: Run syntax and focused verification**

Run inline-script parsing for `public/admin.html`, `node --check src/app.js`, `git diff --check`, and all AI naming tests.

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: no failures beyond the repository's eight known baseline failures.

- [ ] **Step 3: Commit and push**

Run: `git add ... && git commit -m "feat: add AI name review" && git push origin main`.

- [ ] **Step 4: Deploy and verify**

Pull `main` on `/home/ubuntu/HtmlDeploy`, restart `html-deploy` with PM2, verify the deployed commit, clean status, localhost HTTP 200, and public HTTP 200.
