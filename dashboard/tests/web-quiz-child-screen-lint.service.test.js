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
const ALLOW = {
  'ur:hub-last-quiz-score': 'the hub\'s last-quiz line shows that quiz\'s own score («⭐ 4/5», Western digits in a ltr bdi): a known exception',
};

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
  { what: 'rank sentence (UR)', rx: /آپ کا نمبر[^۔!؟\n]{0,6}?[0-9۰-۹][^۔!؟\n]{0,6}?ہے/ },
  // a class count under 5 tells a child how few classmates finished ("2 children" = exactly one other): never shown
  // (the finish card's "N children in your class", the landing's "N in your class played today" / "N classmates")
  { what: 'class count under 5 (EN)', rx: /(?<![0-9])[1-4][\s\u2066-\u2069]*(children in your class|in your class|classmates?\b)/i },
  { what: 'class count under 5 (UR)', rx: /(?<![0-9۰-۹])[1-4۱-۴][\s\u2066-\u2069]*(بچوں نے|نے کھیلا|ہم جماعت|ساتھی)/ },
  // Urdu prose writes Urdu digits; a Western digit there only inside a left-to-right isolate (the Trail's counter:
  // «⁦10⁩ میں سے ⁦1⁩»). Urdu screens only: an English screen is all Western digits. Prose only: a maths tile (a
  // button or a cell holding nothing but a number, Western beside the Western keypad) is not prose.
  { what: 'bare Western digit in Urdu prose', ur: true, prose: true, rx: { exec: (v) => /[0-9]/.exec(v.replace(/[\u2066\u2067\u2068][^\u2066-\u2069]*\u2069/g, ' ')) } },
];

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]);
/** What a child can see or hear read out: the text between tags, and every aria-label / alt / title value. */
function visible(html) {
  const attrs = [];
  String(html).replace(/\s(aria-label|alt|title)="([^"]*)"/g, (m, k, v) => { attrs.push(v); return m; });
  return decode([String(html).replace(/<[^>]*>/g, ' '), ...attrs].join(' ')).replace(/\s+/g, ' ').trim();
}
/** Each row of the table this screen's visible text hits, with the words that hit it (Urdu-only rows on Urdu screens). */
const TILE = /<(button|div)\b[^>]*>[\s0-9?\u2066-\u2069]*<\/\1>/g;
function lint(html, lang) {
  const v = visible(html);
  const prose = visible(String(html).replace(TILE, ' '));
  return FORBID.filter((f) => !f.ur || lang === 'ur').map((f) => { const m = f.rx.exec(f.prose ? prose : v); return m ? { what: f.what, found: m[0], text: v } : null; }).filter(Boolean);
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

/** One screen: no hit, or (on ALLOW by name) still a hit, so a screen that is fixed leaves the list. */
function check(key, html, lang) {
  const hits = lint(html, lang);
  if (ALLOW[key]) {
    if (!hits.length) throw new Error(`${key} is clean now: take it off ALLOW`);
    return;
  }
  if (hits.length) throw new Error(`${key} shows ${hits.map((h) => `${h.what}: "${h.found}"`).join('; ')}\n  visible text: ${hits[0].text}`);
}

/** Every v2 screen a child can reach, in one language: { '<screen>': html }. */
async function collect(lang) {
  const c = COPY[lang];
  const out = {};
  const put = (name, p, want) => { if (want && p.screen() !== want) throw new Error(`${lang}:${name} reached "${p.screen()}", not "${want}"`); out[name] = shot(p); };

  // the map
  put('trail map', v2page(lang), 'trail');
  // "Whose turn?" (two children on one phone)
  put('whose turn', v2page(lang, { menu: menuOf(lang, { ask: 'whose_turn', kids: [{ chip: 'c1', first: c.kid, animal: 'owl' }, { chip: 'c2', first: c.kid, animal: 'cat', line2: lang === 'ur' ? 'جماعت سوم' : 'Class three', avatarLine: true }] }) }), 'whose-turn');

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

  test.each(SCREENS)('%s', (name) => { check(`${lang}:${name}`, shots[name], lang); });
});

