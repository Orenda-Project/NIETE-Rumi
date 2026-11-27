// fde-board-pattern — web-lane driver for tests/features/web/fde-board-pattern.feature. Runs the @FBnn scenarios: the
// ones the local stack can prove without a model call (the switch, the door, Check and make, the refusals, the soft
// limit), and FB09–FB26, the @sandbox scenarios: each proves here what the local stack can, and reports BLOCKED, naming what
// was proved, only the Thens that need a real model-written paper (run on sandbox by .claude/qa/agents/niete-fde-board-pattern-agent.md).
// Controls are found by the app's data-testids (fde-door, fde-side-door, fde-row-inside, fde-inside-tray, step-next);
// what the teacher reads is asserted by its visible words (the copy deck).
'use strict';
const crypto = require('crypto');
const { DEMO, expect, asRole, visit, setSetting } = require('../lib.cjs');

const PATTERN = 'fde_g5_2027';
const HUB = '/portal/teacher/assessment';
// users.phone_number of the demo teacher, built from the login form's number (0 → 92).
const TEACHER_PHONE = '92' + DEMO.teacher.slice(1);

const patternSwitch = (ctx, on) => setSetting(ctx, 'assessment_fde_pattern_enabled', on ? 'true' : 'false');
const limitSwitch = (ctx, on) => setSetting(ctx, 'assessment_rate_limit_enabled', on ? 'true' : 'false');

// The browser's own session calls the portal API, exactly as the app does.
async function api(page, ctx, method, path, body) {
  const url = ctx.baseUrl + '/api/portal' + path;
  const r = method === 'GET' ? await page.request.get(url) : await page.request.post(url, { data: body });
  let json = null;
  try { json = await r.json(); } catch (_) { /* not JSON */ }
  return { status: r.status(), json };
}

const fdeBody = (grade, subject) => ({ grade, subject, pattern: PATTERN, scope: 'fde', questionCount: 0,
  contentSource: 'unseen', seenCount: null, questionTypes: [], answerLines: true, outputFormat: 'pdf' });

// Ten requests in the last hour for the demo teacher, with ids we keep, so clean-up deletes exactly these. Grade 5
// Maths, on the book catalogue() guarantees: the columns are foreign keys and the demo data has no subjects or books.
async function seedTenThisHour(ctx) {
  const ids = Array.from({ length: 10 }, () => crypto.randomUUID());
  await ctx.sql('insert into assessment_requests (id, user_id, surface, grade_code, subject_code, textbook_id, chapter_number, question_count, created_at) '
    + 'select x.id::uuid, u.id, \'portal\', \'grade_5\', \'maths\', '
    + "(select id from textbooks where curriculum = 'ict' and grade = 5 and subject = 'maths' limit 1), 1, 10, now() - (x.n || ' minutes')::interval "
    + 'from users u, (values ' + ids.map((id, i) => "('" + id + "', " + (i + 1) * 3 + ')').join(', ') + ') as x(id, n) '
    + "where u.phone_number = '" + TEACHER_PHONE + "'");
  return ids;
}
const unseed = (ctx, ids) => ctx.sql('delete from assessment_requests where id in (' + ids.map((id) => "'" + id + "'").join(', ') + ')');

// The Grade 5 books the generator offers. The class picker lists only grades and subjects with an ICT book
// (assessment-browse listGrades/listSubjects), and the demo data (DATA=demo, the default) has none: every grade is greyed
// out and no scenario can reach Grade 5. Added only where missing, so a sandbox copy keeps its own books; the run's
// database is its own and is dropped at the end of the run.
const G5_SUBJECTS = ['english', 'maths', 'science'];
async function catalogue(ctx) {
  const list = G5_SUBJECTS.map((s) => "('" + s + "')").join(', ');
  await ctx.sql('insert into subjects (code) select s from (values ' + list + ') as x(s) on conflict (code) do nothing');
  await ctx.sql("insert into textbooks (curriculum, grade, subject, filename, total_pages) "
    + "select 'ict', 5, s, 'e2e-fde-g5-' || s || '.pdf', 100 from (values " + list + ') as x(s) '
    + "where not exists (select 1 from textbooks t where t.curriculum = 'ict' and t.grade = 5 and t.subject = x.s)");
}

async function bodyText(page) { return page.evaluate(() => document.body.innerText); }


// ── FB09–FB26: the @sandbox scenarios (bd-q8wt5e.6.5) ────────────────────────────────────────────────────────────────
// What the local stack can prove is proved here with the real portal and bot (the switch, the server's refusals, its
// status answer, the request the app builds). A ready paper, its editor and its Versions are answered by page.route where
// a scenario is about the screen, in the shapes portal/src/portal/services/api.ts reads. What only a model-written paper
// can show (the printed PDF, the prompt, a retry after a short draw) is reported BLOCKED, naming what was proved first:
// this lane's bot replays recorded vendor calls only (E2E_CASSETTE=replay-strict) and cannot write a paper.
const NEW = HUB + '/new/';
const PICKS_KEY = 'teacher-v2-assessment-new:v1';
const NO_PAPER = "this lane's bot cannot write a paper (vendor calls are replay-only), so ";
const asJson = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const stepIs = (page, label) => page.getByRole('progressbar', { name: label }).first().waitFor({ state: 'attached', timeout: 15000 }).then(() => true, () => false);
const reasonOf = async (page) => ((await page.getByTestId('button-reason').count()) ? (await page.getByTestId('button-reason').innerText()).trim() : '');
const pickerSwitch = (ctx, on) => setSetting(ctx, 'assessment_book_picker_enabled', on ? 'true' : 'false');
const dropIds = (ctx, ids) => (ids.length ? ctx.sql('delete from assessment_requests where id in (' + ids.map((id) => "'" + id + "'").join(', ') + ')') : null);

