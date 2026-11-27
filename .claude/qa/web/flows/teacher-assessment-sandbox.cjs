// teacher-assessment-sandbox — TA23–TA29 (bd-q8wt5e.6.5): the spec's @sandbox scenarios, which had no id and no code.
// Joined to the teacher-assessment driver as gen_page_features.py EXTRA does.
//
// Each proves on the local stack what the local stack can prove, and says plainly what it cannot:
//   TA23  the soft paper limit, for real: ten requests this hour seeded for the demo teacher and the limit switch on (both
//         on THIS run's database, put back), a plain paper's Make answered 429 by the server; English and Urdu.
//   TA24  the report button's tag in the request the app sends (generate caught by page.route). The stored half is
//         BLOCKED: this lane's database (supabase/baseline/schema.sql) has no assessment_requests.origin column
//         (V1.7.6__assessment_request_origin.sql is not in the baseline), so the bot cannot store the tag here.
//   TA25/26  Edit paper's Bloom's summary and FDE target, from a paper answer given by page.route (shapes as the editor's
//         unit suites). The printed paper and answer key need a real model-written paper (vendor calls are replay-only
//         here): that half is BLOCKED with the reason.
//   TA27  grouped counting on Questions from the bot's limits (groupedTypes, maxItems) as /assessment/options answers
//         them; the WhatsApp half belongs to the mock lane, so BLOCKED with the reason once the portal half passed.
//   TA28/29  Select from the book, the list answered by page.route; the printed paper of TA28 is BLOCKED as above.
'use strict';
const crypto = require('crypto');
const { DEMO, expect, asRole, setSetting } = require('../lib.cjs');

const PICKS_KEY = 'teacher-v2-assessment-new:v1';
const BASE = '/portal/teacher/assessment';
const NEW = BASE + '/new/';
const TEACHER_PHONE = '92' + DEMO.teacher.slice(1);
const unisolate = (s) => String(s || '').replace(/[⁦-⁩‎‏]/g, '');
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const reason = async (page) => ((await page.getByTestId('button-reason').count()) ? (await page.getByTestId('button-reason').innerText()).trim() : '');
const total = async (page) => (await page.getByTestId('questions-total').innerText()).replace(/\s+/g, ' ').trim();
const box = (page, name) => page.getByRole('textbox', { name: 'Number of ' + name, exact: true });
async function until(fn, ms = 8000) {
  const deadline = Date.now() + ms;
  let v;
  while (Date.now() < deadline) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); }
  return v;
}
const seedPicks = (page, picks) => page.addInitScript(([k, v]) => {
  if (!sessionStorage.getItem(k + ':e2e')) { sessionStorage.setItem(k, v); sessionStorage.setItem(k + ':e2e', '1'); }
}, [PICKS_KEY, JSON.stringify(picks)]);
async function setLang(ctx, lang) {
  const prev = String(await ctx.sql("select coalesce(preferred_language, '') from users where phone_number = '" + TEACHER_PHONE + "'"));
  await ctx.sql('update users set preferred_language = ' + (lang ? "'" + lang + "'" : 'null') + " where phone_number = '" + TEACHER_PHONE + "'");
  return prev || null;
}

// Reads for one class, answered by page.route (as TA18–TA22): options (types, limits, the book picker), chapters, topics.
async function routeClass(page, { grade, subject, name, types, chapters, extra = {}, bookPicker = () => false, exercises = null }) {
  await page.route('**/api/portal/assessment/options**', (r) => {
    const q = new URL(r.request().url()).searchParams;
    return json(r, { success: true, grades: [grade], maxQuestions: 50, defaultQuestions: 15, ...extra,
      ...(q.get('subject') ? { types, ...(bookPicker() ? { bookPicker: true } : {}) } : q.get('grade') ? { subjects: [{ subject_key: subject, subject: name }] } : {}) });
  });
  await page.route('**/api/portal/assessment/chapters**', (r) => json(r, { success: true, chapters }));
  await page.route('**/api/portal/assessment/topics**', (r) => json(r, { success: true, topics: [] }));
  if (exercises) await page.route('**/api/portal/assessment/exercises**', (r) => json(r, { success: true, enabled: true, chapters: exercises(new URL(r.request().url()).searchParams) }));
}
// A scenario that is not about her language reads its words in English, whatever language she last saved (GET /me/language).
const english = (page) => page.route('**/api/portal/me/language', (r) => (r.request().method() === 'GET'
  ? json(r, { success: true, language: 'en', locked: false }) : r.continue()));
