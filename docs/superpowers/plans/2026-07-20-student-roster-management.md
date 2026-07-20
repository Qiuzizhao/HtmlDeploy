# Student Roster Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only student roster that stores names by class and supports manual entry, Excel/CSV/text import, search, rename, transfer, and deletion.

**Architecture:** Add a normalized `students` SQLite table and focused repository methods, expose admin-protected JSON endpoints from the existing Express app, and add a lazily loaded “学生名单” workspace to the existing single-file admin UI. Parse files in the browser for preview, then submit raw names to the server, where normalization, validation, duplicate detection, and database constraints run again.

**Tech Stack:** Node.js, Express 4, better-sqlite3, node:test, Supertest, browser JavaScript, locally hosted SheetJS browser bundle.

## Global Constraints

- This release implements roster management only; it must not implement student login or change the current project author/upload flow.
- A student record stores only name and class ownership; no student number, password, or additional personal data.
- Names are trimmed, consecutive whitespace is collapsed, empty names are rejected, and the maximum name length is 40 characters.
- Names are unique within one class; different classes may contain the same name.
- Every student API requires the existing `requireAdmin` middleware, and no public student endpoint may be added.
- One import request accepts at most 2,000 entries.
- Deleting a class that still contains students must be rejected.
- Excel parsing must use a locally served asset and must not depend on a CDN.
- Existing `.DS_Store` remains untracked and untouched.

---

### Task 1: Student persistence and repository

**Files:**
- Modify: `src/db/schema.js`
- Modify: `src/db/runtime-store.js`
- Create: `src/db/repositories/students.js`
- Modify: `src/db/repositories/index.js`
- Test: `test/app.test.js`

**Interfaces:**
- Produces: `normalizeStudentName(value): string`
- Produces: `RuntimeStore.listStudents({ classId, query }): Student[]`
- Produces: `RuntimeStore.getStudent(id): Student | null`
- Produces: `RuntimeStore.createStudent(student): Student`
- Produces: `RuntimeStore.updateStudent(id, changes): Student | null`
- Produces: `RuntimeStore.importStudents({ classId, names, idGenerator }): ImportResult`
- Produces: `RuntimeStore.deleteStudents(ids): number`
- Produces: `RuntimeStore.countStudentsByClass(classId): number`
- Student shape: `{ id, classId, name, createdAt, updatedAt }`
- ImportResult shape: `{ added, internalDuplicates, existing, invalid, students }`

- [ ] **Step 1: Write failing persistence tests**

Add a test that creates two classes, inserts normalized students, verifies same-class uniqueness and cross-class duplicate names, searches by class/name, imports mixed names, transfers a student, and deletes selected IDs:

```js
test('student repository stores normalized names by class and imports atomically', async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'html-deploy-students-'));
  const store = new RuntimeStore({ dbFile: path.join(dataDir, 'app.db'), dataDir });
  store.upsertClass({ id: 'class-a', name: '一班' });
  store.upsertClass({ id: 'class-b', name: '二班' });

  const first = store.createStudent({ id: 'student-a', classId: 'class-a', name: '  张   三  ' });
  assert.equal(first.name, '张 三');
  store.createStudent({ id: 'student-b', classId: 'class-b', name: '张 三' });
  assert.throws(
    () => store.createStudent({ id: 'student-c', classId: 'class-a', name: '张 三' }),
    (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );

  const imported = store.importStudents({
    classId: 'class-a',
    names: ['李四', '李四', '张 三', '', '王'.repeat(41), '王五'],
    idGenerator: (() => { const ids = ['student-d', 'student-e']; return () => ids.shift(); })()
  });
  assert.deepEqual(
    { added: imported.added, internalDuplicates: imported.internalDuplicates, existing: imported.existing, invalid: imported.invalid },
    { added: 2, internalDuplicates: 1, existing: 1, invalid: 2 }
  );
  assert.deepEqual(store.listStudents({ classId: 'class-a', query: '李' }).map((item) => item.name), ['李四']);
  assert.equal(store.countStudentsByClass('class-a'), 3);

  const moved = store.updateStudent('student-d', { classId: 'class-b', name: '李四' });
  assert.equal(moved.classId, 'class-b');
  assert.equal(store.deleteStudents(['student-a', 'student-e']), 2);
});
```

