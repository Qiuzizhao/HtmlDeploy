# Class Bulk Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four class-management shortcuts that enable or disable uploads and passwords for every class in one operation.

**Architecture:** Express exposes two admin-only bulk PATCH routes that validate a boolean, update every class, persist once, and return the full list. The existing single-file admin UI calls these routes, replaces its local class state, and re-renders the list.

**Tech Stack:** Node.js, Express, SQLite runtime store, native HTML/CSS/JavaScript, node:test, Supertest

## Global Constraints

- Keep existing per-class controls unchanged.
- Use one server write per bulk operation.
- Disable all bulk controls while a request is running and when there are no classes.
- Require confirmation before changing every class.

---

### Task 1: Bulk class APIs

**Files:**
- Modify: `test/app.test.js`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `PATCH /api/classes/upload-enabled` with `{ uploadEnabled: boolean }` returning `Class[]`.
- Produces: `PATCH /api/classes/password-enabled` with `{ passwordEnabled: boolean }` returning `Class[]`.

- [x] **Step 1: Write failing API tests**

Add tests that create two classes, call each bulk endpoint with `false` and `true`, and assert every returned and subsequently listed class has the requested value. Add rejection checks for unauthenticated and non-boolean requests, plus an empty-list response.

- [x] **Step 2: Verify the tests fail**

Run: `node --test --test-name-pattern="bulk.*class" test/app.test.js`

Expected: FAIL because the routes do not exist.

- [x] **Step 3: Implement minimal routes**

Register fixed bulk routes before `/:id` routes. Reject values whose `typeof` is not `boolean`; map every class to a copy with the requested field and a shared ISO `updatedAt`; persist once with `writeClasses`; return the array.

- [x] **Step 4: Verify API tests pass**

Run: `node --test --test-name-pattern="bulk.*class" test/app.test.js`

Expected: all matching tests pass.

### Task 2: Admin bulk controls

**Files:**
- Modify: `test/app.test.js`
- Modify: `public/admin.html`

**Interfaces:**
- Consumes: both bulk PATCH routes from Task 1.
- Produces: buttons `enableAllClassUploads`, `disableAllClassUploads`, `enableAllClassPasswords`, and `disableAllClassPasswords`; function `setAllClassesState(kind, enabled, button)`.

- [x] **Step 1: Write failing admin HTML test**

Assert the four button IDs and labels exist, the bulk function calls the two fixed endpoints, confirmation is used, button listeners are registered, and empty classes disable the controls.

- [x] **Step 2: Verify the test fails**

Run: `node --test --test-name-pattern="class bulk controls" test/app.test.js`

Expected: FAIL because the controls are absent.

- [x] **Step 3: Implement minimal UI**

Add a compact toolbar above `classList`, cache the four DOM nodes, update their disabled state from `renderClassList`, implement the confirmed PATCH flow, replace `classes` from the response, render, show success or error feedback, and register four click listeners.

- [x] **Step 4: Verify the UI test passes**

Run: `node --test --test-name-pattern="class bulk controls" test/app.test.js`

Expected: PASS.

### Task 3: Full verification

**Files:**
- Verify: `src/app.js`
- Verify: `public/admin.html`
- Verify: `test/app.test.js`

- [x] **Step 1: Run the complete test suite**

Run: `npm test`

Expected: zero failed tests.

- [x] **Step 2: Check formatting and diff scope**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors; only the planned implementation and test files are modified.