const typesOf = (list) => list.map(([id, category]) => ({ id, category }));

/* ── TA23 ───────────────────────────────────────────────────────────────────── */
async function ta23(page, ctx) {
  await ctx.sql("insert into subjects (code) values ('english') on conflict (code) do nothing");
  await ctx.sql("insert into textbooks (curriculum, grade, subject, filename, total_pages) select 'ict', 5, 'english', 'e2e-fde-g5-english.pdf', 100 "
    + "where not exists (select 1 from textbooks t where t.curriculum = 'ict' and t.grade = 5 and t.subject = 'english')");
  const ids = Array.from({ length: 10 }, () => crypto.randomUUID());
  await ctx.sql('insert into assessment_requests (id, user_id, surface, grade_code, subject_code, textbook_id, chapter_number, question_count, created_at) '
    + "select x.id::uuid, u.id, 'portal', 'grade_5', 'english', (select id from textbooks where curriculum = 'ict' and grade = 5 and subject = 'english' limit 1), 1, 10, "
    + "now() - (x.n || ' minutes')::interval from users u, (values " + ids.map((id, i) => "('" + id + "', " + (i + 1) * 3 + ')').join(', ') + ') as x(id, n) '
    + "where u.phone_number = '" + TEACHER_PHONE + "'");
  await setSetting(ctx, 'assessment_rate_limit_enabled', 'true');
  const prevLang = await setLang(ctx, 'en');
  const made = [];
  try {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await seedPicks(page, { grade: 5, subject: 'english', subjectName: 'English', coverBy: 'chapters', chapters: [1], seen: 0,
      typeCounts: { MCQs: 5 }, typesSeeded: true, marks: null });
    const seen = {};
    for (const [lang, want] of [['en', /^Paper limit reached · try again at \d\d?:\d\d/], ['ur', /^پرچوں کی حد پوری ہو گئی · .+ پر دوبارہ کوشش کریں$/]]) {
      await setLang(ctx, lang);
      await page.goto(ctx.baseUrl + NEW + 'check', { waitUntil: 'domcontentloaded' });
      await page.getByTestId('step-next').waitFor({ timeout: 15000 });
      await page.waitForTimeout(lang === 'ur' ? 1600 : 300); // the page turns to her stored language (LANGUAGE_WAIT_MS)
      const answer = page.waitForResponse((r) => r.url().includes('/api/portal/assessment/generate'), { timeout: 30000 });
      await page.getByTestId('step-next').click();
      const res = await answer;
      const body = await res.json().catch(() => ({}));
      if (body && typeof body.requestId === 'string') made.push(body.requestId);
      expect(res.status() === 429 && body.errorCode === 'RATE_LIMITED', lang + ': the 11th paper should be refused 429 RATE_LIMITED, got ' + res.status() + ' ' + body.errorCode);
      const alert = page.getByRole('alert').first();
      await alert.waitFor({ timeout: 10000 });
      const line = unisolate((await alert.innerText()).trim());
      expect(want.test(line), lang + ': the line should be ' + want + ', got ' + line);
      const rows = await page.locator('main section, main [role="list"], main ul').first().boundingBox().catch(() => null);
      const a = await alert.boundingBox();
      const make = await page.getByTestId('step-next').boundingBox();
      expect(a && make && a.y < make.y && (!rows || a.y <= rows.y), lang + ': the line should sit above the rows');
      seen[lang] = line;
    }
    return seen;
  } finally {
    await ctx.sql('delete from assessment_requests where id in (' + [...ids, ...made].map((id) => "'" + id + "'").join(', ') + ')');
    await setSetting(ctx, 'assessment_rate_limit_enabled', 'false');
    await setLang(ctx, prevLang);
  }
}