// The quiz page's grade-1 finish card (wq.js, its own page, run whole in wq-page-harness.js): it says how many children
// of the class finished today, never the child's place, the count in Urdu digits. The lint reads the whole card for the
// rank sentence and the class line for every row (the card's other text is the quiz page's own, outside this lint).
describe('the quiz page finish card: no class count under 5, any count, any grade, EN + UR', () => {
  const QP = require('./wq-page-harness');
  const lineOf = (lang, nth, grade) => {
    const p = QP.page({ lang, grade });
    p.wq.S.result = { score: { correct: 4, total: 5 }, card: { first: '<Name> Testwala', animal: 'cat', correct: 4, total: 5, stars: 4, nth } };
    p.wq.card();
    return /<p class="wq-proof wq-nth">[\s\S]*?<\/p>/.exec(p.html())[0];
  };
  test.each(['en', 'ur'])('%s: n = 1…12, grades 1, 3, 5', (lang) => {
    for (let n = 1; n <= 12; n += 1) for (const g of [1, 3, 5]) check(`${lang}:quiz-finish-card-n${n}-g${g}`, lineOf(lang, n, g), lang);
  });
  test('the row reads the count, not the line: 5 and 12 pass, 10 and 14 are not "1" or "4"', () => {
    expect(lint('<p><bdi>5</bdi> children in your class finished this quiz today.</p>', 'en')).toEqual([]);
    expect(lint('<p><bdi>14</bdi> children in your class finished this quiz today.</p>', 'en')).toEqual([]);
    expect(lint('<p>آج آپ کی کلاس میں <bdi>۱۰</bdi> بچوں نے یہ کوئز مکمل کیا۔</p>', 'ur')).toEqual([]);
  });
});

// The quiz page's two landings (wq.js M3, and the identity v2 landing wq-identity.js M4-who-v2): "N in your class
// played today" and "N classmates are playing right now" only from 5 up. Only the class-count rows run here: the
// landing's other lines are the quiz page's own, outside this lint.
describe('the quiz page landings: no class count under 5, n = 1…12, EN + UR', () => {
  const QP = require('./wq-page-harness');
  const COUNT = FORBID.filter((f) => /^class count under 5/.test(f.what));
  const V2 = { label: 'Class 4-A', teacher: '<Name> Testwala', chips: [], identity: { mode: 'v2', class: { state: 'known', label: '4-A', ask: null }, roster: true, invited: false } };
  const landing = (lang, n, v2) => QP.page({ lang, live: { class_today: n, now: n, ict_today_floor: 40 }, ...(v2 ? { cls: V2, ident: true } : {}) }).html();
  test.each([['en', false], ['ur', false], ['en', true], ['ur', true]])('%s, identity v2 %s', (lang, v2) => {
    for (let n = 1; n <= 12; n += 1) {
      const h = landing(lang, n, v2);
      expect(h).toContain(v2 ? 'M4-who-v2' : 'data-m="M3"');
      const v = visible(h);
      const hits = COUNT.filter((f) => f.rx.exec(v)).map((f) => f.what);
      if (hits.length) throw new Error(`${lang}:landing${v2 ? '-v2' : ''}-n${n} shows ${hits.join('; ')}\n  visible text: ${v}`);
      // from 5 up the class lines are there (the count is shown, not just hidden everywhere)
      if (n >= 5) expect(v).toMatch(lang === 'en' ? /in your class played today/ : /نے کھیلا/);
    }
  });
});

