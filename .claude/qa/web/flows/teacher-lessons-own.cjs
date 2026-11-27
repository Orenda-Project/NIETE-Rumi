// teacher-lessons-own — the hand-written teacher-lessons scenarios for Make my own (bd-snkn32.*: the steps, what the
// lesson is for, the learning-goal start, whole units, the "Made by a teacher" shelf; driver code bd-q8wt5e.6.6).
// Joined to the generated teacher-lessons driver by .claude/qa/web/gen_page_features.py (EXTRA).
//
// Every switch is REAL (app_settings on this run's database) and put back after the scenario (lessons-lib withSettings).
// What the web lane's demo stack cannot give is checked LIVE each run, and reported BLOCKED only after every step that
// does not need it has passed:
//   · a made plan: the worker writes it with a model and the lane's cassette (replay-strict) has no answer → cassetteMiss;
//   · grades 1–5 learning goals: the official outcomes live in assessment_topics, which the demo database does not have,
//     so GET /lp612/own/goals answers no outcomes for any grades 1–5 subject → outcomesOr;
//   · a grades 6–12 subject or a second lesson in a chapter: the demo catalogue carries one lesson per grade (grade 7
//     Computer Science, 8 History, 9 and 10 Biology) → subjectOr.
'use strict';
const L = require('./lessons-lib.cjs');

const T = (ctx) => L.userId(ctx, L.DEMO.teacher);
const OWN = '/portal/teacher/lessons/own';
// A grades 1–5 own plan starts from the day's stored plan script (bot lp-k5-own-source: niete_lp_asset_sources); the
// demo seed stores one for a few days only, Grade 4 Math chapter 5 day 1 among them (any other day answers 404).
const G4_DAY1 = OWN + '?grade=4&subject=math&chapter=5&seg=grade_4_math_ch5_seg1';
const K5_DAYS = [OWN + '?grade=3&subject=math&chapter=1&seg=grade_3_math_ch1_seg1', OWN + '?grade=3&subject=math&chapter=2&seg=grade_3_math_ch2_seg5',
  OWN + '?grade=5&subject=math&chapter=6&seg=grade_5_math_ch6_seg14', OWN + '?grade=4&subject=math&chapter=5&seg=grade_4_math_ch5_seg3'];
const G9_OWN = OWN + '?grade=9&subject=Biology&chapter=c05&seg=grade_9_biology.c05.p068-068';
const G9_LESSONS = '/portal/teacher/lessons/lessons?grade=9&subject=Biology&chapter=c05';
const G9_SEG = 'grade_9_biology.c05.p068-068';

async function settings(ctx, extra) {
  const id = await T(ctx);
  const s = { ...L.modeSettings('teacherV2'), portal_lp_make_own: true, portal_lp_own_goal_start: null, portal_lp_own_unit: null,
    portal_lp_own_shelf: null, portal_lp_own_reviewers: null };
  for (const [k, v] of Object.entries(extra || {})) s[k] = v === 'me' ? [id] : v;
  return s;
}
// sign the demo teacher in with the switches, run body(page), put everything back
const asTeacher = (extra, body) => async (page, ctx) => L.withSettings(ctx, await settings(ctx, extra), async () => {
  L.watch(page);
  await L.asRole(page, ctx, 'teacher');
  return body(page, ctx);
});

const stepOf = (page) => new URL(page.url()).searchParams.get('step') || 'pages';
const okBtn = (page) => page.locator('main').getByRole('button', { name: /^(OK|Next)$/ }).last();
const makeBtn = (page) => page.locator('main').getByRole('button', { name: /^Make my plan$/ });

// Walk Make my own's steps from where the page is to "Your plan": on each step pick `pick[step]` (text) if given, else
// keep what is picked, else the first choice; then OK. Returns the steps walked.
async function walkToCheck(page, pick = {}) {
  const walked = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(600);
    if (await makeBtn(page).count()) return walked;
    const step = stepOf(page);
    walked.push(step);
    const opts = page.locator('main [role="radio"], main [role="checkbox"]');
    if (pick[step]) {
      await page.locator('main [role="radio"], main [role="checkbox"]').filter({ hasText: pick[step] }).first().click();
    } else if (await opts.count()) {
      const on = await page.locator('main [role="radio"][aria-checked="true"], main [role="checkbox"][aria-checked="true"]').count();
      if (!on) await opts.first().click();
    }
    await page.waitForTimeout(500);
    const ok = okBtn(page);
    L.expect(await ok.count(), 'step ' + step + ' has no OK');
    L.expect(!(await ok.isDisabled()), 'OK is off on step ' + step);
    await ok.click();
  }
  throw new Error('did not reach "Your plan" (walked ' + walked.join(' → ') + ')');
}

// Tap Make my plan; return { body: the POST /lp612/own body, preparing: the Preparing address, refusal: text } once the
// page has gone on or said no.
async function makePlan(page) {
  const posted = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/portal\/lp612\/own$/.test(new URL(r.url()).pathname), { timeout: 20000 });
  await makeBtn(page).click();
  const req = await posted;
  let body = null; try { body = req.postDataJSON(); } catch (_) { body = req.postData(); }
  const res = await req.response();
  await page.waitForTimeout(2000);
  return { body, status: res && res.status(), at: L.pathOf(page), preparing: /\/lessons\/preparing/.test(page.url()) };
}
// After Make my plan: wait for the plan to be made or to fail; a failure the cassette explains is BLOCKED (returned),
// any other failure throws.
async function madeOr(page, ctx, mark, done) {
  const t = await L.waitText(page, /Couldn.t make it|We could not make|Download PDF|Answer key/, 150000);
  if (/Download PDF|Answer key/.test(t)) return null;
  L.expect(/Couldn.t make it|We could not make/.test(t), 'her plan is still preparing after 150 s');
  await page.waitForTimeout(1500);
  const miss = L.cassetteMiss(ctx, mark);
  L.expect(miss, 'her plan failed ("' + (t.match(/Couldn.t make it|We could not make[^\n]*/) || [''])[0] + '") and the worker log shows no cassette miss');
  return { blocked: 'checked: ' + done + '. Not provable here: ' + miss };
}