/* ── TA24 ───────────────────────────────────────────────────────────────────── */
async function ta24(page, ctx) {
  // her class picker offers a class only where the bot has a book for it: a Grade 3 English book, where missing
  await ctx.sql("insert into subjects (code) values ('english') on conflict (code) do nothing");
  await ctx.sql("insert into textbooks (curriculum, grade, subject, filename, total_pages) select 'ict', 3, 'english', 'e2e-g3-english.pdf', 100 "
    + "where not exists (select 1 from textbooks t where t.curriculum = 'ict' and t.grade = 3 and t.subject = 'english')");
  await english(page);
  await asRole(page, ctx, 'teacher', 'teacherV2');
  const sent = [];
  await routeClass(page, { grade: 3, subject: 'english', name: 'English', types: typesOf([['MCQs', 'objective'], ['Fill in the Blanks', 'objective']]),
    chapters: [1, 2, 3, 4, 5].map((n) => ({ chapter_number: n, chapter_title: 'Unit ' + n, page_start: n * 10, page_end: n * 10 + 9, page_count: 10 })) });
  await page.route('**/api/portal/assessment/generate', (r) => { sent.push(r.request().postDataJSON()); return json(r, { success: true, requestId: 'e2e-ta24-' + sent.length }, 202); });
  await page.route('**/api/portal/assessment/status/**', (r) => json(r, { success: true, status: 'queued' }));
  const make = async () => {
    await page.waitForURL('**' + NEW + 'cover', { timeout: 15000 });
    await page.getByTestId('step-next').click(); // Chapters → Questions (the report's chapter is picked)
    await page.waitForURL('**' + NEW + 'questions');
    await page.getByTestId('step-next').click();
    await page.waitForURL('**' + NEW + 'check');
    const n = sent.length;
    await page.getByTestId('step-next').click();
    expect(await until(() => sent.length === n + 1, 15000), 'Make my paper should send one request');
    return sent[sent.length - 1];
  };
  await page.goto(ctx.baseUrl + NEW + 'class?origin=report&grade=3&subject=english&chapter=4', { waitUntil: 'domcontentloaded' });
  const first = await make();
  expect(first.origin === 'report' && first.grade === 3 && first.subject === 'english' && JSON.stringify(first.chapterNumbers) === '[4]',
    'the report\'s paper should be Grade 3 English chapter 4 tagged origin report, got ' + JSON.stringify({ origin: first.origin, grade: first.grade, subject: first.subject, ch: first.chapterNumbers }));
  // a new paper from the paper maker's own door
  await page.goto(ctx.baseUrl + BASE, { waitUntil: 'domcontentloaded' });
  await page.getByText('New paper').first().click();
  await page.waitForURL('**' + NEW + 'class');
  await page.getByRole('button', { name: /Select grade and subject/ }).click();
  if (await page.getByRole('radio', { name: /^Grade 3/ }).count()) await page.getByRole('radio', { name: /^Grade 3/ }).first().click();
  await page.getByRole('button', { name: /^Grade 3 · English/ }).first().click();
  await page.getByRole('checkbox').first().click();
  const second = await make();
  expect(!('origin' in second) || second.origin == null, 'a paper from the door should carry no report mark, got ' + second.origin);
  // a report link whose grade has no such subject: she stays on Class, still marked as from the report
  await page.goto(ctx.baseUrl + NEW + 'class?origin=report&grade=3&subject=urdu&chapter=4', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  expect(new URL(page.url()).pathname === NEW + 'class', 'a report link for a subject the grade lacks should keep her on Class, is on ' + new URL(page.url()).pathname);
  const p = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) || 'null'), PICKS_KEY);
  expect(p && p.origin === 'report', 'she should still be marked as from the report, picks: ' + JSON.stringify(p && p.origin));
  const cols = String(await ctx.sql("select count(*) from information_schema.columns where table_name = 'assessment_requests' and column_name = 'origin'"));
  if (cols.trim() === '0') {
    return { blocked: "the stored half: this lane's database has no assessment_requests.origin column (supabase/baseline/schema.sql "
      + 'predates V1.7.6__assessment_request_origin.sql), so the bot cannot store the tag here. Proved: the report paper\'s request '
      + 'carries origin report, the door\'s next paper carries none, and a report link for a missing subject stays on Class still marked',
    request: { origin: first.origin }, next: { origin: second.origin ?? null } };
  }
  return { blocked: 'the stored half reads the bot\'s request row, which a caught request never writes; run on sandbox', request: { origin: first.origin } };
}