async function addBook(ctx, grade, subject) {
  await ctx.sql("insert into subjects (code) values ('" + subject + "') on conflict (code) do nothing");
  await ctx.sql("insert into textbooks (curriculum, grade, subject, filename, total_pages) select 'ict', " + grade + ", '" + subject + "', "
    + "'e2e-fde-g" + grade + '-' + subject + ".pdf', 100 where not exists (select 1 from textbooks t where t.curriculum = 'ict' and t.grade = "
    + grade + " and t.subject = '" + subject + "')");
}

// Hub → the FDE door → a Grade 5 subject → Check and make (the door path FB02 takes).
async function toCheck(page, ctx, subject) {
  await visit(page, ctx, HUB, { heading: /^Assessment$/ });
  await page.getByTestId('fde-door').click();
  await page.waitForURL('**' + NEW + 'class');
  await page.getByRole('button', { name: /Select grade and subject/ }).click();
  await page.getByRole('button', { name: new RegExp('^Grade 5 · ' + subject) }).click();
  await page.waitForURL('**' + NEW + 'check');
  await page.getByTestId('fde-row-inside').waitFor({ state: 'visible', timeout: 15000 });
}

// A board-pattern Grade 5 request queued a moment ago, its paper not started: what findGenerating reads as in flight.
async function seedInFlight(ctx, subject, minutesAgo = 0) {
  const id = crypto.randomUUID();
  await ctx.sql('insert into assessment_requests (id, user_id, surface, grade_code, subject_code, textbook_id, chapter_number, question_count, question_types, created_at) '
    + "select '" + id + "'::uuid, u.id, 'portal', 'grade_5', '" + subject + "', "
    + "(select id from textbooks where curriculum = 'ict' and grade = 5 and subject = '" + subject + "' limit 1), 1, 48, "
    + "'[{\"slot\": \"" + subject + ".A.Q1a\", \"type\": \"MCQs\", \"count\": 1}]'::jsonb, now() - interval '" + minutesAgo + " minutes' "
    + "from users u where u.phone_number = '" + TEACHER_PHONE + "'");
  return id;
}

// An FDE paper in the editor, answered by page.route (GET /assessment/edit/:id/questions); writes are caught, never sent.
function fdeItem(id, number, slot, section, marks, blooms, type) {
  return { id, number, removed: false, type: type || 'Short Answer', section, marks, text: 'Question ' + id, fields: { question: 'Question ' + id, marks }, slot, blooms: blooms || null };
}
async function editor(page, ctx, paper, items) {
  const writes = [];
  await page.route('**/api/portal/assessment/edit/*/questions', (r) => asJson(r, { success: true, paper, items }));
  await page.route(/\/api\/portal\/assessment\/edit\/[^/]+\/(validate|save)$/, (r) => { writes.push(r.request().url()); return asJson(r, { success: false, errorCode: 'PATTERN_NO_ADD', error: 'Board-pattern papers keep their shape.' }, 400); });
  await page.goto(ctx.baseUrl + HUB + '/paper/' + paper.paperId + '/edit', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('edit-both').waitFor({ timeout: 15000 });
  return writes;
}
const Q2 = [{ slot: 'maths.B.Q2', label_en: 'Q2', label_ur: 'سوال 2', generate: 12, attempt: 8, marks_each: 5 }];
const mathsPaper = () => ({ paperId: 'e2e-fb-maths', version: 1, grade: 5, subject: 'Mathematics', subjectKey: 'maths', chapterNumber: null, rtl: false,
  questionCount: 14, marks: 100, pattern: PATTERN, choices: Q2 });
const mathsItems = () => [fdeItem('a1', 1, 'maths.A.Q1a', 'objective', 1), fdeItem('a2', 2, 'maths.A.Q1a', 'objective', 1),
  ...Array.from({ length: 12 }, (_, i) => fdeItem('b' + (i + 1), i + 3, 'maths.B.Q2', 'subjective', 5))];
const marksChip = async (page) => ((await bodyText(page)).match(/(\d+) marks/) || [])[1];
const willSays = (page) => page.getByTestId('will-say').allInnerTexts();

async function fb09(page, ctx) {
  await patternSwitch(ctx, true);
  const made = [];
  try {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await toCheck(page, ctx, 'Maths');
    const answer = page.waitForResponse((r) => r.url().includes('/api/portal/assessment/generate'), { timeout: 30000 });
    await page.getByTestId('step-next').click();
    const res = await answer;
    const body = await res.json().catch(() => ({}));
    if (typeof body.requestId === 'string') made.push(body.requestId);
    const sent = res.request().postDataJSON();
    expect(res.status() < 300 && body.requestId, 'Make my paper should queue the paper, got ' + res.status() + ' ' + JSON.stringify(body).slice(0, 160));
    expect(sent.pattern === PATTERN && sent.scope === 'fde', 'the request should carry the pattern and the FDE syllabus');
    return { blocked: NO_PAPER + 'its sections, Q2\'s "(8×5=40)", Total Marks 100, the marking scheme PDF and the ready screen\'s page counts cannot be '
      + 'checked here. Proved: one tap after the subject (door → Maths → Make my paper) queues a ' + PATTERN + ' request (HTTP ' + res.status() + ')' };
  } finally {
    await unseed(ctx, made);
    await patternSwitch(ctx, false);
  }
}

async function fb10(page, ctx) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  const id = 'e2e-fb10';
  await page.route('**/api/portal/assessment/status/**', (r) => asJson(r, { success: true, status: 'ready', paperId: id, pattern: PATTERN, created_at: new Date().toISOString() }));
  await page.route('**/api/portal/assessment/papers**', (r) => asJson(r, { success: true, total: 1, page: 1, pageSize: 10, papers: [{ paper_id: id, grade: 5,
    subject_key: 'social_studies', subject: 'Social Studies', chapter_number: null, question_count: 46, total_marks: 100, ready_at: new Date().toISOString(),
    has_answer_key: true, version: 1, pattern: PATTERN, pages: { paper: 5, scheme: 4 } }] }));
  await page.route('**/api/portal/assessment/paper/' + id + '/view', (r) => asJson(r, { success: true, sections: [],
    paper: { youAdd: { en: 'the map of Pakistan', ur: 'پاکستان کا نقشہ', page: 3 } } }));
  await page.goto(ctx.baseUrl + HUB + '/request/' + id, { waitUntil: 'domcontentloaded' });
  const add = page.getByTestId('fde-ready-youadd');
  await add.waitFor({ timeout: 15000 });
  const line = (await add.innerText()).trim();
  expect(line === 'You add · the map of Pakistan · p. 3', 'the ready screen should say "You add · the map of Pakistan · p. 3", got ' + line);
  const [paper, scheme, box] = await Promise.all(['fde-ready-paper', 'fde-ready-scheme', 'fde-ready-youadd'].map((t) => page.getByTestId(t).boundingBox()));
  expect(box.y > paper.y && box.y > scheme.y, 'the You add line should sit under "Question paper" and "Marking scheme"');
  return { blocked: NO_PAPER + 'the page the map goes on is not read from a real question paper here. Proved with a ready paper answered by '
    + 'page.route (its paper view carrying youAdd page 3): the ready screen says "' + line + '" under Question paper and Marking scheme' };
}

