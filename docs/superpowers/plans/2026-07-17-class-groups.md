# Class Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent class groups managed in the admin and rendered on the public class navigation.

**Architecture:** SQLite stores ordered group records and a group ID on each class. Express exposes group CRUD/order APIs and extends class ordering for cross-group moves; the native admin and public pages consume the same ordered data.

**Tech Stack:** Node.js, Express, better-sqlite3, native HTML/CSS/JavaScript, node:test, Supertest

## Global Constraints

- Existing classes migrate to the system “未分组” group without data loss.
- “全部作品” remains first and outside all groups.
- Empty groups are hidden on the public page.
- Deleting a group moves its classes to “未分组”.

---

### Task 1: Persistent group model and APIs

**Files:** `src/db/schema.js`, `src/db/runtime-store.js`, `src/app.js`, `test/app.test.js`

- [ ] Add failing tests for group CRUD/order, deletion fallback, and cross-group class order.
- [ ] Run targeted tests and confirm failures are caused by missing group behavior.
- [ ] Add `class_groups`, `classes.group_id`, runtime-store methods, API validation and routes.
- [ ] Run targeted tests and confirm all group API tests pass.

### Task 2: Admin group management

**Files:** `public/admin.html`, `test/app.test.js`

- [ ] Add a failing HTML behavior test for group controls, group selection, rendering and drag persistence.
- [ ] Add the group toolbar, grouped class containers, CRUD handlers and cross-group drag handling.
- [ ] Run the admin group test and confirm it passes.

### Task 3: Public grouped navigation

**Files:** `public/index.html`, `test/app.test.js`

- [ ] Add a failing test for group loading, headings, “未分组”, and “全部作品” ordering.
- [ ] Load public groups and render non-empty grouped class sections.
- [ ] Run the public grouping test and confirm it passes.

### Task 4: Verification and deployment

**Files:** all modified files

- [ ] Run targeted group tests, `npm test`, syntax checks and `git diff --check`.
- [ ] Commit and push `main`.
- [ ] Back up production runtime data, pull, restart PM2, and verify schema and public HTTP health.
