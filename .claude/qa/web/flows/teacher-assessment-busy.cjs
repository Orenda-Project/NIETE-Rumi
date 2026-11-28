// teacher-assessment-busy — TA31 (bd-nr8mrm.10, FEAT-209 follow-up): a paper not made because the question writer is busy
// (MODEL_UNAVAILABLE) says "Try again in a minute" and offers no Change choices; another reason (NO_CONTENT) keeps it.
//
// Same set-up as TA30: the class reads are answered by page.route (the demo data has no Grade 4 Science book), generate
// and status are caught by page.route so nothing reaches the bot, and the status read answers "failed" with the code.
'use strict';
const { expect, asRole } = require('../lib.cjs');

const PICKS_KEY = 'teacher-v2-assessment-new:v1';
const NEW = '/portal/teacher/assessment/new/';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const PICKS = { grade: 4, subject: 'science', subjectName: 'Science', coverBy: 'chapters', chapters: [1], seen: 0,
  typeCounts: { MCQs: 10 }, typesSeeded: true, marks: null };

async function ta31(page, ctx) {
  const state = { code: 'MODEL_UNAVAILABLE', n: 0 };
  await page.route('**/api/portal/me/language', (r) => (r.request().method() === 'GET'
    ? json(r, { success: true, language: 'en', locked: false }) : r.continue()));
  await page.route('**/api/portal/config', async (route) => {
    try {
      const res = await route.fetch();
      const body = await res.json().catch(() => ({}));
      body.features = { ...(body.features || {}), assessmentGenerator: true };
      await json(route, body);
    } catch (_) { /* the page went on before the answer */ }
  });
  await page.route('**/api/portal/assessment/options**', (r) => {
    const q = new URL(r.request().url()).searchParams;
    return json(r, { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15,
      ...(q.get('subject') ? { types: [{ id: 'MCQs', category: 'objective' }] }
        : q.get('grade') ? { subjects: [{ subject_key: 'science', subject: 'Science' }] } : {}) });
  });
  await page.route('**/api/portal/assessment/chapters**', (r) => json(r, { success: true,
    chapters: [{ chapter_number: 1, chapter_title: 'Living things', page_start: 1, page_end: 10, page_count: 10 }] }));
  await page.route('**/api/portal/assessment/topics**', (r) => json(r, { success: true, topics: [] }));
  await page.route('**/api/portal/assessment/generate', (r) => { state.n += 1; return json(r, { success: true, requestId: 'e2e-ta31-' + state.n }, 202); });
  await page.route('**/api/portal/assessment/status/**', (r) => json(r, { success: true, status: 'failed', errorCode: state.code }));

  await asRole(page, ctx, 'teacher', 'teacherV2');
  const make = async () => {
    await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [PICKS_KEY, JSON.stringify(PICKS)]).catch(() => {});
    await page.goto(ctx.baseUrl + NEW + 'check', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('step-next').waitFor({ timeout: 15000 });
    await page.getByTestId('step-next').click();
    await page.waitForURL(/\/request\//, { timeout: 15000 });
    await page.getByRole('alert').waitFor({ timeout: 15000 });
    return (await page.getByRole('alert').innerText()).trim();
  };
  const btn = (name) => page.getByRole('button', { name, exact: true });

  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, v); }, [PICKS_KEY, JSON.stringify(PICKS)]);
  const busy = await make();
  expect(busy.includes('Busy now') && busy.includes('Try again in a minute'), 'busy: the reason and the hint should show, got ' + busy);
  expect(await btn('Try again').count() === 1, 'busy: Try again should show');
  expect(await btn('Dismiss').count() === 1, 'busy: Dismiss should show');
  expect(await btn('Change choices').count() === 0, 'busy: Change choices should not show');

  state.code = 'NO_CONTENT';
  const other = await make();
  expect(other.includes('No chapter text') && !other.includes('Try again in a minute'), 'no text: the reason, no hint, got ' + other);
  expect(await btn('Change choices').count() === 1, 'no text: Change choices should show');
  return { busy, other };
}

module.exports = [
  { id: 'TA31', title: 'A paper not made because the question writer is busy says try again in a minute, with no Change choices', run: ta31 },
];