async function fb11(page, ctx) {
  await patternSwitch(ctx, true);
  try {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const sent = [];
    await page.route('**/api/portal/assessment/generate', (r) => { sent.push(r.request().postDataJSON()); return asJson(r, { success: true, requestId: 'e2e-fb11' }, 202); });
    await page.route('**/api/portal/assessment/status/**', (r) => asJson(r, { success: true, status: 'generating', pattern: PATTERN }));
    await toCheck(page, ctx, 'English');
    await page.getByTestId('fde-row-syllabus').click();
    const syl = page.getByTestId('fde-syllabus-tray');
    await syl.waitFor({ state: 'visible' });
    const boxes = syl.getByRole('checkbox');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) if (i !== 2 && i !== 3) await boxes.nth(i).click(); // keep units 3 and 4
    await syl.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByTestId('fde-row-inside').click();
    const inside = page.getByTestId('fde-inside-tray');
    await inside.waitFor({ state: 'visible' });
    const text = await inside.innerText();
    expect(text.includes('Covers Units 3–4; every section set from these units'), 'Inside should say "Covers Units 3–4; every section set from these units"');
    for (const sec of ['A', 'B', 'C']) expect(new RegExp('(^|\\n)' + sec + '(\\n|$)').test(text), 'Inside should keep section ' + sec);
    await inside.getByRole('button', { name: 'Close' }).first().click();
    await page.getByTestId('step-next').click();
    const deadline = Date.now() + 15000;
    while (!sent.length && Date.now() < deadline) await page.waitForTimeout(250);
    expect(sent.length === 1, 'Make my paper should send one request');
    const b = sent[0];
    expect(b.pattern === PATTERN && JSON.stringify(b.chapterNumbers) === '[3,4]', 'the request should carry the pattern and units 3 and 4, got ' + JSON.stringify({ p: b.pattern, c: b.chapterNumbers, scope: b.scope }));
    return { blocked: NO_PAPER + 'that the paper has the same sections and marks as a full-syllabus paper cannot be checked. Proved: Inside says '
      + '"Covers Units 3–4; every section set from these units" with sections A, B and C, and the request carries ' + PATTERN + ' with units [3,4]' };
  } finally {
    await patternSwitch(ctx, false);
  }
}

async function fb12(page, ctx) {
  await addBook(ctx, 5, 'urdu');
  await patternSwitch(ctx, true);
  try {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const o = await api(page, ctx, 'GET', '/assessment/options?grade=5&subject=urdu');
    const p = ((o.json || {}).patterns || [])[0];
    expect(p && p.id === PATTERN, 'Grade 5 Urdu options should offer ' + PATTERN);
    const held = (p.scope && p.scope.held) || [];
    const chapters = (p.scope && p.scope.chapters) || [];
    expect([1, 2, 3].every((n) => held.includes(n) && !chapters.includes(n)), 'lessons 1 to 3 should be held out of the Urdu FDE syllabus, got chapters '
      + JSON.stringify(chapters) + ' held ' + JSON.stringify(held));
    return { blocked: NO_PAPER + 'right-to-left, Urdu digits and the حصہ الف/ب/ج sections are properties of the printed paper. Proved: the bot\'s Grade 5 '
      + 'Urdu pattern sets no item on lessons 1–3 (syllabus ' + JSON.stringify(chapters) + ', held ' + JSON.stringify(held) + ')' };
  } finally {
    await patternSwitch(ctx, false);
  }
}

async function fb13(page, ctx) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  const writes = await editor(page, ctx, mathsPaper(), mathsItems());
  const before = await willSays(page);
  expect(before.length === 12 && before.every((t) => t === 'Q2 will then say: any eight of eleven'), 'each Q2 question should say "Q2 will then say: any eight of eleven", got ' + JSON.stringify(before.slice(0, 2)));
  const m0 = await marksChip(page);
  await page.getByRole('checkbox', { name: 'Remove question 3' }).click();
  const after = await willSays(page);
  expect(after.filter((t) => t === 'Q2 will then say: any eight of ten').length === 11 && after.includes('Q2 will then say: any eight of twelve'),
    'after one removal the others should say "any eight of ten" and the removed one "any eight of twelve", got ' + JSON.stringify([...new Set(after)]));
  expect(await marksChip(page) === m0, 'the marks chip should stay ' + m0);
  expect(!writes.length, 'nothing should be saved by a removal alone');
  return { blocked: NO_PAPER + 'version 2\'s printed "Attempt any eight of the following eleven questions", its two files and the scheme\'s box cannot be '
    + 'checked. Proved in the editor (paper answered by page.route): "Q2 will then say: any eight of eleven", then ten / twelve after one '
    + 'removal, marks chip unchanged at ' + m0 };
}