describe('the quiz page finish card, grade 1 (Urdu)', () => {
  const QP = require('./wq-page-harness');
  test('ur:quiz-finish-card-g1', () => {
    const p = QP.page({ lang: 'ur', grade: 1 });
    p.wq.S.result = { score: { correct: 4, total: 5 }, card: { first: '<Name> Testwala', animal: 'cat', correct: 4, total: 5, stars: 4, nth: 2 } };
    p.wq.card();
    const html = p.html();
    expect(html).not.toContain('آپ کا نمبر');
    expect(lint(html, 'ur').map((h) => h.what)).not.toContain('rank sentence (UR)');
    const line = /<p class="wq-proof wq-nth">[\s\S]*?<\/p>/.exec(html)[0];
    check('ur:quiz-finish-card-g1', line, 'ur');
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
    ['rank sentence (UR)', '<p>آپ کا نمبر ۲ ہے</p>'],
    ['bare Western digit in Urdu prose', '<p>آپ کا نمبر 2 ہے</p>'],
    ['class count under 5 (EN)', '<p><bdi>2</bdi> children in your class finished this quiz today.</p>'],
    ['class count under 5 (EN)', '<p>4 children in your class finished this quiz today.</p>'],
    ['class count under 5 (UR)', '<p>آج آپ کی کلاس میں <bdi>۲</bdi> بچوں نے یہ کوئز مکمل کیا۔</p>'],
    ['class count under 5 (UR)', '<p>آج آپ کی کلاس میں ⁦4⁩ بچوں نے یہ کوئز مکمل کیا۔</p>'],
    ['class count under 5 (EN)', '<p class="wq-small">1 in your class played today</p>'],
    ['class count under 5 (EN)', '<p class="wq-proof">🟢 2 classmates are playing right now — join them!</p>'],
    ['class count under 5 (UR)', '<p class="wq-small">آج آپ کی کلاس میں 3 نے کھیلا</p>'],
    ['class count under 5 (UR)', '<p class="wq-proof">🟢 ابھی 4 ہم جماعت کھیل میں شامل ہیں — آپ بھی آئیں!</p>'],
    ['class count under 5 (UR)', '<p class="wq-proof">🟢 ابھی ⁦2⁩ ساتھی کھیل رہے ہیں!</p>'],
  ];
  // every fake screen is read as an Urdu screen (so the Urdu-only row runs too)
  test.each(BAD)('%s ← %s', (what, html) => {
    expect(lint(html, 'ur').map((h) => h.what)).toContain(what);
  });
  test('«آپ کا نمبر 2 ہے» hits both the rank sentence and the bare digit; «آپ کا نمبر ۲ ہے» the rank sentence only', () => {
    expect(lint('<p>آج آپ کی کلاس میں مکمل کرنے والوں میں آپ کا نمبر <bdi>2</bdi> ہے</p>', 'ur').map((h) => h.what).sort()).toEqual(['bare Western digit in Urdu prose', 'rank sentence (UR)']);
    expect(lint('<p>آپ کا نمبر 2 ہے</p>', 'ur').map((h) => h.what).sort()).toEqual(['bare Western digit in Urdu prose', 'rank sentence (UR)']);
    expect(lint('<p>آپ کا نمبر ۲ ہے</p>', 'ur').map((h) => h.what)).toEqual(['rank sentence (UR)']);
  });
  test('the bare-digit row runs on Urdu screens only', () => {
    expect(lint('<p>Stop 2</p>', 'en')).toEqual([]);
    expect(lint('<p>Stop 2</p>', 'ur').map((h) => h.what)).toEqual(['bare Western digit in Urdu prose']);
  });
  test('a maths tile is not prose: a number alone in a button or a cell passes, the same number in a sentence does not', () => {
    expect(lint('<div class="wqc-cell">7</div><button class="wqc-k" aria-label="7">7</button><button class="wqc-num">35</button>', 'ur')).toEqual([]);
    expect(lint('<div class="wq-say">آپ نے 7 لیے</div>', 'ur').map((h) => h.what)).toEqual(['bare Western digit in Urdu prose']);
  });
  test('every row of the table is proven by at least one fake screen', () => {
    expect([...new Set(BAD.map((b) => b[0]))].sort()).toEqual(FORBID.map((f) => f.what).sort());
  });
  test('look-alikes are not hits: an item counter (isolated digits in Urdu), "best", «پسند», «بندر», a stop\'s minutes, a "Testwala" name', () => {
    for (const h of ['<p>1 of 6</p>', '<p>Your best reading</p>', '<small>2 min</small>', '<b>&lt;Name&gt; Testwala</b>', '<p>Blocks and clocks</p>']) expect(lint(h, 'en')).toEqual([]);
    for (const h of ['<p>⁦6⁩ میں سے ⁦1⁩</p>', '<p>⁦10⁩ میں سے ⁦1⁩</p>', '<p>⁨10⁩ میں سے ⁨1⁩</p>', '<p>آپ کو پسند ہے</p>', '<p>بندر</p>', '<small>۲ منٹ</small>', '<p>کلاس لسٹ میں آپ کا نمبر کیا ہے؟</p>']) expect(lint(h, 'ur')).toEqual([]);
  });
});

// ── the hub (hub.js + hub-play.js + wq-book.js's hub tile, run whole in a vm with a small fake DOM, as in
// web-quiz-hub-play.service.test.js) and Jugnu's Book (wq-book.js, as in web-quiz-book-page.service.test.js) ──────
// CHILD_LINT_SEED=hub,play,book (any of them): the same walk with a test word put into that page's own copy table.
const vmod = require('vm');
const HUB_SRC0 = fs.readFileSync(path.join(WQ, 'hub.js'), 'utf8');
const PLAY_SRC0 = fs.readFileSync(path.join(WQ, 'hub-play.js'), 'utf8');
const TEL_SRC = fs.readFileSync(path.join(WQ, 'wq-tel.js'), 'utf8');
const BOOK_SRC0 = fs.readFileSync(path.join(WQ, 'wq-book.js'), 'utf8');
/** A copy line of a page's own table with a test word put in front: its English block first, then every Urdu one (the
 * key must be there, English then Urdu, so a renamed line fails loudly). */
const seed = (src, key) => {
  const parts = src.split(`${key}: '`);
  if (parts.length < 3) throw new Error(`seed: "${key}" is not in each language of the page's copy`);
  return `${parts[0]}${key}: 'Reading test ${parts[1]}${key}: 'ٹیسٹ ${parts.slice(2).join(`${key}: 'ٹیسٹ `)}`;
};
const SEEDS = { hub: 'chSub', play: 'lanternTrailMany', book: 'bookLamps' };
/** The three pages' sources, with the named ones seeded. */
const SRCS = (pages = []) => ({
  hub: pages.includes('hub') ? seed(HUB_SRC0, SEEDS.hub) : HUB_SRC0,
  play: pages.includes('play') ? seed(PLAY_SRC0, SEEDS.play) : PLAY_SRC0,
  book: pages.includes('book') ? seed(BOOK_SRC0, SEEDS.book) : BOOK_SRC0,
});
const SEED_ON = String(process.env.CHILD_LINT_SEED || '').split(',').filter(Boolean);

// The hub's clock, fixed (the teacher card says how many days ago its quiz was sent).
const HUB_NOW = Date.parse('2026-10-15T21:00:00Z');
class HubDate extends Date {
  constructor(...a) { super(...(a.length ? a : [HUB_NOW])); }
  static now() { return HUB_NOW; }
}
/** The hub page as hub.js draws it (the minimum of web-quiz-hub-play.service.test.js's page helper). */
function hubPage(boot, { src = SRCS(), book = false, store = {} } = {}) {
  const els = {};
  const timers = [];
  const winL = {};
  const el = (sel, attrs) => (els[sel] = els[sel] || { sel, listeners: {}, attrs: attrs || {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, getAttribute(k) { return this.attrs[k]; } });
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      for (const m of h.matchAll(/<(?:a|button|p|div)\b([^>]*)>/g)) {
        const attrs = {};
        for (const a of m[1].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2].replace(/&amp;/g, '&');
        const sel = attrs.id ? `#${attrs.id}` : attrs['data-shelf'] ? `[data-shelf="${attrs['data-shelf']}"]` : null;
        if (sel) el(sel, attrs);
      }
    },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild() {},
    // the Book's hub tile goes in after the tiles row (here: added to the drawn screen)
    querySelector(sel) { return sel === '.wq-htiles' ? { insertAdjacentHTML: (pos, h) => { root._h += h; } } : els[sel] || null; },
    querySelectorAll(sel) { const k = sel.replace(/^\[|\]$/g, ''); return Object.values(els).filter((e) => e.attrs[k] !== undefined); },
  };
  const docEl = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, classList: { toggle() {}, contains: () => false } };
  const ctx = {
    document: { documentElement: docEl, head: { appendChild() {} }, getElementById: (id) => (id === 'wq' ? root : { textContent: JSON.stringify(boot) }), createElement: () => ({ setAttribute() {}, addEventListener() {}, textContent: '' }), querySelector: () => null, cookie: '' },
    window: { scrollTo() {}, addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); }, matchMedia: () => ({ matches: false }) },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', sendBeacon: () => true },
    history: { replaceState() {} },
    location: { search: '', protocol: 'https:', host: 'wq.example.test', assign() {}, reload() {} },
    Blob: function Blob(parts) { this.parts = parts; },
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    Date: HubDate, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent,
  };
  vmod.createContext(ctx);
  vmod.runInContext(TEL_SRC, ctx);
  if (boot.play) vmod.runInContext(src.play, ctx);
  if (book) vmod.runInContext(src.book, ctx);
  vmod.runInContext(src.hub, ctx);
  const tick = () => { while (timers.length) timers.shift()(); };
  tick();
  return { html: () => root._h, els, tick, win: winL };
}
const hubShot = (p) => [p.html(), ...Object.values(p.els).map((e) => String(e.innerHTML || ''))].join(' ');