- [ ] **Step 2: Run the persistence test and verify RED**

Run: `node --test --test-name-pattern="student repository stores normalized names" test/app.test.js`

Expected: FAIL because the student table and store methods do not exist.

- [ ] **Step 3: Add the SQLite schema**

Bump `SCHEMA_VERSION` from `2` to `3`, add the table and indexes in `applySchema()`:

```sql
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (class_id) REFERENCES classes(id),
  UNIQUE (class_id, name)
);

CREATE INDEX IF NOT EXISTS idx_students_class_name ON students(class_id, name);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);
```

- [ ] **Step 4: Implement store normalization and CRUD**

Add `normalizeStudentName`, `rowToStudent`, and the listed `RuntimeStore` methods. Use prepared statements for reads and mutations and a `better-sqlite3` transaction for imports. Sort list results by `name COLLATE NOCASE`, then `created_at`, then `id`. Validate class existence in `createStudent`, `updateStudent`, and `importStudents`; throw an error with `code = 'CLASS_NOT_FOUND'` when it does not exist. Invalid import entries increment `invalid`; exact duplicates after normalization increment `internalDuplicates`; existing `(class_id, name)` pairs increment `existing`.

Core normalization:

```js
function normalizeStudentName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}
```

Return newly read database rows after create/update, and export `normalizeStudentName` for request validation tests.

- [ ] **Step 5: Add and register the repository**

Create `src/db/repositories/students.js`:

```js
function createStudentsRepository(store) {
  return {
    list(filters) { return store.listStudents(filters); },
    get(id) { return store.getStudent(id); },
    create(student) { return store.createStudent(student); },
    update(id, changes) { return store.updateStudent(id, changes); },
    importMany(input) { return store.importStudents(input); },
    deleteMany(ids) { return store.deleteStudents(ids); },
    countByClass(classId) { return store.countStudentsByClass(classId); }
  };
}

module.exports = { createStudentsRepository };
```

Register it as `students` in `createRepositories(store)`.

- [ ] **Step 6: Run persistence tests and commit**

Run: `node --test --test-name-pattern="student repository stores normalized names" test/app.test.js`

Expected: PASS.

Run: `node --check src/db/runtime-store.js && git diff --check`

Commit:

```bash
git add src/db/schema.js src/db/runtime-store.js src/db/repositories/students.js src/db/repositories/index.js test/app.test.js
git commit -m "feat: add student roster persistence"
```

---

### Task 2: Admin student API and class deletion guard

**Files:**
- Modify: `src/app.js`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: all `RuntimeStore` student methods from Task 1.
- Produces: `GET /api/admin/students?classId=&q=` returning `{ students, total }`.
- Produces: `POST /api/admin/students` accepting `{ classId, name }`.
- Produces: `POST /api/admin/students/import` accepting `{ classId, names }`.
- Produces: `PUT /api/admin/students/:id` accepting `{ classId, name }`.
- Produces: `DELETE /api/admin/students/:id`.
- Produces: `POST /api/admin/students/bulk-delete` accepting `{ ids }`.

- [ ] **Step 1: Write failing API tests**

Add one authorization test and one complete management test:

```js
test('student roster APIs require admin access', async () => {
  const { app } = await makeTestApp();
  await request(app).get('/api/admin/students?classId=class-a').expect(401);
  await request(app).post('/api/admin/students').send({ classId: 'class-a', name: '张三' }).expect(401);
  await request(app).post('/api/admin/students/import').send({ classId: 'class-a', names: ['张三'] }).expect(401);
  await request(app).put('/api/admin/students/student-a').send({ name: '李四' }).expect(401);
  await request(app).delete('/api/admin/students/student-a').expect(401);
  await request(app).post('/api/admin/students/bulk-delete').send({ ids: ['student-a'] }).expect(401);
});

test('admin can manage and import students while protected classes cannot be deleted', async () => {
  const ids = ['class-a', 'class-b', 'student-a', 'student-b', 'student-c'];
  const { app } = await makeTestApp({ idGenerator: () => ids.shift() });
  const admin = request.agent(app);
  await admin.post('/admin-login').type('form').send({ password: 'qqqyyy' }).expect(303);
  await admin.post('/api/classes').send({ name: '一班' }).expect(201);
  await admin.post('/api/classes').send({ name: '二班' }).expect(201);

  const created = await admin.post('/api/admin/students').send({ classId: 'class-a', name: ' 张三 ' }).expect(201);
  assert.equal(created.body.name, '张三');
  await admin.post('/api/admin/students').send({ classId: 'class-a', name: '张三' }).expect(409);

  const imported = await admin
    .post('/api/admin/students/import')
    .send({ classId: 'class-a', names: ['李四', '李四', '张三', '', '王五'] })
    .expect(201);
  assert.deepEqual(
    { added: imported.body.added, internalDuplicates: imported.body.internalDuplicates, existing: imported.body.existing, invalid: imported.body.invalid },
    { added: 2, internalDuplicates: 1, existing: 1, invalid: 1 }
  );

  const listed = await admin.get('/api/admin/students?classId=class-a&q=李').expect(200);
  assert.deepEqual(listed.body.students.map((item) => item.name), ['李四']);
  await admin.put(`/api/admin/students/${created.body.id}`).send({ classId: 'class-b', name: '张三' }).expect(200);
  await admin.delete('/api/classes/class-a').expect(400);
  await admin.post('/api/admin/students/bulk-delete').send({ ids: imported.body.students.map((item) => item.id) }).expect(200);
  await admin.delete('/api/classes/class-a').expect(204);
});
```

Add validation assertions for missing class, absent student, empty/41-character names, duplicate transfer, non-array import, more than 2,000 names, and unknown delete IDs.

- [ ] **Step 2: Run API tests and verify RED**

Run: `node --test --test-name-pattern="student roster APIs|admin can manage and import students" test/app.test.js`

Expected: FAIL with `404` for the unimplemented routes.

- [ ] **Step 3: Add request validation and error mapping**

In `src/app.js`, add helpers that use `normalizeStudentName` and produce the agreed statuses:

```js
function validateStudentName(value) {
  const name = normalizeStudentName(value);
  if (!name || name.length > 40) {
    return { error: '学生姓名必须为 1 到 40 个字符' };
  }
  return { name };
}

function isStudentNameConflict(error) {
  return error && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}
```

Use `400` for malformed input, `404` for missing classes/students, and `409` for same-class duplicate names.

- [ ] **Step 4: Implement the six protected routes**

Resolve the runtime store with `getRuntimeStoreForFile(classesFile)`. Generate IDs using the existing injected `idGenerator`. For import, reject arrays longer than 2,000 before calling `store.importStudents`. Return:

```js
return res.status(201).json({
  added: result.added,
  internalDuplicates: result.internalDuplicates,
  existing: result.existing,
  invalid: result.invalid,
  students: result.students
});
```

Bulk delete must normalize IDs with `String(id).trim()`, remove empty values, cap the request at 2,000 IDs, and return `{ removed }`.

- [ ] **Step 5: Protect class deletion**

Before deleting a class, call `getRuntimeStoreForFile(classesFile).countStudentsByClass(id)`. If positive, return:

```js
return res.status(400).json({ error: '班级下还有学生，不能删除，请先删除或转移学生' });
```

Keep the existing active-project guard unchanged.

- [ ] **Step 6: Run API tests and commit**

Run: `node --test --test-name-pattern="student roster APIs|admin can manage and import students|admin cannot delete a class" test/app.test.js`