async function fb14(page, ctx) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  await editor(page, ctx, mathsPaper(), mathsItems());
  const m0 = Number(await marksChip(page));
  for (const n of [3, 4, 5, 6, 7]) await page.getByRole('checkbox', { name: 'Remove question ' + n }).click();
  const m1 = Number(await marksChip(page));
  expect(m1 === m0 - 5, 'removing five of Q2\'s twelve (seven left, under the eight to attempt) should lower the marks by 5, ' + m0 + ' → ' + m1);
  const lines = [...new Set(await willSays(page))];
  expect(lines.includes('Q2 will then say: attempt all six'), 'a kept Q2 question should say "Q2 will then say: attempt all six", got ' + JSON.stringify(lines));
  return { blocked: NO_PAPER + 'version 2\'s printed "(7×5=35)", Section B 35 and Total Marks 95 cannot be checked. Proved in the editor (paper answered '
    + 'by page.route): with five Q2 questions removed the marks drop by 5 (' + m0 + ' → ' + m1 + ') and the attempt count follows the questions left' };
}

async function fb15(page, ctx) {
  await patternSwitch(ctx, true);
  const ids = [];
  try {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    // the app's own state: a paper for Grade 5 Maths being made (Make caught by page.route, so the job is this page's)
    await page.route('**/api/portal/assessment/generate', (r) => asJson(r, { success: true, requestId: 'e2e-fb15' }, 202));
    await page.route('**/api/portal/assessment/status/**', (r) => asJson(r, { success: true, status: 'generating', pattern: PATTERN }));
    await toCheck(page, ctx, 'Maths');
    await page.getByTestId('step-next').click();
    await page.waitForURL('**/request/e2e-fb15');
    await page.goto(ctx.baseUrl + NEW + 'check', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('fde-row-inside').waitFor({ timeout: 15000 });
    expect(await page.getByTestId('step-next').isDisabled(), 'Make my paper should be off for the same class');
    const why = await reasonOf(page);
    expect(why === 'A paper for this class is being made', 'Make should say "A paper for this class is being made", got ' + why);
    await page.unroute('**/api/portal/assessment/generate');
    // the server's side: a stale request while one is in flight is refused
    ids.push(await seedInFlight(ctx, 'maths'));
    const r = await api(page, ctx, 'POST', '/assessment/generate', fdeBody(5, 'maths'));
    if (r.json && typeof r.json.requestId === 'string' && r.status < 300) ids.push(r.json.requestId);
    expect(r.status === 409 && r.json.errorCode === 'ALREADY_GENERATING', 'a stale request should be refused 409 ALREADY_GENERATING, got ' + r.status + ' ' + (r.json && r.json.errorCode));
    expect(/A paper for this class is being made/.test(r.json.error), 'the refusal should say "A paper for this class is being made", got ' + r.json.error);
    return { why, status: r.status, error: r.json.error };
  } finally {
    await dropIds(ctx, ids);
    await patternSwitch(ctx, false);
  }
}

async function fb16(page, ctx) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  const writes = await editor(page, ctx, mathsPaper(), mathsItems());
  const add = page.getByTestId('add-disabled');
  await add.waitFor({ timeout: 10000 });
  expect(await add.isDisabled(), 'Add question should be off on a board-pattern paper');
  const why = (await page.getByTestId('button-reason').allInnerTexts()).map((t) => t.trim());
  expect(why.includes('Board-pattern papers keep their shape'), 'the editor should say "Board-pattern papers keep their shape", got ' + JSON.stringify(why));
  await add.click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  expect(!writes.length, 'no new version should be asked for');
  return { why: 'Board-pattern papers keep their shape', saves: writes.length, paper: 'answered by page.route' };
}

async function fb17(page, ctx) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  const paper = { ...mathsPaper(), paperId: 'e2e-fb17', subject: 'Science', subjectKey: 'science', choices: [] };
  const items = [fdeItem('s1', 1, 'science.A.Q1', 'objective', 10, 'Remember', 'MCQs'), fdeItem('s2', 2, 'science.B.Q2', 'subjective', 10, 'Understand'),
    fdeItem('s3', 3, 'science.B.Q3', 'subjective', 10, 'Apply'), fdeItem('s4', 4, 'science.C.Q4', 'subjective', 10, 'Apply')];
  await editor(page, ctx, paper, items);
  const tags = await page.getByTestId('bloom-tag').allInnerTexts();
  expect(tags.length === 4, 'each question should show its level, got ' + JSON.stringify(tags));
  const summary = () => page.getByTestId('edit-summary').innerText();
  const s0 = await summary();
  expect(/Remember 25%/.test(s0) && /Apply 50%/.test(s0) && /MCQs 1/.test(s0), 'the summary should show each level\'s share and each type\'s count, got ' + s0.replace(/\n/g, ' | '));
  const target = await page.getByTestId('fde-target').innerText();
  for (const w of ['Remember 30%', 'Understand 30%', 'Apply 40%']) expect(target.includes(w), 'the FDE target should show "' + w + '", got ' + target.replace(/\n/g, ' | '));
  await page.getByRole('checkbox', { name: 'Remove question 4' }).click();
  const s1 = await summary();
  expect(s1 !== s0 && /Apply 33%/.test(s1), 'the summary should follow Remove, got ' + s1.replace(/\n/g, ' | '));
  return { blocked: NO_PAPER + 'that the saved paper and marking scheme print no levels, no summary and no FDE target cannot be checked. Proved in the '
    + 'editor (Grade 5 Science board paper answered by page.route): each question\'s level, the share/type summary following Remove, and FDE target '
    + 'Remember 30% · Understand 30% · Apply 40%' };
}

async function fb18() {
  return { blocked: 'the spec marks this @no-mock-driver: the refusal is decided on a real paper\'s slot-tagged items, which only a sandbox paper '
    + 'carries; ' + NO_PAPER + 'there is no such paper here (the editor\'s PATTERN_FIXED_MARKS words are teacher-assessment TA11)' };
}

