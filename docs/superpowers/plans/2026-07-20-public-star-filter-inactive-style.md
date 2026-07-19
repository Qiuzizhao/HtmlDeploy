# Public Star Filter Inactive Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the background fill from the inactive public star-filter button while preserving hover and active feedback.

**Architecture:** Change only the base `.star-filter-button` background declaration to `transparent`; retain the existing hover/active pale-yellow rule and all JavaScript behavior.

**Tech Stack:** Static HTML/CSS, Node.js built-in test runner, `node:assert` source regression tests.

## Global Constraints

- Inactive background is exactly `transparent`.
- Yellow border and text remain visible when inactive.
- Hover and active states retain `#fef3c7` background and `#f59e0b` border.
- Placement, responsive layout, state logic, labels, and accessibility remain unchanged.
- No new full-suite failure beyond the eight accepted baseline failures.

---

### Task 1: Make the inactive star filter transparent

**Files:**
- Modify: `test/app.test.js:278-315`
- Modify: `public/index.html:325-341`

- [ ] Add a failing assertion requiring `background: transparent` in the base star-filter rule and the existing pale-yellow background in the active rule.
- [ ] Run `node --test --test-name-pattern="public index can search projects and filter starred projects" test/app.test.js` and verify failure.
- [ ] Replace `background: var(--warning-soft)` with `background: transparent` only in `.star-filter-button`.
- [ ] Re-run the focused test, `node --check src/app.js`, and `git diff --check`.
- [ ] Run `npm test` and confirm only the same eight accepted baseline failures.
- [ ] Commit `public/index.html` and `test/app.test.js` with `fix: remove inactive star filter background`.