// story titles from the bank's own passages (Story Time's shelf, the lantern, the Book's stickers)
const PASSAGE = (f) => require(`../../bot/shared/data/child-test/passages/${f}.json`);
const STORIES = {
  en: [PASSAGE('en.read.3.story01'), PASSAGE('en.read.3.story03')].map((j) => ({ pid: j.passage_id, title: j.title_en })),
  ur: [PASSAGE('ur.read.3.story01'), PASSAGE('ur.read.2.story01')].map((j) => ({ pid: j.passage_id, title: j.title_ur })),
};
const KID = (g) => ({ chip: '0000000000000001', first: '<Name> Testwala', animal: 'owl', grade: String(g) });
const hubBoot = (lang, g, o = {}) => ({
  lang, token: 'tok.tok', brand: null, home_v: 1, kids: [KID(g)], kid: '0000000000000001', teacher: null, again: [], recs: [], lib: null,
  challenge: { on: true, exercises: [{ id: 'bigger', done: false }, { id: 'read', done: false }] },
  last: { code: 'MATH01', topic: lang === 'ur' ? 'ریاضی' : 'Maths', subject: 'Maths', k: 'k1', state: 'done', score: { c: 4, t: 5 }, again: true },
  ...o,
});
const PLAY = (o = {}) => ({ first: true, lantern: null, shelf: null, install: false, doors: ['hub_first', 'next', 'tomorrow', 'shelf', 'install'], ...o });
// The last-quiz score line is its own screen (hub-last-quiz-score); every other hub screen is read without it.
const SCORE = /<p class="wq-hscore">[\s\S]*?<\/p>/;
const noScore = (h) => h.replace(SCORE, ' ');

