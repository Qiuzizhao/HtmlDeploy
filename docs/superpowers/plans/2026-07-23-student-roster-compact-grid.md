# Student Roster Compact Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the student roster as the same compact card grid used by forbidden words.

**Architecture:** Keep the existing student state, loading, selection, search, import, and delete functions. Change only the CSS presentation and the DOM produced by `renderStudents()`.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js test runner.

## Global Constraints

- Do not change the student API or persisted data.
- Each card contains only checkbox, name, and delete action.
- Preserve single-delete and bulk-delete behavior.

---

### Task 1: Compact student cards

**Files:**
- Modify: `public/admin.html`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: `students`, `selectedStudentIds`, `deleteStudent(student, button)`, `updateStudentWorkspaceState()`.
- Produces: `.student-list` card grid and `.student-row` compact cards.

- [ ] **Step 1: Write the failing test**

Assert that the student list uses the forbidden-word grid model, the renderer appends only checkbox/name/delete, and legacy edit controls are absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='compact cards' test/app.test.js`

Expected: FAIL because the existing renderer still creates name input, class select, creation time, and save button.

- [ ] **Step 3: Write minimal implementation**

Change `.student-list` to an auto-fill grid matching `.forbidden-results`; change `.student-row` to a compact flex card; render a name span and existing delete button after the checkbox.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='compact cards' test/app.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/admin.html test/app.test.js docs/superpowers/specs/2026-07-23-student-roster-compact-grid-design.md docs/superpowers/plans/2026-07-23-student-roster-compact-grid.md
git commit -m "fix: compact student roster cards"
```