/* ── TA25 / TA26 ──────────────────────────────────────────────────────────── */
const editItem = (id, n, type, blooms, marks = 1) => ({ id, number: n, removed: false, type, section: type === 'MCQs' ? 'objective' : 'subjective', marks,
  text: 'Question ' + id, fields: { question: 'Question ' + id, marks }, ...(blooms ? { blooms } : {}) });
async function editor(page, ctx, paper, items, signIn = true) {
  if (signIn) await asRole(page, ctx, 'teacher', 'teacherV2');
  if (!paper.urdu) await english(page);
  await page.route('**/api/portal/assessment/edit/p-bloom/questions**', (r) => json(r, { success: true, paper: { paperId: 'p-bloom', version: 1, rtl: false, ...paper }, items }));
  await page.route('**/api/portal/assessment/edit/p-bloom/versions**', (r) => json(r, { success: true, versions: [] }));
  await page.route('**/api/portal/assessment/edit/p-bloom/add-kinds**', (r) => json(r, { success: true, kinds: [], slotCap: 50 }));
  await page.route('**/api/portal/assessment/edit/p-bloom/validate', (r) => json(r, { success: true }));
  await page.route('**/api/portal/assessment/edit/p-bloom/save', (r) => json(r, { success: true }));
  await page.route('**/api/portal/assessment/papers**', (r) => json(r, { success: true, total: 0, page: 1, pageSize: 20, papers: [] }));
  await page.goto(ctx.baseUrl + BASE + '/paper/p-bloom/edit', { waitUntil: 'domcontentloaded' });
}
const sumText = async (page, id = 'edit-summary') => unisolate(String(await page.getByTestId(id).evaluate((el) => [...el.querySelectorAll('p, span, div')].filter((n) => !n.children.length).map((n) => n.textContent.trim()).join(' '))).replace(/\s+/g, ' '));

