// teacher-lessons-leaders — the hand-written teacher-lessons scenarios for the leader family reading Lesson Plans
// (bd-4joiqz, LDR01–LDR06; driver code bd-q8wt5e.6.6). Joined to the generated teacher-lessons driver by
// .claude/qa/web/gen_page_features.py (EXTRA).
//
// What the web lane's demo stack cannot give, and so is reported BLOCKED after every step it CAN check has passed:
//   · a grades 6–12 plan: the worker writes it with a model, and the lane's cassette holds no answer (cassetteMiss);
//   · the FLN pages' plans: the test portal has no FLN corpus (no FLN_CORPUS_BASE / CONTENT_R2_PUBLIC_URL; the
//     catalogue answers 503), checked live by flnCorpus();
//   · lp.leader_open: telemetry.service sends it to Axiom only; a local stack has no sink to read it from.
// The grades 1–5 plan's file is not in the demo file store either, so the viewer shows "Can't show it here" around
// its buttons; the buttons are what these scenarios check, and that file's 502 is allowed in the health check.
'use strict';
const L = require('./lessons-lib.cjs');

const K5 = { grade: 4, subject: 'Math', chapter: 1, lesson: 'Place value & reading 5-digit numbers' };
const K5_FILE = '/curriculum/lp/grade_4_math_ch1_seg1/file';
const G612 = '/portal/teacher/lessons/lessons?grade=9&subject=Biology&chapter=c05';

const flnCorpus = L.flnCorpus;

async function viewerButtons(page) {
  await L.seeText(page, /Download PDF/, 'the viewer');
  const t = await L.bodyText(page);
  return { answerKey: /Answer key/.test(t), download: /Download PDF/.test(t), startDc: /Start DC observation/.test(t),
    thingToTry: /Thing to try/.test(t), sendWa: /Send on WhatsApp/.test(t), notYet: /Not available yet/.test(t) };
}
async function currentMenu(page) {
  return ((await L.menu(page)).find((i) => i.current) || {}).text || null;
}

// Open the grade 9 plan and wait for its preparing page to settle: { viewer:true } or { blocked } (a cassette miss).
async function openG612(page, ctx) {
  const mark = L.logMark(ctx, 'worker.log');
  await L.go(page, ctx, G612);
  await page.getByText('Mitosis: Karyokinesis').first().click();
  const t = await L.waitText(page, /Couldn.t make it|Download PDF/, 60000);
  if (/Download PDF/.test(t)) return { viewer: true };
  await page.waitForTimeout(1500);
  const miss = L.cassetteMiss(ctx, mark);
  L.expect(miss, 'the grade 9 plan ended "Couldn\'t make it" and the worker log shows no cassette miss');
  return { blocked: miss };
}

