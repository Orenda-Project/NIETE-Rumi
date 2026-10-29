// coach-school-card — the hand-written coach-portal scenarios for the School card (portal/src/portal/coach/card/**): with
// portal_coach_school_card on, a v2 coach lands on the slim Coach Home (Training Library and My schools), the menu is
// Home · Lesson Plans · More, a school opens as its School card (period chips, four feature tiles, the teachers), a tile
// opens that feature by teacher, a row opens her Teacher page (Digital Coaching and Coach observations tiles first) and
// her Digital Coaching page (graph, practice averages, her reports); a DC report and a coach observation open in the
// coach's report view with no transcript. With the switch off, nothing of it is there. Joined to the generated coach-portal
// driver by .claude/qa/web/gen_page_features.py (EXTRA), so spec and driver still come from one place.
//
// The dashboard caches a switch for 30 s (feature-flags.js readFlagRow), so each scenario waits for /config to say what
// it set before it looks, and every scenario puts the switch back OFF when it ends: the other coach-portal and
// portal-smoke scenarios expect today's coach app.
'use strict';
const { DEMO, MODES, expect, asRole, watch, visit, setSetting, setFlags } = require('../lib.cjs');

const KEY = 'portal_coach_school_card';
const SCHOOL = 'DEMO-001';
const HIDDEN = ['/portal/coach/scheduling', '/portal/coach/schedule', '/portal/coach/team', '/portal/coach/new-visit', '/portal/coach/observe',
  '/portal/coach/reports', '/portal/coach/analytics', '/portal/coach/insights'];
const e164 = (p) => '92' + p.slice(1);
const q = (s) => "'" + s + "'";

async function switchTo(page, ctx, on) {
  const deadline = Date.now() + 45000;
  let seen = null;
  while (Date.now() < deadline) {
    seen = await page.evaluate(() => fetch('/api/portal/config', { credentials: 'include' }).then((r) => r.json()).then((c) => c && c.features ? c.features.schoolCard : null).catch(() => null));
    if (seen === on) return;
    await page.waitForTimeout(1000);
  }
  throw new Error('/config never said schoolCard ' + on + ' (last: ' + JSON.stringify(seen) + ')');
}

/** Coach app v2 on, the School card switch as asked, the demo coach signed in and /config agreeing. */
async function signedIn(page, ctx, on) {
  await setFlags(ctx, MODES.coachV2);
  await setSetting(ctx, KEY, on ? 'true' : 'false');
  await asRole(page, ctx, 'coach', null);
  await switchTo(page, ctx, on);
}

const off = (ctx) => setSetting(ctx, KEY, 'false');

async function shown(page, testId, what) {
  const el = page.getByTestId(testId).first();
  await el.waitFor({ state: 'visible', timeout: 20000 }).catch(() => { throw new Error('no ' + (what || testId) + ' on ' + new URL(page.url()).pathname); });
  return el;
}

function healthy(w, where) {
  expect(!w.errors.length, where + ': uncaught page error — ' + w.errors[0]);
  expect(!w.fivexx.length, where + ': API returned ' + [...new Set(w.fivexx)].join(', '));
}

