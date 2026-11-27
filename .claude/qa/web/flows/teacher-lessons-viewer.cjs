// teacher-lessons-viewer — the hand-written teacher-lessons scenarios for the plan screen (the viewer): Print, Download
// PDF, Send on WhatsApp gone, the reader's own failure, the survey bar and the rating card (bd-m8zwt1.23.2,
// bd-zrdvmi.70, bd-ain69z, bd-96f69c, bd-snkn32.11; driver code bd-q8wt5e.6.6). Joined to the generated teacher-lessons
// driver by .claude/qa/web/gen_page_features.py (EXTRA).
//
// The demo stack holds the catalogue but not the plans' PDFs: the plan screen's file read
// (GET /api/portal/curriculum/lp/<id>/file) answers 502, so the viewer draws its buttons around "Can't show it here".
// Every scenario checks the buttons and what it can, then — when a Then needs the PDF itself (its pages, its last page,
// the downloaded file) — reports BLOCKED naming that read's live answer (fileOr).
'use strict';
const L = require('./lessons-lib.cjs');

const K5 = { grade: 4, subject: 'Math', chapter: 1, lesson: 'Place value & reading 5-digit numbers', id: 'grade_4_math_ch1_seg1' };
const K5_ENG6 = { grade: 4, subject: 'English', chapter: 6 };

async function fileOr(page, ctx, lessonId, done) {
  const r = await page.request.get(ctx.baseUrl + '/api/portal/curriculum/lp/' + lessonId + '/file?kind=lesson');
  if (r.status() === 200) return null;
  return { blocked: (done ? 'checked: ' + done + '. ' : '') + 'the demo stack has no PDF for the plan: GET /api/portal/curriculum/lp/'
    + lessonId + '/file answers ' + r.status() + ' (the run\'s file store holds no lp-cache PDF), so the plan\'s pages never draw here' };
}
const teacher = (extra, body) => async (page, ctx) => L.withSettings(ctx, { ...L.modeSettings('teacherV2'), ...(extra || {}) }, async () => {
  L.watch(page);
  await L.asRole(page, ctx, 'teacher');
  return body(page, ctx);
});
async function openK5(page, ctx, at) {
  await L.go(page, ctx, '/portal/teacher/lessons/new');
  await L.openReadyPlan(page, ctx, at);
  return L.viewerWait(page);
}
const lessonIdOf = (page) => page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="plan="]')].map((x) => x.getAttribute('href')).find(Boolean) || '';
  const m = decodeURIComponent(a).match(/k5:([a-z0-9_]+)/); return m ? m[1] : null;
});

