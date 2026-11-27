// teacher-assessment-questions — TA13, TA14, TA15 (bd-q8wt5e.6.5): a plain New paper's one Questions screen and its four
// steps. Joined to the teacher-assessment driver as gen_page_features.py EXTRA does.
//
// As TA18–TA22: the local stack's demo data has no Grade 4 Science book, so the assessment reads (options, chapters,
// topics) are answered by page.route with one Grade 4 Science chapter and no topics, and /assessment/generate is caught,
// never sent. What is checked is the teacher app itself: the screen, the reasons it gives, and the request it builds.
'use strict';
const { asRole, expect } = require('../lib.cjs');

const PICKS_KEY = 'teacher-v2-assessment-new:v1';
const NEW = '/portal/teacher/assessment/new/';
const TYPES = [['MCQs', 'objective'], ['True/False', 'objective'], ['Fill in the Blanks', 'objective'], ['Brief Answers', 'subjective']]
  .map(([id, category]) => ({ id, category }));
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function science(page, ctx, picks) {
  await asRole(page, ctx, 'teacher', 'teacherV2');
  const sent = [];
  await page.route('**/api/portal/assessment/options**', (r) => {
    const q = new URL(r.request().url()).searchParams;
    return json(r, { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15,
      ...(q.get('subject') ? { types: TYPES } : q.get('grade') ? { subjects: [{ subject_key: 'science', subject: 'Science' }] } : {}) });
  });
  await page.route('**/api/portal/assessment/chapters**', (r) => json(r, { success: true, chapters: [
    { chapter_number: 1, chapter_title: 'Green Guardians of Earth', page_start: 1, page_end: 28, page_count: 28 }] }));
  await page.route('**/api/portal/assessment/topics**', (r) => json(r, { success: true, topics: [] }));
  await page.route('**/api/portal/assessment/generate', (r) => { sent.push(r.request().postDataJSON()); return json(r, { success: true, requestId: 'e2e-ta13' }, 202); });
  await page.route('**/api/portal/assessment/status/**', (r) => json(r, { success: true, status: 'queued' }));
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k + ':e2e')) { sessionStorage.setItem(k, v); sessionStorage.setItem(k + ':e2e', '1'); } },
    [PICKS_KEY, JSON.stringify({ grade: 4, subject: 'science', subjectName: 'Science', coverBy: 'chapters', chapters: [1], ...picks })]);
  return sent;
}

const box = (page, name) => page.getByRole('textbox', { name: 'Number of ' + name, exact: true });
const seenBox = (page) => box(page, 'Seen questions');
const marksBox = (page) => page.getByRole('textbox', { name: 'Total marks' });
const total = async (page) => (await page.getByTestId('questions-total').innerText()).replace(/\s+/g, ' ').trim();
const reason = async (page) => ((await page.getByTestId('button-reason').count()) ? (await page.getByTestId('button-reason').innerText()).trim() : '');
const stepIs = (page, label) => page.getByRole('progressbar', { name: label }).first().waitFor({ state: 'attached', timeout: 15000 }).then(() => true, () => false);
const textOf = (page) => page.evaluate(() => (document.querySelector('main') || document.body).innerText);
async function waitFor(fn, ms = 8000) {
  const deadline = Date.now() + ms;
  let v;
  while (Date.now() < deadline) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); }
  return v;
}