async function fb19(page, ctx) {
  await patternSwitch(ctx, true);
  const ids = [];
  try {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const all = await Promise.all([0, 1, 2].map(() => api(page, ctx, 'POST', '/assessment/generate', fdeBody(5, 'maths'))));
    for (const r of all) if (r.json && typeof r.json.requestId === 'string') ids.push(r.json.requestId);
    const ok = all.filter((r) => r.status < 300);
    const busy = all.filter((r) => r.status === 409 && r.json && r.json.errorCode === 'ALREADY_GENERATING');
    expect(ok.length === 1 && busy.length === 2, 'three at once should queue one and refuse two, got ' + JSON.stringify(all.map((r) => [r.status, r.json && r.json.errorCode])));
    const queued = ok[0].json.requestId;
    expect(busy.every((r) => /A paper for this class is being made/.test(r.json.error) && r.json.requestId === queued),
      'the two refusals should say "A paper for this class is being made" with the queued paper\'s request');
    const rows = Number(await ctx.sql("select count(*) from assessment_requests where id in (" + [...new Set(ids)].map((i) => "'" + i + "'").join(', ') + ')'));
    expect(rows === 1, 'one request row should be written, found ' + rows);
    return { statuses: all.map((r) => r.status), queued };
  } finally {
    await dropIds(ctx, [...new Set(ids)]);
    await patternSwitch(ctx, false);
  }
}

async function fb20(page, ctx) {
  const ids = [];
  try {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const fde = await seedInFlight(ctx, 'maths', 4);
    ids.push(fde);
    const plain = crypto.randomUUID();
    await ctx.sql('insert into assessment_requests (id, user_id, surface, grade_code, subject_code, textbook_id, chapter_number, question_count, created_at) '
      + "select '" + plain + "'::uuid, u.id, 'portal', 'grade_5', 'maths', (select id from textbooks where curriculum = 'ict' and grade = 5 and subject = 'maths' limit 1), "
      + "1, 10, now() from users u where u.phone_number = '" + TEACHER_PHONE + "'");
    ids.push(plain);
    const s = await api(page, ctx, 'GET', '/assessment/status/' + fde);
    expect(s.json && s.json.pattern === PATTERN && !Number.isNaN(Date.parse(s.json.created_at)), 'the status answer should carry the pattern and when it was asked for, got ' + JSON.stringify(s.json));
    const p = await api(page, ctx, 'GET', '/assessment/status/' + plain);
    expect(p.json && !('pattern' in p.json) && !('created_at' in p.json), 'a plain request\'s status should carry neither, got ' + JSON.stringify(p.json));
    // reopened: a fresh tab of the app (no job of its own) on the paper's link
    const again = await page.context().newPage();
    try {
      await again.goto(ctx.baseUrl + HUB + '/request/' + fde, { waitUntil: 'domcontentloaded' });
      await again.getByText('FDE pattern', { exact: true }).waitFor({ timeout: 15000 });
      const text = await again.evaluate(() => document.body.innerText);
      expect(/\d+ min so far/.test(text), 'the reopened wait screen should show how long ago the paper was started (asked 4 min ago); it shows '
        + JSON.stringify(text.split('\n').filter(Boolean).slice(0, 8)) + ' — RequestPage.tsx:156 counts minutes only from this tab\'s own job '
        + '(job.startedAt) and never from the status answer\'s created_at, and the elapsed chip is drawn only for a slow job of its own (:174-175); the status answer has carried created_at for this since 031a7cea89 ("status and versions name a board-pattern request")');
    } finally {
      await again.close();
    }
    return { status: s.json };
  } finally {
    await dropIds(ctx, ids);
  }
}

const noModel = (what) => async () => ({ blocked: NO_PAPER + what });

async function fb24(page, ctx) {
  await patternSwitch(ctx, true);
  try {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    let down = false;
    await page.route(/\/api\/portal\/assessment\/options\?.*subject=maths/, (r) => (down ? r.abort('internetdisconnected') : r.continue()));
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    // down before the door opens: the door's own early read of each subject's pattern fails too, so the tap reads again
    down = true;
    await page.getByTestId('fde-door').click();
    await page.waitForURL('**' + NEW + 'class');
    await page.getByRole('button', { name: /Select grade and subject/ }).click();
    await page.getByRole('button', { name: /^Grade 5 · Maths/ }).click();
    // the Class step's own alert (the shell's paper notices are alerts too)
    const alert = page.getByRole('alert').filter({ hasText: 'Could not load' }).first();
    expect(await alert.waitFor({ timeout: 15000 }).then(() => true, () => false), 'Class should say "Could not load"');
    await page.waitForTimeout(1000);
    expect(new URL(page.url()).pathname.endsWith('/new/class'), 'the teacher should stay on Class, is on ' + page.url());
    down = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await page.waitForURL('**' + NEW + 'check', { timeout: 15000 });
    await page.getByTestId('fde-row-inside').waitFor({ timeout: 15000 });
    return { landed: 'check' };
  } finally {
    await patternSwitch(ctx, false);
  }
}

// The step itself, without the shell's paper notices (they carry other papers of this teacher, made by other scenarios,
// and lift the dock by their height): the notices and every floating layer are hidden, and the dock is compared by its
// words and state instead.
async function stepShot(page) {
  const dock = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-testid="notice-spacer"], [class*="z-[45]"]')) el.style.display = 'none';
    const next = document.querySelector('[data-testid="step-next"]');
    const why = document.querySelector('[data-testid="button-reason"]');
    const out = { next: next ? next.innerText.trim() : null, off: next ? !!next.disabled : null, why: why ? why.innerText.trim() : null };
    for (const el of document.querySelectorAll('main *')) {
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') { el.dataset.e2eHid = '1'; el.style.visibility = 'hidden'; }
    }
    return out;
  });
  await page.waitForTimeout(300);
  const shot = await page.locator('main').first().screenshot({ animations: 'disabled' });
  await page.evaluate(() => { for (const el of document.querySelectorAll('[data-e2e-hid]')) { el.style.visibility = ''; delete el.dataset.e2eHid; } });
  return { shot, dock: JSON.stringify(dock) };
}
const sameScreen = (a, b) => a.dock === b.dock && a.shot.equals(b.shot);

