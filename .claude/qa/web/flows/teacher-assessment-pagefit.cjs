// teacher-assessment-pagefit — TA30 (bd-nr8mrm.8, FEAT-209): Check and make says when her questions need more pages than
// she set, BEFORE the paper is made. A warning, never a block: Make still sends her page count.
//
// The local stack's demo data has no Grade 4 Science book, so the class reads (options, chapters, topics) are answered by
// page.route as TA18–TA29 do; generate is caught by page.route so nothing reaches the bot. GET /config is the real one with
// the generator and page-fit switches set in the answer only (as teacher-assessment-papers does), so switching it off is
// proved on the same page without touching this run's app_settings cache.
'use strict';
const { expect, asRole } = require('../lib.cjs');

const PICKS_KEY = 'teacher-v2-assessment-new:v1';
const NEW = '/portal/teacher/assessment/new/';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const unisolate = (s) => String(s || '').replace(/[⁦-⁩‎‏]/g, '');
const NEED_EN = 'These questions need about 4 pages. Make it 4, or remove some questions.';
const PICKS = { grade: 4, subject: 'science', subjectName: 'Science', coverBy: 'chapters', chapters: [1], seen: 0,
  typeCounts: { 'Long Questions': 10 }, typesSeeded: true, marks: null };
const NEED_UR ='یہ سوالات تقریباً 4 صفحات لیں گے۔ صفحات 4 کر دیں، یا کچھ سوالات ہٹا دیں۔';

async function ta30(page, ctx) {
  const state = { fit: true, lang: 'en' };
  await page.route('**/api/portal/me/language', (r) => (r.request().method() === 'GET'
    ? json(r, { success: true, language: state.lang, locked: false }) : r.continue()));
  await page.route('**/api/portal/config', async (route) => {
    try {
      const res = await route.fetch();
      const body = await res.json().catch(() => ({}));
      body.features = { ...(body.features || {}), assessmentGenerator: true, assessmentPageFit: state.fit };
      await json(route, body);
    } catch (_) { /* the page went on before the answer */ }
  });
  await page.route('**/api/portal/assessment/options**', (r) => {
    const q = new URL(r.request().url()).searchParams;
    return json(r, { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15,
      ...(q.get('subject') ? { types: [{ id: 'MCQs', category: 'objective' }, { id: 'Long Questions', category: 'subjective' }] }
        : q.get('grade') ? { subjects: [{ subject_key: 'science', subject: 'Science' }] } : {}) });
  });
  await page.route('**/api/portal/assessment/chapters**', (r) => json(r, { success: true,
    chapters: [{ chapter_number: 1, chapter_title: 'Living things', page_start: 1, page_end: 10, page_count: 10 }] }));
  await page.route('**/api/portal/assessment/topics**', (r) => json(r, { success: true, topics: [] }));
  const sent = [];
  await page.route('**/api/portal/assessment/generate', (r) => { sent.push(r.request().postDataJSON()); return json(r, { success: true, requestId: 'e2e-ta30' }, 202); });
  await page.route('**/api/portal/assessment/status/**', (r) => json(r, { success: true, status: 'queued' }));

  await asRole(page, ctx, 'teacher', 'teacherV2');
  // 10 long questions: about 4 pages at the tightest print step (pageEstimate.ts)
  await page.addInitScript(([k, v]) => {
    if (!sessionStorage.getItem(k + ':e2e')) { sessionStorage.setItem(k, v); sessionStorage.setItem(k + ':e2e', '1'); }
  }, [PICKS_KEY, JSON.stringify(PICKS)]);
  const open = async () => {
    await page.goto(ctx.baseUrl + NEW + 'check', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('step-next').waitFor({ timeout: 15000 });
    await page.waitForTimeout(state.lang === 'ur' ? 1600 : 300);
  };
  const pages = () => page.getByTestId('pages-limit');
  const note = async () => unisolate((await page.locator('#pages-limit-note').innerText()).trim());

  await open();
  await pages().waitFor({ timeout: 15000 });
  expect(await note() === 'Empty = no limit', 'an empty Pages box should give no warning, got ' + await note());
  await pages().fill('4');
  expect(await note() === 'Empty = no limit', '4 pages for about 4 pages of questions should give no warning, got ' + await note());
  await pages().fill('2');
  await page.getByText(NEED_EN).waitFor({ timeout: 5000 });
  await page.getByTestId('step-next').click();
  const deadline = Date.now() + 15000;
  while (!sent.length && Date.now() < deadline) await page.waitForTimeout(200);
  expect(sent.length === 1 && sent[0].pageCount === 2, 'Make should still send her page count 2, got ' + JSON.stringify(sent.map((s) => s.pageCount)));

  // Urdu: the same line, the number in Western digits
  state.lang = 'ur';
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [PICKS_KEY, JSON.stringify({ ...PICKS, pageCount: 2 })]);
  await open();
  await pages().waitFor({ timeout: 15000 });
  const ur = await note();
  expect(ur === NEED_UR, 'the Urdu warning should read ' + NEED_UR + ', got ' + ur);

  // the switch off: no Pages box, no warning
  state.fit = false; state.lang = 'en';
  await open();
  await page.waitForTimeout(1500);
  expect(await pages().count() === 0, 'with page-fit off Check should show no Pages box');
  expect(await page.getByText(NEED_EN).count() === 0, 'with page-fit off there should be no warning');
  return { pageCount: sent[0].pageCount, en: NEED_EN, ur };
}

module.exports = [
  { id: 'TA30', title: 'Check and make says when her questions need more pages than she set, and Make still sends', run: ta30 },
];