/** Every hub screen a class child sees, one language, one grade: { '<screen>': html }. */
function collectHub(lang, g, src) {
  const out = {};
  const st = STORIES[lang];
  const put = (name, p, want) => { if (want && !p.html().includes(want)) throw new Error(`${lang}:g${g}:${name}: "${want}" was not drawn`); out[name] = noScore(hubShot(p)); };
  const hp = (o, opts = {}) => hubPage(hubBoot(lang, g, o), { src, ...opts });
  put('hub home', hp({ play: PLAY() }), 'class="wq-card wq-hcard wqp-jug"');
  const L = (name, lantern) => put(`hub lantern: ${name}`, hp({ play: PLAY({ lantern }) }), 'id="wqp-next"');
  L('trail one', { kind: 'trail', stops: 1 });
  L('trail many', { kind: 'trail', stops: 3 });
  L('story', { kind: 'story', title: st[0].title, pid: st[0].pid });
  L('numbers', { kind: 'numbers', day: null });
  L('day', { kind: 'day', day: 'monday' });
  L('tomorrow', { kind: 'numbers', day: 'tomorrow' });
  L('all seen', { kind: 'numbers', day: 'monday' });
  put('hub shelf', hp({ play: PLAY({ shelf: [{ id: 'week_story', pid: st[0].pid, nx: 'new', title: st[0].title }, { id: 'listen', pid: st[1].pid, nx: 'seen' }, { id: 'numbers', nx: 'seen' }, { id: 'older', nx: 'seen' }] }) }), 'class="wqp-shelf"');
  {
    const p = hp({ play: PLAY({ shelf: [{ id: 'numbers', nx: 'seen' }], install: true }) }, { store: { wqp_hv_day: String(Math.floor((HUB_NOW + 5 * 3600000) / 86400000)) } });
    p.win.beforeinstallprompt.forEach((fn) => fn({ preventDefault() {}, prompt() {} }));
    if (!String(p.els['#wqp-inst'].innerHTML || '').includes('wqp-add')) throw new Error(`${lang}:g${g}: the install card was not drawn`);
    put('hub install card', p);
  }
  put('hub: last quiz open', hp({ play: PLAY(), last: { code: 'NEWQ01', topic: lang === 'ur' ? 'ریاضی' : 'Maths', subject: 'maths', k: 'k2', state: 'open', answered: 0 } }), 'wq-hlast');
  put('hub: Book tile', hp({ play: PLAY(), book_on: true, class_lights: { shown: true, term_total: 41, week_n: 7 } }, { book: true }), 'id="wq-bk-open"');
  put('hub: Book tile, lights under 5', hp({ play: PLAY(), book_on: true, class_lights: { shown: false } }, { book: true }), 'data-lights="hidden"');
  put('hub: teacher quiz sent today', hp({ play: PLAY(), lib: { href: '/lib/tok.tok?kid=0000000000000001' }, teacher: { code: 'NEWQ01', topic: lang === 'ur' ? 'ریاضی' : 'Maths', subject: 'maths', sent_at: '2026-10-15T10:00:00Z', k: 'k1' } }), 'id="wq-h-teacher"');
  put('hub: two children', hp({ play: PLAY(), kids: [KID(g), { ...KID(g), chip: '0000000000000002', animal: 'cat' }] }), 'id="wq-h-switch"');
  put('hub: no Jugnu block', hp({}), 'id="wq-h-ch"');
  // Left out until the page writes these counts in Urdu digits (each a bare Western digit in Urdu prose, hub.js):
  // a teacher quiz sent N days ago, a quiz still open with N answered, Play again's best and tries, a video's minutes
  // in Try these next.
  // the last quiz's score, alone
  const s = SCORE.exec(hp({ play: PLAY() }).html());
  if (!s) throw new Error(`${lang}:g${g}: the last quiz's score was not drawn`);
  out['hub-last-quiz-score'] = s[0];
  return out;
}
const HUB_SCREENS = ['hub home', 'hub lantern: trail one', 'hub lantern: trail many', 'hub lantern: story', 'hub lantern: numbers', 'hub lantern: day',
  'hub lantern: tomorrow', 'hub lantern: all seen', 'hub shelf', 'hub install card', 'hub: last quiz open', 'hub: teacher quiz sent today', 'hub: two children', 'hub: no Jugnu block', 'hub: Book tile', 'hub: Book tile, lights under 5', 'hub-last-quiz-score'];

