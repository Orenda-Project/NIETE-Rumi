/**
 * The end screen's words (app_settings web_quiz_end_copy_fix → the bot's `end_copy: true` beside the card's field;
 * default OFF).
 *  - PR-1: a replay's end screen drops "Your score is your first try." (its practice line already says which score
 *    counts). A first play keeps it.
 *  - DUP-2: under a replay's own compare box ("Same as your first try! You 3/7 · Your first try 3/7") the practice
 *    line no longer repeats the first score.
 *  - WV-1: "Watch another video" only after a video; a quiz with no video (a teacher's quiz from the Games) offers
 *    "More games", which opens the home on its Games door.
 *  - UD-2: on an Urdu end headline each number is isolated in the digit face (<bdi class="wq-dg">), never Nastaliq.
 *  - UD-3: the school league's sector chip by its catalog name (the board's `sector_name`), and a move of one place in
 *    its one form («کل سے ایک درجہ نیچے»).
 *  - SH-1: the class table and league sheets keep their words 16 px in from both sides of the box.
 *  - CF-2: an end with no star earned gets no confetti (the card and the fanfare stay).
 * Off (absent or anything but JSON true): every screen is today's, byte for byte.
 */
const fs = require('fs');
const path = require('path');
const { page, flush } = require('./wq-page-harness');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const FC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
const ON = { end_copy: true };
const OFFS = [[{}], [{ end_copy: false }], [{ end_copy: 'true' }], [{ end_copy: 1 }]];
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const norm = (h) => h.replace(/(<div class="wq-say">)[\s\S]*?<\/div>/, '$1*</div>');

// ─── PR-1: the replay's end screen ──────────────────────────────────────────

const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result } });
const RES = (counted, extra = {}) => ({ score: { correct: 7, total: 7 }, card: {}, ...(counted === false ? { counted: false } : {}), ...extra });
async function end(lang, bootExtra, counted, { htmlClass = [], extra = {}, video = null } = {}) {
  const res = RES(counted, extra);
  const p = page({ lang, store: store(res), bootExtra, api: { '/finish': res }, htmlClass, video });
  p.wq.results(0);
  for (let k = 0; k < 6; k += 1) await flush();
  expect(p.moment()).toBe('M9');
  return { p, h: norm(p.html()) };
}
const ROUND = { card_v3: true, reason: 'already_finished', card: { kept: { correct: 3, total: 7 } } };

describe('PR-1 on: a replay drops "Your score is your first try."', () => {
  test.each([
    ['en', {}, 'Your score is your first try.'],
    ['ur', {}, 'اسکور پہلی کوشش کا ہے۔'],
    ['ur', { end_fit: true, end_short: true }, 'اسکور پہلی کوشش کا ہے۔'],
  ])('%s %j: gone on a replay, the practice line kept', async (lang, extra, line) => {
    for (const x of [{}, ROUND]) {
      const off = await end(lang, extra, false, { extra: x });
      const on = await end(lang, { ...extra, ...ON }, false, { extra: x });
      expect(off.h).toContain(line);
      expect(on.h).not.toContain(line);
      expect(on.h).toContain('<div class="wq-banner');
    }
  });
  test('a first play keeps it', async () => {
    expect((await end('en', ON, true)).h).toContain('Your score is your first try.');
    expect((await end('ur', ON, true)).h).toContain('اسکور پہلی کوشش کا ہے۔');
  });
});

// ─── WV-1: "Watch another video" only after a video ─────────────────────────