Expected: PASS.

Run: `node --check src/app.js && git diff --check`

Commit:

```bash
git add src/app.js test/app.test.js
git commit -m "feat: add admin student roster API"
```

---

### Task 3: Student roster admin workspace and local Excel parser

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `public/vendor/xlsx.full.min.js`
- Modify: `public/admin.html`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: admin student endpoints from Task 2.
- Produces: admin view target `students` and `[data-admin-view="students"]` workspace.
- Produces DOM IDs: `studentClassFilter`, `studentSearchInput`, `studentNameInput`, `addStudentForm`, `studentImportFile`, `studentImportText`, `parseStudentImport`, `studentImportPreview`, `confirmStudentImport`, `studentList`, `studentCount`, `deleteSelectedStudents`, `studentMessage`.
- Produces browser parser `parseStudentImportSource(): Promise<string[]>`.

- [ ] **Step 1: Write failing admin markup tests**

Add assertions for the navigation placement, workspace, controls, local SheetJS script, lazy loader, and API calls:

```js
test('public admin exposes student roster management and local file import', async () => {
  const html = await fsp.readFile(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  assert.ok(html.indexOf('data-view-target="classes"') < html.indexOf('data-view-target="students"'));
  assert.match(html, /data-admin-view="students"/);
  assert.match(html, /id="studentClassFilter"/);
  assert.match(html, /id="studentSearchInput"/);
  assert.match(html, /id="studentImportFile"[^>]+accept="\.xlsx,\.csv/);
  assert.match(html, /id="studentImportText"/);
  assert.match(html, /id="studentImportPreview"/);
  assert.match(html, /src="\/vendor\/xlsx\.full\.min\.js"/);
  assert.match(html, /fetch\(`\/api\/admin\/students\?\$\{params\.toString\(\)\}`\)/);
  assert.match(html, /viewName === 'students'/);
  assert.doesNotMatch(html, /https?:\/\/[^"']*xlsx/i);
});
```

- [ ] **Step 2: Run the markup test and verify RED**

Run: `node --test --test-name-pattern="public admin exposes student roster" test/app.test.js`

Expected: FAIL because the workspace does not exist.

- [ ] **Step 3: Install and vendor SheetJS**

Run:

```bash
npm install xlsx@0.18.5 --save
mkdir -p public/vendor
cp node_modules/xlsx/dist/xlsx.full.min.js public/vendor/xlsx.full.min.js
```

Add `<script src="/vendor/xlsx.full.min.js"></script>` immediately before the admin page's inline application script. The browser asset is committed so production imports work without a CDN or build step.

- [ ] **Step 4: Add workspace markup and scoped styles**

Place the “学生名单” nav button immediately after “班级管理”. Add a responsive workspace with two panels: roster management and bulk import. Reuse existing `.panel`, `.button`, `.primary-button`, `.danger-button`, `.message`, and form styles. Add only student-specific grid/list/preview styles, including narrow-screen rules that stack controls without horizontal overflow.

Use this workspace structure:

```html
<section data-admin-view="students" class="workspace">
  <div class="panel">
    <div class="panel-head">
      <h2 class="panel-title">学生名单</h2>
      <div class="message" id="studentMessage"></div>
    </div>
    <div class="student-toolbar">
      <select id="studentClassFilter" aria-label="选择班级"></select>
      <input id="studentSearchInput" type="search" maxlength="40" placeholder="搜索学生姓名">
      <span id="studentCount">0 名学生</span>
    </div>
    <form id="addStudentForm" class="student-add-form">
      <input id="studentNameInput" maxlength="40" placeholder="输入学生姓名" required>
      <button class="primary-button" type="submit">新增学生</button>
    </form>
    <div class="student-list-actions">
      <button class="danger-button" id="deleteSelectedStudents" type="button" disabled>删除选中</button>
    </div>
    <div id="studentList" class="student-list"></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h2 class="panel-title">批量导入</h2></div>
    <input id="studentImportFile" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
    <textarea id="studentImportText" placeholder="也可以粘贴名单，每行一个姓名"></textarea>
    <button class="button" id="parseStudentImport" type="button">解析名单</button>
    <div id="studentImportPreview" class="student-import-preview"></div>
    <button class="primary-button" id="confirmStudentImport" type="button" disabled>确认导入</button>
  </div>
</section>
```

