// teacher-classes-remove — the hand-written teacher-classes scenario for Remove class (bd-ql2j3p): Class detail's
// "Remove class" asks first in a tray; Keep leaves the class, Remove takes it off her list and returns to My Classes.
// Joined to the generated teacher-classes driver by .claude/qa/web/gen_page_features.py (EXTRA), so spec and driver
// still come from one place.
//
// The class removed is one the scenario ADDS for her first, through the app's own POST /api/portal/classes, in a
// grade·section·shift she does not already have — so the seeded classes the other scenarios need are never touched.
// If the scenario stops part-way, the clean-up removes that class through the same route the button calls.
'use strict';
const { expect, asRole, visit, watch } = require('../lib.cjs');

const HOME = '/portal/teacher/classes';
const classPath = (id) => HOME + '/class/' + encodeURIComponent(id);
// The demo teacher may read the app in either language; the words are the copy deck's (teacher/classes/copy.ts).
const REMOVE_CLASS = /^(Remove class|کلاس ہٹائیں)$/;
const KEEP = /^(Keep|رہنے دیں)$/;
const REMOVE = /^(Remove|ہٹائیں)$/;

// The browser's own session calls the portal API, exactly as the app does.
async function api(page, ctx, method, path, body) {
  const url = ctx.baseUrl + '/api/portal' + path;
  const r = method === 'GET' ? await page.request.get(url)
    : method === 'DELETE' ? await page.request.delete(url)
      : await page.request.post(url, { data: body });
  let json = null;
  try { json = await r.json(); } catch (_) { /* not JSON */ }
  return { status: r.status(), json };
}

const mine = async (page, ctx) => {
  const r = await api(page, ctx, 'GET', '/classes');
  expect(r.status === 200 && r.json && r.json.success, 'GET /classes failed: ' + r.status);
  return r.json;
};

// A grade·section·shift she is not on, from the options the add form offers.
function freshCombo(list) {
  const taken = new Set(list.classes.map((c) => [c.gradeCode, c.section || '', c.shiftCode].join('|')));
  for (const shift of [...list.shifts].reverse()) {
    for (const section of [...list.sections].reverse()) {
      for (const grade of list.grades) {
        if (!taken.has([grade.code, section.code, shift.code].join('|'))) {
          return { gradeCode: grade.code, section: section.code, shiftCode: shift.code };
        }
      }
    }
  }
  return null;
}

