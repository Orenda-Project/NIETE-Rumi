// teacher-home-look — the hand-written teacher-home scenarios for the Home's new look (portal_teacher_home_look, which
// only ever takes effect with portal_teacher_home_card on): the navy band (home-band, data-shape "one"|"two"), the
// language pill, the tinted card, the progress strip, "All features" or the no-card question, then the 8 tiles.
// Joined to the generated teacher-home driver by .claude/qa/web/gen_page_features.py (EXTRA), so spec and driver
// still come from one place.
//
// The switches are REAL (app_settings on this run's database, read per request by /config). Today's Home answer
// (GET /api/portal/me/home) is fixed per scenario with page.route, because which rung the server picks depends on the
// bot's quiz job and the seed's history; the look draws whatever that answer says, and this is what is under test.
// The demo teacher is renamed "Ayesha Testwala" for the scenario (a two-word Latin name, so the "!" isolate shows) and
// every setting, the name and the saved language are put back afterwards.
'use strict';
const { DEMO, expect, asRole, watch } = require('../lib.cjs');

const e164 = (p) => '92' + p.slice(1);
const q = (s) => (s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");
const KEYS = ['portal_teacher_home_card', 'portal_teacher_home_order', 'portal_teacher_home_look'];
const NAME = 'Ayesha Testwala';

const LESSON_DAY = {
  success: true, order: null, orderOn: false, quizHome: '/quiz/teacher/demo-home-look',
  card: { kind: 'lesson', title: 'Fractions', from: 'lp', id: '00000000-0000-4000-8000-00000000f001', href: '/quiz/teacher/demo-home-look' },
  scores: { coach: { marks: 29, max: 38, at: '2026-10-20T09:00:00Z', id: '00000000-0000-4000-8000-00000000c001' }, observation: null },
};
const NO_CARD_DAY = {
  success: true, order: null, orderOn: false, quizHome: null, card: null,
  scores: { coach: { marks: 29, max: 38, at: '2026-10-20T09:00:00Z', id: '00000000-0000-4000-8000-00000000c001' },
    observation: { marks: 31, max: 40, at: '2026-10-21T09:00:00Z', id: '00000000-0000-4000-8000-00000000b001' } },
};

// Switch the look (and the card) for THIS teacher only, rename them, run `body`, then put everything back.
async function withLook(ctx, { card, look }, body) {
  const [id, name, lang] = (await ctx.sql('select id, name, preferred_language from users where phone_number = ' + q(e164(DEMO.teacher)))).split('|');
  expect(id, 'no demo teacher ' + DEMO.teacher);
  const before = {};
  for (const k of KEYS) before[k] = await ctx.sql('select value::text from app_settings where key = ' + q(k));
  const set = (k, json) => ctx.sql('insert into app_settings (key, value) values (' + q(k) + ', ' + q(json) + "::jsonb) "
    + 'on conflict (key) do update set value = excluded.value, updated_at = now()');
  try {
    await set('portal_teacher_home_card', card ? 'true' : 'false');
    await set('portal_teacher_home_order', 'false');
    await set('portal_teacher_home_look', look ? JSON.stringify([id]) : 'false');
    await ctx.sql('update users set name = ' + q(NAME) + ' where id = ' + q(id));
    return await body(id);
  } finally {
    for (const k of KEYS) {
      if (before[k]) await set(k, before[k]);
      else await ctx.sql('delete from app_settings where key = ' + q(k));
    }
    await ctx.sql('update users set name = ' + q(name) + ', preferred_language = ' + q(lang || null) + ' where id = ' + q(id));
  }
}

async function homeAnswer(page, body) {
  await page.route('**/api/portal/me/home', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, now: new Date().toISOString(),
      order: ['lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance', 'classes', 'analytics'] }) })
    : route.continue()));
}

async function openHome(page, ctx, width) {
  if (width) await page.setViewportSize({ width, height: 800 });
  const w = watch(page);
  w.errors.length = 0; w.fivexx.length = 0;
  await page.goto(ctx.baseUrl + '/portal/teacher', { waitUntil: 'domcontentloaded' });
  return w;
}

const tid = (page, id) => page.getByTestId(id);
async function textOf(page, id, what) {
  const el = tid(page, id).first();
  await el.waitFor({ state: 'visible', timeout: 20000 }).catch(() => { throw new Error('no ' + (what || id) + ' on the Home'); });
  return (await el.innerText()).replace(/\s+/g, ' ').trim();
}
const count = (page, id) => tid(page, id).count();
async function topOf(page, id) { const b = await tid(page, id).first().boundingBox(); return b ? b.y : -1; }
async function tiles(page) {
  await tid(page, 'feature-tiles').waitFor({ state: 'visible', timeout: 20000 });
  return tid(page, 'feature-tiles').locator('a').count();
}
function healthy(w) {
  expect(!w.errors.length, 'uncaught page error — ' + w.errors[0]);
  expect(!w.fivexx.length, 'API returned ' + [...new Set(w.fivexx)].join(', '));
}