describe.each([['en', 1], ['en', 3], ['en', 5], ['ur', 1], ['ur', 3], ['ur', 5]])('%s, grade %s: no hub screen shows a speed, a rank, a test word or a lock', (lang, g) => {
  let shots = null;
  beforeAll(() => { shots = collectHub(lang, g, SRCS(SEED_ON)); });
  test('every hub screen in the list was reached and drawn', () => {
    expect(Object.keys(shots).sort()).toEqual([...HUB_SCREENS].sort());
    for (const n of HUB_SCREENS) expect(visible(shots[n]).length).toBeGreaterThan(0);
  });
  test.each(HUB_SCREENS)('%s', (name) => { check(`${lang}:${name}`, shots[name], lang); });
});

/** The Book, one language: { '<screen>': html } (the page draws it from the bot's JSON; nothing is computed). */
function collectBook(lang, src) {
  const win = { scrollTo() {} };
  vmod.runInNewContext(src, { window: win, JSON, Math, String, Number, Array, Object, encodeURIComponent });
  const BK = win.WQBOOK;
  const st = STORIES[lang];
  const ctx = { token: 'tok.tok', kid: '0000000000000001', lang };
  const d = (o = {}) => ({
    name: '<Name> Testwala', trail_stickers: ['missing', 'read', 'listen', 'bigger'], story_stickers: st.map((s) => ({ passage_id: s.pid, title: s.title })),
    lamps: { reading: 0, numbers: 0 }, next_outline: { reading: true, numbers: true }, days_this_week: [true, false, true, true, false, false, false],
    class_lights: { shown: true, term_total: 41, week_n: 7 }, ...o,
  });
  const out = {};
  for (const n of [0, 1, 3, 5]) out[`book: ${n} lamps`] = BK._bookHtml(d({ lamps: { reading: n, numbers: n } }), ctx, false);
  out['book: no stickers, no days'] = BK._bookHtml(d({ trail_stickers: [], story_stickers: [], days_this_week: [false, false, false, false, false, false, false] }), ctx, false);
  out['book: every day'] = BK._bookHtml(d({ days_this_week: [true, true, true, true, true, true, true] }), ctx, false);
  out['book: lights under 5'] = BK._bookHtml(d({ class_lights: { shown: false } }), ctx, false);
  out['book: new lamp, reading'] = BK._bookHtml(d({ lamps: { reading: 3, numbers: 1 }, levelup: { ladder: 'reading', rung: 3, opens: 'longer' } }), ctx, true);
  out['book: new lamp, numbers'] = BK._bookHtml(d({ lamps: { reading: 1, numbers: 2 }, levelup: { ladder: 'numbers', rung: 2, opens: 'two_digit' } }), ctx, true);
  out['book: new lamp, hundreds'] = BK._bookHtml(d({ lamps: { reading: 1, numbers: 4 }, levelup: { ladder: 'numbers', rung: 4, opens: 'hundreds' } }), ctx, true);
  // the grown-up's line, shown
  out['book: grown-up line'] = BK._bookHtml(d({ lamps: { reading: 3, numbers: 3 } }), ctx, false).replace(' id="wq-bk-pline" hidden>', ' id="wq-bk-pline">');
  return out;
}
const BOOK_SCREENS = ['book: 0 lamps', 'book: 1 lamps', 'book: 3 lamps', 'book: 5 lamps', 'book: no stickers, no days', 'book: every day', 'book: lights under 5',
  'book: new lamp, reading', 'book: new lamp, numbers', 'book: new lamp, hundreds', 'book: grown-up line'];