// Grade 3 Urdu, the default mix Questions starts with: the screens and the request, with the switch off and on.
async function g3UrduPaper(page, ctx) {
  const sent = [];
  const catch_ = (r) => { sent.push(r.request().postDataJSON()); return asJson(r, { success: true, requestId: 'e2e-fb25' }, 202); };
  await page.route('**/api/portal/assessment/generate', catch_);
  await page.goto(ctx.baseUrl + HUB, { waitUntil: 'domcontentloaded' });
  // a clean tab each time: no job or notice of the run before, only her picks
  await page.evaluate(([k, v]) => { sessionStorage.clear(); sessionStorage.setItem(k, v); }, [PICKS_KEY, JSON.stringify({ grade: 3, subject: 'urdu', subjectName: 'Urdu', coverBy: 'chapters', chapters: [1], ranges: [] })]);
  await page.goto(ctx.baseUrl + NEW + 'questions', { waitUntil: 'networkidle' });
  await page.getByTestId('questions-total').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  const questions = await stepShot(page);
  await page.getByTestId('step-next').click();
  await page.waitForURL('**' + NEW + 'check');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  const check = await stepShot(page);
  await page.getByTestId('step-next').click();
  const deadline = Date.now() + 15000;
  while (!sent.length && Date.now() < deadline) await page.waitForTimeout(250);
  await page.unroute('**/api/portal/assessment/generate', catch_);
  return { questions, check, request: sent[0] };
}

async function fb25(page, ctx) {
  await addBook(ctx, 3, 'urdu');
  await asRole(page, ctx, 'teacher', 'teacherV2');
  await page.route('**/api/portal/assessment/chapters**', (r) => asJson(r, { success: true, chapters: [
    { chapter_number: 1, chapter_title: 'Lesson 1', page_start: 1, page_end: 10, page_count: 10 }] }));
  await page.route('**/api/portal/assessment/status/**', (r) => asJson(r, { success: true, status: 'queued' }));
  await patternSwitch(ctx, false);
  const off = await g3UrduPaper(page, ctx);
  await patternSwitch(ctx, true);
  try {
    const on = await g3UrduPaper(page, ctx);
    expect(off.request && on.request, 'Make my paper should send a request each time');
    expect(JSON.stringify(on.request) === JSON.stringify(off.request), 'the request should be identical with the switch on and off: '
      + JSON.stringify(off.request) + ' vs ' + JSON.stringify(on.request));
    expect(!('pattern' in on.request), 'a Grade 3 request carries no pattern');
    expect(sameScreen(on.questions, off.questions), 'Questions should be pixel-identical with the switch on and off');
    expect(sameScreen(on.check, off.check), 'Check and make should be pixel-identical with the switch on and off');
    return { blocked: NO_PAPER + 'the prompt and the printed paper cannot be compared. Proved: Grade 3 Urdu\'s Questions and Check screens are '
      + 'pixel-identical and its request is identical with the switch on and off (' + JSON.stringify(on.request).slice(0, 160) + ')' };
  } finally {
    await patternSwitch(ctx, false);
  }
}

async function fb26(page, ctx) {
  await patternSwitch(ctx, true);
  await pickerSwitch(ctx, true);
  try {
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const sent = [];
    await page.route('**/api/portal/assessment/generate', (r) => { sent.push(r.request().postDataJSON()); return asJson(r, { success: true, requestId: 'e2e-fb26' }, 202); });
    await page.route('**/api/portal/assessment/status/**', (r) => asJson(r, { success: true, status: 'generating', pattern: PATTERN }));
    const o = await api(page, ctx, 'GET', '/assessment/options?grade=5&subject=maths');
    expect(o.json && o.json.bookPicker === true, 'the book picker should be on for this run');
    await toCheck(page, ctx, 'Maths');
    expect(!(await bodyText(page)).includes('Select from the book'), 'Check and make on the board pattern should show no "Select from the book"');
    // her own paper instead, by chapters: Questions offers the book
    await page.getByTestId('fde-row-style').click();
    const style = page.getByTestId('fde-style-tray');
    await style.waitFor({ state: 'visible' });
    await style.getByRole('radio', { name: /My own paper/ }).click();
    await style.getByTestId('fde-style-next').click();
    await page.waitForURL('**' + NEW + 'questions');
    const offered = await page.getByText('Select from the book').first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    expect(offered, 'her own paper by chapters should show "Select from the book" on Questions');
    // and the board-pattern request carries no picked book questions
    await toCheck(page, ctx, 'Maths');
    await page.getByTestId('step-next').click();
    const deadline = Date.now() + 15000;
    while (!sent.length && Date.now() < deadline) await page.waitForTimeout(250);
    expect(sent.length === 1 && sent[0].pattern === PATTERN, 'Make my paper should send the board-pattern request');
    expect(!sent[0].seenPicked || !sent[0].seenPicked.length, 'the board-pattern request should carry no picked book questions');
    return { bookPicker: true, ownPaperOffersBook: offered };
  } finally {
    await pickerSwitch(ctx, false);
    await patternSwitch(ctx, false);
  }
}