const scenarios = [
  { id: 'TH04', title: 'Teacher app v2, new Home look: on a card day the band, the lesson card, the progress strip and All features come in order', run: (page, ctx) =>
    withLook(ctx, { card: true, look: true }, async () => {
      await homeAnswer(page, LESSON_DAY);
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await openHome(page, ctx);
      const greeting = await textOf(page, 'home-look-greeting', 'band greeting');
      expect(greeting === 'Salaam, ' + NAME + '!', 'the band greets "' + greeting + '"');
      const shape = await tid(page, 'home-band').getAttribute('data-shape');
      expect(shape === 'two', 'a 412 px phone should get the two-row band, got ' + shape);
      const meta = await textOf(page, 'home-look-meta', 'date and school line');
      const pill = await textOf(page, 'home-look-lang', 'language pill');
      expect(pill === 'اردو', 'the language pill reads "' + pill + '", not "اردو"');
      const card = tid(page, 'home-look-card');
      expect((await card.getAttribute('data-home-card')) === 'lesson', 'the card is not the lesson card');
      const title = await textOf(page, 'home-look-title', 'card title');
      expect(title === 'Quiz from your last lesson:', 'the card title reads "' + title + '"');
      const topic = await textOf(page, 'home-look-topic', 'lesson topic');
      expect(topic === 'Fractions', 'the topic reads "' + topic + '"');
      expect((await card.locator('[data-primary]').count()) === 1, 'the card has no single primary button');
      const primary = (await card.locator('[data-primary]').innerText()).trim();
      expect(primary === 'Quiz this', 'the primary reads "' + primary + '"');
      expect((await card.getByRole('button', { name: /Open the plan/ }).count()) === 1, 'no "Open the plan" under the primary');
      const progress = await textOf(page, 'home-look-progress', '"Your progress" label');
      expect(progress === 'Your progress', 'the strip label reads "' + progress + '"');
      const chip = await textOf(page, 'home-score-chip_coach', 'coach chip');
      expect(/Coach 29\/38/.test(chip), 'the coach chip reads "' + chip + '"');
      const all = await textOf(page, 'home-look-all', '"All features" label');
      expect(all.toLowerCase() === 'all features', 'the label reads "' + all + '"');
      expect((await count(page, 'home-look-ask')) === 0, 'the no-card question is drawn on a card day');
      const n = await tiles(page);
      expect(n === 8, 'expected 8 feature tiles, saw ' + n);
      const ys = await Promise.all(['home-band', 'home-look-card', 'home-scores', 'home-look-all', 'feature-tiles'].map((id) => topOf(page, id)));
      expect(ys.every((y, i) => i === 0 || y > ys[i - 1]), 'not in order band, card, strip, All features, tiles: ' + JSON.stringify(ys));
      healthy(w);
      return { greeting, shape, meta, pill, topic, chip, tiles: n };
    }) },
  { id: 'TH05', title: 'Teacher app v2, new Home look: on a no-card day the two score chips come first, then the question and the features', run: (page, ctx) =>
    withLook(ctx, { card: true, look: true }, async () => {
      await homeAnswer(page, NO_CARD_DAY);
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await openHome(page, ctx);
      await tid(page, 'home-band').waitFor({ state: 'visible', timeout: 20000 });
      const ask = await textOf(page, 'home-look-ask', 'no-card question');
      expect(ask === 'What would you like to do today?', 'the heading reads "' + ask + '"');
      expect((await count(page, 'home-look-card')) === 0, 'a card is drawn on a no-card day');
      expect((await count(page, 'home-look-all')) === 0, '"All features" is drawn on a no-card day');
      const coach = await textOf(page, 'home-score-chip_coach', 'coach chip');
      const obs = await textOf(page, 'home-score-chip_obs', 'observation chip');
      expect(/29\/38/.test(coach) && /31\/40/.test(obs), 'the chips read "' + coach + '" and "' + obs + '"');
      expect((await count(page, 'home-look-progress')) === 0, '"Your progress" is drawn beside two chips');
      const n = await tiles(page);
      expect(n === 8, 'expected 8 feature tiles, saw ' + n);
      const ys = await Promise.all(['home-band', 'home-scores', 'home-look-ask', 'feature-tiles'].map((id) => topOf(page, id)));
      expect(ys.every((y, i) => i === 0 || y > ys[i - 1]), 'not in order band, strip, question, tiles: ' + JSON.stringify(ys));
      healthy(w);
      return { ask, coach, obs, tiles: n };
    }) },
  { id: 'TH06', title: 'Teacher app v2, new Home look: the language pill switches the Home to Urdu and the "!" stays inside the name', run: (page, ctx) =>
    withLook(ctx, { card: true, look: true }, async (id) => {
      await homeAnswer(page, NO_CARD_DAY);
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await openHome(page, ctx);
      await textOf(page, 'home-look-lang', 'language pill');
      await tid(page, 'home-look-lang').click();
      let greeting = '';
      for (let i = 0; i < 40 && !/^السلام علیکم/.test(greeting); i++) {
        greeting = (await tid(page, 'home-look-greeting').innerText()).replace(/\s+/g, ' ').trim();
        if (!/^السلام علیکم/.test(greeting)) await page.waitForTimeout(250);
      }
      expect(/^السلام علیکم/.test(greeting), 'the band did not switch to Urdu: "' + greeting + '"');
      const name = (await tid(page, 'home-look-greeting').locator('[data-testid="home-greeting-name"]').innerText()).trim();
      expect(name === NAME + '!', 'the name\'s isolate reads "' + name + '" (the "!" must be inside it, after the name)');
      const pill = await textOf(page, 'home-look-lang', 'language pill');
      expect(pill === 'English', 'the pill reads "' + pill + '" on the Urdu Home');
      const ask = await textOf(page, 'home-look-ask', 'no-card question');
      expect(ask === 'آج کیا کریں؟', 'the Urdu question reads "' + ask + '"');
      const saved = await ctx.sql('select preferred_language from users where id = ' + q(id));
      expect(saved === 'ur', 'the teacher\'s saved language is ' + saved + ', not ur');
      await tid(page, 'home-look-lang').click();
      await page.getByTestId('home-look-greeting').filter({ hasText: /^Salaam, / }).waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => { throw new Error('the "English" pill did not bring the Home back to English'); });
      healthy(w);
      return { greeting, name, pill, ask, saved };
    }) },
  { id: 'TH07', title: 'Teacher app v2, new Home look: on a 320 px phone the band is one row and drops the date line', run: (page, ctx) =>
    withLook(ctx, { card: true, look: true }, async () => {
      await homeAnswer(page, LESSON_DAY);
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await openHome(page, ctx, 320);
      const greeting = await textOf(page, 'home-look-greeting', 'band greeting');
      expect(greeting === 'Salaam, ' + NAME + '!', 'the band greets "' + greeting + '"');
      const shape = await tid(page, 'home-band').getAttribute('data-shape');
      expect(shape === 'one', 'a 320 px phone should get the one-row band, got ' + shape);
      const row = tid(page, 'home-band').locator('[data-band-row]').first();
      expect((await row.getByTestId('home-look-greeting').count()) === 1 && (await row.getByTestId('home-look-lang').count()) === 1,
        'the greeting and the language pill are not on the one row');
      expect((await count(page, 'home-look-meta')) === 0, 'the date and school line is drawn under 344 px');
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollW <= 320, 'the Home scrolls sideways at 320 px (' + scrollW + ' px wide)');
      expect((await count(page, 'home-look-card')) === 1, 'no card at 320 px');
      healthy(w);
      return { greeting, shape, scrollWidth: scrollW };
    }) },
  { id: 'TH08', title: 'Teacher app v2: with the new Home look off, or on without the Home card, the Home is the one before', run: async (page, ctx) => {
    const seen = {};
    await withLook(ctx, { card: true, look: false }, async () => {
      await homeAnswer(page, NO_CARD_DAY);
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await openHome(page, ctx);
      seen.lookOff = await textOf(page, 'home-greeting', 'greeting band');
      expect(/Salaam, Ayesha Testwala!/.test(seen.lookOff), 'the Home greets "' + seen.lookOff + '"');
      expect((await count(page, 'home-band')) === 0, 'the new band is drawn with the look switch off');
      expect((await tiles(page)) === 8, 'not 8 feature tiles with the look off');
      healthy(w);
    });
    // Signing in again needs a signed-out browser: a fresh context (the session is not only a cookie).
    const fresh = await page.context().browser().newContext({ viewport: page.viewportSize() || { width: 412, height: 915 } });
    try {
      const p2 = await fresh.newPage();
      await withLook(ctx, { card: false, look: true }, async () => {
        await asRole(p2, ctx, 'teacher', 'teacherV2');
        const w = await openHome(p2, ctx);
        seen.cardOff = await textOf(p2, 'home-greeting', 'greeting band');
        expect((await count(p2, 'home-band')) === 0, 'the new band is drawn with the Home card off');
        expect((await tiles(p2)) === 8, 'not 8 feature tiles with the Home card off');
        healthy(w);
      });
    } finally {
      await fresh.close();
    }
    return seen;
  } },
];

module.exports = scenarios;