module.exports = [
  { id: 'TK03', title: 'Teacher app v2: Remove class asks first; Keep leaves it, Remove takes it off My Classes', run: async (page, ctx) => {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const before = await mine(page, ctx);
    expect(before.canAdd, 'the demo teacher cannot add a class (no school or no academic session on this run)');
    const combo = freshCombo(before);
    expect(combo, 'no grade·section·shift left that the demo teacher is not already on');

    const added = await api(page, ctx, 'POST', '/classes', { ...combo, subjectCodes: [], isClassTeacher: false });
    expect(added.status === 201 && added.json.success, 'adding the throwaway class failed: ' + added.status + ' ' + JSON.stringify(added.json));
    const classId = added.json.class.classId;
    let removed = false;
    try {
      const count = (await mine(page, ctx)).classes.length;
      expect(count === before.classes.length + 1, 'the added class is not on her list');

      await visit(page, ctx, classPath(classId), {});
      const w = watch(page);

      // Keep: the tray closes and the class is still hers.
      await page.getByRole('button', { name: REMOVE_CLASS }).click();
      const tray = page.getByRole('dialog');
      await tray.waitFor({ state: 'visible', timeout: 10000 });
      await tray.getByRole('button', { name: KEEP }).click();
      await tray.waitFor({ state: 'hidden', timeout: 10000 });
      expect((await mine(page, ctx)).classes.some((c) => c.classId === classId), 'Keep removed the class');

      // Remove: back to My Classes, one class fewer, and this one gone.
      await page.getByRole('button', { name: REMOVE_CLASS }).click();
      await tray.waitFor({ state: 'visible', timeout: 10000 });
      await tray.getByRole('button', { name: REMOVE }).click();
      await page.waitForURL((u) => new URL(u).pathname === HOME, { timeout: 15000 });
      const heading = new RegExp('^(Classes|کلاسیں)\\s+' + (count - 1) + '\\b');
      await page.getByRole('heading', { name: heading }).first().waitFor({ state: 'visible', timeout: 15000 });
      const after = await mine(page, ctx);
      removed = !after.classes.some((c) => c.classId === classId);
      expect(removed, 'the class is still on her list after Remove');
      expect(after.classes.length === count - 1, 'expected ' + (count - 1) + ' classes, found ' + after.classes.length);
      expect(!w.errors.length, 'uncaught page error — ' + w.errors[0]);
      expect(!w.fivexx.length, 'API returned ' + [...new Set(w.fivexx)].join(', '));
      return { classId, combo, before: before.classes.length, after: after.classes.length };
    } finally {
      if (!removed) await api(page, ctx, 'DELETE', '/classes/' + encodeURIComponent(classId));
    }
  } },

  // bd-2dn4vu — Add students is a page of rows (roll no shown + name), not a paste box. Same throwaway-class
  // pattern: the students and the class are taken off again at the end, so nothing accumulates on the demo school.
  { id: 'TK04', title: 'Teacher app v2: Add students is rows, numbered from 1, and saves each name as typed', run: async (page, ctx) => {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const before = await mine(page, ctx);
    expect(before.canAdd, 'the demo teacher cannot add a class (no school or no academic session on this run)');
    const combo = freshCombo(before);
    expect(combo, 'no grade·section·shift left that the demo teacher is not already on');
    const added = await api(page, ctx, 'POST', '/classes', { ...combo, subjectCodes: [], isClassTeacher: false });
    expect(added.status === 201 && added.json.success, 'adding the throwaway class failed: ' + added.status);
    const classId = added.json.class.classId;
    const tag = String(Date.now()).slice(-6);
    const names = ['Ayesha ' + tag, 'Khan, Bilal ' + tag, 'Hira ' + tag];
    try {
      await visit(page, ctx, classPath(classId), {});
      const w = watch(page);
      await page.getByRole('link', { name: /^(Add students|طلبہ شامل کریں)$/ }).click();
      await page.waitForURL((u) => new URL(u).pathname === classPath(classId) + '/add-students', { timeout: 15000 });

      // An empty class: two rows, roll 1 and 2, and no paste box.
      const row = (n) => page.getByLabel(new RegExp('^(Name, roll no|نام، رول نمبر) ' + n + '$'));
      await row(1).waitFor({ state: 'visible', timeout: 15000 });
      expect(await row(2).isVisible(), 'the page does not open with two rows');
      expect(!(await row(3).count()), 'more than two rows on a fresh page');
      await row(1).fill(names[0]);
      await row(2).fill(names[1]);
      await page.getByRole('button', { name: /^(Add student|طالب علم شامل کریں)$/ }).click();
      await row(3).fill(names[2]);
      await page.getByRole('button', { name: /^(Save 3 students|3 طلبہ محفوظ کریں)$/ }).click();
      await page.getByText(/^(3 students added|3 طلبہ شامل)$/).waitFor({ state: 'visible', timeout: 15000 });

      const r = await api(page, ctx, 'GET', '/classes/' + encodeURIComponent(classId) + '/students');
      const got = (r.json && r.json.students || []).map((s) => [s.rollNumber, s.studentName]).sort((a, b) => a[0] - b[0]);
      expect(JSON.stringify(got) === JSON.stringify(names.map((n, i) => [i + 1, n])),
        'saved roster is not the three names as typed with rolls 1-3: ' + JSON.stringify(got));
      expect(!w.errors.length, 'uncaught page error — ' + w.errors[0]);
      expect(!w.fivexx.length, 'API returned ' + [...new Set(w.fivexx)].join(', '));
      return { classId, saved: got.length };
    } finally {
      const r = await api(page, ctx, 'GET', '/classes/' + encodeURIComponent(classId) + '/students');
      for (const s of (r.json && r.json.students) || []) {
        await api(page, ctx, 'DELETE', '/classes/' + encodeURIComponent(classId) + '/students/' + encodeURIComponent(s.studentId));
      }
      await api(page, ctx, 'DELETE', '/classes/' + encodeURIComponent(classId));
    }
  } },

  // bd-mx822w — Edit a name: tap the child, the tray opens focused on the name, Save fixes it and the roll no and
  // child stay the same. Same throwaway-class pattern and clean-up.
  { id: 'TK05', title: 'Teacher app v2: tapping a child opens Edit student; Save fixes the name and keeps the roll no', run: async (page, ctx) => {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const before = await mine(page, ctx);
    expect(before.canAdd, 'the demo teacher cannot add a class (no school or no academic session on this run)');
    const combo = freshCombo(before);
    expect(combo, 'no grade·section·shift left that the demo teacher is not already on');
    const added = await api(page, ctx, 'POST', '/classes', { ...combo, subjectCodes: [], isClassTeacher: false });
    expect(added.status === 201 && added.json.success, 'adding the throwaway class failed: ' + added.status);
    const classId = added.json.class.classId;
    const tag = String(Date.now()).slice(-6);
    const wrong = 'Fatma ' + tag;
    const right = 'Fatima ' + tag;
    try {
      const seeded = await api(page, ctx, 'POST', '/classes/' + encodeURIComponent(classId) + '/students', { names: [wrong] });
      expect(seeded.status === 200 && seeded.json && seeded.json.success, 'seeding the child failed: ' + seeded.status);
      const kids = (await api(page, ctx, 'GET', '/classes/' + encodeURIComponent(classId) + '/students')).json.students;
      expect(kids.length === 1 && kids[0].rollNumber === 1, 'seeded roster is not one child as roll 1: ' + JSON.stringify(kids));
      const childId = kids[0].studentId;

      await visit(page, ctx, classPath(classId), {});
      const w = watch(page);
      expect(!(await page.getByRole('button', { name: new RegExp('^(Remove ' + wrong + '|' + wrong + ' کو ہٹائیں)$') }).count()),
        'the row still has a bin');
      await page.getByRole('button', { name: new RegExp('^(Edit ' + wrong + '|' + wrong + ' میں تبدیلی)$') }).click();
      const tray = page.getByRole('dialog', { name: /^(Edit student|طالب علم میں تبدیلی)$/ });
      await tray.waitFor({ state: 'visible', timeout: 15000 });
      const box = tray.getByLabel(/^(Name, roll no|نام، رول نمبر) 1$/);
      expect((await box.inputValue()) === wrong, 'the name box does not hold the name');
      expect(await box.evaluate((el) => el === document.activeElement), 'the name box is not focused');
      expect(await tray.getByRole('button', { name: /^(Remove student|طالب علم ہٹائیں)$/ }).isVisible(), 'Remove student is not in the tray');
      const save = tray.getByRole('button', { name: /^(Save|محفوظ کریں)$/ });
      expect(await save.isDisabled(), 'Save is on before the name changes');
      await box.fill(right);
      await save.click();
      await page.getByRole('status').filter({ hasText: /^(Name saved|نام محفوظ ہو گیا)$/ }).waitFor({ state: 'visible', timeout: 15000 });
      expect(!(await page.getByRole('dialog').count()), 'the tray did not close');

      const after = (await api(page, ctx, 'GET', '/classes/' + encodeURIComponent(classId) + '/students')).json.students;
      expect(after.length === 1 && after[0].studentId === childId && after[0].rollNumber === 1 && after[0].studentName === right,
        'saved roster is not the same child, roll 1, renamed: ' + JSON.stringify(after));
      expect(!w.errors.length, 'uncaught page error — ' + w.errors[0]);
      expect(!w.fivexx.length, 'API returned ' + [...new Set(w.fivexx)].join(', '));
      return { classId, renamed: after[0].studentName };
    } finally {
      const r = await api(page, ctx, 'GET', '/classes/' + encodeURIComponent(classId) + '/students');
      for (const s of (r.json && r.json.students) || []) {
        await api(page, ctx, 'DELETE', '/classes/' + encodeURIComponent(classId) + '/students/' + encodeURIComponent(s.studentId));
      }
      await api(page, ctx, 'DELETE', '/classes/' + encodeURIComponent(classId));
    }
  } },

  // bd-pqx8h9 — Add a class: no subjects, class + section + shift required, the year on top; a class she is
  // already on answers "Already on your list" and posts nothing. The class she is "already on" is a throwaway one
  // added first through the API, and removed again at the end.
  { id: 'TK06', title: 'Teacher app v2: Add a class asks only class, section and shift; a class she is already on is not saved again', run: async (page, ctx) => {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const before = await mine(page, ctx);
    expect(before.canAdd, 'the demo teacher cannot add a class (no school or no academic session on this run)');
    const combo = freshCombo(before);
    expect(combo, 'no grade·section·shift left that the demo teacher is not already on');
    const added = await api(page, ctx, 'POST', '/classes', { ...combo, subjectCodes: [], isClassTeacher: false });
    expect(added.status === 201 && added.json.success, 'adding the throwaway class failed: ' + added.status);
    const classId = added.json.class.classId;
    const label = (list, code) => (list.find((o) => o.code === code) || {}).label;
    const exact = (t) => new RegExp('^' + String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
    try {
      await visit(page, ctx, HOME + '/add', {});
      const w = watch(page);
      const posts = [];
      page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/portal\/classes$/.test(new URL(r.url()).pathname)) posts.push(r.url()); });
      const save = page.getByRole('button', { name: /^(Save class|کلاس محفوظ کریں)$/ });
      await save.waitFor({ state: 'visible', timeout: 15000 });
      expect(!(await page.getByText(/^(Subjects|مضامین)$/).count()), 'the Subjects field is still there');
      expect(await page.getByText(/^(No sections: select A|بغیر سیکشن: A چنیں)$/).isVisible(), 'the no-section note is missing');
      if (before.currentSession) expect(await page.getByText(new RegExp('^(Year|سال) ' + before.currentSession + '$')).isVisible(), 'the year is not shown on top');
      expect(await save.isDisabled(), 'Save class is on before anything is chosen');
      await page.getByRole('radio', { name: exact(label(before.grades, combo.gradeCode)) }).click();
      await page.getByRole('radio', { name: exact(label(before.sections, combo.section)) }).click();
      expect(await save.isDisabled(), 'Save class is on without a shift');
      await page.getByRole('radio', { name: exact(label(before.shifts, combo.shiftCode)) }).click();
      expect(!(await save.isDisabled()), 'Save class stays off with class, section and shift chosen');
      await save.click();
      await page.getByText(/^(Already on your list|پہلے سے فہرست میں)$/).waitFor({ state: 'visible', timeout: 15000 });
      expect(!posts.length, 'a class was posted for a class she is already on');
      await page.getByRole('link', { name: /^(Open class|کلاس کھولیں)$/ }).click();
      await page.waitForURL((u) => new URL(u).pathname === classPath(classId), { timeout: 15000 });
      expect(!w.errors.length, 'uncaught page error — ' + w.errors[0]);
      expect(!w.fivexx.length, 'API returned ' + [...new Set(w.fivexx)].join(', '));
      return { classId, alreadyOn: true };
    } finally {
      await api(page, ctx, 'DELETE', '/classes/' + encodeURIComponent(classId));
    }
  } },
];