async function ta25(page, ctx) {
  const prevLang = await setLang(ctx, 'en');
  try {
    const items = [editItem('a', 1, 'MCQs', 'Remember'), editItem('b', 2, 'MCQs', 'Apply'), editItem('c', 3, 'Short Questions', 'Remember'), editItem('d', 4, 'Short Questions', 'Understand')];
    await editor(page, ctx, { grade: 7, subject: 'Science', subjectKey: 'science', chapterNumber: 1, questionCount: 4, marks: 4 }, items);
    await page.getByTestId('edit-summary').waitFor({ timeout: 15000 });
    const tags = (await page.getByTestId('bloom-tag').allInnerTexts()).map((t) => t.trim());
    expect(JSON.stringify(tags) === '["Remember","Apply","Remember","Understand"]', 'each question should show its level, got ' + JSON.stringify(tags));
    const before = await sumText(page);
    for (const w of ['Remember 50%', 'Apply 25%', 'Understand 25%', 'MCQs 2', 'Short Questions 2']) expect(before.includes(w), 'the summary should show ' + w + ', got ' + before);
    await page.getByRole('checkbox', { name: 'Remove question 3' }).click();
    const after = await sumText(page);
    for (const w of ['Remember 33%', 'Apply 33%', 'Understand 33%', 'Short Questions 1']) expect(after.includes(w), 'after Remove the summary should show ' + w + ', got ' + after);
    // in Urdu
    await setLang(ctx, 'ur');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const ur = await until(async () => { const t = (await page.getByTestId('edit-summary').count()) ? await sumText(page) : ''; return t.includes('یاد رکھنا') ? t : null; }, 15000);
    expect(ur && ur.includes('بلوم کی سطحیں'), 'in Urdu the levels and headings should be Urdu, got ' + ur);
    // a paper whose questions carry no level: no summary
    await setLang(ctx, 'en');
    await page.unroute('**/api/portal/assessment/edit/p-bloom/questions**');
    await page.route('**/api/portal/assessment/edit/p-bloom/questions**', (r) => json(r, { success: true, paper: { paperId: 'p-bloom', version: 1, rtl: false, grade: 7, subject: 'Science', subjectKey: 'science', chapterNumber: 1, questionCount: 2, marks: 2 },
      items: [editItem('a', 1, 'MCQs'), editItem('b', 2, 'MCQs')] }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('checkbox', { name: 'Remove question 1' }).waitFor({ timeout: 15000 });
    expect(await page.getByTestId('edit-summary').count() === 0 && await page.getByTestId('bloom-tag').count() === 0, 'a paper with no levels should show no summary');
    return { blocked: 'the printed half ("the printed paper and answer key show no levels and no summary") needs a real model-written paper '
      + 'and its PDFs, which this lane cannot make (vendor calls are replay-only). Proved: each level beside its question, the shares and type counts, '
      + 'their change on Remove, Urdu, and no summary without levels', tags, before, after };
  } finally {
    await setLang(ctx, prevLang);
  }
}

async function ta26(page, ctx) {
  const items = [editItem('a', 1, 'MCQs', 'Remember'), editItem('b', 2, 'MCQs', 'Apply'), editItem('c', 3, 'Short Questions', 'Remember'), editItem('d', 4, 'Short Questions', 'Understand')];
  const out = {};
  let signedIn = false;
  const open = async (grade, subject, subjectKey) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await editor(page, ctx, { grade, subject, subjectKey, chapterNumber: 1, questionCount: 4, marks: 4 }, items, !signedIn);
    signedIn = true;
    await page.getByTestId('edit-summary').waitFor({ timeout: 15000 });
  };
  await open(5, 'Mathematics', 'maths');
  const target = await sumText(page, 'fde-target');
  for (const w of ['FDE target', 'Remember 10%', 'Understand 50%', 'Apply 40%']) expect(target.includes(w), 'Grade 5 Maths should show ' + w + ', got ' + target);
  const summary = await sumText(page);
  expect(summary.includes('This paper, by marks'), 'the summary should show "This paper, by marks"');
  const mixBefore = await sumText(page, 'paper-mix');
  expect(mixBefore.includes('Remember 50%'), 'this paper by marks should start Remember 50%, got ' + mixBefore);
  await page.getByRole('checkbox', { name: 'Remove question 3' }).click();
  const mixAfter = await sumText(page, 'paper-mix');
  expect(mixAfter !== mixBefore && mixAfter.includes('Remember 33%'), '"This paper, by marks" should change on Remove, got ' + mixAfter);
  expect((await sumText(page, 'fde-target')) === target, 'the FDE target should stay the same');
  expect(await page.getByTestId('step-next').count() === 0 || !(await page.getByTestId('step-next').isDisabled()), 'nothing should stop her keeping a paper off the target');
  out.g5maths = target;
  // Grade 1-4: FDE's own table for its grade and subject (Grade 3 English: 30 / 30 / 40, FDE Table of Specification 2023-24)
  await open(3, 'English', 'english');
  out.g3english = (await page.getByTestId('fde-target').count()) ? await sumText(page, 'fde-target') : null;
  for (const w of ['FDE target', 'Remember 30%', 'Understand 30%', 'Apply 40%']) expect(out.g3english && out.g3english.includes(w), 'Grade 3 English should show ' + w + ', got ' + out.g3english);
  // a subject FDE gives no table for (Grade 3 Science): none
  await open(3, 'Science', 'science');
  expect(await page.getByTestId('fde-target').count() === 0, 'Grade 3 Science (no FDE table) should show no FDE target');
  // Grade 6-12: none
  await open(7, 'Science', 'science');
  expect(await page.getByTestId('fde-target').count() === 0, 'a Grade 7 paper should show no FDE target');
  return out;
}

/* ── TA27 ───────────────────────────────────────────────────────────────────── */
async function ta27(page, ctx) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  await routeClass(page, { grade: 5, subject: 'science', name: 'Science',
    types: typesOf([['MCQs', 'objective'], ['Fill in the Blanks', 'objective'], ['True/False', 'objective'], ['Short Questions', 'subjective']]),
    chapters: [{ chapter_number: 1, chapter_title: 'Living Things', page_start: 1, page_end: 20, page_count: 20 }],
    extra: { groupedTypes: ['MCQs', 'Fill in the Blanks', 'True/False'], maxItems: 100 } });
  await seedPicks(page, { grade: 5, subject: 'science', subjectName: 'Science', coverBy: 'chapters', chapters: [1], seen: 0,
    typeCounts: { MCQs: 20, 'Fill in the Blanks': 10, 'True/False': 10, 'Short Questions': 25 }, typesSeeded: true });
  await page.goto(ctx.baseUrl + NEW + 'questions', { waitUntil: 'domcontentloaded' });
  await box(page, 'MCQs').waitFor({ timeout: 15000 });
  const t28 = await total(page);
  expect(/^28 questions/.test(t28), 'the total should read 28 questions, got ' + t28);
  expect(!(await page.getByTestId('step-next').isDisabled()), 'Next should be open at 28');
  await box(page, 'MCQs').fill('40'); // 85 printed items: still under 100
  expect(await until(async () => !(await page.getByTestId('step-next').isDisabled())), 'she can still add MCQs while the paper prints fewer than 100 items');
  await box(page, 'MCQs').fill('20');
  await box(page, 'Short Questions').fill('51');
  const r51 = await until(async () => ((await reason(page)) === 'Questions: 1 to 50' ? 'Questions: 1 to 50' : null));
  expect(r51, 'Next should be held with "Questions: 1 to 50", got ' + await reason(page));
  await box(page, 'Short Questions').fill('5');
  await box(page, 'MCQs').fill('70'); // 70 + 10 + 10 + 5 = 95 … plus the groups
  await box(page, 'Fill in the Blanks').fill('20');
  const items = await until(async () => ((await reason(page)) === 'Printed items: up to 100' ? 'Printed items: up to 100' : null));
  expect(items, 'Next should be held with "Printed items: up to 100", got ' + await reason(page));
  return { blocked: 'the WhatsApp half ("on WhatsApp the same paper is accepted on the counts screen, and 51 written questions are refused naming 50") '
    + 'is the bot\'s Flow, driven on the mock lane, not in a browser. Proved on the portal: 28 questions, Next open, more MCQs allowed under 100 items, '
    + '"Questions: 1 to 50" at 51 written, "Printed items: up to 100" past 100', total: t28 };
}

