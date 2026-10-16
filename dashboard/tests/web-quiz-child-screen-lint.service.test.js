/**
 * One lint over every child-facing Trail (v2) screen of the Challenge page, English and Urdu: the real page code
 * (wq-challenge.js + wq-trail.js + wq-read-live.js) run whole in the harness's vm, each screen reached the way a child
 * reaches it, and its visible text (the HTML with its tags stripped, plus every aria-label / alt / title value, plus
 * whatever the page painted into an element after the screen was drawn) checked against one table of words no child
 * screen may show: a words-a-minute number or label, a rank, a percentile, a score "out of" something, a test word,
 * or a lock on a stop. Only the browser and the network are faked.
 *
 * CHILD_LINT_PAGE_SRC=<a wq-challenge.js>: run the same lint against another copy of the page code.
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');
const Bank = require('../../bot/shared/services/child-test/item-bank');

const { ok } = H;
const WQ = path.join(__dirname, '..', 'public', 'wq');
const SRC = process.env.CHILD_LINT_PAGE_SRC ? fs.readFileSync(process.env.CHILD_LINT_PAGE_SRC, 'utf8') : H.SRC;
const TRAIL_SRC = fs.readFileSync(path.join(WQ, 'wq-trail.js'), 'utf8');
const LIVE_SRC = fs.readFileSync(path.join(WQ, 'wq-read-live.js'), 'utf8');

// Screens that show a forbidden word today and are waiting for a page fix. Shrink-only: an entry leaves when its
// screen is clean; nothing is ever added to make a new screen pass. One line per entry: '<lang>:<screen>': 'why'.
const ALLOW = {};

// ── the table: one row per thing no child screen may show ───────────────────────────────────────────────────
// Urdu has no \b: a word is a run of Arabic-script letters, so the edges are "no Arabic letter on either side".
const UR_W = (w) => new RegExp(`(?<![\\u0600-\\u06FF])${w}(?![\\u0600-\\u06FF])`);
const FORBID = [
  { what: 'words a minute (EN)', rx: /\bwords? (a|per|in a|each) minute\b/i },
  { what: 'WCPM / WPM label', rx: /\b(wcpm|wpm|cwpm)\b/i },
  { what: 'words a minute (UR)', rx: /ایک منٹ میں[^۔!؟\n]{0,24}لفظ|فی منٹ[^۔!؟\n]{0,12}لفظ|لفظ فی منٹ/ },
  { what: 'rank (EN)', rx: /\b(rank|ranks|ranked|ranking)\b/i },
  { what: 'rank (UR)', rx: UR_W('(پوزیشن|درجہ بندی)') },
  { what: 'percentile (EN)', rx: /\bpercentiles?\b/i },
  { what: 'percentile (UR)', rx: UR_W('(پرسنٹائل|فیصدی درجہ)') },
  { what: 'score out of (EN)', rx: /\bout of\b/i },
  { what: 'test word (EN)', rx: /\b(tests?|exams?|assessments?|egra|egma)\b/i },
  { what: 'test word (UR)', rx: UR_W('(ٹیسٹ|امتحان|جائزہ|اسیسمنٹ)') },
  { what: 'lock (sign)', rx: /🔒|🔐/u },
  { what: 'lock (EN)', rx: /\block(ed|s)?\b/i },
  { what: 'lock (UR)', rx: UR_W('بند') },
];

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]);
/** What a child can see or hear read out: the text between tags, and every aria-label / alt / title value. */
function visible(html) {
  const attrs = [];
  String(html).replace(/\s(aria-label|alt|title)="([^"]*)"/g, (m, k, v) => { attrs.push(v); return m; });
  return decode([String(html).replace(/<[^>]*>/g, ' '), ...attrs].join(' ')).replace(/\s+/g, ' ').trim();
}
/** Each row of the table this screen's visible text hits, with the words that hit it. */
function lint(html) {
  const v = visible(html);
  return FORBID.map((f) => { const m = f.rx.exec(v); return m ? { what: f.what, found: m[0], text: v } : null; }).filter(Boolean);
}