const scenarios = [
  { id: 'PRINT01', title: 'A grades 1–5 plan\'s Print opens its A4 paper copy; Download still saves the phone copy',
    run: teacher({}, async (page, ctx) => {
      await page.setViewportSize({ width: 360, height: 740 });
      const files = [];
      page.on('response', (r) => { if (/\/curriculum\/lp\/[^/]+\/(file|pdf)/.test(r.url())) files.push(r.status() + ' ' + new URL(r.url()).pathname + new URL(r.url()).search); });
      await L.go(page, ctx, '/portal/teacher/lessons/new');
      await L.pickGradeSubject(page, K5_ENG6.grade, K5_ENG6.subject);
      await page.waitForURL(/\/lessons\/chapters\?/, { timeout: 15000 });
      await page.locator('main a[href*="chapter=6"]').first().click();
      await page.waitForURL(/\/lessons\/lessons\?/, { timeout: 15000 });
      await page.locator('main button, main a').filter({ hasText: /p\.\d/ }).first().click();
      await L.viewerWait(page);
      const print = page.getByTestId('lp-print');
      L.expect(await print.count(), 'the grade 4 English plan has no Print button');
      const t = await L.bodyText(page);
      L.expect(/Print[\s\S]{0,200}Download PDF|Download PDF[\s\S]{0,200}Print/.test(t), 'Print is not beside Download PDF');
      const id = files.map((f) => (f.match(/\/lp\/([^/]+)\//) || [])[1]).find(Boolean);
      return (await fileOr(page, ctx, id || 'unknown', 'a grade 4 English chapter 6 plan has Print beside Download PDF')) || { print: true };
    }) },

  { id: 'OFF01', title: 'Download PDF keeps a plan on her phone to open without internet',
    run: teacher({}, async (page, ctx) => {
      await openK5(page, ctx, K5);
      await L.seeText(page, /Download PDF/, 'the plan screen');
      await page.getByText('Answer key', { exact: true }).first().click();
      await page.waitForTimeout(1500);
      await L.seeText(page, /Download PDF/, 'the answer key\'s screen');
      return (await fileOr(page, ctx, K5.id, 'the plan screen and its answer key read "Download PDF"')) || { blocked: 'the PDF is on this stack, but the download steps have no driver code yet' };
    }) },

  { id: 'GBS04', title: 'A GB or ICT teacher\'s plan screen has no Send on WhatsApp, grey or green',
    run: teacher({}, async (page, ctx) => {
      await openK5(page, ctx, K5);
      await L.noText(page, /Send on WhatsApp|Not available yet/, 'an ICT teacher\'s grade 1–5 plan screen');
      // the same demo teacher read as a GB teacher (users.source main_rumi_gb: region.service GB_SOURCES), then back
      const id = await L.userId(ctx, L.DEMO.teacher);
      const prev = await ctx.sql('select coalesce(source, \'\') from users where id = ' + L.q(id));
      try {
        await ctx.sql("update users set source = 'main_rumi_gb' where id = " + L.q(id));
        await L.go(page, ctx, '/portal/teacher/lessons/new');
        await L.pickGradeSubject(page, 1, 'Urdu');
        await page.waitForURL(/\/lessons\/chapters\?/, { timeout: 15000 });
        await page.locator('main a[href*="chapter="]').first().click();
        await page.waitForURL(/\/lessons\/lessons\?/, { timeout: 15000 });
        await page.locator('main button, main a').filter({ hasText: /p\.\d|LP/ }).first().click();
        const t = await L.waitText(page, /Download PDF|Couldn.t make it/, 60000);
        if (!/Download PDF/.test(t)) {
          return { blocked: 'checked: an ICT teacher\'s grade 1–5 plan screen has Download PDF and no Send on WhatsApp. A GB grade 1 Urdu plan opens on the 6–12 lane, whose plan the worker writes with a model: '
            + (L.cassetteMiss(ctx, 0) || 'it did not open (' + JSON.stringify(t.slice(0, 120)) + ')') };
        }
        await L.noText(page, /Send on WhatsApp|Not available yet/, 'a GB teacher\'s plan screen');
        return { ok: true };
      } finally { await ctx.sql('update users set source = ' + (prev ? L.q(prev) : 'null') + ' where id = ' + L.q(id)); }
    }) },

  { id: 'GBS02', title: 'When the reader cannot show a plan, it says which step failed in the logs',
    run: teacher({}, async (page, ctx) => {
      const sent = [];
      page.on('request', (r) => { if (/\/funnel\/lp-viewer-failed/.test(r.url())) sent.push(r); });
      await openK5(page, ctx, K5);
      const t = await L.seeText(page, /Can.t show it here/, 'the viewer whose file read failed');
      L.expect(/Open in another app/.test(t), 'no "Open in another app"');
      await page.waitForTimeout(1500);
      L.expect(sent.length === 1, sent.length + ' lp_viewer.failed reports were sent, not 1');
      const body = sent[0].postDataJSON();
      const res = await sent[0].response();
      L.expect(res && res.status() === 204, 'the report was answered ' + (res && res.status()));
      L.expect(body.stage && body.lane, 'the report names no step or lane: ' + JSON.stringify(body));
      L.expect(body.status != null || body.sizeBytes != null, 'the report carries neither the file read\'s status nor its size: ' + JSON.stringify(body));
      const raw = JSON.stringify(body);
      L.expect(!raw.includes('Place value') && !raw.includes(K5.id), 'the report names the plan: ' + raw);
      L.healthy(page, ['/curriculum/lp/' + K5.id + '/file']);
      return { report: body };
    }) },

  { id: 'RATE02', title: 'A shelf plan or a ready-made plan has no rating card',
    run: teacher({ portal_lp_make_own: true }, async (page, ctx) => {
      await openK5(page, ctx, K5);
      await page.waitForTimeout(1500);
      await L.noText(page, /How good was this plan\?/, 'a ready-made plan');
      return { blocked: 'checked: a ready-made plan has no rating card. A shelf plan needs a teacher\'s own plan the AI reviewer passed, which needs the model (no cassette answer on this lane)' };
    }) },

  ...[{ id: 'TL05', a: ['Teacher app v2: with the survey bar on, a grades 1-5 plan ends with "This plan · Useful · Not useful", and Useful asks In class'] },
    { id: 'TL06', a: ['Teacher app v2: a plan she already answered, in the app or on WhatsApp, shows no survey bar'] },
    { id: 'TL07', a: ['Teacher app v2: a GB plan ends with the survey bar, grades 3 or grades 7'] },
    { id: 'TL08', a: ['Teacher app v2: the same plan open in two tabs follows the answer already saved'] },
    { id: 'TL09', a: ['Teacher app v2: a grades 6-12 plan ends with the survey bar, and no WhatsApp survey follows the open'] },
    { id: 'TL10', a: ['Teacher app v2: a grades 6-12 shelf plan or her own made plan shows no survey bar'] },
  ].map(({ id, a: [title] }) => ({ id, title, run: teacher({ portal_lp_feedback_bar: true }, async (page, ctx) => {
    // the bar is drawn under the plan's LAST page: it needs the plan's PDF to draw
    await openK5(page, ctx, K5);
    return (await fileOr(page, ctx, K5.id, 'the plan screen opens with the survey bar switch on'))
      || { blocked: 'the PDF is on this stack, but ' + id + '\'s steps after the last page have no driver code yet' };
  }) })),
];

module.exports = scenarios;