/* ── TA28 / TA29 ──────────────────────────────────────────────────────────── */
const EX = (ref, heading, text, type, page) => ({ ref, heading, text, type, page });
const G4_SCI_CH1 = { chapterNumber: 1, title: 'Living Things', exercises: [
  EX('Exercise 1 · Q1', 'Exercise 1', 'What do plants need to grow?', 'Brief Answers', 12),
  EX('Exercise 1 · Q2', 'Exercise 1', 'Roots take in (a) light (b) water', 'MCQs', 12),
  EX('Exercise 2 · Q1', 'Exercise 2', 'Plants can walk.', 'True/False', 18),
  EX('Exercise 2 · Q2', 'Exercise 2', 'Name two parts of a plant.', 'Brief Answers', 18),
] };

async function ta28(page, ctx) {
  await english(page);
  await asRole(page, ctx, 'teacher', 'teacherV2');
  const sent = [];
  await routeClass(page, { grade: 4, subject: 'science', name: 'Science', bookPicker: () => true,
    types: typesOf([['MCQs', 'objective'], ['True/False', 'objective'], ['Brief Answers', 'subjective']]),
    chapters: [{ chapter_number: 1, chapter_title: 'Living Things', page_start: 10, page_end: 20, page_count: 11 }],
    exercises: () => [G4_SCI_CH1] });
  await page.route('**/api/portal/assessment/generate', (r) => { sent.push(r.request().postDataJSON()); return json(r, { success: true, requestId: 'e2e-ta28' }, 202); });
  await page.route('**/api/portal/assessment/status/**', (r) => json(r, { success: true, status: 'queued' }));
  await seedPicks(page, { grade: 4, subject: 'science', subjectName: 'Science', coverBy: 'chapters', chapters: [1], seen: 5, typeCounts: { MCQs: 4 }, typesSeeded: true });
  await page.goto(ctx.baseUrl + NEW + 'questions', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('pick-from-book').click({ timeout: 15000 });
  const tray = page.getByTestId('book-picker-tray');
  await tray.waitFor();
  await tray.getByText(G4_SCI_CH1.exercises[3].text).waitFor({ timeout: 20000 });
  const listed = await tray.innerText();
  for (const h of ['Exercise 1', 'Exercise 2']) expect(listed.includes(h), 'the list should group under the book\'s heading ' + h);
  for (const e of G4_SCI_CH1.exercises) expect(listed.includes(e.text), 'the list should show ' + e.text);
  const boxes = tray.getByRole('checkbox');
  for (const i of [0, 1, 2]) await boxes.nth(i).click();
  await tray.getByRole('button', { name: 'Done' }).click();
  await tray.waitFor({ state: 'detached' });
  const card = await page.getByTestId('book-picked').innerText();
  expect(/Book · 3 selected/.test(card) && /Change/.test(card), 'the seen card should read "Book · 3 selected" with Change, got ' + card);
  expect(await page.getByRole('button', { name: 'Clear selection' }).count() > 0, 'the seen card should offer Clear selection');
  const t = await total(page);
  expect(/3 seen/.test(t), 'the total should count the 3 as seen questions, got ' + t);
  await page.getByTestId('step-next').click();
  await page.waitForURL('**' + NEW + 'check');
  await page.getByText('Book · 3 selected').first().waitFor({ timeout: 10000 });
  await page.getByTestId('step-next').click();
  expect(await until(() => sent.length === 1, 15000), 'Make my paper should send one request');
  const picked = (sent[0].seenPicked || []).map((x) => x.text);
  expect(JSON.stringify(picked) === JSON.stringify(G4_SCI_CH1.exercises.slice(0, 3).map((e) => e.text)), 'the request should carry the 3 picked questions word for word, got ' + JSON.stringify(picked));
  return { blocked: 'the printed half ("every question in the list is printed on that chapter\'s pages"; "the paper\'s seen questions are those 3, word for word, '
    + 'each with marks and an answer") needs the bot\'s real book read and a model-written paper, which this lane cannot make (vendor calls are replay-only). '
    + 'Proved: the grouped list, Book · 3 selected with Change and Clear selection, the total, Check, and the request carrying the 3 word for word', seenPicked: picked };
}

async function ta29(page, ctx) {
  const prevLang = await setLang(ctx, 'ur');
  try {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    let on = true;
    const ch = (n, title) => ({ chapterNumber: n, title, exercises: [EX('مشق ' + n + ' · 1', 'مشق', 'سبق ' + n + ' کا پہلا سوال لکھیں۔', 'Brief Answers', n * 10)] });
    await routeClass(page, { grade: 4, subject: 'urdu', name: 'Urdu', bookPicker: () => on,
      types: typesOf([['MCQs', 'objective'], ['Brief Answers', 'subjective']]),
      chapters: [1, 2].map((n) => ({ chapter_number: n, chapter_title: 'سبق ' + n, page_start: n * 10, page_end: n * 10 + 9, page_count: 10 })),
      exercises: (q) => q.get('chapters').split(',').map(Number).map((n) => ch(n, 'سبق ' + n)) });
    await seedPicks(page, { grade: 4, subject: 'urdu', subjectName: 'Urdu', coverBy: 'chapters', chapters: [1, 2], seen: 5, typeCounts: { MCQs: 4 }, typesSeeded: true });
    await page.goto(ctx.baseUrl + NEW + 'questions', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('pick-from-book').click({ timeout: 15000 });
    const tray = page.getByTestId('book-picker-tray');
    await tray.waitFor();
    await tray.getByText('سبق 2 کا پہلا سوال', { exact: false }).waitFor({ timeout: 20000 });
    const listed = await tray.innerText();
    for (const n of [1, 2]) expect(listed.includes('سبق ' + n + ' کا پہلا سوال'), 'chapter ' + n + '\'s question should be listed');
    expect(/باب ⁦?1⁩?/.test(unisolate(listed)) || unisolate(listed).includes('باب 1'), 'each question should sit under its chapter');
    const dir = await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
    expect(dir === 'rtl', 'the Urdu page should run right to left, got ' + dir);
    await tray.getByRole('button', { name: /بند|Close/ }).first().click();
    // the book picker switched off: Questions has no "Select from the book"
    on = false;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await box(page, 'MCQs').or(page.getByRole('textbox').first()).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    expect(await page.getByTestId('pick-from-book').count() === 0, 'with the book picker off there should be no "Select from the book"');
    // a paper by pages: never
    on = true;
    await page.evaluate((k) => { const p = JSON.parse(sessionStorage.getItem(k)); sessionStorage.setItem(k, JSON.stringify({ ...p, coverBy: 'pages', chapters: [], ranges: [[10, 15]] })); }, PICKS_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    expect(await page.getByTestId('pick-from-book').count() === 0, 'a paper by pages should never show "Select from the book"');
    return { blocked: 'the board-pattern half ("a board-pattern paper never offers Select from the book") is fde-board-pattern\'s scenario of the same name, '
      + 'run there on the real pattern. Proved here: both chapters\' questions under their chapters in Urdu right to left, none with the picker off, none by pages' };
  } finally {
    await setLang(ctx, prevLang);
  }
}

module.exports = [
  { id: 'TA23', title: "A plain paper refused for the hour's limit says so above the rows", run: ta23 },
  { id: 'TA24', title: "A paper made from the class report's button is marked as one; the next paper she starts is not", run: ta24 },
  { id: 'TA25', title: "Edit paper shows each question's Bloom's level and a summary that follows Remove", run: ta25 },
  { id: 'TA26', title: "Edit paper shows FDE's target thinking-level mix for Grades 1-5 beside the paper's own mix by marks", run: ta26 },
  { id: 'TA27', title: 'A group of MCQs, blanks or true/false counts as one question toward the 50', run: ta27 },
  { id: 'TA28', title: "Teacher ticks the chapter's own book questions and the paper prints exactly those", run: ta28 },
  { id: 'TA29', title: 'Select from the book follows the chapters on the paper and the switch', run: ta29 },
];
