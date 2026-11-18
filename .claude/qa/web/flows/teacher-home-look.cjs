// teacher-home-look — the hand-written teacher-home scenarios for the Home's new look (portal_teacher_home_look, which
// only ever takes effect with portal_teacher_home_card on): since 810b3bae2 the kit's HomeGreeting (home-band: the mark,
// the language pill, the greeting, home-date, home-school), the tinted card, the progress strip, then the 8 tiles three
// per row — no "All features" label, no question line. Also the Quizzes tile on the card build's Home (TH09).
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
const KEYS = ['portal_teacher_home_card', 'portal_teacher_home_order', 'portal_teacher_home_look', 'portal_teacher_home_quiz_tile', 'quiz_teacher_home'];
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
async function withLook(ctx, { card, look, quizTile, quizHome }, body) {
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
    await set('portal_teacher_home_quiz_tile', quizTile ? JSON.stringify([id]) : 'false');
    // The bot's quiz home (bot/shared/services/first-touch/teacher-home.flags.js, quiz_teacher_home): only set when asked.
    if (quizHome !== undefined) await set('quiz_teacher_home', quizHome ? 'true' : 'false');
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
// The kit header (HomeGreeting, home-band): its h1 greeting, date line and school line.
async function greetingOf(page) {
  const band = tid(page, 'home-band');
  await band.locator('h1').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => { throw new Error('no greeting in the band on the Home'); });
  const t = async (loc) => ((await loc.count()) ? (await loc.first().innerText()).replace(/\s+/g, ' ').trim() : '');
  return { greeting: await t(band.locator('h1')), date: await t(tid(page, 'home-date')), school: await t(tid(page, 'home-school')) };
}
// The feature grid: how many tiles, and how many share the first row.
async function gridOf(page) {
  await tid(page, 'feature-tiles').waitFor({ state: 'visible', timeout: 20000 });
  return tid(page, 'feature-tiles').evaluate((el) => {
    const kids = [...el.children]; const top = kids.length ? kids[0].getBoundingClientRect().top : 0;
    return { n: kids.length, cols: kids.filter((k) => Math.abs(k.getBoundingClientRect().top - top) < 2).length };
  });
}
// The grid's FEATURE tiles (a link each, or the Quizzes button), in drawing order — the card build's Home also puts its
// slim card and the score chips inside the grid, and those are not tiles. Each: its link, whether it is Quizzes, its
// words, and whether it spans both columns. `want`: wait up to 10 s for that many tiles (Quizzes arrives with /me/home).
async function cellsOf(page, want) {
  const grid = tid(page, 'feature-tiles');
  await grid.waitFor({ state: 'visible', timeout: 20000 });
  const read = () => grid.evaluate((el) => [...el.children].filter((c) => c.matches('a[href], [data-testid="tile-quiz"]')).map((c) => ({
    href: c.getAttribute('href'), quiz: c.getAttribute('data-testid') === 'tile-quiz',
    text: c.innerText.replace(/\s+/g, ' ').trim(), wide: /\bcol-span-2\b/.test(c.className) })));
  for (let i = 0; i < 40 && (await read()).length !== want; i++) await page.waitForTimeout(250);
  await page.waitForTimeout(500);   // settled: nothing more arrives
  return read();
}
function healthy(w) {
  expect(!w.errors.length, 'uncaught page error — ' + w.errors[0]);
  expect(!w.fivexx.length, 'API returned ' + [...new Set(w.fivexx)].join(', '));
}