const scenarios = [
  { id: 'LDR01', title: 'A coach on the coach app opens Lesson Plans from the menu and reads a grade 1–5 plan',
    run: async (page, ctx) => L.withSettings(ctx, L.modeSettings('coachV2'), async () => {
      L.watch(page);
      await L.asRole(page, ctx, 'coach');
      await L.go(page, ctx, '/portal/coach/training');
      const m = (await L.menu(page)).map((i) => i.text);
      L.expect(L.inOrder(m, ['Training Library', 'Lesson Plans', 'More']), 'menu: ' + JSON.stringify(m));
      await page.locator('nav a:visible', { hasText: 'Lesson Plans' }).first().click();
      await page.waitForURL(/\/portal\/teacher\/lessons$/, { timeout: 15000 });
      await L.seeText(page, /New lesson plan/, 'Lesson Plans');
      await L.noText(page, /Recent Lesson Plans/, 'a coach\'s Lesson Plans');
      L.expect(!(await page.locator('main header button[aria-label="Back"]').count()), 'Lesson Plans has a Back button for the coach');
      const onHome = await currentMenu(page);
      await page.getByText('New lesson plan').first().click();
      await page.waitForURL(/\/lessons\/new/, { timeout: 15000 });
      const onNew = await currentMenu(page);
      await L.openReadyPlan(page, ctx, K5);
      L.expect(L.pathOf(page).startsWith('/portal/teacher/lessons/plan'), 'the plan opened at ' + L.pathOf(page));
      const b = await viewerButtons(page);
      L.expect(b.answerKey && b.download, 'the viewer lacks the answer key or Download PDF: ' + JSON.stringify(b));
      L.expect(!b.startDc && !b.thingToTry && !b.sendWa, 'the coach\'s viewer shows a teacher-only part: ' + JSON.stringify(b));
      const onPlan = await currentMenu(page);
      for (const [where, c] of [['Lesson Plans', onHome], ['New lesson plan', onNew], ['the viewer', onPlan]]) {
        L.expect(c === 'Lesson Plans', 'on ' + where + ' the current menu item is ' + c);
      }
      L.healthy(page, [K5_FILE]);
      return { menu: m, viewer: b };
    }) },

  { id: 'LDR02', title: 'A principal off the teacher app finds Lesson Plans in the leader menu and reads a grade 6–12 plan',
    run: async (page, ctx) => L.withSettings(ctx, L.modeSettings('classic'), async () => {
      L.watch(page);
      await L.asRole(page, ctx, 'principal');
      await L.go(page, ctx, '/portal/leader');
      const m = await L.menu(page);
      L.expect(m.some((i) => i.text === 'Lesson Plans'), 'the leader menu has no Lesson Plans: ' + JSON.stringify(m.map((i) => i.text)));
      await page.setViewportSize({ width: 360, height: 740 });
      const bottom = await page.$$eval('nav a', (as) => as.filter((a) => a.offsetParent && a.getBoundingClientRect().top > 500).map((a) => a.innerText.trim()));
      L.expect(bottom.includes('Lesson Plans'), 'the phone\'s bottom bar has no Lesson Plans: ' + JSON.stringify(bottom));
      await page.locator('nav a:visible', { hasText: 'Lesson Plans' }).first().click();
      await page.waitForTimeout(2500);
      L.expect(L.pathOf(page) === '/portal/teacher/lessons', 'Lesson Plans did not stay open: ' + L.pathOf(page));
      const g = await openG612(page, ctx);
      if (g.blocked) return { blocked: 'menu and Lesson Plans checked; the grade 9 plan cannot open: ' + g.blocked };
      const b = await viewerButtons(page);
      L.expect(!b.startDc && !b.sendWa, 'the principal\'s viewer shows a teacher-only part: ' + JSON.stringify(b));
      return { viewer: b };
    }) },

  { id: 'LDR03', title: 'A teacher\'s Lesson Plans, and a principal\'s on the teacher app, are unchanged',
    run: async (page, ctx) => L.withSettings(ctx, { ...L.modeSettings('teacherV2'), portal_lp_make_own: null }, async () => {
      L.watch(page);
      await L.asRole(page, ctx, 'teacher');
      await L.go(page, ctx, '/portal/teacher/lessons');
      await L.seeText(page, /Recent Lesson Plans/, 'her Lesson Plans');
      const m = (await L.menu(page)).map((i) => i.text);
      L.expect(L.inOrder(m, ['Home', 'Lesson Plans']), 'Lesson Plans is not under Home: ' + JSON.stringify(m));
      await page.getByText('New lesson plan').first().click();
      await L.openReadyPlan(page, ctx, K5);
      const b = await viewerButtons(page);
      L.expect(b.startDc && b.download, 'her viewer lacks Start DC observation or Download PDF: ' + JSON.stringify(b));
      L.expect(!b.sendWa && !b.notYet, 'her viewer shows Send on WhatsApp: ' + JSON.stringify(b));
      const all = await L.go(page, ctx, '/portal/teacher/lessons/all');
      L.expect(all.startsWith('/portal/teacher/lessons/all'), 'All Lesson Plans did not open for her: ' + all);
      L.healthy(page, [K5_FILE]);
      // ...and still turned away for a coach (a second browser context: her session stays hers)
      const coach = await page.context().browser().newContext({ viewport: { width: 412, height: 915 } });
      try {
        const cp = await coach.newPage();
        await L.withSettings(ctx, L.modeSettings('coachV2'), async () => {
          await L.asRole(cp, ctx, 'coach');
          const at = await L.go(cp, ctx, '/portal/teacher/lessons/all');
          L.expect(!at.startsWith('/portal/teacher/lessons/all'), 'All Lesson Plans opened for a coach');
        });
      } finally { await coach.close(); }
      return { viewer: b, all };
    }) },

  { id: 'LDR04', title: 'A leader\'s open is not a teacher\'s: no open row, no survey, one lp.leader_open event',
    run: async (page, ctx) => L.withSettings(ctx, L.modeSettings('coachV2'), async () => {
      const coachId = await L.userId(ctx, L.DEMO.coach);
      const teacherId = await L.userId(ctx, L.DEMO.teacher);
      const opens = async (id) => Number(await ctx.sql("select count(*) from niete_lp_opens where user_id = " + L.q(id)
        + " and plan_ref like '%grade_4_math_ch1_seg1%'"));
      const coachBefore = await opens(coachId);
      await L.asRole(page, ctx, 'coach');
      await L.go(page, ctx, '/portal/teacher/lessons/new');
      await L.openReadyPlan(page, ctx, K5);
      await L.viewerWait(page);
      await page.waitForTimeout(2000);
      L.expect(await opens(coachId) === coachBefore, 'a niete_lp_opens row was written for the coach');
      // the same plan opened by the demo teacher: one row, as before. An earlier scenario of the run (LDR03) opened it for
      // her already, so her rows for this plan are set aside first (and put back after): the open counted is this one.
      const where = 'user_id = ' + L.q(teacherId) + " and plan_ref like '%grade_4_math_ch1_seg1%'";
      const kept = await ctx.sql('select coalesce(json_agg(t), \'[]\')::text from niete_lp_opens t where ' + where);
      await ctx.sql('delete from niete_lp_opens where ' + where);
      const teacherBefore = await opens(teacherId);
      const tc = await page.context().browser().newContext({ viewport: { width: 412, height: 915 } });
      try {
        const tp = await tc.newPage();
        await L.withSettings(ctx, L.modeSettings('teacherV2'), async () => {
          await L.asRole(tp, ctx, 'teacher');
          await L.go(tp, ctx, '/portal/teacher/lessons/new');
          await L.openReadyPlan(tp, ctx, K5);
          await L.viewerWait(tp);
          await tp.waitForTimeout(2000);
        });
      } finally { await tc.close(); }
      const teacherAfter = await opens(teacherId);
      await ctx.sql('delete from niete_lp_opens where ' + where);
      await ctx.sql('insert into niete_lp_opens select * from json_populate_recordset(null::niete_lp_opens, ' + L.q(kept) + '::json)');
      L.expect(teacherAfter === teacherBefore + 1, 'the teacher\'s open wrote ' + (teacherAfter - teacherBefore) + ' niete_lp_opens rows, not 1');
      return { blocked: 'checked: no open row for the coach, one for the teacher. Not provable here: lp.leader_open goes to Axiom only '
        + '(dashboard/services/telemetry.service.js), the survey request and the PDF ask are bot-side calls the local stack does not record '
        + 'per caller, and the FLN plan and the grade 6–12 plan cannot open on the demo stack (no FLN corpus; no model answer in the cassette)' };
    }) },

  { id: 'LDR05', title: 'A leader\'s way back from an FLN page is their Lesson Plans tab',
    run: async (page, ctx) => L.withSettings(ctx, { ...L.modeSettings('coachV2'), portal_fln_lessons: true }, async () => {
      await L.asRole(page, ctx, 'coach');
      await L.go(page, ctx, '/portal/teacher/lessons/new');
      await L.seeText(page, /Reading Hour & Numeracy/, 'the coach\'s Lesson Plans');
      const why = await flnCorpus(page, ctx);
      if (why) return { blocked: 'the Reading Hour & Numeracy band is on the page; ' + why };
      throw new Error('the FLN corpus is loaded on this stack: the FLN list and plan steps have no driver code yet');
    }) },

  { id: 'LDR06', title: 'Send a lesson plan: each row has View, which opens that plan\'s page',
    run: async (page, ctx) => L.withSettings(ctx, { ...L.modeSettings('coachV2'), portal_fln_lessons: true, portal_fln_share: true }, async () => {
      await L.asRole(page, ctx, 'coach');
      const why = await flnCorpus(page, ctx);
      if (why) return { blocked: why };
      throw new Error('the FLN corpus is loaded on this stack: the Send a lesson plan steps have no driver code yet');
    }) },
];

module.exports = scenarios;