// ── fixtures: server copy and payloads in each language (the page's own copy is its own) ───────────────────
const COPY = {
  en: {
    tc: {
      title: "{name}'s Trail", sub: '{done} of {total} stops done. Pick any stop!', allDone: "You finished {name}'s Trail!", badge: 'Done', next: 'Next',
      mic: 'uses the microphone', needsMic: 'needs a microphone', micWait: 'This stop needs a microphone.', other: 'Go to another stop', back: 'Back to the trail',
      practice: 'Play it again.', stopDone: 'Stop done!', missAsk: 'Which number is missing?', missYes: 'Yes! {n} goes here.', missWas: '{n} goes here.', missSkip: 'Skip',
      micAgain: 'Try the microphone again',
    },
    clips: { intro: { text: 'Let us play.', url: null }, start: { text: 'Ready? Begin.', url: null }, stop: { text: 'Stop. Thank you!', url: null }, done: { text: 'Great reading! Well done.', url: null } },
    names: { missing: 'Missing number', read: 'Read aloud', bigger: 'Which is bigger?', listen: 'Listen and answer' },
    story: Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story,
    kid: '<Name> Testwala',
  },
  ur: {
    tc: {
      title: '{name} کا راستہ', sub: '{total} میں سے {done} مکمل۔', allDone: '{name} کا راستہ مکمل!', badge: 'مکمل', next: 'اگلا',
      mic: 'مائیک استعمال ہوگا', needsMic: 'مائیک چاہیے', micWait: 'مائیک چاہیے۔', other: 'کوئی اور کھیل', back: 'راستے پر واپس',
      practice: 'مشق کا دور۔', stopDone: 'مکمل!', missAsk: 'کون سا عدد غائب ہے؟', missYes: 'جی ہاں! {n} یہاں آئے گا۔', missWas: '{n} یہاں آئے گا۔', missSkip: 'چھوڑیں',
      micAgain: 'مائیک دوبارہ آزمائیں',
    },
    clips: { intro: { text: 'آئیں کھیلیں۔', url: null }, start: { text: 'تیار؟ شروع کریں۔', url: null }, stop: { text: 'رکیں۔ شکریہ!', url: null }, done: { text: 'بہت خوب پڑھا!', url: null } },
    names: { missing: 'غائب عدد', read: 'اونچی آواز میں پڑھیں', bigger: 'کون سا بڑا ہے؟', listen: 'سنیں اور جواب دیں' },
    story: Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ur.story' }).story,
    kid: '<Name> Testwala',
  },
};
const V2 = { pool: true, story: true, consent: true };
const exs = (c) => [
  { id: 'missing', name: c.names.missing, mins: 2, done: false, last: null, badge: false, anchor_block: 'A1' },
  { id: 'read', name: c.names.read, mins: 2, done: true, last: { wcpm: 42 }, badge: true, mic: true },
  { id: 'bigger', name: c.names.bigger, mins: 2, done: false, last: null, badge: false },
  { id: 'listen', name: c.names.listen, mins: 2, done: false, last: null, badge: false },
];
const menuOf = (lang, extra = {}) => ({ lang, form: 'G3', record: true, trail: true, trail_copy: COPY[lang].tc, exercises: exs(COPY[lang]), v2: V2, ...extra });
const storyOf = (lang) => { const s = COPY[lang].story; return { text: s.text, tokens: s.tokens, lines: s.lines, dir: lang === 'ur' ? 'rtl' : 'ltr' }; };
const base = (lang, ex, ct) => ({ ex, ct, lang, clips: COPY[lang].clips, record: true, trail: true, trail_copy: COPY[lang].tc, v2: V2 });
const READ = (lang, extra = {}) => ({ ...base(lang, 'read', 'CTR'), secs: 60, story: storyOf(lang), previous_wcpm: 40, ...extra });
const BIGGER = (lang, extra = {}) => ({ ...base(lang, 'bigger', 'CTB'), items: [{ a: 3, b: 5 }, { a: 9, b: 4 }], practice: [], per_item_s: 10, stop_after: 4, ...extra });
const ITEMS = Array.from({ length: 6 }, (_, i) => ({ seq: [i + 1, i + 2, null, i + 4], answer: i + 3 }));
const WARMUP = (lang, extra = {}) => ({ ...base(lang, 'missing', 'CTM'), items: ITEMS, practice: [{ seq: [1, 2, null, 4], answer: 3 }], stop_after: 0, first_key_s: 5, anchor_block: 'A1', ...extra });
const LISTEN = (lang, extra = {}) => ({ ...base(lang, 'listen', 'CTL'), story_clip: { url: '/clips/listen-a.mp3' }, read_times: 2, ...extra });
const KEY = (lang) => ({ api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt.test/ws', model: 'stt-rt', lang });

// the browser's socket (the live words), held so a screen can be driven: open, words heard, the stream finished
const SOCKET = 'var __ws = []; window.WebSocket = function (u) { this.url = u; this.sent = []; this.bufferedAmount = 0; __ws.push(this); };'
  + 'window.WebSocket.prototype.send = function (x) { this.sent.push(x); };'
  + 'window.WebSocket.prototype.close = function () { this.closed = true; };'
  + 'window.WebSocket.prototype.open = function () { if (this.onopen) this.onopen({}); };'
  + 'window.WebSocket.prototype.msg = function (m) { if (this.onmessage) this.onmessage({ data: JSON.stringify(m) }); };'
  + 'WebSocket = window.WebSocket;';
const toks = (words) => words.map((w, k) => ({ text: (k === 0 ? '' : ' ') + w, start_ms: k * 1000, end_ms: k * 1000 + 800, is_final: true }));
const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const SAT = { 'wqc_helped_v2:': 'self', 'wqc_helped_v2:c1': 'self' };

const v2page = (lang, o = {}) => H.page({ src: SRC, lang, menu: menuOf(lang), freshEls: true, session: store(SAT), storage: store(), ...o, pre: [SOCKET, LIVE_SRC, TRAIL_SRC] });
/** The screen as drawn, plus what the page painted into its elements after drawing it (the live words, a nudge). */
const shot = (p) => [p.root.innerHTML, ...Object.values(p.els).map((e) => `${e.innerHTML || ''} ${e.textContent || ''}`)].join(' ');
const type = async (p, digits) => { for (const d of String(digits)) await p.click(`wqc-k${d}`); await p.click('wqc-kok'); };

/** Every v2 screen a child can reach, in one language: { '<screen>': html }. */
async function collect(lang) {
  const c = COPY[lang];
  const out = {};
  const put = (name, p, want) => { if (want && p.screen() !== want) throw new Error(`${lang}:${name} reached "${p.screen()}", not "${want}"`); out[name] = shot(p); };

  // the map
  put('trail map', v2page(lang), 'trail');
  // "Whose turn?" (two children on one phone)
  put('whose turn', v2page(lang, { menu: menuOf(lang, { ask: 'whose_turn', kids: [{ chip: 'c1', first: c.kid, animal: 'owl' }, { chip: 'c2', first: c.kid, animal: 'cat', line2: 'G3', avatarLine: true }] }) }), 'whose-turn');

  // a tap game: help asked first, then its intro, its item screen, its end cards (done, stopped)
  {
    const p = v2page(lang, { session: store(), routes: { 'ch/HUB.TOKEN/bigger': ok(BIGGER(lang)), 'ch/result': ok({ score: { correct: 2, n: 2, stopped: false } }) } });
    await p.click('wqc-ex-bigger');
    put('help-ask', p, 'help-ask');
    await p.click('wqc-help-no');
    put('intro (tap game)', p, 'intro');
    await p.click('wqc-go');
    await p.runTimers((x) => x.ms === 300);
    put('tap-game item', p, 'bigger-play');
    p.w.bigger.result({ correct: 2, n: 2, stopped: false });
    put('end card: done', p, 'bigger-result');
    p.w.bigger.result({ correct: 0, n: 2, stopped: true });
    put('end card: stopped', p, 'bigger-result');
  }

  // the warm-up: its title on the map, its intro, its item, its end card
  {
    const p = v2page(lang, { routes: { 'ch/HUB.TOKEN/missing': ok(WARMUP(lang)) } });
    await p.click('wqc-ex-missing');
    put('warm-up intro', p, 'intro');
    await p.click('wqc-go');
    put('warm-up practice item', p, 'missing-practice');
    await type(p, 3);
    await p.runTimers((x) => x.ms === 1800);
    await p.runTimers((x) => x.ms === 300);
    put('warm-up item', p, 'missing-play');
    p.w.missing.result({ correct: 6, n: 6, stopped: false });
    put('end card: warm-up done', p, 'missing-result');
  }

  // read: intro, the mic notice, then the read without live words, its result
  {
    const p = v2page(lang, { kid: 'c1', routes: { 'ch/HUB.TOKEN/read': ok(READ(lang, { live: false, v2: { ...V2, notice: 1, name: c.kid } })), 'ch/upload': ok({ put_url: 'https://r2.test/put', key: 'k', content_type: 'audio/webm' }), 'r2.test': ok({}), 'ch/result': ok({ score: { correct: 88, attempted: 90, stopped: false }, wcpm: 90, previous: { wcpm: 80 } }) } });
    await p.click('wqc-ex-read');
    put('intro (read)', p, 'intro');
    await p.click('wqc-go');
    put('mic notice', p, 'mic-notice');
    await p.click('wqc-notice-ok');
    put('read-rec', p, 'read-rec');
    p.w.stopRec('done_tap');
    await p.flush();
    put('read result', p, 'read-result');
    p.w.readResult({ score: { correct: 0, attempted: 0, stopped: false }, wcpm: 0 });
    put('read result: no words', p, 'read-result');
  }

  // read with live words: the words light up, then the reading ends live
  {
    const p = v2page(lang, { routes: { 'ch/HUB.TOKEN/read': ok(READ(lang, { live: true })), 'ch/live': ok(KEY(lang)), 'ch/upload': ok({ put_url: 'https://r2.test/put', key: 'k', content_type: 'audio/webm' }), 'r2.test': ok({}), 'ch/result': ok({ pending: true }) } });
    await p.click('wqc-ex-read');
    await p.click('wqc-go');
    if (!p.w.live()) throw new Error(`${lang}: the live words did not start`);
    put('read-live (before a word)', p, 'read-live');
    const s = p.ctx.__ws[0];
    s.open();
    s.msg({ tokens: toks(storyOf(lang).tokens.slice(0, 10)) });
    put('read-live (live words on)', p, 'read-live');
    p.w.stopRec('done_tap');
    s.msg({ tokens: [], finished: true });
    await p.flush();
    put('read result (live)', p, 'read-result');
  }

  // listen: intro, the story playing
  {
    const p = v2page(lang, { routes: { 'ch/HUB.TOKEN/listen': ok(LISTEN(lang)) } });
    await p.click('wqc-ex-listen');
    put('intro (listen)', p, 'intro');
    await p.click('wqc-go');
    put('listen-play', p, 'listen-play');
  }

  // Story Time: the room's wait, its ask, read along, its end card
  {
    put('story room: on its way', v2page(lang, { href: 'https://portal.test/c/HUB.TOKEN?room=story' }), 'story');
    const AUDIO = 'Audio = function (u) { this.url = u; this.l = {}; this.currentTime = 0; this.duration = NaN; };'
      + 'Audio.prototype.addEventListener = function (n, fn) { (this.l[n] = this.l[n] || []).push(fn); };'
      + 'Audio.prototype.play = function () { return Promise.resolve(); }; Audio.prototype.pause = function () {};';
    const sread = READ(lang, { practice_round: true, mode: 'practice', story_clip: { url: '/clips/story-a.mp3' }, questions_on: false, v2: V2 });
    const p = H.page({ src: SRC, lang, menu: menuOf(lang), freshEls: true, session: store(SAT), storage: store(), href: 'https://portal.test/c/HUB.TOKEN?room=story&pid=en.read.1.a', pre: [AUDIO, SOCKET, LIVE_SRC, TRAIL_SRC], routes: { 'ch/HUB.TOKEN/read': ok(sread), 'ch/upload': ok({ put_url: 'https://r2.test/put', key: 'k', content_type: 'audio/webm' }), 'r2.test': ok({}), 'ch/result': ok({ score: { correct: 9, attempted: 10 }, wcpm: 55 }) } });
    await p.flush();
    put('story ask', p, 'story-ask');
    await p.click('wqc-story-along');
    put('story read-along', p, 'story-along');
    await p.click('wqc-along-read');
    put('story read', p, 'read-rec');
    p.w.stopRec('done_tap');
    await p.flush();
    put('end card: story', p, 'read-result');
  }

  // the branches: no microphone, a story on its way, a listening story still being recorded
  {
    const p = v2page(lang, { media: 'none' });
    await p.click('wqc-ex-read');
    put('mic wait', p, 'mic-wait');
    put('on its way', await (async () => { const q = v2page(lang, { routes: { 'ch/HUB.TOKEN/read': ok({ ex: 'read', draw: { outcome: 'on_its_way' } }) } }); q.w.open('read'); await q.flush(); return q; })(), 'on-its-way');
    const g = v2page(lang, { routes: { 'ch/HUB.TOKEN/listen': () => ({ status: 503, body: { error: 'getting_ready' } }) } });
    g.w.open('listen');
    await g.flush();
    put('getting ready', g, 'getting-ready');
  }
  return out;
}

const SCREENS = ['trail map', 'whose turn', 'help-ask', 'intro (tap game)', 'tap-game item', 'end card: done', 'end card: stopped',
  'warm-up intro', 'warm-up practice item', 'warm-up item', 'end card: warm-up done', 'intro (read)', 'mic notice', 'read-rec', 'read result',
  'read result: no words', 'read-live (before a word)', 'read-live (live words on)', 'read result (live)', 'intro (listen)', 'listen-play',
  'story room: on its way', 'story ask', 'story read-along', 'story read', 'end card: story', 'mic wait', 'on its way', 'getting ready'];

describe.each(['en', 'ur'])('%s: no child screen shows a speed, a rank, a test word or a lock', (lang) => {
  let shots = null;
  beforeAll(async () => { shots = await collect(lang); });

  test('every screen in the list was reached and drawn', () => {
    expect(Object.keys(shots).sort()).toEqual([...SCREENS].sort());
    // the live screen was linted with its words lit, not an empty passage
    expect((shots['read-live (live words on)'].match(/wqc-w wqc-ok/g) || []).length).toBeGreaterThanOrEqual(10);
  });

  test.each(SCREENS)('%s', (name) => {
    const hits = lint(shots[name]);
    const key = `${lang}:${name}`;
    if (ALLOW[key]) {
      // an allowed screen must still be dirty: a clean one leaves the list
      expect(hits.length).toBeGreaterThan(0);
      return;
    }
    if (hits.length) throw new Error(`${key} shows ${hits.map((h) => `${h.what}: "${h.found}"`).join('; ')}\n  visible text: ${hits[0].text}`);
  });
});

describe('the lint catches each forbidden thing (a fake screen per row)', () => {
  const BAD = [
    ['words a minute (EN)', '<p>You read <b>42</b> words a minute!</p>'],
    ['words a minute (EN)', '<span>words in a minute</span>'],
    ['WCPM / WPM label', '<p class="x">WCPM 42</p>'],
    ['WCPM / WPM label', '<button aria-label="42 wpm">▶</button>'],
    ['words a minute (UR)', '<span>ایک منٹ میں لفظ</span>'],
    ['words a minute (UR)', '<p>آپ نے ایک منٹ میں ⁦42⁩ لفظ پڑھے!</p>'],
    ['rank (EN)', '<p>Your rank: 3</p>'],
    ['rank (EN)', '<img src="x.png" alt="ranked first">'],
    ['rank (UR)', '<p>آپ کی پوزیشن تیسری ہے</p>'],
    ['percentile (EN)', '<p>80th percentile</p>'],
    ['percentile (UR)', '<p>پرسنٹائل ۸۰</p>'],
    ['score out of (EN)', '<p>You got 7 out of 10!</p>'],
    ['test word (EN)', '<p>Reading test</p>'],
    ['test word (EN)', '<p>Two tests left</p>'],
    ['test word (EN)', '<p>The exam starts</p>'],
    ['test word (EN)', '<p>Your assessment</p>'],
    ['test word (EN)', '<p>EGRA</p>'],
    ['test word (EN)', '<div title="EGMA check">x</div>'],
    ['test word (UR)', '<p>پڑھنے کا ٹیسٹ</p>'],
    ['test word (UR)', '<p>آج امتحان ہے</p>'],
    ['test word (UR)', '<p>یہ جائزہ ہے</p>'],
    ['test word (UR)', '<p>اسیسمنٹ</p>'],
    ['lock (sign)', '<span class="wqc-pill">🔒</span>'],
    ['lock (EN)', '<small>Locked</small>'],
    ['lock (EN)', '<button aria-label="locked stop"></button>'],
    ['lock (UR)', '<small>یہ کھیل بند ہے</small>'],
  ];
  test.each(BAD)('%s ← %s', (what, html) => {
    expect(lint(html).map((h) => h.what)).toContain(what);
  });
  test('every row of the table is proven by at least one fake screen', () => {
    expect([...new Set(BAD.map((b) => b[0]))].sort()).toEqual(FORBID.map((f) => f.what).sort());
  });
  test('look-alikes are not hits: an item counter, "best", «پسند», «بندر», a stop\'s minutes, a "Testwala" name', () => {
    for (const h of ['<p>1 of 6</p>', '<p>⁦6⁩ میں سے ⁦1⁩</p>', '<p>Your best reading</p>', '<p>آپ کو پسند ہے</p>', '<p>بندر</p>', '<small>2 min</small>', '<b>&lt;Name&gt; Testwala</b>', '<p>Blocks and clocks</p>']) {
      expect(lint(h)).toEqual([]);
    }
  });
});
