// leader-assess — the hand-written leader-portal scenarios for the coach app's Learning assessment and its results
// dashboard (LP05–LP34; driver code bd-q8wt5e.6.6). Joined to the generated leader-portal driver by
// .claude/qa/web/gen_page_features.py (EXTRA).
//
// The run's OWN stack is made ready once per process (ready()):
//   · the bot is restarted with the child test on (CHILD_TEST_ENABLED, a draw secret for this lane only, and the demo
//     coach on CHILD_TEST_COACH_IDS) plus the overrides dev-portal.sh gave it (its internal key, this portal's URL) —
//     the web lane's bot runs without the child test, so every Learning assessment read answered 404 'disabled';
//   · the child-test migrations V1.6.20, V1.6.21, V1.7.3 and V1.7.4 are applied to the run's database (idempotent): the
//     demo database comes from supabase/baseline/schema.sql, which lists them as carried (schema.migrations.txt) but has
//     neither child_test_sessions.client_finished_at nor the grade suffix in the visit-key checks, so the day's list
//     (a draw with a ':g<N>' key) and the dashboard's read failed with 500s.
//   · sa_engine is turned on for the run: the battery engine's files (/sa/sa-offline.js, /sa/sw.js) are served only then,
//     and without them Get ready ends "Not everything downloaded" (its report says why: no_engine).
// Each scenario clears the coach's child-test rows for the day first, sets its switches and puts them back.
// What the demo stack cannot give is reported BLOCKED with the page's or the server's own answer as the reason.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const L = require('./lessons-lib.cjs');

const MIGRATIONS = ['V1.6.20__child_test_self_admin', 'V1.6.21__child_test_response_mode', 'V1.7.3__child_test_all_grades', 'V1.7.4__child_test_sa_item_reviews'];
const SCHOOL = 'Demo Model School G-6/2';
let readyOnce = null;