const VIDEO = { url: 'https://r2.example/v.mp4', title: 'Plants' };
const HOME = { nav: { home: true } };
describe('WV-1 on: a quiz with no video offers the Games, not another video', () => {
  test.each(['en', 'ur'])('%s: the results screen', async (lang) => {
    const { p, h } = await end(lang, { ...ON, ...HOME }, true);
    expect(h).not.toContain(lang === 'en' ? 'Watch another video' : 'ایک اور ویڈیو دیکھیں');
    expect(h).toContain('id="wq-more" data-to="games"');
    expect(h).toContain(lang === 'en' ? 'More games' : 'مزید کھیل');
    p.els['#wq-more'].fire('click');
    expect(p.fetches.some((f) => f.url.indexOf('videos/') >= 0)).toBe(false);
  });
  test('the tap opens the home on its Games door', async () => {
    const q = page({ lang: 'en', store: store(RES(true)), bootExtra: { ...ON, ...HOME }, api: { '/finish': RES(true), hubdoor: { href: '/h/tok.abc' } } });
    q.wq.results(0);
    for (let k = 0; k < 6; k += 1) await flush();
    q.els['#wq-more'].fire('click');
    for (let k = 0; k < 4; k += 1) await flush();
    expect(q.hist.assigned).toEqual(['/h/tok.abc?from=home#games']);
  });
  test('the scorecard and "today" too; "today" asks no video list and Jugnu says a game', async () => {
    const card = page({ lang: 'en', store: store({ card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, score: { correct: 3, total: 5 } }), bootExtra: { ...ON, ...HOME } });
    expect(card.html()).not.toContain('Watch another video');
    expect(card.html()).toContain('More games');
    const t = page({ lang: 'ur', store: store(RES(true)), bootExtra: { ...ON, ...HOME } });
    t.wq.today();
    expect(t.html()).toContain('مزید کھیل');
    expect(t.html()).toContain('ایک اور کھیل کھیلیں؟');
    expect(t.html()).not.toContain('ایک اور ویڈیو دیکھیں');
    expect(t.fetches.some((f) => f.url.indexOf('/videos/') >= 0)).toBe(false);
  });
  test('no home here (a friend\'s run, no session): no button at all', async () => {
    const { h } = await end('en', ON, true);
    expect(h).not.toContain('id="wq-more"');
  });
  test('a video quiz keeps "Watch another video"', async () => {
    const { h } = await end('en', { ...ON, ...HOME }, true, { video: VIDEO });
    expect(h).toContain('Watch another video');
    expect(h).not.toContain('More games');
  });
});

// ─── DUP-2: the replay's compare box and its practice line ──────────────────

const replay = (card, vs) => ({ wq_s_TEST: { st: 'st1', child: CHILD, answers: {}, queue: [],
  result: { card: { first: 'Zara', animal: 'owl', correct: 3, total: 7, practice: true, kept: { correct: 3, total: 7 }, ...card }, challenge_code: 'CH12AB', vs } } });
const VS = { first: 'Testwala', correct: 4, total: 7, outcome: 'lose' };
describe('DUP-2 on: under the compare box the practice line drops its score', () => {
  test.each([
    ['en', 'Practice round · your first try counts', 'Practice round · your first score 3/7'],
    ['ur', 'مشق کا راؤنڈ · صرف پہلی بار کا اسکور گنا جاتا ہے', 'پہلی بار کا اسکور ۳/۷'],
  ])('%s', (lang, short, long) => {
    const on = page({ lang, store: replay({}, VS), bootExtra: { share_page_lang: true, ...ON } });
    on.wq.card();
    expect(on.html()).toContain('<div class="wq-banner wq-vs">');
    expect(on.html()).toContain(`<div class="wq-banner">${short}</div>`);
    expect(on.html()).not.toContain(long);
    // no compare box (not a friend's challenge): the line keeps its score
    const solo = page({ lang, store: replay({}, undefined), bootExtra: { share_page_lang: true, ...ON } });
    solo.wq.card();
    expect(solo.html()).toContain(long);
  });
  test('with the Urdu share words on, the line ends with «۔» as the long one does', () => {
    const on = page({ lang: 'ur', store: replay({}, VS), bootExtra: { share_page_lang: true, share_bidi: true, ...ON } });
    on.wq.card();
    expect(on.html()).toContain('<div class="wq-banner">مشق کا راؤنڈ · صرف پہلی بار کا اسکور گنا جاتا ہے۔</div>');
  });
});