- [ ] **Step 5: Add DOM state and lazy loading**

Add `students`, `selectedStudentIds`, and `pendingStudentImportNames` state. Add `students: '学生名单'` to `viewTitles`. In `loadCurrentViewData`, ensure classes are available, populate the student class selector, and call `loadStudents()` only when the students workspace is first opened.

- [ ] **Step 6: Implement file and text parsing**

Use `File.arrayBuffer()` and `XLSX.read()` for `.xlsx`; use `File.text()` for CSV; prefer a `姓名` header and otherwise read the first non-empty column. Text input splits on newlines. The returned array remains raw enough for the preview to count invalid rows, but trim display values.

Core Excel extraction:

```js
function namesFromRows(rows) {
  if (!rows.length) return [];
  const headerIndex = rows[0].findIndex((cell) => String(cell || '').trim() === '姓名');
  const columnIndex = headerIndex >= 0
    ? headerIndex
    : Math.max(0, rows.find((row) => row.some((cell) => String(cell || '').trim()))?.findIndex((cell) => String(cell || '').trim()) || 0);
  const startIndex = headerIndex >= 0 ? 1 : 0;
  return rows.slice(startIndex).map((row) => String(row[columnIndex] ?? ''));
}
```

For CSV, call `XLSX.read(text, { type: 'string' })` so quoted fields and encodings handled by the browser are parsed consistently. If both file and pasted text are present, combine both sources and report their combined preview.

- [ ] **Step 7: Run markup tests and commit**

Run: `node --test --test-name-pattern="public admin exposes student roster" test/app.test.js`

Expected: PASS.

Run: `git diff --check`

Commit:

```bash
git add package.json package-lock.json public/vendor/xlsx.full.min.js public/admin.html test/app.test.js
git commit -m "feat: add student roster admin workspace"
```

---

### Task 4: Complete roster interactions

**Files:**
- Modify: `public/admin.html`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: workspace DOM from Task 3 and all APIs from Task 2.
- Produces: `loadStudents`, `renderStudents`, `createStudent`, `updateStudent`, `deleteStudent`, `deleteSelectedStudents`, `previewStudentImport`, and `importStudents` browser functions.

- [ ] **Step 1: Extend the failing UI behavior test**

Add assertions for create, update, delete, bulk-delete, import, conflict display, confirmation, class switching, search debounce, and button loading:

