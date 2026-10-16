/**
 * The Trail page v2's stop intro (public/wq/wq-trail.js with the real Challenge page in the harness's vm):
 *   (A) a read or listen stop whose payload carries `title` {en, ur} names the passage in one line under the bubble
 *       (Urdu child: ur → en → the stop's name; English child: en → the stop's name); no title ⇒ no line. Whether a
 *       listen stop has a title is the server's call (it withholds one that would give an answer away): the page has
 *       no listen branch.
 *   (B) `reopened: true` → "Welcome back! Let's carry on." in place of the intro line, no hear button (English only:
 *       no Urdu line exists yet, an Urdu child sees today's intro).
 *   (C) `teacher_preview: true` → the practice banner is the teacher line (jg.t.practice), never the replay banner.
 * Every intro test runs on a fresh profile: no localStorage, no sessionStorage.
 * Golden: with none of the new fields the intro and banner are the base page's, string-equal (captured from the base
 * code with WRITE_TRAIL_INTRO_GOLDEN=1).
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');
const { ok, CLIPS, STORY } = H;

const TRAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-trail.js'), 'utf8');
const DECK = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'config', 'copy.v2.json'), 'utf8'));
const GOLDEN = path.join(__dirname, 'fixtures', 'trail-intro-v2.golden.json');

const TC = { practice: 'Practice round. Play as much as you like!', stopDone: 'Stop done!', badge: 'Done', next: 'Next', mic: 'uses the microphone' };
const EXS = [
  { id: 'read', name: 'Read aloud', mins: 2, done: false, last: null, badge: false, mic: true },
  { id: 'listen', name: 'Listen', mins: 2, done: false, last: null, badge: false },
  { id: 'bigger', name: 'Which is bigger?', mins: 2, done: false, last: null, badge: false },
];
const V2 = { pool: true, story: false, consent: true };
const MENU = (lang, v2 = V2) => ({ lang, form: 'G3', record: true, trail: true, trail_copy: TC, exercises: EXS, ...(v2 ? { v2 } : {}) });
// an intro clip with a url: its hear button shows (or, for the welcome-back line, must not)
const CL = { ...CLIPS, intro: { text: 'Intro line', url: 'https://r2.test/intro.ogg' } };
const READ = (extra = {}) => ({ ex: 'read', name: 'Read aloud', ct: 'CTR', secs: 60, clips: CL, story: STORY, record: true, trail: true, trail_copy: TC, v2: V2, ...extra });
const LISTEN = (extra = {}) => ({ ex: 'listen', name: 'Listen', ct: 'CTL', clips: CL, read_times: 2, story_clip: { url: 'https://r2.test/story.ogg' }, record: true, trail: true, trail_copy: TC, v2: V2, ...extra });
const BIGGER = (extra = {}) => ({ ex: 'bigger', name: 'Which is bigger?', ct: 'CTB', clips: CL, record: true, trail: true, trail_copy: TC, items: [{ a: 3, b: 5 }], practice: [], per_item_s: 10, stop_after: 4, v2: V2, ...extra });

// a fresh profile (#93b): no storage of any kind; the stop opened, help answered (a scored stop asks first), at the intro
async function introOf(payload, { lang = 'en', v2 = true } = {}) {
  const p = H.page({ lang, menu: MENU(lang, v2 ? V2 : null), freshEls: true, pre: v2 ? [TRAIL_SRC] : [], routes: { [`ch/HUB.TOKEN/${payload.ex}`]: ok(payload) } });
  p.w.open(payload.ex);
  await p.flush();
  if (p.screen() === 'help-ask') await p.click('wqc-help-no');
  expect(p.screen()).toBe('intro');
  return p;
}
const lineOf = (h) => (/<p class="wq-sub" id="wqc-ptitle">([^<]*)<\/p>/.exec(h) || [])[1];

describe('golden: no title, no reopened, no teacher_preview → the intro and the banner are the base page\'s', () => {
  const shots = async () => ({
    readEn: (await introOf(READ())).html(),
    readUr: (await introOf(READ(), { lang: 'ur' })).html(),
    listenEn: (await introOf(LISTEN())).html(),
    practiceEn: (await introOf(BIGGER({ practice_round: true }))).html(),
    practiceUr: (await introOf(BIGGER({ practice_round: true }), { lang: 'ur' })).html(),
    // v2 off (wq-trail.js not loaded): the new fields change nothing on today's page
    v2offTitled: (await introOf(READ({ v2: undefined, title: { en: 'The Pink Kite', ur: null }, reopened: true, teacher_preview: true }), { v2: false })).html(),
  });
  test('string-equal to the capture from the base code', async () => {
    const now = await shots();
    if (process.env.WRITE_TRAIL_INTRO_GOLDEN === '1') fs.writeFileSync(GOLDEN, `${JSON.stringify(now, null, 2)}\n`);
    expect(now).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });
});

describe('(A) the stop\'s intro names the passage', () => {
  test('English child, read stop: the title_en line under the bubble', async () => {
    const h = (await introOf(READ({ title: { en: 'The Pink Kite', ur: 'لال پتنگ' } }))).html();
    expect(h).toContain('<p class="wq-sub" id="wqc-ptitle">The Pink Kite</p>');
    expect(h).toContain('Intro line');
  });
  test('a listen payload WITHOUT a title → the generic: today\'s intro exactly, English and Urdu', async () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    const en = (await introOf(LISTEN())).html();
    expect(en).not.toContain('wqc-ptitle');
    expect(en).toBe(golden.listenEn);
    const ur = (await introOf(LISTEN({ title: null }), { lang: 'ur' })).html();
    expect(ur).not.toContain('wqc-ptitle');
    expect(ur).toContain('<div class="wq-say" id="wqc-say">Intro line</div>');
  });
  test('a listen payload WITH a title → the same one line as a read stop (no listen branch on the page)', async () => {
    expect(lineOf((await introOf(LISTEN({ title: { en: 'The Lost Dog', ur: null } }))).html())).toBe('The Lost Dog');
    expect(lineOf((await introOf(LISTEN({ title: { en: 'The Lost Dog', ur: 'سفید مرغی' } }), { lang: 'ur' })).html())).toBe('سفید مرغی');
    expect(lineOf((await introOf(LISTEN({ title: { en: null, ur: null } }), { lang: 'ur' })).html())).toBe('Listen');
  });
  test('Urdu child: ur, else en, else the stop\'s name', async () => {
    expect(lineOf((await introOf(READ({ title: { en: 'The Pink Kite', ur: 'لال پتنگ' } }), { lang: 'ur' })).html())).toBe('لال پتنگ');
    expect(lineOf((await introOf(READ({ title: { en: 'The Pink Kite', ur: null } }), { lang: 'ur' })).html())).toBe('The Pink Kite');
    expect(lineOf((await introOf(READ({ title: { en: null, ur: null } }), { lang: 'ur' })).html())).toBe('Read aloud');
  });
  test('one side absent as a key (the live serve: EN {en} only, UR {ur} only): each child sees its own', async () => {
    expect(lineOf((await introOf(READ({ title: { en: 'The Pink Kite' } }))).html())).toBe('The Pink Kite');
    expect(lineOf((await introOf(READ({ title: { ur: 'لال پتنگ' } }), { lang: 'ur' })).html())).toBe('لال پتنگ');
    expect(lineOf((await introOf(READ({ title: { en: 'The Pink Kite' } }), { lang: 'ur' })).html())).toBe('The Pink Kite');
    const h = (await introOf(READ({ title: { ur: 'لال پتنگ' } }))).html();
    expect(lineOf(h)).toBe('Read aloud');
    expect(h).not.toMatch(/null|undefined/);
  });
  test('English child with only an Urdu title: the stop\'s name, never the Urdu, never "null"', async () => {
    const h = (await introOf(READ({ title: { en: null, ur: 'لال پتنگ' } }))).html();
    expect(lineOf(h)).toBe('Read aloud');
    expect(h).not.toMatch(/null|undefined|لال پتنگ/);
  });
  test('a title object with nothing to say and no stop name: no line (never empty, never "undefined")', async () => {
    const h = (await introOf(READ({ name: undefined, title: { en: '', ur: null } }))).html();
    expect(h).not.toContain('wqc-ptitle');
    expect(h).not.toMatch(/null|undefined/);
  });
  test('escaped', async () => {
    const p = await introOf(READ({ title: { en: '<b>Kite</b> & "Co"', ur: null } }));
    expect(p.root.innerHTML).toContain('id="wqc-ptitle">&lt;b&gt;Kite&lt;/b&gt; &amp; &quot;Co&quot;</p>');
  });
  test('a tap game never carries the line, even with a title', async () => {
    expect((await introOf(BIGGER({ title: { en: 'X', ur: 'X' } }))).html()).not.toContain('wqc-ptitle');
  });
});

describe('(B) a re-served record (reopened: true): "Welcome back"', () => {
  const T = () => { const vm = require('vm'); const ctx = { window: {}, document: {} }; vm.createContext(ctx); vm.runInContext(TRAIL_SRC, ctx); return ctx.window.WQTRAIL.T; };
  test('English: the welcome-back line in place of the intro line, no hear button for it', async () => {
    const p = await introOf(READ({ reopened: true }));
    const h = p.html();
    expect(h).toContain('<div class="wq-say" id="wqc-say">Welcome back! Let\'s carry on.</div>');
    expect(h).not.toContain('Intro line');
    expect(h).not.toContain('id="wqc-hear"');
    expect(p.played).not.toContain('https://r2.test/intro.ogg');
    expect(h).not.toMatch(/you left/i);
    expect(h).toContain('id="wqc-go"');
  });
  test('Urdu: no Urdu line exists yet → today\'s intro unchanged (its line and its hear button)', async () => {
    const h = (await introOf(READ({ reopened: true }), { lang: 'ur' })).html();
    expect(h).toContain('<div class="wq-say" id="wqc-say">Intro line</div>');
    expect(h).toContain('id="wqc-hear"');
    expect(T().ur).not.toHaveProperty('welcomeBack');
    expect(T().en.welcomeBack).toBe('Welcome back! Let\'s carry on.');
  });
});

describe('(C) a teacher-preview run → the teacher line', () => {
  test('English: the practice banner is jg.t.practice\'s bytes, never the replay banner', async () => {
    const h = (await introOf(BIGGER({ practice_round: true, teacher_preview: true }))).root.innerHTML;
    expect(h).toContain(`<p class="wqc-banner" id="wqc-practice">${DECK['jg.t.practice'].en.replace(/'/g, '&#39;')}</p>`);
    expect(h).not.toContain('Playing again: just for fun');
  });
  test('Urdu: the deck\'s Urdu bytes', async () => {
    const h = (await introOf(BIGGER({ practice_round: true, teacher_preview: true }), { lang: 'ur' })).html();
    expect(h).toContain(`<p class="wqc-banner" id="wqc-practice">${DECK['jg.t.practice'].ur}</p>`);
    expect(h).not.toContain('یہ کھیل دوبارہ: بس مزے کے لیے');
  });
  test('the page\'s table holds the deck\'s bytes exactly', () => {
    const vm = require('vm'); const ctx = { window: {}, document: {} }; vm.createContext(ctx); vm.runInContext(TRAIL_SRC, ctx);
    expect(ctx.window.WQTRAIL.T.en.teacherPractice).toBe(DECK['jg.t.practice'].en);
    expect(ctx.window.WQTRAIL.T.ur.teacherPractice).toBe(DECK['jg.t.practice'].ur);
  });
  test('a child\'s replay (no teacher_preview) keeps the replay banner', async () => {
    expect((await introOf(BIGGER({ practice_round: true }))).html()).toContain('Playing again: just for fun');
  });
});