// ─── UD-2: the Urdu end headline's numbers ──────────────────────────────────

describe('UD-2 on: the Urdu end headline\'s numbers in the digit face, isolated', () => {
  test.each([[{}], [{ end_fit: true }], [{ end_fit: true, end_short: true }]])('%j', async (extra) => {
    const res = { score: { correct: 1, total: 7 }, card: {} };
    const p = page({ lang: 'ur', store: store(res), bootExtra: { ...extra, ...ON }, api: { '/finish': res } });
    p.wq.results(0);
    for (let k = 0; k < 6; k += 1) await flush();
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(p.html())[1];
    expect(h1).toContain('<bdi class="wq-dg">۷</bdi>');
    expect(h1).toContain('<bdi class="wq-dg">۱</bdi>');
    expect(h1.replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ')).toBe('آپ نے ۷ میں سے ۱ درست کیا');
  });
  test('English keeps today\'s headline', async () => {
    const res = { score: { correct: 1, total: 7 }, card: {} };
    const p = page({ lang: 'en', store: store(res), bootExtra: ON, api: { '/finish': res } });
    p.wq.results(0);
    for (let k = 0; k < 6; k += 1) await flush();
    expect(p.html()).toContain('<h1>You got 1 out of 7</h1>');
  });
  test('the stylesheet: the digit face (Urdu digits only) on wq-dg', () => {
    expect(CSS).toMatch(/@font-face\{font-family:"WQ Digits";src:url\(fonts\/wq-urdigits-1\.woff2\)[^}]*unicode-range:U\+06F0-06F9\}/);
    expect(CSS).toContain('html[lang=ur] .wq-dg{font-family:"WQ Digits",var(--f)');
    expect(fs.existsSync(path.join(__dirname, '..', 'public', 'wq', 'fonts', 'wq-urdigits-1.woff2'))).toBe(true);
  });
});

// ─── UD-3: the school league page ───────────────────────────────────────────

const SCH = (mine, extra = {}) => ({ week_start: '2026-10-19', rows: [{ place: 1, name: 'School Alpha', sector: 'ict', points: 90, kids: 4, move: -1, mine: true }],
  mine: { place: 1, name: 'School Alpha', sector: 'ict', points: 90, kids: 4, move: -1, ...mine }, ranked_n: 1, zero_n: 0, ...extra });
async function league(lang, body, bootExtra = {}) {
  const p = page({ lang, store: store({ card: { first: 'Zara', correct: 3, total: 5 }, score: { correct: 3, total: 5 } }), board: { finishers_n: 0, rows: [] }, api: { '/schools/TEST': body }, bootExtra });
  p.wq.board(); await flush();
  p.els['#wq-schools'].fire('click');
  await flush();
  return p.html();
}
const NAMES = { sector_name: { en: 'ICT', ur: 'آئی سی ٹی' } };
describe('UD-3 on: the sector chip by its catalog name, one place in its one form', () => {
  test('Urdu', async () => {
    const h = await league('ur', SCH(NAMES, { end_copy: true }));
    expect(h).toContain('<bdi>آئی سی ٹی</bdi>');
    expect(h).toContain('کل سے ایک درجہ نیچے');
    expect(h).not.toContain('درجے نیچے');
    const up = await league('ur', SCH({ ...NAMES, move: 1 }, { end_copy: true }));
    expect(up).toContain('کل سے ایک درجہ اوپر');
    // two places keep today's words
    const two = await league('ur', SCH({ ...NAMES, move: -2 }, { end_copy: true }));
    expect(two).toContain('کل سے ۲ درجے نیچے');
  });
  test('English: the catalog name, today\'s move line', async () => {
    const h = await league('en', SCH(NAMES, { end_copy: true }));
    expect(h).toContain('<bdi>ICT</bdi>');
    expect(h).toContain('▼1 since yesterday');
  });
  test('off (the board names nothing): today\'s chip and line', async () => {
    const h = await league('ur', SCH({}));
    expect(h).toContain('<bdi>ict</bdi>');
    expect(h).toContain('کل سے ۱ درجے نیچے');
  });
});