```js
assert.match(html, /async function loadStudents/);
assert.match(html, /method: 'PUT'/);
assert.match(html, /method: 'DELETE'/);
assert.match(html, /\/api\/admin\/students\/bulk-delete/);
assert.match(html, /\/api\/admin\/students\/import/);
assert.match(html, /confirm\(`确定删除学生/);
assert.match(html, /confirm\(`确定删除选中的 \$\{selectedStudentIds\.size\} 名学生吗/);
assert.match(html, /setButtonLoading\(confirmStudentImport/);
assert.match(html, /studentClassFilter\.addEventListener\('change'/);
assert.match(html, /studentSearchInput\.addEventListener\('input'/);
```

- [ ] **Step 2: Run the behavior test and verify RED**

Run: `node --test --test-name-pattern="public admin exposes student roster" test/app.test.js`

Expected: FAIL on the missing interaction functions.

- [ ] **Step 3: Implement loading, searching, and rendering**

`loadStudents()` sends the selected `classId` and current search query, renders a loading placeholder, then replaces it with rows. Each row contains a checkbox, editable name input, target-class select, created time, save button, and delete button. Disable the entire roster and import confirmation when no class is selected.

Use a 250 ms search debounce. Preserve the selected class while switching views and after mutations. Clear selected IDs that are no longer in the loaded result.

- [ ] **Step 4: Implement manual CRUD and batch deletion**

POST manual additions, PUT edited name/class, DELETE single records, and POST selected IDs for bulk deletion. Show server `error` text for `400`, `404`, and `409` responses. Require browser confirmation before single and bulk deletion. Use the existing `setButtonLoading` helper for every mutation button and always restore it in `finally`.

- [ ] **Step 5: Implement import preview and confirmation**

After parsing, normalize names in the browser only for a useful preview. Show valid rows, within-file duplicate count, invalid count, and a scrollable name sample. Do not claim how many names already exist until the server responds. On confirmation, send the raw parsed names plus selected class ID, then display:

```js
setMessage(
  studentMessage,
  `导入完成：新增 ${result.added} 人，名单内重复 ${result.internalDuplicates} 人，已有 ${result.existing} 人，无效 ${result.invalid} 行`
);
```

Clear the file, pasted text, preview, and pending array after success, then reload the roster.

- [ ] **Step 6: Wire events and reload behavior**

Wire form submit, class selection, debounced search, file/text parsing, import confirmation, and bulk delete. When `loadClasses()` refreshes class data, repopulate `studentClassFilter` while keeping a valid selection. If the current class was deleted, select the first available class or an empty state.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test --test-name-pattern="student roster|public admin exposes student roster|admin can manage and import students" test/app.test.js`

Expected: PASS.

Run: `git diff --check`

Commit:

```bash
git add public/admin.html test/app.test.js
git commit -m "feat: complete student roster management"
```

---

### Task 5: Full verification and production rollout

**Files:**
- Verify: `src/db/schema.js`
- Verify: `src/db/runtime-store.js`
- Verify: `src/app.js`
- Verify: `public/admin.html`
- Verify: `test/app.test.js`

**Interfaces:**
- Consumes: complete feature from Tasks 1–4.
- Produces: verified `main` commit and a healthy production deployment.

- [ ] **Step 1: Run syntax and focused verification**

Run:

```bash
node --check src/app.js
node --check src/db/runtime-store.js
node --test --test-name-pattern="student roster|student repository|admin can manage and import students|public admin exposes student roster" test/app.test.js
git diff --check
```

Expected: all focused tests PASS and all checks exit `0`.

- [ ] **Step 2: Run the complete regression suite**

Run: `npm test`

Expected: no new failures beyond this accepted pre-existing baseline; compare names, not only counts:

- `public index shows a loading spinner before project cards resolve`
- `public index shows the class name tag on project cards`
- `public index shows total usage count on project cards`
- `public index renders class password entry inside the project grid`
- `public admin uses compact horizontal page padding`
- `public admin exposes AI settings controls`
- `admin AI settings require admin access and mask saved API keys`
- `POST /api/sites/:id/ai-name names and saves a project title`

- [ ] **Step 3: Inspect final scope**

Run:

```bash
git status --short
git diff HEAD~4 --stat
git log -5 --oneline
```

Expected: only the planned files changed; `.DS_Store` remains untracked; no public student API, student login, or author autofill code exists.

- [ ] **Step 4: Push `main`**

Run:

```bash
git fetch origin main
git rev-list --left-right --count HEAD...origin/main
git push origin main
```

Expected: remote has no unseen commits before push, and push succeeds.

- [ ] **Step 5: Deploy and verify production**

On the configured production host, run:

```bash
cd /home/ubuntu/HtmlDeploy
git pull --ff-only origin main
npm install --omit=dev
node --check src/app.js
pm2 restart html-deploy --update-env
pm2 save
```

After the normal startup window, verify localhost and `https://htmldeploy.qiuzizhao.com/` return `200`, `/admin.html` contains “学生名单” after authenticated access, and an unauthenticated `GET /api/admin/students?classId=test` returns `401`. Confirm production `HEAD` equals `origin/main` and the worktree is clean.