describe.each(['en', 'ur'])('%s: no Book screen shows a speed, a rank, a test word or a lock', (lang) => {
  let shots = null;
  beforeAll(() => { shots = collectBook(lang, SRCS(SEED_ON).book); });
  test('every Book screen in the list was reached and drawn', () => {
    expect(Object.keys(shots).sort()).toEqual([...BOOK_SCREENS].sort());
    const lit = (h, ladder) => (h.split(`data-ladder="${ladder}"`)[1].split('</ol>')[0].match(/wq-bk-lamp"/g) || []).length;
    for (const n of [0, 1, 3, 5]) for (const ladder of ['reading', 'numbers']) expect(lit(shots[`book: ${n} lamps`], ladder)).toBe(n);
    expect(shots['book: 3 lamps']).toContain('class="wq-bk-st"');
    expect(shots['book: 3 lamps']).toContain('wq-bk-trail');
    expect(shots['book: new lamp, reading']).toContain('wq-bk-up');
  });
  test.each(BOOK_SCREENS)('%s', (name) => { check(`${lang}:${name}`, shots[name], lang); });
});

describe('the hub and Book walks read each page\'s own copy: a test word in one copy table is caught there', () => {
  const failing = (shots, lang) => Object.keys(shots).filter((n) => { try { check(`${lang}:${n}`, shots[n], lang); return false; } catch (e) { return true; } }).sort();
  test.each(['en', 'ur'])('%s: hub.js (the Jugnu tile\'s line): every hub screen with the Jugnu tile or card fails; the shipped copy passes', (lang) => {
    expect(failing(collectHub(lang, 3, SRCS(['hub'])), lang)).toEqual(HUB_SCREENS.filter((n) => n !== 'hub-last-quiz-score').sort());
    expect(failing(collectHub(lang, 3, SRCS()), lang)).toEqual([]);
  });
  test.each(['en', 'ur'])('%s: hub-play.js (the lantern, many games): only that lantern fails; the shipped copy passes', (lang) => {
    expect(failing(collectHub(lang, 3, SRCS(['play'])), lang)).toEqual(['hub lantern: trail many']);
  });
  test.each(['en', 'ur'])('%s: wq-book.js (My lamps): every Book screen fails; the shipped copy passes', (lang) => {
    expect(failing(collectBook(lang, SRCS(['book']).book), lang)).toEqual([...BOOK_SCREENS].sort());
    expect(failing(collectBook(lang, SRCS().book), lang)).toEqual([]);
  });
});