// ─── SH-1: the class table sheet's words in from both sides ─────────────────

describe('SH-1 on: the class table and league sheets pad their words', () => {
  async function tableShare(bootExtra) {
    const p = page({ lang: 'ur', topic: 'Proper Fraction', board: { finishers_n: 1, class_avg_pct: 17, rows: [], more_n: 0 }, store: store({ card: { first: 'Zara', correct: 1, total: 6 }, score: { correct: 1, total: 6 } }), bootExtra: { share_v4: true, ...bootExtra } });
    p.ctx.document.head = { appendChild() {} };
    p.wq.board();
    await flush(); await flush(); await flush();
    const calls = [];
    p.ctx.WQFC = { shareArt: (o) => calls.push(o) };
    p.els['#wq-share-t'].fire('click');
    return calls;
  }
  test('the page asks for it with the switch on, never off', async () => {
    expect((await tableShare(ON))[0].pad).toBe(true);
    for (const [off] of OFFS) expect('pad' in (await tableShare(off))[0]).toBe(false);
  });
  test('the sheet: a padded box only when asked (16 px inline)', () => {
    expect(FC).toContain(".wqfc-sh-msg.wqfc-sh-pad{padding-inline:16px}");
    expect(FC).toMatch(/msgHtml\(o\.text, o\.url, o\.iso, o\.one === true && l === 'ur', o\.bidi === true && l === 'ur', o\.pad === true\)/);
    expect(FC).toMatch(/bidi: o\.bidi === true, pad: o\.pad === true \}\);/);
  });
});

// ─── CF-2: confetti only with a star ────────────────────────────────────────

describe('CF-2 on: no confetti at 0 stars', () => {
  async function juiced(bootExtra, correct) {
    const res = { score: { correct, total: 8 }, card: {} };
    const p = page({ lang: 'en', store: store(res), bootExtra, api: { '/finish': res } });
    const calls = [];
    p.ctx.WQJ = { finish: (o) => calls.push(o), skin() {}, toggle() {}, muted: () => true, stopAll() {} };
    p.wq.results(0);
    for (let k = 0; k < 6; k += 1) await flush();
    return calls;
  }
  test('0 of 8: the finish runs without confetti; 1 of 8 keeps it', async () => {
    expect((await juiced(ON, 0))[0].nc).toBe(true);
    expect('nc' in (await juiced(ON, 1))[0]).toBe(false);
  });
  test.each(OFFS)('off %j: today\'s finish at 0 of 8', async (off) => {
    expect('nc' in (await juiced(off, 0))[0]).toBe(false);
  });
  test('the kit: nc skips only the confetti', () => {
    const J = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-juice.js'), 'utf8');
    expect(J).toContain('if (!o.nc) confetti(24, 1600, o.back === true);');
  });
});

// ─── off: today's screens, byte for byte ────────────────────────────────────

describe('off: every screen is today\'s', () => {
  test.each(OFFS)('boot %j', async (off) => {
    for (const lang of ['en', 'ur']) {
      for (const counted of [true, false]) {
        expect((await end(lang, { ...off, ...HOME }, counted)).h).toBe((await end(lang, HOME, counted)).h);
      }
      const a = page({ lang, store: replay({}, VS), bootExtra: { share_page_lang: true, ...off } }); a.wq.card();
      const b = page({ lang, store: replay({}, VS), bootExtra: { share_page_lang: true } }); b.wq.card();
      expect(a.html()).toBe(b.html());
      const c = page({ lang, store: store(RES(true)), bootExtra: { ...HOME, ...off } }); c.wq.today();
      const d = page({ lang, store: store(RES(true)), bootExtra: HOME }); d.wq.today();
      expect(c.html()).toBe(d.html());
      expect(c.html()).toContain(lang === 'en' ? 'Watch another video' : 'ایک اور ویڈیو دیکھیں');
    }
  });
});
