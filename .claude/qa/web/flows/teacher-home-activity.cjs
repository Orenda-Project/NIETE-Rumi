// teacher-home-activity — the hand-written teacher-home scenarios for Home's "Last 30 days" block and My journey
// (portal_teacher_home_activity, which only ever takes effect with portal_teacher_home_card on, and
// portal_teacher_journey). Joined to the generated teacher-home driver by .claude/qa/web/gen_page_features.py (EXTRA).
//
// Nothing is faked between the page and the server: the switches are REAL (app_settings on this run's database) and
// the numbers are a REAL stored value in this run's Redis, under the key the twice-a-day job writes
// (bot/shared/config/teacher-activity-contract.js), so GET /me/home and GET /me/journey read it exactly as they will on
// sandbox. Every switch, the stored value and the saved language are put back afterwards.
// WEB_SHOTS_DIR set → each scenario also saves its 360 px screens there (the design review's screenshots).
'use strict';
const path = require('path');
const { DEMO, expect, asRole, watch } = require('../lib.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const contract = require(path.join(ROOT, 'bot/shared/config/teacher-activity-contract.js'));
const e164 = (p) => '92' + p.slice(1);
const q = (s) => (s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");
const KEYS = ['portal_teacher_home_card', 'portal_teacher_home_activity', 'portal_teacher_journey'];
const HOUR = 3600e3;

function storedValue(now = Date.now()) {
  const at = (h) => new Date(now - h * HOUR).toISOString();
  return {
    updated_at: at(1), slot: 'day',
    tiles: { plans_opened: { now: 14, prev: 9 }, taught: { now: 3, prev: 1 }, coached: { now: 2, prev: 2 },
      quizzes: { now: 4, prev: 0 }, exams: { now: 1, prev: 0 } },
    trend: [],
    tip: { session_id: '00000000-0000-4000-8000-00000000c001', text: 'Ask two children to explain their answer.', at: at(26) },
    journey: [
      { kind: 'plan_opened', at: at(2), ref_id: 'qa-k5-plan-1', meta: { plan_kind: 'k5', grade: 3, subject: 'math' } },
      { kind: 'taught', at: at(25), ref_id: 'qa-k5-plan-0', meta: { topic: 'Fractions', grade: 3, subject: 'math' } },
      { kind: 'coached', at: at(50), ref_id: '00000000-0000-4000-8000-00000000c001', meta: { grade: 3, subject: 'math' } },
    ],
    furthest_step: 'coached', grade_band: 'k5',
  };
}

async function redis(args) {
  if (!process.env.RUN_DIR && process.env.WEB_RUN_DIR) process.env.RUN_DIR = process.env.WEB_RUN_DIR;
  const SC = require(path.join(ROOT, '.claude/qa/engine/bin/stack-control.cjs'));
  const r = await SC.redis(args);
  expect(r && r.ok, 'redis ' + args[0] + ' failed: ' + (r && r.err));
  return r;
}

// The demo teacher, with `on` switches set for her alone, `stored` in Redis (or no key), and `lang` saved; then put back.
async function withActivity(ctx, { on, stored, lang }, body) {
  const [id, prevLang] = (await ctx.sql('select id, preferred_language from users where phone_number = ' + q(e164(DEMO.teacher)))).split('|');
  expect(id, 'no demo teacher ' + DEMO.teacher);
  const key = contract.teacherActivityKey(id);
  const before = {};
  for (const k of KEYS) before[k] = await ctx.sql('select value::text from app_settings where key = ' + q(k));
  const set = (k, json) => ctx.sql('insert into app_settings (key, value) values (' + q(k) + ', ' + q(json) + "::jsonb) "
    + 'on conflict (key) do update set value = excluded.value, updated_at = now()');
  try {
    await set('portal_teacher_home_card', 'true');
    await set('portal_teacher_home_activity', on ? JSON.stringify([id]) : 'false');
    await set('portal_teacher_journey', on ? JSON.stringify([id]) : 'false');
    if (stored) {
      expect(contract.checkTeacherActivity(stored, Date.now()), 'the test value fails the store contract');
      await redis(['SETEX', key, '3600', JSON.stringify(stored)]);
    } else await redis(['DEL', key]);
    await ctx.sql('update users set preferred_language = ' + q(lang || 'en') + ' where id = ' + q(id));
    return await body(id);
  } finally {
    await redis(['DEL', key]).catch(() => {});
    for (const k of KEYS) {
      if (before[k]) await set(k, before[k]);
      else await ctx.sql('delete from app_settings where key = ' + q(k));
    }
    await ctx.sql('update users set preferred_language = ' + q(prevLang || null) + ' where id = ' + q(id));
  }
}

async function open(page, ctx, p) {
  await page.setViewportSize({ width: 360, height: 740 });
  const w = watch(page);
  w.errors.length = 0; w.fivexx.length = 0;
  await page.goto(ctx.baseUrl + p, { waitUntil: 'domcontentloaded' });
  return w;
}
async function textOf(page, id, what) {
  const el = page.getByTestId(id).first();
  await el.waitFor({ state: 'visible', timeout: 20000 }).catch(() => { throw new Error('no ' + (what || id) + ' on the page'); });
  return (await el.innerText()).replace(/\s+/g, ' ').trim();
}
async function shot(page, name) {
  if (!process.env.WEB_SHOTS_DIR) return null;
  const file = path.join(process.env.WEB_SHOTS_DIR, name + '.png');
  await page.screenshot({ path: file, fullPage: true });
  // The fold as she sees it (360×740, menu bar in place), for the design review's "all four tiles show" check.
  await page.screenshot({ path: path.join(process.env.WEB_SHOTS_DIR, name + '-fold.png') });
  return file;
}
function healthy(w) {
  expect(!w.errors.length, 'page error: ' + w.errors.join(' | '));
  expect(!w.fivexx.length, '5xx: ' + w.fivexx.join(' | '));
}
const noSideScroll = async (page) => {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw <= 360, 'the page scrolls sideways at 360 px (' + sw + ' px wide)');
  return sw;
};

const scenarios = [
  { id: 'TH11', title: 'Teacher app v2: with Home activity on and her numbers counted, Home shows her last 30 days and My journey', run: (page, ctx) =>
    withActivity(ctx, { on: true, stored: storedValue() }, async () => {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await open(page, ctx, '/portal/teacher');
      const block = await textOf(page, 'home-activity', 'Last 30 days block');
      for (const want of ['Last 30 days', 'Updated today', 'Plans opened', '14', 'Taught in class', '3', 'DC observations', 'Quizzes · Papers', 'My journey']) {
        expect(block.includes(want), 'the block lacks "' + want + '": ' + block);
      }
      // Design review: on a slim-card day the block follows the slim card (inside the grid), never above it.
      let slimFirst = null;
      if (await page.getByTestId('home-slim-card').count()) {
        slimFirst = await page.evaluate(() => {
          const card = document.querySelector('[data-testid="home-slim-card"]');
          const block = document.querySelector('[data-testid="home-activity"]');
          return !!(card && block && (card.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING));
        });
        expect(slimFirst, 'the Last 30 days block is above the slim card');
      }
      const sw = await noSideScroll(page);
      const file = await shot(page, 'home-activity-en-360');
      healthy(w);
      return { block: block.slice(0, 300), slimFirst, scrollWidth: sw, shot: file };
    }) },
  { id: 'TH12', title: 'Teacher app v2: with Home activity on in Urdu, the block and My journey read in Urdu', run: (page, ctx) =>
    withActivity(ctx, { on: true, stored: storedValue(), lang: 'ur' }, async () => {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await open(page, ctx, '/portal/teacher');
      const block = await textOf(page, 'home-activity', 'Last 30 days block');
      expect(block.includes('پچھلے 30 دن') && block.includes('میرا سفر'), 'the block is not in Urdu: ' + block);
      const sw = await noSideScroll(page);
      const homeShot = await shot(page, 'home-activity-ur-360');
      await page.goto(ctx.baseUrl + '/portal/teacher/journey', { waitUntil: 'domcontentloaded' });
      const list = await textOf(page, 'journey-list', 'journey list');
      expect(list.includes('لیسن پلان کھولا') && list.includes('کلاس میں پڑھایا'), 'the journey is not in Urdu: ' + list);
      const journeyShot = await shot(page, 'journey-ur-360');
      healthy(w);
      return { block: block.slice(0, 200), list: list.slice(0, 200), scrollWidth: sw, shots: [homeShot, journeyShot] };
    }) },
  { id: 'TH13', title: 'Teacher app v2: My journey lists her stored steps newest first, with the updated line', run: (page, ctx) =>
    withActivity(ctx, { on: true, stored: storedValue() }, async () => {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await open(page, ctx, '/portal/teacher');
      await textOf(page, 'home-activity', 'Last 30 days block');
      await page.getByTestId('home-activity').getByText('My journey', { exact: true }).click();
      const list = await textOf(page, 'journey-list', 'journey list');
      const order = ['Opened a lesson plan', 'Taught in class', 'DC observation'].map((s) => list.indexOf(s));
      expect(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], 'the steps are missing or out of order: ' + list);
      const updated = await textOf(page, 'journey-updated', 'updated line');
      expect(/^Updated today/.test(updated), 'the updated line reads "' + updated + '"');
      expect(/\/portal\/teacher\/journey/.test(page.url()), 'My journey opened ' + page.url());
      // bd-96f69c.9 design review #5: Home stays the current menu item on My journey.
      const current = await page.locator('nav [aria-current="page"]').first().getAttribute('href');
      expect(current === '/portal/teacher', 'the menu item lit on My journey is ' + current);
      const sw = await noSideScroll(page);
      const file = await shot(page, 'journey-en-360');
      healthy(w);
      return { list: list.slice(0, 300), updated, scrollWidth: sw, shot: file };
    }) },
  { id: 'TH14', title: 'Teacher app v2: with Home activity on but no numbers counted yet, Home loads with no numbers and no error', run: (page, ctx) =>
    withActivity(ctx, { on: true, stored: null }, async () => {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await open(page, ctx, '/portal/teacher');
      await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: 20000 });
      await page.waitForTimeout(1500);
      const tiles = await page.getByTestId('home-activity').getByText('Plans opened').count();
      expect(tiles === 0, 'number tiles drawn with nothing stored');
      const file = await shot(page, 'home-no-numbers-en-360');
      healthy(w);
      return { tiles, shot: file };
    }) },
  { id: 'TH15', title: 'Teacher app v2: with Home activity and My journey off, Home has no Last 30 days block, even with numbers stored', run: (page, ctx) =>
    withActivity(ctx, { on: false, stored: storedValue() }, async () => {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await open(page, ctx, '/portal/teacher');
      await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: 20000 });
      await page.waitForTimeout(1500);
      const blocks = await page.getByText('Last 30 days').count();
      expect(blocks === 0, 'the Last 30 days block shows with the switch off');
      healthy(w);
      return { blocks };
    }) },
];

module.exports = scenarios;