const scenarios = [
  { id: 'CP07', title: 'Coach app v2 with the School card on: her home is the slim Coach Home, the menu is Home, Lesson Plans and More, and the hidden pages land on Home', run: async (page, ctx) => {
    try {
      await signedIn(page, ctx, true);
      const home = await visit(page, ctx, '/portal/coach');
      await shown(page, 'coach-home-slim', 'slim Coach Home');
      const tiles = await page.getByTestId('feature-tiles').locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      expect(JSON.stringify(tiles) === JSON.stringify(['/portal/coach/training', '/portal/coach/people']), 'Home tiles are ' + JSON.stringify(tiles));
      const menu = await page.getByTestId('teacher-nav').locator('a').evaluateAll((as) => as.map((a) => a.textContent.trim()));
      expect(JSON.stringify(menu) === JSON.stringify(['Home', 'Lesson Plans', 'More']), 'the menu is ' + JSON.stringify(menu));
      const landed = [];
      for (const p of HIDDEN) landed.push((await visit(page, ctx, p, { settle: '/portal/coach' })).settled);
      return { home: home.settled, tiles, menu, hidden: HIDDEN.length, landed: [...new Set(landed)] };
    } finally { await off(ctx); }
  } },

  { id: 'CP08', title: "Coach app v2 with the School card on: a school opens as its School card; This month, a feature's grid and a teacher's page open from it", run: async (page, ctx) => {
    try {
      await signedIn(page, ctx, true);
      const w = watch(page);
      await visit(page, ctx, '/portal/coach/school/' + SCHOOL);
      for (const id of ['score-tile-dc', 'score-tile-coach', 'tile-lp', 'tile-papers', 'tile-training']) await shown(page, id, 'the ' + id + ' tile');
      const order = await page.getByTestId('activity').evaluate((el) => [...el.children].map((c) => c.getAttribute('data-testid')));
      expect(order[0] === 'score-tile-dc' && order[1] === 'score-tile-coach', 'the score tiles are not first: ' + JSON.stringify(order));
      const radios = await page.getByRole('radiogroup', { name: 'Period' }).getByRole('radio').evaluateAll((rs) => rs.map((r) => r.getAttribute('aria-label')));
      expect(JSON.stringify(radios) === JSON.stringify(['Today', 'This week', 'This month']), 'the period chips are ' + JSON.stringify(radios));
      await shown(page, 'manage', 'Manage group');
      const body = await page.evaluate(() => document.body.innerText);
      expect(!/Share with principal|Schedule a visit/.test(body), 'the School card shows Share or a Schedule dock');
      w.errors.length = 0; w.fivexx.length = 0;
      await page.getByRole('radio', { name: 'This month' }).click();
      await page.waitForURL(/period=month/, { timeout: 15000 });
      const bars = await (await shown(page, 'bars-lp', 'Lesson plans bars')).innerText();
      expect(/Wk 1/.test(bars), 'This month has no week bars: ' + bars.slice(0, 80));
      await page.getByTestId('tile-lp').click();
      await page.waitForURL('**/portal/coach/school/' + SCHOOL + '/feature/lp?period=month', { timeout: 15000 });
      await shown(page, 'teacher-grid', 'Lesson plans by teacher grid');
      const school = await (await shown(page, 'grid-school', 'School row')).innerText();
      const rows = await page.getByTestId('grid-row').count();
      expect(rows > 0, 'the grid has no teacher rows');
      await page.getByTestId('grid-row').first().click();
      await page.waitForURL(/\/portal\/coach\/teacher\/[^/?]+(\?|$)/, { timeout: 15000 });
      await shown(page, 'teacher-tiles', 'Teacher page tiles');
      const tiles = await page.getByTestId('teacher-tiles').evaluate((el) => [...el.children].map((c) => c.getAttribute('data-testid')));
      expect(tiles[0] === 't-dc' && tiles[1] === 't-coach', 'the Teacher page tiles are ' + JSON.stringify(tiles));
      await (await shown(page, 't-dc', 'Digital Coaching tile')).click();
      await page.waitForURL(/\/dc\?period=month/, { timeout: 15000 });
      await shown(page, 'scores-summary', 'Digital Coaching summary');
      const h1 = (await page.locator('h1').first().innerText()).trim();
      expect(/^Digital Coaching$/.test(h1), 'her Digital Coaching page did not open (h1: ' + h1 + ')');
      healthy(w, 'the School card journey');
      return { school: SCHOOL, radios, gridRows: rows, schoolRow: school.replace(/\s+/g, ' '), teacherTiles: tiles, dc: h1 };
    } finally { await off(ctx); }
  } },

  { id: 'CP09', title: "Coach app v2 with the School card on: a teacher's DC report opens in the coach's view, with no transcript", run: async (page, ctx) => {
    const id = (await ctx.sql('select s.id from coaching_sessions s join users t on t.id = s.user_id join leader_schools ls on ls.school_id = t.school_id '
      + 'join users c on c.id = ls.leader_user_id where c.phone_number = ' + q(e164(DEMO.coach)) + " and s.observation_type is null and s.status = 'completed' "
      + 'and s.duplicate_of_session_id is null and s.analysis_data is not null order by s.created_at desc limit 1')).split('\n')[0];
    expect(id, 'the demo coach has no teacher with a completed DC report');
    try {
      await signedIn(page, ctx, true);
      await visit(page, ctx, '/portal/coach/session/' + id, { heading: /^Report$/ });
      await shown(page, 'overall', 'overall AI score');
      await shown(page, 'coach-view', '"Coach view" chip');
      const body = await page.evaluate(() => document.body.innerText);
      expect(!/transcript|Focus here/i.test(body), 'the coach DC report shows a transcript or "Focus here"');
      return { session: id };
    } finally { await off(ctx); }
  } },

  { id: 'CP10', title: "Coach app v2 with the School card off: her home is the Training Library, a school opens as before, and the School card's own pages do not open", run: async (page, ctx) => {
    await signedIn(page, ctx, false);
    await visit(page, ctx, '/portal/coach', { settle: '/portal/coach/training' });
    await visit(page, ctx, '/portal/coach/session/00000000-0000-0000-0000-000000000000', { settle: '/portal/coach/training' });
    await visit(page, ctx, '/portal/coach/school/' + SCHOOL);
    const body = await page.evaluate(() => document.body.innerText);
    expect(/Visits · last 3 months/.test(body), "the school page is not today's (no \"Visits · last 3 months\")");
    expect(!(await page.getByTestId('activity').count()), 'the School card shows with the switch off');
    const menu = await page.getByTestId('teacher-nav').locator('a').evaluateAll((as) => as.map((a) => a.textContent.trim()));
    expect(!menu.includes('Home'), 'the menu has Home with the switch off: ' + JSON.stringify(menu));
    return { menu };
  } },

  { id: 'CP11', title: "Coach app v2 with the School card on: Digital Coaching by teacher opens a teacher's Digital Coaching page, whose report opens in the coach's view, and her old addresses open her pages", run: async (page, ctx) => {
    // A teacher on one of the demo coach's schools with a scored DC report this month (Pakistan time), and that school's EMIS.
    const [ext, emis] = (await ctx.sql('select t.phone_number, coalesce(ls.emis, sch.emis) from coaching_sessions s join users t on t.id = s.user_id '
      + 'join schools sch on sch.id = t.school_id join leader_schools ls on ls.school_id = t.school_id join users c on c.id = ls.leader_user_id '
      + 'where c.phone_number = ' + q(e164(DEMO.coach)) + " and t.role in ('teacher', 'principal') and t.is_test_user is not true and t.deleted_at is null"
      + " and s.observation_type is null and s.status = 'completed' and s.duplicate_of_session_id is null and s.analysis_data -> 'scores' is not null"
      + " and s.created_at >= (date_trunc('month', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi')"
      + ' order by s.created_at desc limit 1')).split('\n')[0].split('|');
    expect(ext && emis, "no teacher at the demo coach's schools has a scored DC report this month");
    try {
      await signedIn(page, ctx, true);
      const w = watch(page);
      await visit(page, ctx, '/portal/coach/school/' + emis + '/feature/dc?period=month', { heading: /^Digital Coaching by teacher$/ });
      const row = page.locator('a[data-testid="score-row"][href^="/portal/coach/teacher/' + ext + '/dc"]').first();
      await row.waitFor({ state: 'visible', timeout: 20000 });
      const rowText = (await row.innerText()).replace(/\s+/g, ' ');
      expect(/\d+ observations?/.test(rowText) && /\d+%/.test(rowText), "her row shows no count or average: " + rowText);
      await row.click();
      await page.waitForURL(/\/teacher\/[^/]+\/dc\?period=month/, { timeout: 15000 });
      for (const id of ['scores-summary', 'detail-chart', 'practices-head', 'reports-head']) await shown(page, id, id);
      await page.getByTestId('report-row').first().click();
      await page.waitForURL(/\/portal\/coach\/session\//, { timeout: 15000 });
      await shown(page, 'coach-view', '"Coach view" chip');
      const me = '/portal/coach/teacher/' + ext;
      await visit(page, ctx, me + '/observations?period=month', { heading: /^Coach observations$/ });
      const moved = await visit(page, ctx, me + '/reports', { settle: me + '/dc' });
      healthy(w, 'the Digital Coaching journey');
      return { teacher: ext, school: emis, reports: moved.settled };
    } finally { await off(ctx); }
  } },

  { id: 'CP12', title: "Coach app v2 with the School card on: a teacher's reviewed coach observation opens in the coach's report view with its Coach score", run: async (page, ctx) => {
    const id = (await ctx.sql('select s.id from coaching_sessions s join users t on t.id = s.user_id join leader_schools ls on ls.school_id = t.school_id '
      + 'join users c on c.id = ls.leader_user_id left join users o on o.id = s.observer_user_id where c.phone_number = ' + q(e164(DEMO.coach))
      + " and s.observation_type = 'leader_observation' and s.status in ('completed', 'observer_review_complete')"
      + ' and s.observer_user_id is distinct from s.user_id and o.is_test_user is not true and s.analysis_data is not null'
      + ' order by s.created_at desc limit 1')).split('\n')[0];
    expect(id, "no teacher at the demo coach's schools has a reviewed coach observation");
    try {
      await signedIn(page, ctx, true);
      const w = watch(page);
      await visit(page, ctx, '/portal/coach/session/' + id, { heading: /^Report$/ });
      await shown(page, 'overall', 'overall Coach score');
      await shown(page, 'coach-view', '"Coach view" chip');
      const body = await page.evaluate(() => document.body.innerText);
      expect(/Coach score/.test(body), 'the coach observation report shows no Coach score');
      expect(!/transcript|Focus here/i.test(body), 'the report shows a transcript or "Focus here"');
      healthy(w, 'the coach observation report');
      return { session: id };
    } finally { await off(ctx); }
  } },
];

module.exports = scenarios;
