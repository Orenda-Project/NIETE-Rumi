/**
 * The reading moment (app_settings web_quiz_read_feedback → the menu's `read_feedback: true`; wq-moment.js): a child who
 * reads aloud is answered at once — the words read, a jar of Jugnu's lights for the speed with the number beside it,
 * stars for reading the words right, a line against the child's own last read only, an effort badge — on the Jugnu
 * page's Read aloud (the live read and its checked result), the passage after Jugnu's read-along (the same end), and
 * Story Time's end. A 0-word read gets the kind card. With the key absent every screen is byte-identical to today
 * (the goldens below were recorded on the code before this change).
 * The pages run whole in a vm (wqc-page-harness.js) or wq-trail.js with a small host; only the browser is faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./wqc-page-harness');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const R = (f) => fs.readFileSync(path.join(WQ, f), 'utf8');
const LIVE_SRC = R('wq-read-live.js');
const LR_SRC = R('wq-liveread.js');
const TRAIL_SRC = R('wq-trail.js');
const FC_SRC = R('wq-finish-card.js');
const MOMENT_FILE = path.join(WQ, 'wq-moment.js');
const MOMENT_SRC = fs.existsSync(MOMENT_FILE) ? fs.readFileSync(MOMENT_FILE, 'utf8') : '';
const GOLDEN_FILE = path.join(__dirname, 'fixtures', 'read-feedback-off-golden.json');
const WRITE = process.env.RF_GOLDEN_WRITE === '1';
const BANNED = /\b(test|exam|assessment|slower|slow)\b|امتحان|ٹیسٹ/i;
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&(#39|amp|lt|gt|quot);/g, ' ');

// ---- the module on its own ---------------------------------------------------------------------------------------
function moment() {
  const win = {};
  const ctx = vm.createContext({ window: win, document: { createElement: () => ({}) } });
  vm.runInContext(MOMENT_SRC, ctx);
  return win.WQMoment;
}

describe('WQMoment, pure', () => {
  test('a checked read: words, speed, accuracy and the last read come through; the number is honest to show', () => {
    const M = moment();
    const fb = M.feedback({ score: { correct: 50, attempted: 54 }, wcpm: 50, previous: { wcpm: 44 } });
    expect(fb).toMatchObject({ words: 50, wcpm: 50, prev: 44, zero: false, showNum: true });
    expect(fb.acc).toBeCloseTo(50 / 54, 5);
    expect(M.level(fb, 'G3')).toEqual({ lights: 4, stars: 3, growth: 'up', badge: 'faster' });
    // the bands follow the grade: the same read is more lights in grade 1, fewer in grade 5
    expect(M.level(fb, 1).lights).toBe(5);
    expect(M.level(fb, 5).lights).toBe(3);
  });
  test('stars are words read right: 3 from 90 %, 2 from 70 %, 1 below', () => {
    const M = moment();
    const st = (c, a) => M.level(M.feedback({ score: { correct: c, attempted: a }, wcpm: 40 }), 3).stars;
    expect([st(9, 10), st(7, 10), st(6, 10), st(1, 10)]).toEqual([3, 2, 1, 1]);
  });
  test('growth only against the child\'s own last read; slower says nothing about speed (never "slower")', () => {
    const M = moment();
    const g = (w, p) => M.level(M.feedback({ score: { correct: 30, attempted: 30 }, wcpm: w, previous: p == null ? null : { wcpm: p } }), 3).growth;
    expect([g(42, 40), g(41, 40), g(40, 40), g(39, 40), g(30, 40), g(40, null)]).toEqual(['up', 'same', 'same', 'same', null, null]);
    const h = M.html(M.feedback({ score: { correct: 30, attempted: 30 }, wcpm: 30, previous: { wcpm: 40 } }), 'en', { grade: 3 });
    expect(h).not.toContain('last time');
    expect(text(h)).not.toMatch(BANNED);
  });
  test('a short read (a story page: under 15 words or 6 s): the picture, never the number', () => {
    const M = moment();
    const fb = M.feedback({ words_read: 5, words_total: 5, ms: 3000 });
    expect(fb).toMatchObject({ words: 5, zero: false, showNum: false });
    const h = M.html(fb, 'en', { grade: 1, size: 's' });
    expect(h).toContain('You read 5 words!');
    expect(h).not.toContain('a minute');
    expect(h).toContain('wq-moment--s');
    // a long page read: the number, from its own words and time
    const long = M.feedback({ words_read: 30, words_total: 32, ms: 40000 });
    expect(long).toMatchObject({ wcpm: 45, showNum: true });
    expect(M.html(long, 'en', { grade: 3 })).toContain('45 words a minute');
  });
  test.each(['en', 'ur'])('%s: a 0-word read is the kind card — no lights, no stars, a "brave try" badge', (lang) => {
    const M = moment();
    const fb = M.feedback({ score: { correct: 0, attempted: 0 } });
    expect(fb.zero).toBe(true);
    expect(M.level(fb, 3)).toEqual({ lights: 0, stars: 0, growth: null, badge: 'try' });
    const h = M.html(fb, lang, { grade: 3 });
    expect(h.replace(/&#39;/g, "'")).toContain(lang === 'ur' ? 'آئیں مل کر پڑھیں!' : "Let's read it together!");
    expect(h).toContain(lang === 'ur' ? 'زبردست کوشش' : 'Brave try');
    expect(h).not.toContain('wq-moment-star');
    expect(h).not.toContain('wq-moment-meter');
  });
  test('Urdu: Urdu digits, right to left, no Latin digit in the words; English: left to right', () => {
    const M = moment();
    const fb = M.feedback({ score: { correct: 42, attempted: 45 }, wcpm: 42, previous: { wcpm: 38 } });
    const ur = M.html(fb, 'ur', { grade: 3 });
    expect(ur).toMatch(/^<section class="wq-moment"[^>]* lang="ur" dir="rtl"/);
    expect(ur).toContain('آپ نے ۴۲ لفظ پڑھے!');
    expect(ur).toContain('ایک منٹ میں ۴۲ لفظ');
    expect(ur).toContain('پچھلی بار سے تیز!');
    expect(text(ur).replace(/\s+/g, ' ')).not.toMatch(/[0-9]/);
    const en = M.html(fb, 'en', { grade: 3 });
    expect(en).toMatch(/^<section class="wq-moment"[^>]* lang="en" dir="ltr"/);
    expect(en).toContain('You read 42 words!');
    expect(en).toContain('42 words a minute');
    expect(en).toContain('Faster than last time!');
    for (const h of [ur, en]) {
      expect(text(h)).not.toMatch(BANNED);
      expect(h).not.toMatch(/<button|<a /);   // the host keeps its own buttons
      expect(h).not.toMatch(/[\u{1F300}-\u{1FAFF}⭐]/u);   // drawn, never emoji
    }
  });
});

// ---- the Jugnu page's end cards (wq-trail.js with a small host) --------------------------------------------------
const STORY_HREF = 'https://portal.example/c/tok?room=story&pid=p1';
function trail({ lang = 'en', data = {}, menu = {}, withFc = true, withMoment = true, href = 'https://portal.example/c/tok' } = {}) {
  let screen = '';
  const listeners = {};
  const posts = [];
  const juice = [];
  const tagOf = (id) => new RegExp(`<(a|button|p)\\b[^>]*\\bid="${id}"[^>]*>`).exec(screen);
  const el = (id) => ({
    id,
    get className() { const t = tagOf(id); const m = t && /class="([^"]*)"/.exec(t[0]); return m ? m[1] : ''; },
    set className(v) { const t = tagOf(id); if (t) screen = screen.replace(t[0], t[0].replace(/class="[^"]*"/, `class="${v}"`)); },
    removeAttribute(a) { const t = tagOf(id); if (t) screen = screen.replace(t[0], t[0].replace(new RegExp(` ${a}(="[^"]*")?(?=[ >])`), '')); },
    setAttribute() {},
    get parentNode() {
      return { removeChild() { const t = tagOf(id); if (t) screen = screen.replace(new RegExp(`${t[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?</${t[1]}>`), ''); } };
    },
    addEventListener(n, fn) { (listeners[id] = listeners[id] || []).push(fn); },
  });
  const ctx = {
    location: { origin: 'https://portal.example', hash: '', href, search: href.indexOf('?') >= 0 ? href.slice(href.indexOf('?')) : '' }, navigator: {}, URL,
    sessionStorage: { getItem: () => null, setItem() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch: (url, init) => { posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') }); },
    document: {
      getElementById: (id) => (screen.indexOf(`id="${id}"`) >= 0 ? el(id) : null),
      querySelector: (sel) => (sel === '#wq .wq-stack' && screen.indexOf('<div class="wq-stack">') >= 0
        ? { insertAdjacentHTML: (pos, h) => { screen = screen.replace('<div class="wq-stack">', `${h}<div class="wq-stack">`); } } : null),
      createElement: () => ({ setAttribute() {} }), head: { appendChild() {} },
    },
    WQJ: { finish: (o) => juice.push(`finish:${o.kind}`), badge: () => juice.push('badge'), sentence: () => juice.push('sentence') },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (withFc) vm.runInContext(FC_SRC, ctx);
  if (withMoment && MOMENT_SRC) vm.runInContext(MOMENT_SRC, ctx);
  vm.runInContext(TRAIL_SRC, ctx);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { data: { ct: 'CT1', ex: 'read', story: { tokens: ['a', 'b', 'c', 'd'] }, title: { en: 'The lost kite', ur: 'کھوئی ہوئی پتنگ' }, ...data } };
  const h = {
    L: lang, t: { again: 'Again', later: 'Later', listening: 'Listening' }, tc: (k) => k, boot: { kid: 'k1', token: 'tok' }, S, esc,
    on: (id, fn) => { (listeners[id] = listeners[id] || []).push(fn); }, q: () => null,
    show: (name, html) => { S.screen = name; screen = html; }, jug: (pose, line) => `<p class="wq-say" data-pose="${pose}">${esc(line)}</p>`,
    ev() {}, open() {}, refreshMenu() {}, md: () => menu, read() {}, backLabel: () => 'Back',
    qa: () => ({ open() {} }), qaButtons: () => '<button class="wq-btn wq-go" id="wqc-qa" type="button">Story questions</button><button class="wq-btn wq-soft" id="wqc-menu" type="button">Back</button>',
  };
  const TR = ctx.WQTRAIL.init(h);
  return { TR, html: () => screen, posts, juice };
}
const RF = { read_feedback: true };
const FOLD = { card_v3: true, card_fold: true, v2: {} };
const NEXT = { kind: 'storybook', id: 'b1', href: '/s/b1/1', title: 'Read a storybook', title_ur: 'کہانی کی کتاب پڑھیں', minutes: 2 };
const CHECKED = { score: { correct: 46, attempted: 50 }, wcpm: 48, previous: { wcpm: 40 } };
const primaries = (h) => (h.match(/data-primary/g) || []).length;
const before = (h, a, b) => h.indexOf(a) >= 0 && h.indexOf(b) >= 0 && h.indexOf(a) < h.indexOf(b);

// the end-card scenes, each with the key absent: recorded on the code before this change (byte-identical after)
const SCENES = {
  'read heard': () => { const t = trail({ data: { questions_on: true } }); t.TR.readEnd({ ...CHECKED, rf: CHECKED }, null, 4); return t.html(); },
  'read heard, folded': () => { const t = trail({ menu: FOLD, data: { next_offer: NEXT } }); t.TR.readEnd({ ...CHECKED, rf: CHECKED }, null, 4); return t.html(); },
  'read held': () => { const t = trail(); t.TR.readHold({ score: { attempted: 4 }, rf: { score: { correct: 4, attempted: 4 }, secs: 5 } }, null, 4); return t.html(); },
  'read zero, card': () => { const t = trail({ menu: { card_v3: true, v2: {} } }); t.TR.readEnd({ score: { correct: 0, attempted: 0 }, sticker: false, rf: { score: { correct: 0, attempted: 0 } } }); return t.html(); },
  'read zero, no card': () => { const t = trail(); t.TR.readEnd({ score: { correct: 0, attempted: 0 }, rf: { score: { correct: 0, attempted: 0 } } }); return t.html(); },
  'story room read (ur)': () => { const t = trail({ lang: 'ur', href: STORY_HREF, menu: { v2: { story: true } }, data: { story_room: true, practice_round: true } }); t.TR.menu(); t.TR.readEnd({ ...CHECKED, rf: CHECKED }, null, 4); return t.html(); },
};

describe('the key absent: every end card is byte-identical to today', () => {
  const golden = fs.existsSync(GOLDEN_FILE) ? JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) : {};
  if (WRITE) {
    test('write the goldens (on the code before the change)', () => {
      const out = {};
      Object.keys(SCENES).forEach((k) => { out[k] = SCENES[k](); });
      fs.mkdirSync(path.dirname(GOLDEN_FILE), { recursive: true });
      fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify({ ...golden, trail: out }, null, 1)}\n`);
    });
    return;
  }
  test.each(Object.keys(SCENES))('%s', (k) => {
    expect(SCENES[k]()).toBe(golden.trail[k]);
  });
});

describe('the key on: the moment answers the read on the end card', () => {
  test.each(['en', 'ur'])('%s: a checked read — words, the jar with the number beside it, stars, growth, badge; above the buttons', (lang) => {
    const t = trail({ lang, menu: RF, data: { questions_on: true } });
    t.TR.readEnd({ ...CHECKED, rf: CHECKED }, null, 4);
    const h = t.html();
    expect(h).toContain('data-rf');
    expect(h).toContain(lang === 'ur' ? 'آپ نے ۴۶ لفظ پڑھے!' : 'You read 46 words!');
    expect(h).toContain(lang === 'ur' ? 'ایک منٹ میں ۴۸ لفظ' : '48 words a minute');
    expect(h).toContain(lang === 'ur' ? 'پچھلی بار سے تیز!' : 'Faster than last time!');
    expect(h).toContain('data-stars="3"');
    expect(h).toContain('data-badge="faster"');
    // Jugnu's line first, then the moment, then the buttons (the questions lead)
    expect(before(h, 'wq-say', 'data-rf')).toBe(true);
    expect(before(h, 'data-rf', 'id="wqc-qa"')).toBe(true);
    expect(text(h)).not.toMatch(BANNED);
  });
  test('folded (the child home): the moment above the ONE Next; still one primary', () => {
    const t = trail({ menu: { ...FOLD, ...RF }, data: { next_offer: NEXT } });
    t.TR.readEnd({ ...CHECKED, rf: CHECKED }, null, 4);
    const h = t.html();
    expect(h).toContain('48 words a minute');
    expect(primaries(h)).toBe(1);
    expect(before(h, 'data-rf', 'data-primary')).toBe(true);
  });
  test('the held card (before the check): the words heard and the jar; the settled card replaces it', () => {
    const t = trail({ menu: RF });
    t.TR.readHold({ score: { attempted: 4 }, rf: { score: { correct: 4, attempted: 4 }, secs: 5 } }, null, 4);
    const h = t.html();
    expect(h).toContain('You read 4 words!');
    expect(h).not.toContain('a minute');   // 4 words: too short to give a number
  });
  test.each(['en', 'ur'])('%s: a 0-word read — the kind moment with its badge, no stars, no sticker, Try again stays', (lang) => {
    for (const menu of [{ ...RF, card_v3: true, v2: {} }, RF]) {
      const t = trail({ lang, menu });
      t.TR.readEnd({ score: { correct: 0, attempted: 0 }, sticker: false, rf: { score: { correct: 0, attempted: 0 } } });
      const h = t.html();
      expect(h).toContain('data-badge="try"');
      expect(h).not.toContain('wq-moment-star');
      expect(h).not.toContain('id="wqc-sticker"');
      expect(h).toContain('id="wqc-again"');
    }
  });
  test('Story Time\'s end (the operator\'s screen: "Read this story again any time."): the moment comes with it', () => {
    for (const lang of ['en', 'ur']) {
      const t = trail({ lang, href: STORY_HREF, menu: { v2: { story: true }, ...RF }, data: { story_room: true, practice_round: true } });
      t.TR.menu();
      t.TR.readEnd({ ...CHECKED, rf: CHECKED }, null, 4);
      const h = t.html();
      expect(h).toContain(lang === 'ur' ? 'یہ کہانی جب چاہیں دوبارہ پڑھیں۔' : 'Read this story again any time.');
      expect(h).toContain(lang === 'ur' ? 'ایک منٹ میں ۴۸ لفظ' : '48 words a minute');
      expect(before(h, 'wq-say', 'data-rf')).toBe(true);
    }
  });
  test('Jugnu reacts with sound: the badge jingle with a read, the soft chime with a 0-word read', () => {
    const a = trail({ menu: RF });
    a.TR.readEnd({ ...CHECKED, rf: CHECKED }, null, 4);
    expect(a.juice).toContain('badge');
    const b = trail({ menu: RF });
    b.TR.readEnd({ score: { correct: 0, attempted: 0 }, rf: { score: { correct: 0, attempted: 0 } } });
    expect(b.juice).toContain('sentence');
  });
  test('a class round turn: no moment (the phone goes back to the round)', () => {
    const on = trail({ menu: RF, data: { round_turn: true, round_handback: 'Back to the class' } });
    on.TR.readEnd({ ...CHECKED, rf: CHECKED }, null, 4);
    expect(on.html()).not.toContain('data-rf');
  });
  test('the key on but the moment file missing (a slow load): today\'s card, never a broken one', () => {
    const t = trail({ menu: RF, withMoment: false, data: { questions_on: true } });
    t.TR.readEnd({ ...CHECKED, rf: CHECKED }, null, 4);
    const off = trail({ data: { questions_on: true } });
    off.TR.readEnd({ ...CHECKED, rf: CHECKED }, null, 4);
    expect(t.html()).toBe(off.html());
  });
});

// ---- the whole Jugnu page: a live read, then the checked result reaches the settled card --------------------------
const KEY = { api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt.test/ws', model: 'stt-rt-v5' };
const TC = { stopDone: 'Stop done!', badge: 'Done', next: 'Next', mic: 'uses the microphone' };
const V2 = { pool: true, story: false };
const LR3 = { meter: 'glow', done: true, done_from: 0.8, counted: true, finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet: false } };
const MENU = (lang, extra) => ({ lang, form: 'G3', record: true, trail: true, trail_copy: TC, v2: V2, card_v3: true, lr3: true, exercises: [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null }], ...extra });
const READ = (lang) => ({ ex: 'read', ct: 'CT1', secs: 60, live: true, lang, clips: H.CLIPS, record: true, trail: true, trail_copy: TC, v2: V2, lr3: LR3, story: H.STORY });
class FakeSocket {
  constructor() { this.sent = []; this.bufferedAmount = 0; FakeSocket.all.push(this); }
  send(x) { this.sent.push(x); }
  close() {}
  open() { if (this.onopen) this.onopen({}); }
  msg(m) { if (this.onmessage) this.onmessage({ data: JSON.stringify(m) }); }
}
const toks = (words) => words.map((w, k) => ({ text: (k === 0 ? '' : ' ') + w, start_ms: k * 1000, end_ms: k * 1000 + 800, is_final: true }));
function page(lang, menuExtra, { withMoment = true } = {}) {
  FakeSocket.all = [];
  const server = { now: { status: 200, body: { pending: true } } };
  const pre = [LIVE_SRC, LR_SRC, TRAIL_SRC, FC_SRC].concat(withMoment && MOMENT_SRC ? [MOMENT_SRC] : []);
  const p = H.page({ lang, menu: MENU(lang, menuExtra), freshEls: true, pre, routes: {
    'ch/HUB.TOKEN/read': H.ok(READ(lang)), 'ch/live': H.ok({ ...KEY, lang }),
    'ch/upload': H.ok({ put_url: 'https://r2.test/put/abc', key: 'child-voice/sandbox/r/read-1.webm', content_type: 'audio/webm' }),
    'r2.test/put': () => ({ status: 200, body: {} }), 'ch/result': () => server.now,
  } });
  p.win.WebSocket = FakeSocket;
  p.server = server;
  return p;
}
async function readAndSettle(p, body) {
  p.w.open('read'); await p.flush();
  await p.click('wqc-help-no'); await p.click('wqc-go');
  const s = FakeSocket.all[0]; s.open(); await p.flush();
  s.msg({ tokens: toks(H.STORY.tokens) }); await p.flush();
  await p.click('wqc-stop');
  s.msg({ tokens: [], finished: true }); await p.flush(); await p.flush();
  const held = p.html();
  p.server.now = { status: 200, body };
  for (let i = 0; i < 3; i += 1) await p.runTimers((x) => x.ms === 3000);
  return { held, settled: p.html() };
}
const SETTLE = { score: { correct: 9, attempted: 10, stopped: false }, wcpm: 48, previous: { wcpm: 40 } };

describe('the Jugnu page: the checked result reaches the settled card', () => {
  const golden = fs.existsSync(GOLDEN_FILE) ? JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) : {};
  if (WRITE) {
    test('write the page goldens', async () => {
      const out = {};
      for (const lang of ['en', 'ur']) out[lang] = await readAndSettle(page(lang, {}, { withMoment: false }), SETTLE);
      const cur = fs.existsSync(GOLDEN_FILE) ? JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) : {};
      fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify({ ...cur, page: out }, null, 1)}\n`);
    });
    return;
  }
  test.each(['en', 'ur'])('%s, key absent (the file even there): the held and settled cards are today\'s, byte for byte', async (lang) => {
    const got = await readAndSettle(page(lang, {}), SETTLE);
    expect(got).toEqual(golden.page[lang]);
  });
  test.each(['en', 'ur'])('%s, key on: the settled card carries the checked speed, the growth and the stars', async (lang) => {
    const { held, settled } = await readAndSettle(page(lang, RF), SETTLE);
    // the held card: the live count (10 words heard), no number yet — 10 words is too short to give one
    expect(held).toContain(lang === 'ur' ? 'آپ نے ۱۰ لفظ پڑھے!' : 'You read 10 words!');
    expect(settled).toContain(lang === 'ur' ? 'آپ نے ۹ لفظ پڑھے!' : 'You read 9 words!');
    expect(settled).toContain('data-stars="3"');
    expect(settled).toContain('data-level="3"');   // 48 a minute, grade 3: three lights
    expect(text(settled)).not.toMatch(BANNED);
  });
  test('key on, a long checked read: the number beside the jar and "faster than last time"', async () => {
    const { settled } = await readAndSettle(page('en', RF), { score: { correct: 46, attempted: 50, stopped: false }, wcpm: 48, previous: { wcpm: 40 } });
    expect(settled).toContain('48 words a minute');
    expect(settled).toContain('Faster than last time!');
  });
});
