# Admin Pagination Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the `每页` label and page-size select on one horizontal line without changing other admin forms or pagination behavior.

**Architecture:** Add one selector scoped to `.site-pagination label`, overriding the admin-wide grid label rule only inside the project pagination footer. Protect the layout with a focused static regression test and leave markup, JavaScript, APIs, breakpoints, and forbidden-word pagination unchanged.

**Tech Stack:** Static HTML/CSS, Node.js built-in test runner, `node:assert` source regression tests.

## Global Constraints

- `.site-pagination label` uses horizontal inline flex layout.
- `每页` and its page-size select are vertically centered, separated by exactly 8 pixels, and do not wrap independently.
- Desktop pagination remains one row; at the existing narrow-screen breakpoint only the overall toolbar may retain its current column layout.
- The global form-label grid rule, forbidden-word pagination, markup, select options, JavaScript, APIs, and responsive breakpoints remain unchanged.
- The full suite introduces no failures beyond the eight accepted baseline failures.

---

### Task 1: Keep the page-size label horizontal

**Files:**
- Modify: `test/app.test.js:440-470`
- Modify: `public/admin.html:1044-1062`

**Interfaces:**
- Consumes: existing `.site-pagination` markup containing a semantic `label` and `#adminPageSize` select.
- Produces: a pagination-scoped label layout rule; no JavaScript or DOM interface changes.

- [ ] **Step 1: Write the failing regression test**

Add this test near the existing admin pagination assertions:

```js
test('public admin keeps the page-size label horizontal', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  assert.match(
    html,
    /\.site-pagination label \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*gap: 8px;[^}]*white-space: nowrap;/
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test --test-name-pattern="public admin keeps the page-size label horizontal" test/app.test.js
```

Expected: 1 test fails because `.site-pagination label` does not yet override the global grid label layout.

- [ ] **Step 3: Implement the scoped CSS override**

Add immediately after the `.site-pagination` rule:

```css
.site-pagination label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
```

Do not change the global `label` rule or the existing narrow-screen `.site-pagination` rule.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node --test --test-name-pattern="public admin keeps the page-size label horizontal" test/app.test.js
```

Expected: 1 test passes, 0 fail.

- [ ] **Step 5: Run source validation and the related admin static tests**

Run:

```bash
node --check src/app.js
git diff --check
node --test --test-name-pattern="public admin page exposes project CRUD controls|public admin keeps the page-size label horizontal" test/app.test.js
```

Expected: syntax and whitespace checks exit 0; both related tests pass.

- [ ] **Step 6: Run the full suite and compare the accepted baseline**

Run:

```bash
npm test
```

Expected: the new pagination test passes. Any failures are limited to these same eight accepted baseline tests:

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

- [ ] **Step 7: Commit the implementation**

```bash
git add public/admin.html test/app.test.js
git commit -m "fix: keep admin page-size control horizontal"
```

Expected: one implementation commit modifying only the scoped CSS and its regression test.