const scenarios = [
  { id: 'TH04', title: 'Teacher app v2, new Home look: on a card day the band, the lesson card, the progress strip and the features come in order', run: (page, ctx) =>
    withLook(ctx, { card: true, look: true }, async () => {
      await homeAnswer(page, LESSON_DAY);
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await openHome(page, ctx);
      const head = await greetingOf(page);
      expect(head.greeting === 'Salaam, ' + NAME + '!', 'the band greets "' + head.greeting + '"');
      expect(head.date && head.school, 'the band has no date (' + head.date + ') or no school (' + head.school + ')');
      const ys0 = await Promise.all(['home-greeting-name', 'home-date', 'home-school'].map((id) => topOf(page, id)));
      expect(ys0[0] < ys0[1] && ys0[1] < ys0[2], 'not greeting, then date, then school: ' + JSON.stringify(ys0));
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
      const plan = card.getByRole('button', { name: /Open the plan/ });
      expect((await plan.count()) === 1, 'no "Open the plan" on the card');
      const [pb, sb] = [await card.locator('[data-primary]').boundingBox(), await plan.boundingBox()];
      expect(pb && sb && Math.abs((pb.y + pb.height / 2) - (sb.y + sb.height / 2)) < 12, '"Open the plan" is not beside "Quiz this"');
      const progress = await textOf(page, 'home-look-progress', '"Your progress" label');
      expect(progress === 'Your progress', 'the strip label reads "' + progress + '"');
      const chip = await textOf(page, 'home-score-chip_coach', 'coach chip');
      expect(/Coach 29\/38/.test(chip), 'the coach chip reads "' + chip + '"');
      const grid = await gridOf(page);
      expect(grid.n === 8 && grid.cols === 3, 'expected 8 tiles three per row, saw ' + JSON.stringify(grid));
      const body = await page.locator('body').innerText();
      expect(!/All features|What would you like to do today\?/i.test(body), 'an "All features" label or the question line is drawn');
      const ys = await Promise.all(['home-band', 'home-look-card', 'home-scores', 'feature-tiles'].map((id) => topOf(page, id)));
      expect(ys.every((y, i) => i === 0 || y > ys[i - 1]), 'not in order band, card, strip, tiles: ' + JSON.stringify(ys));
      healthy(w);
      return { ...head, pill, topic, chip, grid };
    }) },
  { id: 'TH05', title: 'Teacher app v2, new Home look: on a no-card day the two score chips come straight after the band, then the features', run: (page, ctx) =>
    withLook(ctx, { card: true, look: true }, async () => {
      await homeAnswer(page, NO_CARD_DAY);
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await openHome(page, ctx);
      await tid(page, 'home-band').waitFor({ state: 'visible', timeout: 20000 });
      const coach = await textOf(page, 'home-score-chip_coach', 'coach chip');
      const obs = await textOf(page, 'home-score-chip_obs', 'observation chip');
      expect(/29\/38/.test(coach) && /31\/40/.test(obs), 'the chips read "' + coach + '" and "' + obs + '"');
      expect((await count(page, 'home-look-card')) === 0, 'a card is drawn on a no-card day');
      expect((await count(page, 'home-look-progress')) === 0, '"Your progress" is drawn beside two chips');
      const grid = await gridOf(page);
      expect(grid.n === 8, 'expected 8 feature tiles, saw ' + grid.n);
      const body = await page.locator('body').innerText();
      expect(!/What would you like to do today\?|All features/i.test(body), 'a question line or "All features" is drawn');
      const ys = await Promise.all(['home-band', 'home-scores', 'feature-tiles'].map((id) => topOf(page, id)));
      expect(ys.every((y, i) => i === 0 || y > ys[i - 1]), 'not in order band, strip, tiles: ' + JSON.stringify(ys));
      healthy(w);
      return { coach, obs, grid };
    }) },
  { id: 'TH06', title: 'Teacher app v2, new Home look: the language pill switches the Home to Urdu and the "!" stays inside the name', run: (page, ctx) =>
    withLook(ctx, { card: true, look: true }, async (id) => {
      await homeAnswer(page, NO_CARD_DAY);
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await openHome(page, ctx);
      const dateEn = await textOf(page, 'home-date', 'date line');
      await tid(page, 'home-look-lang').click();
      let head = { greeting: '' };
      for (let i = 0; i < 40 && !/^السلام علیکم/.test(head.greeting); i++) {
        head = await greetingOf(page);
        if (!/^السلام علیکم/.test(head.greeting)) await page.waitForTimeout(250);
      }
      expect(/^السلام علیکم/.test(head.greeting), 'the band did not switch to Urdu: "' + head.greeting + '"');
      const name = (await tid(page, 'home-greeting-name').innerText()).trim();
      expect(name === NAME + '!', 'the name\'s isolate reads "' + name + '" (the "!" must be inside it, after the name)');
      const pill = await textOf(page, 'home-look-lang', 'language pill');
      expect(pill === 'English', 'the pill reads "' + pill + '" on the Urdu Home');
      expect(/[؀-ۿ]/.test(head.date) && head.date !== dateEn, 'the date is not in Urdu: "' + head.date + '"');
      const saved = await ctx.sql('select preferred_language from users where id = ' + q(id));
      expect(saved === 'ur', 'the teacher\'s saved language is ' + saved + ', not ur');
      await tid(page, 'home-look-lang').click();
      await page.getByTestId('home-band').locator('h1').filter({ hasText: /^Salaam, / }).waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => { throw new Error('the "English" pill did not bring the Home back to English'); });
      healthy(w);
      return { greeting: head.greeting, name, pill, date: head.date, saved };
    }) },
  // @obsolete (bd-j7czk9.1): 810b3bae2 removed the one-row band; the lane reports it BLOCKED (TH10 covers 320 px now).
  { id: 'TH07', title: 'Teacher app v2, new Home look: on a 320 px phone the band is one row and drops the date line', run: async () => ({
    blocked: 'obsolete: 810b3bae2 (30 Oct 2026) replaced the look\'s own band with the kit\'s HomeGreeting at every width — no one-row band, no dropped date line; @TH07 is @obsolete in the spec, @TH10 covers the 320 px phone',
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
  { id: 'TH09', title: 'Teacher app v2: with the Quizzes tile on, Quizzes is the 2nd tile, right after Lesson plans, and opens my quiz home', run: async (page, ctx) => {
    const seen = {};
    // Today's Home (look off), on a 360 px phone; the answer is the server's own, so its quizTile rule is under test.
    await page.setViewportSize({ width: 360, height: 800 });
    await withLook(ctx, { card: true, look: false, quizTile: true, quizHome: true }, async () => {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      // The bot caches quiz_teacher_home 30 s on its own clock (not the lane's 1 s): wait until /me/home has a quiz home.
      let home = null;
      for (const end = Date.now() + 45000; Date.now() < end;) {
        home = await (await page.request.get(ctx.baseUrl + '/api/portal/me/home')).json().catch(() => null);
        if (home && home.quizTile === true) break;
        await page.waitForTimeout(2000);
      }
      expect(home && home.quizTile === true, 'GET /me/home never answered quizTile:true (quizHome ' + JSON.stringify(home && home.quizHome) + ')');
      const w = await openHome(page, ctx);
      const cells = await cellsOf(page, 9);
      seen.on = cells;
      expect(cells.length === 9, 'expected 9 tiles with the Quizzes tile on, saw ' + cells.length + ' (the server gave no quiz home?)');
      expect(/lessons$/.test(cells[0].href || '') && cells[1].quiz, 'Quizzes is not 2nd, right after Lesson plans: ' + JSON.stringify(cells.slice(0, 3)));
      expect(/^Quizzes$/i.test(cells[1].text), 'the 2nd tile reads "' + cells[1].text + '"');
      expect(cells[8].wide && cells.slice(0, 8).every((c) => !c.wide), 'only the 9th tile should span both columns: ' + JSON.stringify(cells.map((c) => c.wide)));
      await tid(page, 'tile-quiz').click();
      await page.waitForURL(/\/quiz\/teacher\/[^/?#]+/, { timeout: 15000 })
        .catch(() => { throw new Error('Quizzes went to ' + new URL(page.url()).pathname + ', not /quiz/teacher/<token>'); });
      seen.went = new URL(page.url()).pathname.replace(/\/quiz\/teacher\/.+/, '/quiz/teacher/<token>');
      healthy(w);
    });
    const fresh = await page.context().browser().newContext({ viewport: { width: 360, height: 800 } });
    try {
      const p2 = await fresh.newPage();
      await withLook(ctx, { card: true, look: false, quizTile: false }, async () => {
        await asRole(p2, ctx, 'teacher', 'teacherV2');
        const w = await openHome(p2, ctx);
        const cells = await cellsOf(p2, 8);
        seen.off = cells.length;
        expect(cells.length === 8 && !cells.some((c) => c.quiz), 'with the Quizzes tile off: ' + JSON.stringify(cells.map((c) => c.href || 'quiz')));
        expect(!cells.some((c) => c.wide), 'a tile spans both columns with eight tiles');
        healthy(w);
      });
    } finally {
      await fresh.close();
    }
    return seen;
  } },
  { id: 'TH10', title: 'Teacher app v2, new Home look: on a 320 px phone the whole header and the lesson card fit without sideways scroll', run: (page, ctx) =>
    withLook(ctx, { card: true, look: true }, async () => {
      await homeAnswer(page, LESSON_DAY);
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const w = await openHome(page, ctx, 320);
      const head = await greetingOf(page);
      expect(head.greeting === 'Salaam, ' + NAME + '!', 'the band greets "' + head.greeting + '"');
      expect(head.date && head.school, 'the band dropped the date (' + head.date + ') or the school (' + head.school + ') at 320 px');
      expect((await count(page, 'home-look-lang')) === 1, 'no language pill at 320 px');
      expect((await count(page, 'home-look-card')) === 1, 'no card at 320 px');
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollW <= 320, 'the Home scrolls sideways at 320 px (' + scrollW + ' px wide)');
      healthy(w);
      return { ...head, scrollWidth: scrollW };
    }) },
];

module.exports = scenarios;
