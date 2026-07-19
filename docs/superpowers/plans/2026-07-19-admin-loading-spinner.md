# Admin Loading Spinner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every admin loading spinner perfectly circular while allowing loading labels to expand buttons without shrinking their idle layout.

**Architecture:** Retain the existing shared `setButtonLoading(button, isLoading, text)` interface and fix behavior at its two shared boundaries: the admin-wide loading CSS and the helper's temporary width constraint. The public page and non-button message spinners remain unchanged because they do not exhibit the defect.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner, `node:assert` static regression tests.

## Global Constraints

- The ring remains a 14 by 14 pixel content box with a 2 pixel border, an 8 pixel label gap, and the existing 0.72 second rotation.
- All current and future admin buttons using `setButtonLoading` receive the fix through shared code.
- Loading buttons retain their idle width as a minimum and may expand for longer loading content.
- Public-page buttons, non-button message spinners, labels, colors, job behavior, and loading timing remain unchanged.
- The full test suite must introduce no failures beyond the eight previously accepted baseline failures.

---

### Task 1: Protect the shared admin spinner and width behavior

**Files:**
- Modify: `test/app.test.js:517-540`
- Modify: `public/admin.html:66-81`
- Modify: `public/admin.html:1967-1992`

**Interfaces:**
- Consumes: existing `setButtonLoading(button: HTMLButtonElement, isLoading: boolean, text?: string): void` calls throughout `public/admin.html`.
- Produces: the same helper signature, with a temporary `style.minWidth` and `dataset.loadingMinWidthLocked` state; shared `button.is-loading` CSS that cannot compress its ring.

- [ ] **Step 1: Write failing regression assertions**

Update the admin loading test to require centered inline-flex layout and a non-shrinking pseudo-element:

```js
assert.match(
  html,
  /button\.is-loading \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*justify-content: center;/
);
assert.match(
  html,
  /button\.is-loading::before \{[^}]*display: inline-block;[^}]*flex: 0 0 auto;/
);
```

Replace the exact-width assertions in `public admin keeps action button width stable while loading` with minimum-width assertions:

```js
assert.match(html, /const currentWidth = button\.getBoundingClientRect\(\)\.width/);
assert.match(html, /button\.style\.minWidth = `\$\{Math\.ceil\(currentWidth\)\}px`/);
assert.match(html, /button\.style\.removeProperty\('min-width'\)/);
assert.doesNotMatch(html, /button\.style\.width =/);
```

- [ ] **Step 2: Run the focused tests and verify the red state**

Run:

```bash
node --test --test-name-pattern="public admin shows loading feedback|public admin keeps action button width stable" test/app.test.js
```

Expected: both affected assertions fail because admin CSS lacks `display`, alignment, and `flex: 0 0 auto`, while the helper still assigns `style.width`.

- [ ] **Step 3: Implement the minimal shared CSS fix**

Change the admin loading styles to:

```css
button.is-loading {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

button.is-loading::before {
  content: "";
  display: inline-block;
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin-right: 8px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: loading-spin 0.72s linear infinite;
}
```

- [ ] **Step 4: Replace exact-width locking with minimum-width locking**

Update the temporary width portion of `setButtonLoading` to:

```js
if (isLoading && !button.dataset.loadingMinWidthLocked) {
  const currentWidth = button.getBoundingClientRect().width;
  if (currentWidth > 0) {
    button.style.minWidth = `${Math.ceil(currentWidth)}px`;
    button.dataset.loadingMinWidthLocked = 'true';
  }
}

button.disabled = isLoading;
button.classList.toggle('is-loading', isLoading);
button.textContent = isLoading ? text : button.dataset.idleText;

if (!isLoading && button.dataset.loadingMinWidthLocked) {
  button.style.removeProperty('min-width');
  delete button.dataset.loadingMinWidthLocked;
}
```

- [ ] **Step 5: Run the focused tests and verify the green state**

Run:

```bash
node --test --test-name-pattern="public admin shows loading feedback|public admin keeps action button width stable" test/app.test.js
```

Expected: 2 tests pass, 0 fail.

- [ ] **Step 6: Run syntax and whitespace validation**

Run:

```bash
node --check src/app.js
git diff --check
```

Expected: both commands exit 0 with no errors.

- [ ] **Step 7: Commit the implementation**

```bash
git add public/admin.html test/app.test.js
git commit -m "fix: keep admin loading spinners circular"
```

Expected: one commit containing only the shared admin spinner behavior and its regression tests.

---

### Task 2: Verify the repository and production-ready result

**Files:**
- Verify: `public/admin.html`
- Verify: `public/index.html`
- Verify: `test/app.test.js`

**Interfaces:**
- Consumes: Task 1's shared admin CSS and unchanged `setButtonLoading` signature.
- Produces: evidence that all 75 admin loading-state transition calls inherit the fix (76 textual matches including the helper definition), public loading CSS remains protected, and no new test failure is introduced.

- [ ] **Step 1: Verify every admin loading action uses the shared helper**

Run:

```bash
rg -n "setButtonLoading\(" public/admin.html
rg -n "button\.is-loading|flex: 0 0 auto|minWidth" public/admin.html public/index.html
```

Expected: all admin button loading transitions use `setButtonLoading`; both pages protect the spinner with `flex: 0 0 auto`; only the admin helper uses temporary `minWidth` state.

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: the new and existing admin loading tests pass. Any failures are limited to the same eight accepted baseline tests:

```text
public index shows a loading spinner before project cards resolve
public index shows the class name tag on project cards
public index shows total usage count on project cards
public index renders class password entry inside the project grid
public admin uses compact horizontal page padding
public admin exposes AI settings controls
admin AI settings require admin access and mask saved API keys
POST /api/sites/:id/ai-name names and saves a project title
```

- [ ] **Step 3: Review final diff and repository status**

Run:

```bash
git diff HEAD^ --check
git show --stat --oneline HEAD
git status --short --branch
```

Expected: implementation commit contains only `public/admin.html` and `test/app.test.js`; the existing untracked `.DS_Store` remains untouched.