/* ── TA13 ───────────────────────────────────────────────────────────────────── */
async function ta13(page, ctx) {
  const sent = await science(page, ctx, {});
  await page.goto(ctx.baseUrl + NEW + 'questions', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Please select the number of questions' }).waitFor({ timeout: 15000 });
  expect(await stepIs(page, 'Step 3 of 4'), 'Questions should say Step 3 of 4');
  expect((await seenBox(page).inputValue()) === '5', 'Seen questions should show 5');
  const unseen = {};
  for (const t of TYPES) unseen[t.id] = (await box(page, t.id).count()) ? await box(page, t.id).inputValue() : null;
  expect(JSON.stringify(unseen) === JSON.stringify({ MCQs: '4', 'True/False': '3', 'Fill in the Blanks': '3', 'Brief Answers': null }),
    'Unseen questions should show only MCQs 4, True/False 3 and Fill in the Blanks 3, got ' + JSON.stringify(unseen));
  expect(await total(page) === '15 questions · 5 seen · 10 unseen', 'the line above Next should read "15 questions · 5 seen · 10 unseen", got ' + await total(page));

  await page.getByRole('button', { name: /Add a type/ }).click();
  const tray = page.getByTestId('types-tray');
  await tray.waitFor();
  await tray.getByRole('checkbox', { name: 'Brief Answers' }).click();
  await tray.getByRole('button', { name: 'Done' }).click();
  await tray.waitFor({ state: 'detached' });
  expect((await box(page, 'Brief Answers').inputValue()) === '1', 'Brief Answers should be on the page at 1');
  expect(/^16 questions/.test(await total(page)), 'the line should read 16 questions, got ' + await total(page));

  await box(page, 'True/False').fill('2');
  await page.getByRole('button', { name: 'Fewer True/False', exact: true }).click();
  expect((await box(page, 'True/False').inputValue()) === '1', 'its minus should take True/False to 1');
  await page.getByRole('button', { name: 'Remove True/False', exact: true }).click();
  expect(await waitFor(async () => (await box(page, 'True/False').count()) === 0), 'True/False should be off the page');

  await page.getByTestId('step-next').click();
  await page.waitForURL('**' + NEW + 'check');
  await page.getByText('13 questions', { exact: true }).first().waitFor({ timeout: 15000 });
  const check = await textOf(page);
  expect(check.includes('5 seen · 8 unseen'), 'the Questions row should say "5 seen · 8 unseen"');
  for (const t of ['MCQs', 'Fill in the Blanks', 'Brief Answers']) expect(check.includes(t), 'the Questions row should name ' + t);
  expect(check.includes('Total marks'), 'Check should have a Total marks row');
  expect(!/(^|\n)File(\n|$)/.test(check), 'Check should have no File row');
  const lines = page.getByRole('switch', { name: /Answer lines/ });
  expect((await lines.getAttribute('aria-checked')) === 'true', 'Answer lines should start on');
  await lines.click();
  expect((await lines.getAttribute('aria-checked')) === 'false', 'Answer lines should turn off');
  await page.getByTestId('step-next').click();
  expect(await waitFor(() => sent.length === 1, 15000), 'Make my paper should send one request');
  const b = sent[0];
  const types = JSON.stringify((b.questionTypes || []).map((t) => [t.id, t.count]));
  expect(b.questionCount === 13 && b.contentSource === 'both' && b.seenCount === 5 && b.answerLines === false,
    'the request should carry questionCount 13, contentSource both, seenCount 5, answerLines false, got ' + JSON.stringify(b));
  expect(types === '[["MCQs",4],["Fill in the Blanks",3],["Brief Answers",1]]', 'the request should carry the three types with their counts, got ' + types);
  return { request: { questionCount: b.questionCount, contentSource: b.contentSource, seenCount: b.seenCount, questionTypes: b.questionTypes, answerLines: b.answerLines } };
}

/* ── TA14 ───────────────────────────────────────────────────────────────────── */
async function ta14(page, ctx) {
  await science(page, ctx, { seen: 5, typeCounts: { MCQs: 4 }, typesSeeded: true });
  await page.goto(ctx.baseUrl + NEW + 'questions', { waitUntil: 'domcontentloaded' });
  await seenBox(page).waitFor({ timeout: 15000 });
  const out = {};

  await seenBox(page).fill('');
  await box(page, 'MCQs').fill('1');
  await page.getByRole('button', { name: 'Remove MCQs', exact: true }).click();
  out.none = await waitFor(() => reason(page));
  expect(await page.getByTestId('step-next').isDisabled(), 'Next should be off with no questions');
  expect(out.none === 'Add at least 1 question', 'Next should say "Add at least 1 question", got ' + out.none);

  await page.getByRole('button', { name: /Add a type/ }).click();
  const tray = page.getByTestId('types-tray');
  await tray.getByRole('checkbox', { name: 'MCQs' }).click();
  await tray.getByRole('button', { name: 'Done' }).click();
  await tray.waitFor({ state: 'detached' });
  await seenBox(page).fill('45');
  await box(page, 'MCQs').fill('10');
  out.count = await waitFor(async () => ((await reason(page)) === 'Questions: 1 to 50' ? 'Questions: 1 to 50' : null));
  expect(await page.getByTestId('step-next').isDisabled(), 'Next should be off past 50');
  expect(out.count === 'Questions: 1 to 50', 'Next should say "Questions: 1 to 50", got ' + await reason(page));
  const red = [await seenBox(page).getAttribute('aria-invalid'), await box(page, 'MCQs').getAttribute('aria-invalid')];
  expect(red.every((v) => v === 'true'), 'the seen and MCQs boxes should be red (aria-invalid), got ' + JSON.stringify(red));

  await seenBox(page).fill('8');
  await box(page, 'MCQs').fill('4');
  await marksBox(page).fill('5');
  out.marksLow = await waitFor(async () => ((await reason(page)).startsWith('At least') ? reason(page) : null));
  expect(await page.getByTestId('step-next').isDisabled(), 'Next should be off under the count');
  expect(out.marksLow === 'At least 12 marks for 12 questions', 'Next should say "At least 12 marks for 12 questions", got ' + out.marksLow);

  await marksBox(page).fill('24');
  expect(await waitFor(async () => !(await page.getByTestId('step-next').isDisabled())), 'Next should come on at 24 marks');
  out.line = await total(page);
  expect(/24 marks$/.test(out.line), 'the line above Next should end "24 marks", got ' + out.line);
  await page.getByTestId('step-next').click();
  await page.waitForURL('**' + NEW + 'check');
  return out;
}

/* ── TA15 ───────────────────────────────────────────────────────────────────── */
async function ta15(page, ctx) {
  await science(page, ctx, { seen: 3, typeCounts: { MCQs: 6, 'True/False': 2 }, typesSeeded: true, marks: 20 });
  const out = {};
  for (const old of ['types', 'extras']) {
    await page.goto(ctx.baseUrl + NEW + old, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**' + NEW + 'questions', { timeout: 15000 });
    await seenBox(page).waitFor({ timeout: 15000 });
    const kept = [await seenBox(page).inputValue(), await box(page, 'MCQs').inputValue(), await box(page, 'True/False').inputValue(), await marksBox(page).inputValue()];
    expect(JSON.stringify(kept) === '["3","6","2","20"]', '/new/' + old + ' should land on Questions with her choices kept, got ' + JSON.stringify(kept));
    out[old] = new URL(page.url()).pathname;
  }
  return out;
}

module.exports = [
  { id: 'TA13', title: 'A plain paper is chosen on one Questions screen and checked in four steps', run: ta13 },
  { id: 'TA14', title: 'Questions holds Next, and says why, until the paper can be made', run: ta14 },
  { id: 'TA15', title: 'The old Question types and Marks and lines links land on Questions', run: ta15 },
];