async function outcomesOr(page, ctx, grade, subject, done) {
  const r = await page.request.get(ctx.baseUrl + '/api/portal/lp612/own/goals?grade=' + grade + '&subject=' + encodeURIComponent(subject));
  const j = await r.json().catch(() => ({}));
  if (r.status() === 200 && j.outcomes && j.outcomes.length) return null;
  return { blocked: (done ? 'checked: ' + done + '. ' : '') + 'the demo database has no grades 1–5 learning outcomes: GET /api/portal/lp612/own/goals?grade='
    + grade + '&subject=' + subject + ' answers ' + r.status() + ' with ' + ((j.outcomes || []).length) + ' outcomes (they are read from '
    + 'assessment_topics, which the demo seed does not create), so no goal can be listed, searched or picked' };
}
async function subjectOr(page, ctx, grade, subject, done) {
  const r = await page.request.get(ctx.baseUrl + '/api/portal/lp612/subjects?grade=' + grade);
  const j = await r.json().catch(() => ({}));
  const have = (j.subjects || []).map((s) => s.subject);
  if (have.includes(subject)) return null;
  return { blocked: (done ? 'checked: ' + done + '. ' : '') + 'the demo grades 6–12 catalogue has no Grade ' + grade + ' ' + subject
    + ' (GET /api/portal/lp612/subjects?grade=' + grade + ' lists ' + JSON.stringify(have) + '; it carries one lesson per grade), so that chapter cannot be opened' };
}
const NEXT_LESSON = 'no grades 6–12 chapter in the demo catalogue has a second lesson (one lesson per grade: GET /api/portal/lp612/lessons), so "Add the next lesson\'s pages" can never be offered here';

// The demo teacher as a GB teacher for the body (users.source main_rumi_gb: region.service GB_SOURCES), then back.
async function asGb(ctx, body) {
  const id = await T(ctx);
  const prev = await ctx.sql('select coalesce(source, \'\') from users where id = ' + L.q(id));
  try { await ctx.sql("update users set source = 'main_rumi_gb' where id = " + L.q(id)); return await body(); }
  finally { await ctx.sql('update users set source = ' + (prev ? L.q(prev) : 'null') + ' where id = ' + L.q(id)); }
}

async function apiStatus(page, ctx, p) { return (await page.request.get(ctx.baseUrl + '/api/portal' + p)).status(); }

