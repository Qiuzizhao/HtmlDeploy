# Student Class Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add passwordless class roster login with server-enforced student upload identity and teacher-controlled browsing scope.

**Architecture:** Extend class persistence with portal configuration and a random token. Create signed student sessions resolved on every protected read/upload, add a roster landing page, and adapt the existing public index and admin roster UI to consume the new APIs.

**Tech Stack:** Node.js, Express, SQLite, static HTML/CSS/JavaScript, Node test runner, Supertest.

## Global Constraints

- Student login remains one click with no password.
- Server, not browser fields, is authoritative for student author and class.
- Existing public/admin behavior remains compatible when no student session exists.
- Portal links are random and resettable.

---

### Task 1: Persist class portal settings

**Files:**
- Modify: `src/db/schema.js`
- Modify: `src/db/runtime-store.js`
- Test: `test/app.test.js`

- [ ] Add failing migration and round-trip tests for portal fields.
- [ ] Run focused database tests and confirm failure.
- [ ] Add schema version 4 columns and class normalization/upsert mapping.
- [ ] Run focused tests and confirm pass.

### Task 2: Add portal and student-session APIs

**Files:**
- Modify: `src/app.js`
- Test: `test/app.test.js`

- [ ] Add failing tests for admin configuration, roster fetch, login/session/logout, invalidation and access scope.
- [ ] Run focused API tests and confirm failure.
- [ ] Implement signed student cookies, portal APIs and student-aware read authorization.
- [ ] Run focused tests and confirm pass.

### Task 3: Enforce upload identity

**Files:**
- Modify: `src/app.js`
- Test: `test/app.test.js`

- [ ] Add failing tests proving forged author/class values are overridden.
- [ ] Run focused upload tests and confirm failure.
- [ ] Resolve student identity in upload and AI naming routes and enforce the class upload switch.
- [ ] Run focused tests and confirm pass.

### Task 4: Build the student roster page

**Files:**
- Create: `public/student-class.html`
- Modify: `src/app.js`
- Test: `test/app.test.js`

- [ ] Add failing structure and route tests.
- [ ] Implement responsive name bubbles, empty/error states and click login.
- [ ] Run focused tests and confirm pass.

### Task 5: Add admin controls and student identity UI

**Files:**
- Modify: `public/admin.html`
- Modify: `public/index.html`
- Test: `test/app.test.js`

- [ ] Add failing UI structure/behavior tests.
- [ ] Add portal controls to the selected-class student toolbar.
- [ ] Load student session before public data, restrict class tabs, lock upload labels and add logout.
- [ ] Run focused UI tests and confirm pass.

### Task 6: Verify and deploy

**Files:**
- Verify all modified files.

- [ ] Run focused portal, upload, database and UI tests.
- [ ] Run syntax and whitespace checks.
- [ ] Commit, push, deploy, and verify production schema, process and public endpoints.