const SANDBOX = [
  { id: 'FB09', title: 'A Grade 5 Maths teacher gets a board-pattern paper and a marking scheme in one tap after the subject', run: fb09 },
  { id: 'FB10', title: 'The ready screen says what the teacher adds and the page it goes on', run: fb10 },
  { id: 'FB11', title: 'A chapter-scoped FDE paper keeps the board shape and says what it covers', run: fb11 },
  { id: 'FB12', title: 'An Urdu board-pattern paper is right-to-left with Urdu digits and no item from lessons 1 to 3', run: fb12 },
  { id: 'FB13', title: 'Removing a question from a choice group keeps the choice honest', run: fb13 },
  { id: 'FB14', title: 'Removing more questions than the choice allows lowers the attempt count and the total', run: fb14 },
  { id: 'FB15', title: 'A second paper for the same class is not made while the first is being made', run: fb15 },
  { id: 'FB16', title: 'Adding a question to a board-pattern paper is refused with a reason', run: fb16 },
  { id: 'FB17', title: "Editing a board-pattern paper shows the Bloom's summary and leaves the printed files alone", run: fb17 },
  { id: 'FB18', title: "Changing a board-pattern question's marks is refused, and sending the same marks back is not an edit", run: fb18 },
  { id: 'FB19', title: 'Three requests for the same class at the same moment make one paper', run: fb19 },
  { id: 'FB20', title: 'A reopened wait page still knows it is a board-pattern paper', run: fb20 },
  { id: 'FB21', title: 'A Maths paper whose first draw set aside two MCQs is still made whole', run: noModel('the first draw, its two MCQs with equal options and the section asked once more are the model\'s replies, which this lane cannot make') },
  { id: 'FB22', title: 'A paper that still fails keeps what was written', run: noModel('a paper coming back short twice (PATTERN_SHORT_SLOT) needs the model to write it, which this lane cannot do') },
  { id: 'FB23', title: 'A board-pattern paper that comes back short is made once more before the teacher hears of it', run: noModel('a whole run coming back short of a slot, and the second run from nothing, are the model\'s replies, which this lane cannot make') },
  { id: 'FB24', title: 'A failed read on the FDE door keeps the teacher on Class with Try again', run: fb24 },
  { id: 'FB25', title: 'A paper for any other grade is unchanged', run: fb25 },
  { id: 'FB26', title: 'A board-pattern paper never offers Select from the book', run: fb26 },
];

