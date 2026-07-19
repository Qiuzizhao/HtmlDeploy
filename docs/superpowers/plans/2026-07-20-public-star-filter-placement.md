# Public Star Filter Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place the existing `星标` filter immediately to the right of `全部作品` on every screen size.

**Architecture:** Reuse the existing starred-filter DOM element and event listener. `renderClasses()` will place it beside the dynamically created all-projects tab in a dedicated non-wrapping flex row before rendering class groups; the search row will retain only search and order controls.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner, `node:assert` static regression tests.

## Global Constraints

- `全部作品` is first and `星标` is immediately to its right.
- Both controls remain on one horizontal line on desktop and narrow screens.
- Reuse the existing `#starredFilterButton`; do not duplicate it or its event listener.
- Preserve star-filter state, active styling, labels, accessibility attributes, and behavior.
- Search, ordering, class groups, refresh placement, APIs, and project cards remain unchanged.
- The full suite introduces no failures beyond the eight accepted baseline failures.

---

### Task 1: Move the existing star filter beside all projects

**Files:**
- Modify: `test/app.test.js:250-305`
- Modify: `public/index.html:210-235`
- Modify: `public/index.html:975-986`
- Modify: `public/index.html:1083-1094`
- Modify: `public/index.html:1948-1962`

**Interfaces:**
- Consumes: existing `starredFilterButton: HTMLButtonElement`, `renderClasses()`, and `starredOnly` click behavior.
- Produces: `.primary-class-tab-row` containing `allButton` followed by `starredFilterButton`; no event or state interface changes.

- [ ] **Step 1: Write failing placement and layout assertions**

Add or update assertions to require:

```js
assert.match(html, /const primaryRow = document\.createElement\('div'\)/);
assert.match(html, /primaryRow\.className = 'primary-class-tab-row'/);
assert.match(html, /primaryRow\.append\(allButton, starredFilterButton\)/);
assert.ok(html.indexOf('primaryRow.append(allButton, starredFilterButton)') < html.indexOf('classGroups.forEach'));
assert.match(html, /\.primary-class-tab-row \{[^}]*display: flex;[^}]*gap: 8px;[^}]*flex-wrap: nowrap;/);
assert.doesNotMatch(
  html,
  /<div class="project-filter-row">[\s\S]*?id="starredFilterButton"[\s\S]*?<\/div>/
);
```

Keep the existing assertion that there is exactly one button with
`id="starredFilterButton"` and its current listener/state assertions.

- [ ] **Step 2: Run focused tests and confirm they fail for missing placement**

Run:

```bash
node --test --test-name-pattern="public index renders an all tab before class buttons|public index can search projects and filter starred projects" test/app.test.js
```

Expected: placement/layout assertions fail because the star button is still in
the project filter row and no primary row exists.

- [ ] **Step 3: Add the primary-row CSS**

Add near `.class-tabs`:

```css
.primary-class-tab-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}
```

At the narrow breakpoint, replace the full-width star-filter rule with:

```css
.primary-class-tab-row .star-filter-button {
  width: auto;
}
```

- [ ] **Step 4: Move the existing button and update dynamic rendering**

Move the existing star-filter button in static markup outside
`.project-filter-row`, keeping exactly one instance. In `renderClasses()`, after
building `allButton`, add:

```js
const primaryRow = document.createElement('div');
primaryRow.className = 'primary-class-tab-row';
primaryRow.append(allButton, starredFilterButton);
classTabs.append(primaryRow);
```

Remove the old `classTabs.append(allButton)` call. Do not change the star button
listener or state logic.

- [ ] **Step 5: Run focused and source validation**

Run:

```bash
node --test --test-name-pattern="public index renders an all tab before class buttons|public index can search projects and filter starred projects" test/app.test.js
node --check src/app.js
git diff --check
```

Expected: 2 tests pass; checks exit 0.

- [ ] **Step 6: Run the full suite and compare baseline**

Run `npm test`.

Expected: no new failures beyond the same eight accepted baseline failures.

- [ ] **Step 7: Commit**

```bash
git add public/index.html test/app.test.js
git commit -m "fix: place star filter beside all projects"
```