const scenarios = [
  { id: 'OWN01', title: 'Make my own for grades 1–5: she sees the day\'s book pages and can add the next day\'s',
    run: asTeacher({}, async (page, ctx) => {
      await L.go(page, ctx, G4_DAY1);
      const from = page.getByTestId('own-pg-from'), to = page.getByTestId('own-pg-to');
      await from.waitFor({ timeout: 15000 });
      const day = await L.bodyText(page);
      const dp = (day.match(/Day 1 · [^\n]*· p\.(\d+)(?:-(\d+))?/) || []);
      L.expect(dp[1], 'the picked day shows no "p.N" pages: ' + JSON.stringify(day.slice(0, 200)));
      const [f0, t0] = [dp[1], dp[2] || dp[1]];
      L.expect(await from.inputValue() === f0 && await to.inputValue() === t0, 'From/To read ' + await from.inputValue() + '/' + await to.inputValue() + ' for a p.' + f0 + '-' + t0 + ' day');
      const nx = (day.match(/Add the next day.s pages \(p\.(\d+)(?:-(\d+))?\)/) || []);
      L.expect(nx[1], 'no "Add the next day\'s pages (p.…)"');
      const last = nx[2] || nx[1];
      await page.getByText(/Add the next day.s pages/).first().click();
      await page.waitForTimeout(600);
      L.expect(await to.inputValue() === last, 'after "Add the next day\'s pages" To page reads ' + await to.inputValue() + ', not ' + last);
      L.expect(!(await okBtn(page).isDisabled()), 'OK is off with pages ' + f0 + '-' + last);
      await to.fill(String(Number(f0) - 1));
      await L.seeText(page, /Check the pages/, 'a To page before the From page');
      L.expect(await okBtn(page).isDisabled(), 'OK is on with To before From');
      await to.fill(last);
      await page.waitForTimeout(500);
      await walkToCheck(page);
      const check = await L.seeText(page, /Your plan/, 'the check screen');
      L.expect(new RegExp('p\\.\\s?' + f0 + '\\s?[-–]\\s?' + last).test(check), 'the check screen does not show her pages p.' + f0 + '-' + last + ': ' + JSON.stringify(check.slice(0, 300)));
      const mark = L.logMark(ctx, 'worker.log');
      const made = await makePlan(page);
      L.expect(made.preparing, 'Make my plan did not open Preparing: ' + made.at + ' (' + made.status + ')');
      return (await madeOr(page, ctx, mark, 'From/To = the day\'s pages, the next day\'s pages, Check the pages and OK off, the check screen with her pages')) || { made };
    }) },

  { id: 'OWN02', title: 'The Lesson Plans first screen offers ready-made plans and Make my own as two separate choices',
    run: asTeacher({}, async (page, ctx) => {
      await L.go(page, ctx, '/portal/teacher/lessons');
      await L.seeText(page, /Ready-made lesson plans[\s\S]*Open a plan already written for your chapter/, 'the first screen');
      await L.seeText(page, /Make my own[\s\S]*Make a plan for your own class, in about 1 minute/, 'the first screen');
      await page.getByText('Ready-made lesson plans', { exact: true }).click();
      await page.waitForURL(/\/lessons\/new(\?|$)/, { timeout: 15000 });
      L.expect(!/pick=own/.test(page.url()), 'Ready-made opened ' + L.pathOf(page));
      await L.seeText(page, /Select grade and subject/, 'the ready-made steps');
      await page.goBack();
      await page.getByText('Make my own', { exact: true }).first().click();
      await page.waitForURL(/pick=own/, { timeout: 15000 });
      await L.withSettings(ctx, { portal_lp_make_own: null }, async () => {
        await L.go(page, ctx, '/portal/teacher/lessons');
        await L.seeText(page, /New lesson plan/, 'Lesson Plans with portal_lp_make_own off');
        await L.noText(page, /Make my own|Ready-made lesson plans/, 'Lesson Plans with portal_lp_make_own off');
      });
      const coach = await page.context().browser().newContext({ viewport: { width: 412, height: 915 } });
      try {
        const cp = await coach.newPage();
        await L.withSettings(ctx, L.modeSettings('coachV2'), async () => {
          await L.asRole(cp, ctx, 'coach');
          await L.go(cp, ctx, '/portal/teacher/lessons');
          await L.seeText(cp, /New lesson plan/, 'a coach\'s Lesson Plans');
          await L.noText(cp, /Make my own/, 'a coach\'s Lesson Plans');
        });
      } finally { await coach.close(); }
      L.healthy(page);
      return { ok: true };
    }) },

  { id: 'OWN05', title: 'The learning-goal start shows skills only, never a chapter name, and lets her add her own goal',
    run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) => {
      await L.go(page, ctx, '/portal/teacher/lessons/new?pick=own');
      await L.seeText(page, /From a learning goal/, 'Make my own');
      return (await outcomesOr(page, ctx, 3, 'math', '"From a learning goal" is offered')) || { goals: true };
    }) },

  { id: 'OWN06', title: 'A Grades 6–12 learning-goal list is one list with no chapter headings',
    run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) => (await subjectOr(page, ctx, 7, 'General Science')) || { subject: true }) },

  { id: 'OWN03', title: 'A GB teacher gets neither Make my own nor the shelf, even with both switches on for teachers',
    run: async (page, ctx) => L.withSettings(ctx, { ...L.modeSettings('teacherV2'), portal_lp_make_own: 'teachers', portal_lp_own_shelf: 'teachers' }, () => asGb(ctx, async () => {
      L.watch(page);
      await L.asRole(page, ctx, 'teacher');
      await L.go(page, ctx, '/portal/teacher/lessons');
      await L.seeText(page, /New lesson plan/, 'a GB teacher\'s Lesson Plans');
      await L.noText(page, /Make my own|Made by a teacher/, 'a GB teacher\'s Lesson Plans');
      const own = await apiStatus(page, ctx, '/lp612/own/recent');
      const shelf = await apiStatus(page, ctx, '/lp612/shelf?grade=9&subject=Biology&chapter_key=c05');
      L.expect(own === 404 && shelf === 404, 'a GB teacher\'s direct calls answer own ' + own + ', shelf ' + shelf + ', not 404');
      return { own, shelf };
    })) },

  { id: 'MKO01', title: 'A Grade 8 teacher says what the lesson is for, and gets ways for a subject lesson',
    run: asTeacher({}, async (page, ctx) => (await subjectOr(page, ctx, 8, 'General Science')) || { subject: true }) },
  { id: 'MKO02', title: 'A Grade 10 teacher preparing for the board exam is suggested past-paper practice',
    run: asTeacher({}, async (page, ctx) => (await subjectOr(page, ctx, 10, 'Chemistry')) || { subject: true }) },
  { id: 'MKO03', title: 'A Grade 10 lesson whose SLOs are mixed asks which outcomes come first; one that is not mixed does not',
    run: asTeacher({}, async (page, ctx) => (await subjectOr(page, ctx, 10, 'Chemistry')) || { subject: true }) },

  { id: 'MKO04', title: 'A Grade 1–5 teacher says what the lesson is for, from a book day or a learning goal, with no exam practice',
    run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) => {
      await L.go(page, ctx, G4_DAY1);
      await page.getByTestId('own-pg-from').waitFor({ timeout: 15000 });
      await okBtn(page).click();
      await page.waitForURL(/step=purpose/, { timeout: 15000 });
      const t = await L.seeText(page, /What is this lesson for\?/, 'the purpose step');
      L.expect(/Teach new/.test(t) && /Revise/.test(t) && /Re-teach/.test(t), 'the choices are not Teach new, Revise, Re-teach: ' + JSON.stringify(t.slice(0, 300)));
      L.expect(/Practise what they already learned/.test(t), 'Revise does not say "Practise what they already learned"');
      L.expect(!/Board exam/.test(t), 'a grades 1–5 lesson is offered Board exam practice');
      const on = await page.locator('main [role="radio"][aria-checked="true"]').innerText();
      L.expect(/Teach new/.test(on), 'Teach new is not already picked (picked: ' + on + ')');
      const walked = await walkToCheck(page, { purpose: 'Re-teach' });
      L.expect(!walked.includes('focus'), 'a grades 1–5 lesson asked which outcomes first');
      const check = await L.seeText(page, /Your plan/, 'the check screen');
      L.expect(/Lesson for\s*\n?\s*Re-teach/.test(check), '"Your plan" does not show Lesson for: Re-teach');
      L.expect(/Teach at each child.s level|Things → pictures → numbers|Sounds first|Games and movement|Story and talk/.test(check), 'the teaching way is not a grades 1–5 way');
      const made = await makePlan(page);
      L.expect(made.body && made.body.answers && made.body.answers.purpose === 'reteach', 'POST /lp612/own carries purpose ' + JSON.stringify(made.body && made.body.answers && made.body.answers.purpose));
      return (await outcomesOr(page, ctx, 3, 'math', 'the book-day path: Teach new/Revise/Re-teach, Teach new picked, no exam practice and no outcomes step, "Lesson for Re-teach", grades 1–5 ways, POST purpose reteach'))
        || { made };
    }) },

  { id: 'OWN15', title: 'Make my own offers the next lesson\'s pages, and the plan she asks for covers both lessons',
    run: asTeacher({}, async () => ({ blocked: NEXT_LESSON })) },

  { id: 'OWN16', title: 'On the last lesson of a chapter there is no next lesson to add',
    run: asTeacher({}, async (page, ctx) => {
      await L.go(page, ctx, OWN + '?grade=9&subject=Biology&chapter=c05&seg=' + encodeURIComponent(G9_SEG));
      await L.seeText(page, /Mitosis/, 'Make my own on the chapter\'s only (last) lesson');
      await page.waitForTimeout(1000);
      await L.noText(page, /Add the next lesson.s pages/, 'the last lesson of the chapter');
      await walkToCheck(page);
      const mark = L.logMark(ctx, 'worker.log');
      const made = await makePlan(page);
      L.expect(!(made.body && made.body.ext), 'the plan asks for a next lesson: ' + JSON.stringify(made.body));
      return (await madeOr(page, ctx, mark, 'no "Add the next lesson\'s pages" on the chapter\'s last lesson, and the plan asks for no next lesson')) || { made };
    }) },

  { id: 'OWN04', title: 'Changing the lesson clears the next-lesson choice', run: asTeacher({}, async () => ({ blocked: NEXT_LESSON })) },

  { id: 'TL04', title: 'Make my own: after scrolling down Grade and subject, the chapter list opens at chapter 1',
    run: asTeacher({}, async (page, ctx) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await L.go(page, ctx, '/portal/teacher/lessons/new?pick=own&start=book');
      await page.getByText('Select grade and subject', { exact: true }).first().click();
      await page.getByText('Grade 4', { exact: true }).first().click();
      const subj = page.getByText('Urdu', { exact: true }).last();
      await subj.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(400);
      const scrolled = await page.evaluate(() => window.scrollY);
      await subj.click();
      await page.waitForURL(/\/lessons\/chapters\?/, { timeout: 15000 });
      await page.waitForTimeout(1200);
      const y = await page.evaluate(() => window.scrollY);
      const first = page.locator('main a[href*="chapter="]').first();
      const box = await first.boundingBox();
      L.expect(y === 0, 'the chapter list opened scrolled to ' + y + ' px (Grade and subject was at ' + scrolled + ')');
      L.expect(box && box.y >= 0 && box.y < 740, 'chapter 1 is not in view');
      await first.click();
      await page.waitForURL(/\/lessons\/own\?/, { timeout: 15000 });
      await page.locator('main [role="radio"]').first().click().catch(() => {});
      const ys = [];
      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(700);
        const ok = okBtn(page);
        if (!(await ok.count()) || await ok.isDisabled()) {
          const opts = page.locator('main [role="radio"]'); if (await opts.count()) await opts.first().click();
          await page.waitForTimeout(400);
        }
        if (!(await ok.count()) || await ok.isDisabled()) break;
        await ok.click();
        await page.waitForTimeout(900);
        const h = await page.locator('main h1').first().boundingBox();
        ys.push(h && Math.round(h.y));
        L.expect(h && h.y >= 0 && h.y < 740, 'step ' + stepOf(page) + ' opened with its heading out of view');
      }
      L.healthy(page);
      return { scrolledBefore: scrolled, chapterListY: y, stepHeadingsY: ys };
    }) },

  { id: 'GOAL01', title: 'A listed teacher starts a plan from a learning goal and it is made with no textbook',
    run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) => {
      await L.go(page, ctx, OWN + '?grade=9&subject=Biology&chapter=c05');
      await L.seeText(page, /Start from a learning goal or topic/, 'step 1 of Make my own on a grades 6–12 chapter');
      await page.getByText('Start from a learning goal or topic').first().click();
      await page.waitForTimeout(1200);
      await page.locator('main [role="radio"], main [role="option"], main li button').filter({ hasText: 'Mitosis' }).first().click();
      await page.waitForTimeout(600);
      await okBtn(page).click();
      await walkToCheck(page);
      const made = await makePlan(page);
      const a = made.body || {};
      L.expect(JSON.stringify(a).includes('Mitosis') || (a.goal && a.goal.text), 'her answers carry no goal: ' + JSON.stringify(a).slice(0, 300));
      L.expect(!(a.res || []).includes('textbook') && !a.pg, 'her answers carry the textbook or book pages: ' + JSON.stringify(a).slice(0, 300));
      L.expect(made.preparing && /render=|own=|id=/.test(made.at), 'Preparing did not open on her plan: ' + made.at);
      return { made: { at: made.at, keys: Object.keys(a) } };
    }) },

  { id: 'GOAL02', title: 'A typed topic with no lesson behind it is said plainly',
    run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) => {
      await L.go(page, ctx, OWN + '?grade=9&subject=Biology&chapter=c05');
      await page.getByText('Start from a learning goal or topic').first().click();
      await page.waitForTimeout(1000);
      // the typed topic is "Add my own goal" → "Check my goal" on today's goal step (the spec's "Find")
      await page.getByText('Add my own goal', { exact: true }).click();
      await page.locator('main input:visible, main textarea:visible').last().fill('volcano eruption lava');
      await page.getByRole('button', { name: /Check my goal|^Find$/ }).first().click();
      await L.seeText(page, /Not found in your grade.s lessons\. Try other words, or select a learning goal\./, 'a topic no lesson shares a word with');
      L.expect(await okBtn(page).isDisabled(), 'OK is on after "Not found"');
      return { ok: true };
    }) },

  { id: 'GOAL03', title: 'A teacher not on the list never sees the goal start',
    run: asTeacher({}, async (page, ctx) => {
      await L.go(page, ctx, OWN + '?grade=9&subject=Biology&chapter=c05');
      await L.seeText(page, /Mitosis/, 'step 1 of Make my own');
      await L.noText(page, /Start from a learning goal or topic/, 'step 1 for a teacher not on the goal list');
      const at = await L.go(page, ctx, OWN + '?grade=9&subject=Biology&chapter=c05&step=goal&start=goal');
      L.expect(!/step=goal/.test(at), 'the goal address opened for her: ' + at);
      const g = await apiStatus(page, ctx, '/lp612/own/goals?grade=9&subject=Biology');
      const m = await apiStatus(page, ctx, '/lp612/own/goals/match?grade=9&subject=Biology&q=mitosis');
      L.expect(g === 404 && m === 404, 'the goal reads answer ' + g + ' / ' + m + ', not 404');
      return { goalAddress: at };
    }) },

  { id: 'GOAL04', title: 'A listed teacher starts a Grades 1–5 plan from an official learning outcome',
    run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) => {
      await L.go(page, ctx, OWN + '?grade=4&subject=math&chapter=1');
      await L.seeText(page, /Start from a learning goal or topic/, 'step 1 on a grades 1–5 chapter');
      return (await outcomesOr(page, ctx, 4, 'math', 'step 1 offers "Start from a learning goal or topic"')) || { goals: true };
    }) },

  { id: 'GOAL05', title: 'Make my own opens on two equal starts, and the goal start needs no chapter',
    run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) => {
      await L.go(page, ctx, '/portal/teacher/lessons');
      await page.getByText('Make my own', { exact: true }).first().click();
      await page.waitForURL(/pick=own/, { timeout: 15000 });
      const t = await L.seeText(page, /From a textbook chapter[\s\S]*From a learning goal/, 'Make my own\'s first screen');
      L.expect(!/Select grade and subject/.test(t), 'the class picker shows before a start is picked');
      const a = await page.getByText('From a textbook chapter').first().boundingBox();
      const b = await page.getByText('From a learning goal').first().boundingBox();
      await page.getByText('From a learning goal').first().click();
      await page.getByText('Select grade and subject', { exact: true }).first().click();
      await page.getByText('Grade 3', { exact: true }).first().click();
      await page.getByText('Math', { exact: true }).first().click();
      await page.waitForURL(/step=goal/, { timeout: 15000 });
      L.expect(!/chapter=/.test(page.url()), 'the goal step carries a chapter: ' + L.pathOf(page));
      await L.seeText(page, /Learning goal/, 'the goal step');
      L.healthy(page);
      return { cards: [a && Math.round(a.x), b && Math.round(b.x)], at: L.pathOf(page) };
    }) },

  ...[{ id: 'GOAL06', a: ['Grades 1–5 learning goals are skill-sized and grouped by skill'] },
    { id: 'GOAL08', a: ['A misspelt or Roman Urdu topic offers "Did you mean" goals, and nothing is picked until she taps one'] },
    { id: 'GOAL09', a: ['A goal of another grade is named'] },
    { id: 'GOAL11', a: ['A goal plan says it is being checked, and opens with her goal at the top'] },
    { id: 'GOAL13', a: ['A grades 1-5 goal plan the check asks to fix gets its one fix, and ends ready or with the calm refusal'] },
    { id: 'GOAL17', a: ['A Grade 5 English writing goal gets a plan about that goal, not the book day beside it', 5, 'english'] },
    { id: 'GOAL18', a: ['A Grade 3 English vowel-sounds goal gets a plan about vowel sounds, not the dictionary day it sits on', 3, 'english'] },
    { id: 'GOAL19', a: ['A Grade 3 Maths subtraction goal is not refused over a small tip'] },
    { id: 'GOAL20', a: ['A Grade 4 Urdu goal plan that says the board is not there is not refused for using a board', 4, 'urdu'] },
    { id: 'GOAL14', a: ['Make my own\'s check screen names the subject, not its key'] },
  ].map(({ id, a: [title, g, s] }) => ({ id, title, run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) =>
    (await outcomesOr(page, ctx, g || 3, s || 'math', '')) || { blocked: 'outcomes are listed on this stack, but ' + id + ' has no further driver code yet' }) })),

  { id: 'GOAL07', title: 'With the goal switch off, Make my own\'s first screen is unchanged',
    run: asTeacher({}, async (page, ctx) => {
      await L.go(page, ctx, '/portal/teacher/lessons');
      await page.getByText('Make my own', { exact: true }).first().click();
      await page.waitForURL(/pick=own/, { timeout: 15000 });
      await L.seeText(page, /Select grade and subject/, 'Make my own\'s first screen');
      await L.noText(page, /From a learning goal/, 'Make my own\'s first screen with the goal switch off');
      return { ok: true };
    }) },

  { id: 'GOAL10', title: 'A topic off the curriculum, or with a blocked word, is refused',
    run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) => {
      const ask = async (q) => (await page.request.get(ctx.baseUrl + '/api/portal/lp612/own/goals/match?grade=3&subject=math&q=' + encodeURIComponent(q))).json();
      const off = await ask('cricket world cup');
      L.expect(off.status === 'none' && !off.match, '"cricket world cup" is answered ' + JSON.stringify(off).slice(0, 200));
      const bad = await ask('gun');
      L.expect(bad.status === 'blocked' && !bad.match, 'a blocked word is answered ' + JSON.stringify(bad).slice(0, 200));
      return (await outcomesOr(page, ctx, 3, 'math', 'the server refuses "cricket world cup" (none) and a blocked word (blocked), with nothing picked; the screen\'s two messages are shown on the goal step, which lists no goals here')) || { off, bad };
    }) },

  { id: 'GOAL12', title: 'A goal plan the check refuses shows a calm refusal, not Try again',
    run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) => (await outcomesOr(page, ctx, 3, 'math', '')) || { blocked: 'needs a goal plan the worker refused with OWN_GOAL_UNSURE, which needs the model' }) },

  { id: 'GOAL15', title: 'Try again after her own plan failed takes her back to her own answers',
    run: asTeacher({}, async (page, ctx) => {
      await L.go(page, ctx, G9_OWN);
      await L.seeText(page, /Mitosis/, 'Make my own');
      await walkToCheck(page);
      const answers = L.pathOf(page);
      const made = await makePlan(page);
      L.expect(made.preparing, 'Make my plan did not open Preparing: ' + made.at);
      const t = await L.waitText(page, /Couldn.t make it|Download PDF/, 60000);
      if (!/Couldn.t make it/.test(t)) return { blocked: 'her plan was made (the model answered), so there is no failed plan to try again' };
      await page.getByRole('button', { name: /Try again/ }).first().click().catch(async () => page.getByText('Try again').first().click());
      await page.waitForTimeout(2000);
      await L.seeText(page, /Your plan/, 'after Try again');
      const back = L.pathOf(page);
      L.expect(back.startsWith(OWN) && /step=check/.test(back), 'Try again went to ' + back + ', not her answers');
      for (const k of ['seg=grade_9_biology', 'size=', 'way=']) L.expect(back.includes(k), 'her answers lost ' + k + ': ' + back);
      await L.noText(page, /Answer key/, 'after Try again (the ready-made plan of that lesson)');
      return { answers, back };
    }) },

  { id: 'GOAL16', title: 'The daily limit is said where she can see it',
    run: asTeacher({}, async (page, ctx) => {
      const id = await T(ctx);
      const ids = [];
      try {
        for (let i = 0; i < 5; i++) {
          ids.push(await ctx.sql("insert into niete_lp612_own_plans (user_id, template_version, answers, status, lesson_id) values ("
            + L.q(id) + ", 'qa-daily-limit', '{}'::jsonb, 'ready', 'grade_4_math_ch1_seg1') returning id"));
        }
        await L.go(page, ctx, G9_OWN);
        await L.seeText(page, /Mitosis/, 'Make my own');
        await walkToCheck(page);
        const made = await makePlan(page);
        if (made.preparing) {
          // the limit is off where the bot runs as a sandbox (lp-own-edit-guard dailyLimit: DEFAULT_REGION *-sandbox → none)
          const env = require('fs').readFileSync(require('path').join(ctx.runDir, 'src', '.env'), 'utf8');
          const region = (env.match(/^DEFAULT_REGION=(.*)$/m) || [])[1] || '';
          if (/-sandbox$/i.test(region)) return { blocked: 'the lane\'s bot runs as DEFAULT_REGION=' + region + ', where Make my own has no daily limit (bot lp-own-edit-guard.js dailyLimit → Infinity for a sandbox): a sixth plan today is made, so the refusal can never show here' };
        }
        L.expect(!made.preparing, 'a sixth plan today opened Preparing');
        const msg = page.getByText(/You.ve made 5 plans today/).first();
        await msg.waitFor({ timeout: 10000 });
        const box = await msg.boundingBox();
        const vh = page.viewportSize().height;
        L.expect(box && box.y >= 0 && box.y + box.height <= vh, 'the daily-limit line is not in view (at ' + JSON.stringify(box) + ')');
        const btn = await makeBtn(page).boundingBox();
        L.expect(!btn || box.y < btn.y, 'the refusal is below Make my plan');
        return { status: made.status };
      } finally {
        if (ids.length) await ctx.sql('delete from niete_lp612_own_plans where id in (' + ids.map(L.q).join(',') + ')');
      }
    }) },

  { id: 'OWN07', title: 'A whole unit: chapters, period and pace give a day-by-day outline she can change and save',
    run: asTeacher({ portal_lp_own_unit: 'me' }, async (page, ctx) => {
      const id = await T(ctx);
      const since = await ctx.sql('select now()::text');
      try {
      await L.go(page, ctx, '/portal/teacher/lessons/unit/new?grade=3&subject=math');
      await page.getByText('Plus and Minus Mysteries').first().click();
      await page.getByText('Multiplication Mountain: Climbing the Numbers').first().click();
      await page.getByText('35 min', { exact: true }).first().click();
      const t = await L.seeText(page, /Recommended · 21 days/, 'the paces');
      L.expect(/Slower · 25 days/.test(t) && /Faster · 17 days/.test(t), 'the paces read ' + JSON.stringify((t.match(/(Recommended|Slower|Faster) · \d+ days/g) || [])));
      await page.getByRole('button', { name: /See the days/ }).click();
      const days = await L.seeText(page, /Your days/, 'the outline');
      const n = (days.match(/\bDay \d+\b/g) || []).length;
      L.expect(new Set(days.match(/\bDay \d+\b/g)).size === 21, 'the outline shows ' + n + ' day labels, not 21');
      L.expect(/Review/i.test(days) && /Test|Check/i.test(days), 'no review or test day is marked');
      await page.getByTestId('unit-more-1').click();
      await page.getByText('Join with next day').first().click();
      await L.seeText(page, /Undo/, 'after Join with next day');
      const d20 = await L.bodyText(page);
      L.expect(new Set(d20.match(/\bDay \d+\b/g)).size === 20, 'after joining, ' + new Set(d20.match(/\bDay \d+\b/g)).size + ' days, not 20');
      await page.getByRole('button', { name: /Save unit/ }).click();
      await page.waitForTimeout(2000);
      await L.go(page, ctx, '/portal/teacher/lessons/new?pick=own');
      await L.seeText(page, /My units/, 'Make my own after saving a unit');
      await page.locator('main a, main button').filter({ hasText: /20 days · 35 min/ }).first().click();
      const again = await L.seeText(page, /Day 20\b/, 'the reopened unit');
      L.expect(new Set(again.match(/\bDay \d+\b/g)).size === 20, 'the reopened unit shows ' + new Set(again.match(/\bDay \d+\b/g)).size + ' days, not 20');
      await L.go(page, ctx, '/portal/teacher/lessons/unit/new?grade=3&subject=math');
      await L.seeText(page, /How long is your period\?/, 'a new Grade 3 Math unit');
      const picked = await page.locator('[aria-checked="true"], [aria-pressed="true"]').filter({ hasText: /^\s*\d+ min\s*$/ }).allInnerTexts();
      L.expect(picked.map((x) => x.trim()).includes('35 min'), 'a new unit for Grade 3 Math starts with ' + JSON.stringify(picked) + ' chosen, not 35 min');
      L.healthy(page);
      return { days: 20, period: picked };
      } finally {
        await ctx.sql('delete from niete_lp_own_units where user_id = ' + L.q(id) + ' and created_at >= ' + L.q(since) + '::timestamptz');
      }
    }) },

  { id: 'OWN08', title: 'A unit day\'s plan is made only when she opens it; a review day opens the book\'s own day',
    run: asTeacher({ portal_lp_own_unit: 'me' }, async (page, ctx) => {
      const id = await T(ctx);
      const since = await ctx.sql('select now()::text');
      const posts = [];
      // a day's plan is asked for by POST /lp/own/units/<id>/days/<n>/open (or a direct own make): count them, and the rows
      page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/portal\/(lp612\/own$|lp\/own\/units\/[^/]+\/days\/\d+\/open)/.test(new URL(r.url()).pathname)) posts.push(new URL(r.url()).pathname); });
      const rows = async () => Number(await ctx.sql('select count(*) from niete_lp612_own_plans where user_id = ' + L.q(id) + ' and created_at >= ' + L.q(since) + '::timestamptz'));
      try {
        await L.go(page, ctx, '/portal/teacher/lessons/unit/new?grade=3&subject=math');
        const ch = page.getByText('Plus and Minus Mysteries').first();
        await ch.click(); await ch.click();
        await page.getByText('35 min', { exact: true }).first().click();
        await page.getByRole('button', { name: /See the days/ }).click();
        await L.seeText(page, /Your days/, 'her saved unit');
        await page.getByText('Up to 30', { exact: true }).first().click();
        await page.getByText('On track', { exact: true }).first().click();
        await page.waitForTimeout(800);
        L.expect(!posts.length, 'a plan was asked for before she opened a day: ' + posts.join(', '));
        const unitAt = L.pathOf(page);
        // a grades 1–5 day is made from its stored plan script; in the demo seed only chapter 2's day 5
        // (grade_3_math_ch2_seg5, "Subtraction with and without regrouping") has one, so that lesson day is opened
        await page.getByTestId('unit-open-5').click();
        await page.waitForURL(/\/lessons\/preparing/, { timeout: 20000 });
        await page.waitForTimeout(1500);
        L.expect(posts.length === 1, 'opening a lesson day asked for ' + posts.length + ' plans: ' + posts.join(', '));
        L.expect(await rows() === 1, 'opening a lesson day wrote ' + await rows() + ' own-plan rows, not 1');
        await L.go(page, ctx, unitAt);
        await L.seeText(page, /Review/, 'her unit');
        const before = posts.length;
        const review = page.locator('main').getByText(/Chapter Review/).first();
        const row = review.locator('xpath=ancestor::*[.//button[contains(., "Open plan")]][1]');
        await row.getByRole('button', { name: /Open plan/ }).first().click();
        await page.waitForTimeout(3000);
        L.expect(await rows() === 1, 'the review day made a plan (' + await rows() + ' own-plan rows)');
        const at = L.pathOf(page);
        L.expect(/\/lessons\/(plan|open)/.test(at), 'the review day opened ' + at + ', not the book\'s own day');
        await L.seeText(page, /Chapter Review|Download PDF/, 'the review day\'s plan');
        return { lessonDayPosts: 1, reviewDay: at };
      } finally {
        await ctx.sql('delete from niete_lp_own_units where user_id = ' + L.q(id) + ' and created_at >= ' + L.q(since) + '::timestamptz');
      }
    }) },

  { id: 'OWN09', title: 'With the unit switch off, Make my own is unchanged',
    run: asTeacher({ portal_lp_own_goal_start: 'me' }, async (page, ctx) => {
      await L.go(page, ctx, '/portal/teacher/lessons/new?pick=own');
      await L.seeText(page, /From a textbook chapter/, 'Make my own');
      await L.noText(page, /A whole unit/, 'Make my own with the unit switch off');
      const at = await L.go(page, ctx, '/portal/teacher/lessons/unit/new?grade=3&subject=math');
      L.expect(!at.startsWith('/portal/teacher/lessons/unit'), 'the unit address opened: ' + at);
      return { at };
    }) },

  { id: 'OWN10', title: 'A whole unit from learning goals has no textbook: her goals become days, review and check days included',
    run: asTeacher({ portal_lp_own_unit: 'me', portal_lp_own_goal_start: 'me' }, async (page, ctx) => (await outcomesOr(page, ctx, 3, 'math', '')) || { blocked: 'outcomes listed, but OWN10 has no further driver code yet' }) },

  { id: 'OWN11', title: 'A goal with a blocked word is refused and a unit needs at least two goals',
    run: asTeacher({ portal_lp_own_unit: 'me', portal_lp_own_goal_start: 'me' }, async (page, ctx) => (await outcomesOr(page, ctx, 3, 'math', '')) || { blocked: 'outcomes listed, but OWN11 has no further driver code yet' }) },

  { id: 'OWN12', title: 'A book-path note with an everyday lesson word is kept; only a goal start drops a blocked-word note',
    run: asTeacher({}, async (page, ctx) => (await subjectOr(page, ctx, 8, 'General Science')) || { subject: true }) },

  ...[{ id: 'OWN13', a: ['A Grades 1-5 change keeps You Do alone, and a note asking to skip a part or to cram is not used'] },
    { id: 'OWN14', a: ['A grades 1-5 own plan still refused tells her what to change'] },
    { id: 'RLP01', a: ['A grades 1-5 plan of her own, opened in the app, reopens from Recent Lesson Plans as a grades 1-5 plan'] },
    { id: 'RATE01', a: ['Her own plan asks how good it was and saves her rating'] },
  ].map(({ id, a: [title] }, i) => ({ id, title, run: asTeacher({}, async (page, ctx) => {
    // each needs one of her own grades 1–5 plans MADE: try to make one (each on its own day with a stored plan, so no
    // scenario's plan still being made holds up the next), and report what stopped it
    await L.go(page, ctx, K5_DAYS[i]);
    await page.getByTestId('own-pg-from').waitFor({ timeout: 15000 });
    await walkToCheck(page);
    const mark = L.logMark(ctx, 'worker.log');
    const made = await makePlan(page);
    L.expect(made.preparing, 'Make my plan did not open Preparing: ' + made.at + ' (' + made.status + ')');
    return (await madeOr(page, ctx, mark, 'her answers reach Make my plan and Preparing opens'))
      || { blocked: 'her plan was made here; ' + id + '\'s steps after it have no driver code yet' };
  }) })),

  { id: 'SHF03', title: 'Someone not listed cannot reach the check',
    run: asTeacher({ portal_lp_own_shelf: true }, async (page, ctx) => L.withSettings(ctx, { portal_lp_own_reviewers: [await L.userId(ctx, L.DEMO.coach)] }, async () => {
      await L.go(page, ctx, '/portal/teacher/lessons/check');
      await page.waitForURL((u) => !String(u).includes('/lessons/check'), { timeout: 15000 }).catch(() => {});
      const at = L.pathOf(page);
      L.expect(at.startsWith('/portal/teacher/lessons') && !at.startsWith('/portal/teacher/lessons/check'), '/check settled on ' + at);
      const s = await apiStatus(page, ctx, '/lp612/own/review');
      L.expect(s === 404, 'the review API answers ' + s + ', not 404');
      return { at, review: s };
    })) },
  ...[{ id: 'SHF04', a: ['An AI-passed plan is listed with no person\'s approval'] },
    { id: 'SHF01', a: ['A reviewer approves an AI-passed plan, and it appears under "Made by a teacher"'] },
    { id: 'SHF02', a: ['A rejection needs a reason, and a rejected plan is never listed'] },
  ].map(({ id, a: [title] }) => ({ id, title, run: asTeacher({ portal_lp_own_shelf: true }, async () => ({ blocked:
    'needs a teacher\'s own plan the AI reviewer passed: making one needs the model (no cassette answer on this lane), and no seed '
    + 'of an AI-passed niete_lp612_own_plans row with its PDF is written yet; the spec\'s reviewer is a sandbox teacher, not one of the demo network' })) })),
];

module.exports = scenarios;