const scenarios = [
  { id: 'FB01', title: 'The hub offers FDE pattern papers when the switch is on', run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    await page.getByTestId('fde-door').waitFor({ state: 'visible', timeout: 15000 });
    expect((await page.getByTestId('fde-door').innerText()).includes('FDE pattern papers'), 'the door does not say FDE pattern papers');
    const o = await api(page, ctx, 'GET', '/assessment/options?grade=5&subject=maths');
    expect(o.status === 200, 'options answered ' + o.status);
    expect(Array.isArray(o.json.patternGrades) && o.json.patternGrades.includes(5), 'no patternGrades [5] in options');
    expect((o.json.patterns || []).some((p) => p.id === PATTERN), 'Grade 5 Maths options do not name ' + PATTERN);
    return { patterns: o.json.patterns.map((p) => p.id) };
  } },

  { id: 'FB02', title: 'Check and make says what is inside before the paper is made', run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    await page.getByTestId('fde-door').click();
    // The door's picker opens straight on Grade 5's subjects (no grade step).
    await page.getByRole('button', { name: /Select grade and subject/ }).click();
    await page.getByRole('button', { name: /^Grade 5 · Science/ }).click();
    await page.getByTestId('step-next').waitFor({ state: 'visible', timeout: 15000 });
    // Count the finished page: Make shows before the pattern's rows load, and a count taken then passed headless
    // with words still missing (a slowed --headed run counted 55).
    await page.getByTestId('fde-row-inside').waitFor({ state: 'visible', timeout: 15000 });
    // Words above Make my paper: everything the teacher reads before the button.
    const above = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="step-next"]');
      if (!btn) return null;
      const top = btn.getBoundingClientRect().top;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const words = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !el.offsetParent || btn.contains(el)) continue;
        // A control that is only its label ("Edit") is not something she reads; a row whose button holds more is.
        const ctl = el.closest('button, a, [role="button"]');
        if (ctl && ctl.innerText.trim() === n.textContent.trim()) continue;
        // Words only: the "·" separators are not words.
        if (el.getBoundingClientRect().bottom <= top) words.push(...n.textContent.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)));
      }
      return words.length;
    });
    expect(above !== null, 'no Make my paper button on Check and make');
    expect(above <= 50, above + ' words above Make my paper (at most 50)');
    // The summary is the Inside row itself; the tray behind it lists the sections and what she adds.
    const row = await page.getByTestId('fde-row-inside').innerText();
    for (const want of ['3 sections', '100 marks', '3 hrs']) expect(row.includes(want), 'Inside row lacks "' + want + '"');
    await page.getByTestId('fde-row-inside').click();
    const tray = page.getByTestId('fde-inside-tray');
    await tray.waitFor({ state: 'visible', timeout: 15000 });
    const text = await tray.innerText();
    for (const sec of ['A', 'B', 'C']) expect(new RegExp('(^|\\n)' + sec + '(\\n|$)').test(text), 'Inside tray lacks section ' + sec);
    expect(text.includes('You add'), 'Inside tray lacks "You add"');
    expect(/diagram to label/i.test(text), 'Inside tray lacks "the diagram to label"');
    return { wordsAboveMake: above };
  } },

  { id: 'FB03', title: 'A teacher on plain New paper takes the side door', run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    await page.getByText('New paper').first().click();
    // The class picker is a collapsed trigger; its tray holds the grade radios and the subject buttons.
    await page.getByRole('button', { name: /Select grade and subject/ }).click();
    await page.getByRole('radio', { name: /^Grade 5/ }).click();
    await page.getByRole('button', { name: /^Grade 5 · English/ }).click();
    const card = page.getByTestId('fde-side-door');
    await card.waitFor({ state: 'visible', timeout: 15000 });
    await card.getByRole('radio').first().click();
    await page.getByTestId('step-next').click();
    await page.getByLabel('Step 2 of 2').first().waitFor({ state: 'attached', timeout: 15000 });
    await page.getByTestId('fde-row-inside').waitFor({ state: 'visible', timeout: 15000 });
    return { landed: 'check' };
  } },

  { id: 'FB04', title: 'With the switch off, nothing new appears and a stale request is refused clearly', run: async (page, ctx) => {
    await patternSwitch(ctx, false);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    await visit(page, ctx, HUB, { heading: /^Assessment$/ });
    expect(!(await page.getByTestId('fde-door').count()), 'the hub shows the FDE door with the switch off');
    expect(!(await bodyText(page)).includes('FDE pattern papers'), 'the hub says FDE pattern papers with the switch off');
    // The side-door card renders only from options' `patterns` (the app's own tests pin that), so options without
    // the keys is the proof that Chapters or pages shows no card.
    const o = await api(page, ctx, 'GET', '/assessment/options?grade=5&subject=maths');
    expect(!('patterns' in (o.json || {})) && !('patternGrades' in (o.json || {})), 'options carry pattern keys with the switch off');
    const r = await api(page, ctx, 'POST', '/assessment/generate', fdeBody(5, 'maths'));
    expect(r.status === 400, 'stale pattern request answered ' + r.status + ', not 400');
    expect(r.json && r.json.errorCode === 'PATTERN_OFF', 'errorCode ' + (r.json && r.json.errorCode) + ', not PATTERN_OFF');
    expect(/Board-pattern papers are off right now/.test(r.json.error), 'message: ' + r.json.error);
    return { status: r.status, errorCode: r.json.errorCode };
  } },

  { id: 'FB05', title: 'A Grade 4 request cannot carry the pattern', run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    await asRole(page, ctx, 'teacher', 'teacherV2');
    const r = await api(page, ctx, 'POST', '/assessment/generate', fdeBody(4, 'maths'));
    expect(r.status === 400, 'Grade 4 pattern request answered ' + r.status + ', not 400');
    expect(r.json && r.json.errorCode === 'PATTERN_INELIGIBLE', 'errorCode ' + (r.json && r.json.errorCode));
    expect(!r.json.requestId, 'a request id came back: something was queued');
    return { status: r.status, errorCode: r.json.errorCode };
  } },

  { id: 'FB06', title: 'A teacher who has made 10 papers this hour is told when the next one can be made', run: async (page, ctx) => {
    await limitSwitch(ctx, true);
    const ids = await seedTenThisHour(ctx);
    try {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const r = await api(page, ctx, 'POST', '/assessment/generate', fdeBody(5, 'maths'));
      expect(r.status === 429, 'the 11th request answered ' + r.status + ', not 429');
      expect(r.json.errorCode === 'RATE_LIMITED', 'errorCode ' + r.json.errorCode);
      expect(/^You have made 10 papers this hour\. The next one can be made at \d\d:\d\d\.$/.test(r.json.error), 'message: ' + r.json.error);
      expect(!Number.isNaN(Date.parse(r.json.retryAt)), 'retryAt is not a time: ' + r.json.retryAt);
      expect(!r.json.requestId, 'a request id came back: something was queued');
      return { status: r.status, retryAt: r.json.retryAt };
    } finally {
      await unseed(ctx, ids);
      await limitSwitch(ctx, false);
    }
  } },

  { id: 'FB07', title: 'With the soft limit off, a teacher past 10 papers this hour is not refused', run: async (page, ctx) => {
    await limitSwitch(ctx, false);
    const ids = await seedTenThisHour(ctx);
    try {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const r = await api(page, ctx, 'POST', '/assessment/generate', { grade: 5, subject: 'maths', chapterNumbers: [1],
        contentSource: 'unseen', questionCount: 5, questionTypes: [{ type: 'mcq', count: 5 }], answerLines: true, outputFormat: 'pdf' });
      // A request the bot accepted is ours to remove too (its paper rows go with it: ON DELETE CASCADE).
      if (r.json && typeof r.json.requestId === 'string') ids.push(r.json.requestId);
      expect(r.status !== 429 && !(r.json && r.json.errorCode === 'RATE_LIMITED'), 'refused for the limit with the limit off');
      return { status: r.status };
    } finally {
      await unseed(ctx, ids);
    }
  } },

  { id: 'FB08', title: "A board-pattern choice switched off mid-way goes back to today's Chapters step", run: async (page, ctx) => {
    await patternSwitch(ctx, true);
    try {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      await visit(page, ctx, HUB, { heading: /^Assessment$/ });
      await page.getByText('New paper').first().click();
      // The class picker is a collapsed trigger; its tray holds the grade radios and the subject buttons.
      await page.getByRole('button', { name: /Select grade and subject/ }).click();
      await page.getByRole('radio', { name: /^Grade 5/ }).click();
      await page.getByRole('button', { name: /^Grade 5 · English/ }).click();
      const card = page.getByTestId('fde-side-door');
      await card.waitFor({ state: 'visible', timeout: 15000 });
      await card.getByRole('radio').first().click();
      await page.getByText('Chapters are not used for the FDE board pattern').waitFor({ state: 'visible', timeout: 15000 });
      // The switch goes off while the teacher is on the step; a reload reads the options again (the app reads them once per load).
      await patternSwitch(ctx, false);
      await page.reload();
      const tab = page.getByRole('tab', { name: 'Chapters' });
      await tab.waitFor({ state: 'visible', timeout: 15000 });
      expect((await tab.getAttribute('aria-selected')) === 'true', 'the Chapters tab is not selected after the switch went off');
      expect(!(await page.getByTestId('fde-side-door').count()), 'the FDE board pattern card is still on Chapters or pages');
      await page.getByText('Select at least one chapter').first().waitFor({ state: 'visible', timeout: 15000 });
      expect(await page.getByTestId('step-next').isDisabled(), 'Next is not off on Chapters or pages');
      return { landed: 'chapters' };
    } finally {
      await patternSwitch(ctx, false);
    }
  } },
  ...SANDBOX,
];

// Every scenario starts on the catalogue, so a new one cannot forget it.
const withCatalogue = scenarios.map((s) => ({ ...s, run: async (page, ctx) => { await catalogue(ctx); return s.run(page, ctx); } }));

module.exports = { feature: 'fde-board-pattern', spec: 'tests/features/web/fde-board-pattern.feature', scenarios: withCatalogue };