function sh(file, args, opts) {
  return new Promise((resolve) => execFile(file, args, { timeout: 180000, ...opts }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') })));
}
async function ready(ctx) {
  if (!readyOnce) readyOnce = (async () => {
    const repo = path.resolve(__dirname, '..', '..', '..', '..');
    await clearDay(ctx); // V1.6.20's check is the narrower one until V1.7.3 widens it: no ':g<N>' row may sit between them
    for (const m of MIGRATIONS) await ctx.sql(fs.readFileSync(path.join(repo, 'infrastructure/supabase/migrations', m + '.sql'), 'utf8'));
    const coach = await L.userId(ctx, L.DEMO.coach);
    const port = new URL(ctx.baseUrl).port;
    const env = ['INTERNAL_API_KEY=' + ctx.internalKey, 'PORTAL_URL=http://localhost:' + port, 'WEB_QUIZ_BASE_URL=https://localhost:' + port,
      'CHILD_TEST_ENABLED=true', 'CHILD_TEST_DRAW_SECRET=e2e-web-lane-only', 'CHILD_TEST_COACH_IDS=' + coach];
    const r = await sh('bash', [path.join(ctx.runDir, 'src', 'bot/scripts/e2e/local-stack.sh'), 'restart', 'bot', ctx.runDir, ...env]);
    // the restart line echoes its env: never let the internal key reach a result
    if (!r.ok) throw new Error('could not restart the run\'s bot with the child test on: ' + r.out.replace(ctx.internalKey, '<key>').slice(-200));
    await new Promise((res) => setTimeout(res, 1500));
    // the battery engine's own files (/sa/*) are served only while sa_engine is on; the portal reads that switch through
    // a 30 s cache that holds ON (dashboard/routes/sa-switch.js), so it is turned on once for the run and waited for
    await ctx.sql("insert into app_settings (key, value) values ('sa_engine', 'true'::jsonb) on conflict (key) do update set value = excluded.value");
    for (const until = Date.now() + 90000; ;) {
      const body = await (await fetch(ctx.baseUrl + '/sa/sa-offline.js')).text().catch(() => '');
      if (!/^\s*<!doctype/i.test(body) && body) break;
      if (Date.now() > until) throw new Error('the portal still serves no /sa/sa-offline.js 90 s after sa_engine was turned on');
      await new Promise((res) => setTimeout(res, 3000));
    }
    return true;
  })();
  return readyOnce;
}
async function clearDay(ctx) {
  const coach = await L.userId(ctx, L.DEMO.coach);
  await ctx.sql('delete from child_test_blocks where session_id in (select id from child_test_sessions where coach_user_id = ' + L.q(coach) + ')');
  await ctx.sql('delete from child_test_sessions where coach_user_id = ' + L.q(coach));
  await ctx.sql("delete from child_test_draws where visit_key like 'day:' || " + L.q(coach) + " || ':%'");
}
const BASE = { portal_child_test_sa: true, sa_all_grades: true };
const coach = (extra, body) => async (page, ctx) => {
  await ready(ctx);
  await clearDay(ctx);
  return L.withSettings(ctx, { ...L.modeSettings('coachV2'), ...BASE, ...(extra || {}) }, async () => {
    L.watch(page);
    await L.asRole(page, ctx, 'coach');
    await L.go(page, ctx, '/portal/leader/assess');
    await page.getByText('English', { exact: true }).first().click();
    await L.seeText(page, /Which school\?/, 'the Learning assessment');
    return body(page, ctx);
  });
};
async function openList(page, school, grade) {
  // the school list's row (the Get ready card, when on, names the schools too, above it)
  await page.getByText(school, { exact: true }).last().click();
  await page.getByText('Grade ' + grade, { exact: true }).first().click();
  await page.getByRole('button', { name: /^Ready/ }).click();
}

// The dashboard's own line says how many sessions it reads: with none finished, nothing it counts can be checked.
async function sessionsOr(page, ctx) {
  await L.go(page, ctx, '/portal/leader/assess/dashboard');
  const t = await L.seeText(page, /Live data: \d+ sessions|No child has finished/, 'the results dashboard');
  const n = Number((t.match(/Live data: (\d+) sessions/) || [])[1] || 0);
  if (n > 0) return null;
  return { blocked: 'the results dashboard reads "Live data: ' + n + ' sessions": the demo data holds no finished self-administered session, '
    + 'and finishing one means a child working through the whole battery (about 29 minutes of listening, speaking and tapping), '
    + 'so no count, filter or skip list can be checked here' };
}

// Tick a school on the Get ready card (the first, when none is) and, with every grade on, its Grade 3.
async function tickForPrep(page) {
  if (!(await page.locator('input[type="checkbox"]:checked').count())) await page.locator('input[type="checkbox"]').first().check();
  const g = page.locator('[role="group"] button', { hasText: /^\s*3\s*$/ }).first();
  if (await g.count() && await g.getAttribute('aria-pressed') !== 'true') await g.click();
}

const DASH = { sa_real_dashboard: true, sa_dash_filters: true };
const OFFLINE_NEEDS = 'needs the battery\'s files kept on the phone';

const scenarios = [
  { id: 'LP05', title: 'Learning assessment: the school search matches a school\'s EMIS and sector, and each row shows them',
    run: coach({}, async (page, ctx) => {
      const t = await L.seeText(page, /(\d+) of (\d+)/, 'the school list');
      const total = Number(t.match(/(\d+) of (\d+)/)[2]);
      for (const [name, line] of [['Demo Boys School Sihala', 'Sihala · DEMO-003'], ['Demo Girls School I-8/4', 'Urban-I · DEMO-002'], [SCHOOL, 'Urban-I · DEMO-001']]) {
        L.expect(t.includes(name + '\n' + line), name + ' does not show "' + line + '" under its name');
      }
      await page.getByPlaceholder(/Find a school/i).or(page.getByLabel(/Find a school/i)).first().fill('DEMO-002');
      await page.waitForTimeout(800);
      const after = (await L.bodyText(page)).split('Which school?').pop();
      L.expect(after.includes('1 of ' + total), 'the count does not read "1 of ' + total + '"');
      L.expect(after.includes('Demo Girls School I-8/4') && !after.includes('Demo Boys School Sihala') && !after.includes(SCHOOL + '\n'), 'the EMIS search kept other schools');
      return { total };
    }) },

  { id: 'LP06', title: 'Learning assessment: End test is a tap and a question, and an ended child shows Restart test (sa_end_test_restart)',
    run: coach({ sa_end_test_restart: true, sa_end_section: true, sa_rdf_manual: true }, async (page) => {
      await openList(page, SCHOOL, 3);
      await L.seeText(page, /Test these children/, 'the day\'s list');
      await page.getByText('Present', { exact: true }).first().click();
      await page.getByRole('button', { name: /^Start/ }).first().click();
      await page.getByText('End test (coach)', { exact: true }).waitFor({ timeout: 20000 });
      await page.getByText('End test (coach)', { exact: true }).click();
      await page.getByRole('button', { name: /^End test$/ }).click();
      const t = await L.seeText(page, /Stopped/, 'the list after End test');
      L.expect(/Restart test/.test(t), 'the ended child has no "Restart test"');
      L.expect(/test was ended\. Tap Restart test to begin again/.test(t), 'no note says to tap Restart test to begin again');
      return { blocked: 'checked: End test (coach) → End test, the child reads Stopped with Restart test and the note. The RDF manual leg '
        + '("End this section" beside it) needs a coach-led (RDF manual) session, which this driver does not start yet' };
    }) },

  { id: 'LP33', title: 'Results dashboard: a coach-led / auto filter applies across the whole dashboard (sa_dash_filters)',
    run: coach(DASH, async (page, ctx) => (await sessionsOr(page, ctx)) || { blocked: 'sessions exist, but LP33 has no further driver code yet' }) },
  { id: 'LP07', title: 'Results dashboard: filter by date (Pakistan days) and by coach, combined with the mode',
    run: coach(DASH, async (page, ctx) => (await sessionsOr(page, ctx)) || { blocked: 'sessions exist, but LP07 has no further driver code yet' }) },
  { id: 'LP08', title: 'Results dashboard: every skip and stop by type and by coach',
    run: coach(DASH, async (page, ctx) => (await sessionsOr(page, ctx)) || { blocked: 'sessions exist, but LP08 has no further driver code yet' }) },
  { id: 'LP10', title: 'Every words-per-minute number is correct words per minute, labelled CWPM (sa_cwpm)',
    run: coach({ ...DASH, sa_cwpm: true }, async (page, ctx) => (await sessionsOr(page, ctx)) || { blocked: 'sessions exist, but LP10 has no further driver code yet' }) },
  { id: 'LP11', title: 'Results dashboard: children from the random draw against children added by the coach',
    run: coach(DASH, async (page, ctx) => (await sessionsOr(page, ctx)) || { blocked: 'sessions exist, but LP11 has no further driver code yet' }) },
  { id: 'LP09', title: 'Results dashboard without sa_dash_filters is unchanged',
    run: coach({ sa_real_dashboard: true, sa_dash_filters: null }, async (page, ctx) => (await sessionsOr(page, ctx)) || { blocked: 'sessions exist, but LP09 has no further driver code yet' }) },

  { id: 'LP29', title: 'Learning assessment: the practice school is first in the school list (sa_r19_practice_first)',
    run: async (page, ctx) => {
      // the practice school: the demo network's fourth school, marked is_probable_test and linked to the coach for the scenario
      await ready(ctx);
      const coachId = await L.userId(ctx, L.DEMO.coach);
      const sid = await ctx.sql("select id from schools where emis = 'DEMO-004'");
      const linkId = await ctx.sql('insert into leader_schools (leader_user_id, source, school_ext_id, school_name, emis, school_id, name_match_quality) values ('
        + L.q(coachId) + ", 'niete_ict', 'niete:DEMO-004', 'Demo Hill School Bhara Kahu', 'DEMO-004', " + L.q(sid) + ", 'exact') returning id");
      try {
        await ctx.sql('update schools set is_probable_test = true where id = ' + L.q(sid));
        const order = async (on) => L.withSettings(ctx, { ...L.modeSettings('coachV2'), ...BASE, sa_r19_practice_first: on ? true : null, sa_hide_practice: null }, async () => {
          await L.go(page, ctx, '/portal/leader/assess');
          await L.seeText(page, /Which school\?|کون سا اسکول/, 'the school list');
          await page.waitForTimeout(1000);
          return page.$$eval('main button, main a', (els) => els.map((e) => e.innerText.split('\n')[0].trim()).filter((t) => /^Demo .*School/.test(t)));
        });
        await L.asRole(page, ctx, 'coach');
        let on = await order(true);
        for (const until = Date.now() + 45000; on[0] !== 'Demo Hill School Bhara Kahu' && Date.now() < until;) { await page.waitForTimeout(5000); on = await order(true); }
        L.expect(on[0] === 'Demo Hill School Bhara Kahu', 'with the switch on the first school is ' + on[0] + ' (' + JSON.stringify(on) + ')');
        // the bot caches this switch for 30 s (practice-first-switch.js TTL_MS): read the list until it follows, up to 45 s
        let off = await order(false);
        for (const until = Date.now() + 45000; off[0] === 'Demo Hill School Bhara Kahu' && Date.now() < until;) { await page.waitForTimeout(5000); off = await order(false); }
        L.expect(off[0] !== 'Demo Hill School Bhara Kahu' || off.length === 1, 'with the switch off the practice school is still first: ' + JSON.stringify(off));
        // with no signal: the schools saved on the phone (Get ready, then offline, then the page again) keep it first
        const saved = await L.withSettings(ctx, { ...L.modeSettings('coachV2'), ...BASE, sa_r19_practice_first: true, sa_r8_offline_prep: true }, async () => {
          await L.go(page, ctx, '/portal/leader/assess');
          await page.getByText('English', { exact: true }).first().click().catch(() => {});
          await L.seeText(page, /Get ready for offline/, 'the Learning assessment');
          // the bot's 30 s switch cache: the online list must already put the practice school first before it is kept
          const first = () => page.$$eval('main button, main a', (els) => els.map((e) => e.innerText.split('\n')[0].trim()).filter((t) => /^Demo .*School/.test(t))[0]);
          for (const until = Date.now() + 45000; (await first()) !== 'Demo Hill School Bhara Kahu' && Date.now() < until;) {
            await page.waitForTimeout(5000); await page.reload(); await page.getByText('English', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(1500);
          }
          await tickForPrep(page);
          await page.getByRole('button', { name: /^Get ready$|^Get ready again$/ }).click();
          await L.seeText(page, /Ready for offline ✓/, 'Get ready', 180000);
          await page.context().setOffline(true);
          try {
            await page.reload({ waitUntil: 'domcontentloaded' });
            await L.seeText(page, /Demo Hill School Bhara Kahu/, 'the saved schools with no signal', 20000);
            return page.$$eval('main button, main a', (els) => els.map((e) => e.innerText.split('\n')[0].trim()).filter((t) => /^Demo .*School/.test(t)));
          } finally { await page.context().setOffline(false); }
        });
        L.expect(saved[0] === 'Demo Hill School Bhara Kahu', 'with no signal the saved schools start with ' + saved[0]);
        return { on, off, saved };
      } finally {
        await ctx.sql('update schools set is_probable_test = false where id = ' + L.q(sid));
        await ctx.sql('delete from leader_schools where id = ' + L.q(linkId));
      }
    } },

  { id: 'LP32', title: 'Learning assessment: at an ICT school with no class list for the grade, the page is exactly as before (sa_add_child)',
    run: coach({ sa_add_child: true }, async (page) => {
      // Grade 1 at the Model School: nobody of the demo network teaches Grade 1 there (portal-demo-seed.js TEACHERS)
      await openList(page, SCHOOL, 1);
      await L.seeText(page, /This school has no class list for this grade yet\./, 'an empty Grade 1 at an ICT school');
      await L.noText(page, /Add a child/, 'an ICT school with no class list');
      return { ok: true };
    }) },

  ...[{ id: 'LP30', a: ['Learning assessment: at a Gilgit-Baltistan school with no class list for the grade, "Add a child" seats the first child (sa_add_child)'] },
    { id: 'LP31', a: ['Learning assessment: on a second visit to a Gilgit-Baltistan school where every child was tested, "Add a child" opens the day\'s list (sa_add_child)'] },
  ].map(({ id, a: [title] }) => ({ id, title, run: async (page, ctx) => {
    const gb = await ctx.sql("select count(*) from schools s join leader_schools l on l.school_id = s.id where l.leader_user_id = "
      + L.q(await L.userId(ctx, L.DEMO.coach)) + " and s.region ilike any (array['%gilgit%', '%gb%', '%skardu%', '%hunza%'])");
    if (Number(gb) === 0) return { blocked: 'the demo network has no Gilgit-Baltistan school: the demo coach\'s schools are all Islamabad (ICT) ones (portal-demo-seed.js SCHOOLS), so "Add a child" at a GB school cannot be reached' };
    throw new Error('a GB school is linked to the demo coach, but ' + id + ' has no further driver code yet');
  } })),

  { id: 'LP20', title: 'Learning assessment: Start opens the test within 1.5 s even when the server is slow (sa_r8_fast_start)',
    run: async (page, ctx) => {
      // the server's answer to Present (POST …/sa/outcome) is held 4 s on its way back: the real answer, late
      const timeStart = async (fast) => coach({ sa_r8_fast_start: fast ? true : null }, async (p) => {
        await p.route('**/api/portal/leader/child-test/sa/outcome', async (route) => { const r = await route.fetch(); await new Promise((x) => setTimeout(x, 4000)); await route.fulfill({ response: r }); });
        await openList(p, SCHOOL, 3);
        await L.seeText(p, /Test these children/, 'the day\'s list');
        await p.getByText('Present', { exact: true }).first().click();
        const t0 = Date.now();
        await p.getByRole('button', { name: /^Start/ }).first().click();
        await p.getByText('End test (coach)', { exact: true }).waitFor({ timeout: 30000 });
        return Date.now() - t0;
      })(page, ctx);
      const fast = await timeStart(true);
      L.expect(fast <= 1500 + 400, 'with sa_r8_fast_start on the test opened ' + fast + ' ms after Start (server held 4 s)');
      const ctx2 = await page.context().browser().newContext({ viewport: { width: 412, height: 915 } });
      let slow;
      try { slow = await timeStart.call(null, false).catch(() => null); } finally { await ctx2.close(); }
      return { fastMs: fast, blocked: 'checked: the test opens ' + fast + ' ms after Start while the server holds Present 4 s. Where the late session id is kept on the phone, '
        + 'Present\'s queue after a failed network, and the switch-off timing (a second sign-in in one scenario) have no driver code yet' };
    } },

  { id: 'LP22', title: 'Learning assessment: Get ready for offline before the school (sa_r8_offline_prep)',
    run: coach({ sa_r8_offline_prep: true }, async (page, ctx) => {
      await L.seeText(page, /Get ready for offline/, 'the Learning assessment');
      const schools = await (await page.request.get(ctx.baseUrl + '/api/portal/leader/child-test/sa/schools')).json();
      const list = schools.schools || schools.data || [];
      const today = list.filter((x) => x.visitToday).map((x) => x.name || x.schoolName);
      const ticked = await page.$$eval('input[type="checkbox"]', (els) => els.filter((e) => e.checked).map((e) => (e.closest('label') || e.parentElement).innerText.trim()));
      L.expect(JSON.stringify([...ticked].sort()) === JSON.stringify([...today].sort()), 'ticked ' + JSON.stringify(ticked) + ', today\'s visits ' + JSON.stringify(today));
      await tickForPrep(page);
      await page.getByRole('button', { name: /^Get ready$/ }).click();
      const t = await L.waitText(page, /Ready for offline ✓|Not everything downloaded \(\d+ files missing\)/, 180000);
      const line = (t.match(/Ready for offline ✓ \d+\s(school|schools) · [\d.]+\sMB · [^\n]+/) || [])[0];
      L.expect(line, 'Get ready ended: ' + JSON.stringify((t.match(/Not everything[^\n]*|Ready for offline[^\n]*/) || [''])[0]));
      // a card made on an earlier day: the phone's own record of it (localStorage assess:r8:prep) dated yesterday
      await page.evaluate(() => { const k = 'assess:r8:prep'; const r = JSON.parse(localStorage.getItem(k)); const d = new Date(Date.now() - 864e5);
        r.day = d.toISOString().slice(0, 10); r.at = d.getTime(); localStorage.setItem(k, JSON.stringify(r)); });
      await page.reload();
      await page.getByText('English', { exact: true }).first().click().catch(() => {});
      await L.seeText(page, /This was made on an earlier day\. Get ready again today/, 'a card made yesterday');
      return { ready: line, todaysVisits: today };
    }) },

  { id: 'LP25', title: 'Learning assessment: Get ready for offline with every grade on (sa_r8_offline_prep, sa_all_grades)',
    run: coach({ sa_r8_offline_prep: true }, async (page) => {
      await L.seeText(page, /Get ready for offline/, 'the Learning assessment');
      for (const b of await page.locator('input[type="checkbox"]').all()) if (await b.isChecked()) await b.uncheck();
      await page.locator('label', { hasText: SCHOOL }).locator('input[type="checkbox"]').check();
      const grades = page.locator('[role="group"]').first().locator('button');
      const names = (await grades.allInnerTexts()).map((x) => x.trim().replace(/\D/g, ''));
      L.expect(JSON.stringify(names) === JSON.stringify(['1', '2', '3', '4', '5']), 'the grade buttons are ' + JSON.stringify(names));
      for (const g of await grades.all()) if (await g.getAttribute('aria-pressed') === 'true') await g.click();
      const lists = [];
      page.on('request', (r) => { if (/\/sa\/list\?/.test(r.url())) lists.push(new URL(r.url()).searchParams.get('grade')); });
      await page.getByRole('button', { name: /^Get ready$/ }).click();
      await L.seeText(page, new RegExp(SCHOOL.replace(/[/]/g, '\\/') + ': tick the grades you will test there\\.'), 'Get ready with no grade ticked');
      L.expect(!lists.length, 'a list was read with no grade ticked');
      for (const g of ['2', '4']) await grades.filter({ hasText: new RegExp('^\\s*' + g + '\\s*$') }).click();
      await page.getByRole('button', { name: /^Get ready$/ }).click();
      await L.waitText(page, /Ready for offline ✓|Not everything downloaded/, 180000);
      L.expect(JSON.stringify([...new Set(lists)].sort()) === JSON.stringify(['2', '4']), 'Get ready read the lists of grades ' + JSON.stringify(lists));
      await L.seeText(page, /Ready for offline ✓/, 'Get ready for grades 2 and 4');
      return { lists, blocked: 'checked: grades 1–5 under the ticked school, the no-grade message with nothing read, and only the grade 2 and 4 lists kept. '
        + 'Which tests (Urdu and English, those grades only) went onto the phone is inside the battery engine\'s cache, which this driver does not read yet' };
    }) },

  ...[{ id: 'LP23', a: ['Learning assessment: at a school with no signal after getting ready (sa_r8_offline_prep)', {}, false, true] },
    { id: 'LP27', a: ['Learning assessment: after Get ready, a child starts at a school with no signal (sa_r8_offline_first, sa_r8_offline_prep)', { sa_r8_offline_first: true }, false, false] },
    { id: 'LP24', a: ['Learning assessment: the page opens again after a reload at a school with no signal (sa_r8_offline_prep)', {}, true, false] },
  ].map(({ id, a: [title, sw, reload, note] }) => ({ id, title, run: coach({ sa_r8_offline_prep: true, ...sw }, async (page, ctx) => {
    await L.seeText(page, /Get ready for offline/, 'the Learning assessment');
    for (const b of await page.locator('input[type="checkbox"]').all()) if (await b.isChecked()) await b.uncheck();
    await page.locator('label', { hasText: SCHOOL }).locator('input[type="checkbox"]').check();
    const g3 = page.locator('[role="group"]').first().locator('button', { hasText: /^\s*3\s*$/ });
    if (await g3.count() && await g3.getAttribute('aria-pressed') !== 'true') await g3.click();
    await page.getByRole('button', { name: /^Get ready$/ }).click();
    await L.seeText(page, /Ready for offline ✓/, 'Get ready', 180000);
    await page.context().setOffline(true);
    try {
      if (reload) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByText('English', { exact: true }).first().click({ timeout: 15000 }).catch(() => {});
        await L.seeText(page, /Which school\?[\s\S]*Demo Model School G-6\/2/, 'the Learning assessment reloaded with no internet', 20000);
        L.expect(!L.pathOf(page).startsWith('/portal/login'), 'the reload with no internet lost her sign-in');
      } else {
        // she opens the Learning assessment again inside the app (another page, then back), as she would at the school
        await page.locator('nav a:visible', { hasText: 'My schools' }).first().click();
        await page.waitForTimeout(1500);
        await page.goBack();
        await page.getByText('English', { exact: true }).first().click({ timeout: 15000 }).catch(() => {});
        await L.seeText(page, /Which school\?[\s\S]*Demo Model School G-6\/2/, 'the Learning assessment opened with no internet', 20000);
        if (note) await L.seeText(page, /No internet: these are the schools saved on this phone\./, 'the Learning assessment opened with no internet', 5000);
      }
      await page.getByText(SCHOOL, { exact: true }).last().click();
      await page.getByText('Grade 3', { exact: true }).first().click().catch(() => {});
      await page.getByRole('button', { name: /^Ready/ }).click().catch(() => {});
      await L.seeText(page, /Test these children/, 'the saved list with no internet', 20000);
      await page.getByText('Present', { exact: true }).first().click();
      await page.getByRole('button', { name: /^Start/ }).first().click();
      await page.getByText('End test (coach)', { exact: true }).waitFor({ timeout: 30000 });
      await page.waitForTimeout(3000);
      L.expect(!/The voice is not ready yet|Getting Jugnu ready/.test(await L.bodyText(page)), 'the offline start waited for, or lacked, the voice');
    } finally { await page.context().setOffline(false); }
    if (reload) {
      // with sa_r8_offline_prep off, the page's offline copy goes the next time the page reads its switches online
      const pageSw = () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).filter((r) => /\/portal\/leader\/assess/.test(r.scope)).length);
      L.expect(await pageSw() === 1, 'no page worker was kept by Get ready');
      await ctx.sql("delete from app_settings where key = 'sa_r8_offline_prep'");
      let left = 1;
      for (const until = Date.now() + 60000; left && Date.now() < until;) { await page.reload(); await page.waitForTimeout(5000); left = await pageSw(); }
      L.expect(!left, 'the page\'s offline copy is still on the phone a minute after sa_r8_offline_prep went off');
    }
    return { offlineStart: true };
  }) })),

  ...[{ id: 'LP21', a: ['Learning assessment: the child\'s whole test is on the phone before it starts (sa_r8_offline_first)'] },
    { id: 'LP34', a: ['Learning assessment: no internet and the test is not on the phone yet (sa_r8_offline_first)'] },
    { id: 'LP26', a: ['Learning assessment: Start does not wait when the child\'s part is already on the phone (sa_r8_offline_first)'] },
    { id: 'LP28', a: ['Learning assessment: Start is never slower than without the switch (sa_r8_offline_first)'] },
  ].map(({ id, a: [title] }) => ({ id, title, run: coach({ sa_r8_offline_first: true }, async (page) => {
    // the first step all four share: the background download of the list's battery, seen on the list (Downloading… n of N)
    await openList(page, SCHOOL, 3);
    await L.seeText(page, /Test these children/, 'the day\'s list');
    return { blocked: 'the day\'s list opens with sa_r8_offline_first on. ' + id + ' turns on how fast the battery reaches the phone against when Start is tapped '
      + '(a throttled or cut network mid-download); this driver has no network throttling yet, so its timing cannot be set up' };
  }) })),
];

module.exports = scenarios;
