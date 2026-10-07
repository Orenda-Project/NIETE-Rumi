/**
 * Read aloud, live (public/wq/wq-read-live.js + the live mode of wq-challenge.js): the words light up as the child
 * reads, a words-a-minute bar moves, and the result shows the moment the reading ends; the recording still goes up
 * the usual way and its checked count replaces the live one when they differ. Run whole in a vm with a fake DOM,
 * fake fetch, fake media and a fake WebSocket (Soniox) — only the browser and the network are faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LIVE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-read-live.js'), 'utf8');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-challenge.js'), 'utf8');
const TextNorm = require('../../bot/shared/services/child-test/scoring/text-norm');
const Bank = require('../../bot/shared/services/child-test/item-bank');

const EN = Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story;
const UR = Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ur.story' }).story;
const CLIPS = { intro: { text: 'Intro line', url: null }, start: { text: 'Ready? Begin.', url: null }, stop: { text: 'Stop. Thank you!', url: null }, done: { text: 'Great reading! Well done.', url: null } };
const READ = (story, live = true) => ({ ex: 'read', ct: 'CT1', secs: 60, live, clips: CLIPS, story: { text: story.text, tokens: story.tokens, lines: story.lines, dir: story === UR ? 'rtl' : 'ltr' } });
const MENU = { lang: 'en', form: 'G3', exercises: [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null }] };
const KEY = { api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt-rt.soniox.test/transcribe-websocket', model: 'stt-rt-v5', lang: 'en' };
const ok = (body) => () => ({ status: 200, body });
// Soniox tokens: each word a final token (with a leading space after the first), timed `gap` s apart.
const toks = (wordsList, { from = 0, gap = 1, final = true } = {}) => wordsList.map((w, k) => ({ text: (from + k === 0 ? '' : ' ') + w, start_ms: (from + k) * gap * 1000, end_ms: ((from + k) * gap + 0.8) * 1000, is_final: final }));

function fakeEl(id) {
  return { id, listeners: {}, className: '', textContent: '', innerHTML: '', style: {},
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    click() { (this.listeners.click || []).forEach((fn) => fn({})); } };
}

function page({ lang = 'en', menu = MENU, routes = {}, chunk = 4000, wsMode = 'ok' } = {}) {
  const els = {};
  const root = { innerHTML: '', querySelector: (sel) => { const id = sel.replace(/^#/, ''); if (!els[id]) els[id] = fakeEl(id); return els[id]; } };
  const fetches = []; const events = []; const timers = []; const recs = []; const sockets = [];
  const fetch = (url, init = {}) => {
    fetches.push({ url, init });
    if (url === '/api/wq/e') { events.push(...JSON.parse(init.body).events); return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') }); }
    let r = { status: 200, body: {} };
    for (const [rx, fn] of Object.entries(routes)) if (new RegExp(rx).test(url)) { r = fn(url, init); break; }
    return Promise.resolve({ ok: r.status < 300, status: r.status, text: () => Promise.resolve(JSON.stringify(r.body)) });
  };
  class MediaRecorder {
    constructor(stream, opts) { this.mimeType = (opts && opts.mimeType) || 'audio/webm'; this.state = 'inactive'; recs.push(this); }
    start(slice) { this.state = 'recording'; this.slice = slice; }
    tick() { this.ondataavailable({ data: { size: chunk, tag: `c${recs.length}` } }); }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: { size: chunk } }); this.onstop(); }
    static isTypeSupported(t) { return t === 'audio/webm;codecs=opus'; }
  }
  class WebSocket {
    constructor(url) { this.url = url; this.sent = []; this.bufferedAmount = 0; this.closed = false; sockets.push(this); }
    send(x) { this.sent.push(x); }
    close() { this.closed = true; }
    // test hooks
    open() { this.onopen && this.onopen({}); }
    msg(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
    drop(code = 1006) { this.onclose && this.onclose({ code }); }
  }
  const navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile WhatsApp', mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop() {} }] }) } };
  class Audio { constructor() { this.l = {}; } addEventListener(n, fn) { this.l[n] = fn; } play() { return Promise.resolve(); } pause() {} }
  const boot = { textContent: JSON.stringify({ token: 'HUB.TOKEN', kid: null, menu: { ...menu, lang }, mascot: lang === 'ur' ? 'جگنو' : 'Jugnu' }) };
  const wl = {};
  const window = { MediaRecorder, WebSocket: wsMode === 'none' ? undefined : WebSocket, scrollTo() {}, addEventListener(n, fn) { (wl[n] = wl[n] || []).push(fn); } };
  const ctx = {
    window, navigator, fetch, Audio, console, WebSocket: window.WebSocket, MediaRecorder,
    Blob: function Blob(parts, o) { this.size = parts.reduce((a, p) => a + (p.size || 0), 0); this.type = o && o.type; },
    location: { href: 'https://portal.test/c/HUB.TOKEN', host: 'portal.test', pathname: '/c/HUB.TOKEN', search: '' },
    document: { getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? boot : null), createElement: () => ({}), head: { appendChild() {} }, visibilityState: 'visible', addEventListener() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    Date, JSON, Math, String, Number, Promise, Error, RegExp, Object, Array, encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(LIVE_SRC, ctx);
  vm.runInContext(SRC, ctx);
  const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };
  const runTimers = async (pred = () => true) => { const due = timers.splice(0).filter((x) => { if (pred(x)) return true; timers.push(x); return false; }); due.forEach((x) => x.fn()); await flush(); };
  return {
    window, w: window.__wqc, L: window.WQLive, root, els, fetches, events, recs, sockets, flush, runTimers, timers,
    html: () => root.innerHTML.replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
    screen: () => (/data-screen="([^"]+)"/.exec(root.innerHTML) || [])[1],
    story: () => (els['wqc-live-story'] || {}).innerHTML || '',
    click: async (id) => { els[id].click(); await flush(); },
  };
}

// ── the engine ────────────────────────────────────────────────────────────────────────────────────
describe('the aligner is the scorer\'s own (text-norm.js), ported 1:1', () => {
  test('clean() and same() agree on every word of the four passages and on look-alike pairs', () => {
    const p = page();
    const all = [EN, UR, Bank.getTaskSpec({ grade: 5, set: 'A', task: 'en.story' }).story, Bank.getTaskSpec({ grade: 5, set: 'A', task: 'ur.story' }).story].flatMap((s) => s.tokens);
    all.forEach((w) => expect(p.L.clean(w)).toBe(TextNorm.clean(w)));
    const pairs = [['school', 'schol'], ['plant', 'plants'], ['the', 'tha'], ['بلال', 'بلا'], ['والد', 'والدہ'], ['ساتھ', 'ساتہ'], ['آج', 'اج'], ['early', 'yearly']];
    pairs.forEach(([a, b]) => expect(p.L.same(p.L.clean(a), p.L.clean(b))).toBe(TextNorm.same(TextNorm.clean(a), TextNorm.clean(b))));
  });

  test('align() gives the same status, matches and insertions as text-norm.align on readings with skips, swaps and extra words', () => {
    const p = page();
    for (const st of [EN, UR]) {
      const ref = TextNorm.refWords(st.tokens);
      const variants = [
        ref.slice(0, 30),
        ref.filter((_, k) => k % 7 !== 3),
        ref.map((w, k) => (k % 9 === 4 ? `${w}x` : w)),
        ref.flatMap((w, k) => (k % 11 === 5 ? [w, w] : [w])),
        [],
      ];
      for (const hyp of variants) {
        const a = p.L.align(ref, hyp); const b = TextNorm.align(ref, hyp);
        expect({ status: [...a.status], hypIdx: [...a.hypIdx], ins: a.ins }).toEqual(b);
      }
    }
  });

  test('a child reads a PREFIX: a repeated word is matched where the child is, never further on', () => {
    const p = page();
    const ref = ['a', 'b', 'the', 'c', 'd', 'the'];
    const r = p.L.alignPrefix(ref, ['a', 'b', 'the']);
    expect([...r.status]).toEqual(['correct', 'correct', 'correct', 'omit', 'omit', 'omit']);
  });
});

describe('tracker: what each passage word shows', () => {
  const words = ['Imran', 'woke', 'up', 'early', 'for', 'school.'];
  test('final ⇒ ok, not final ⇒ okp, passed over ⇒ miss (never "wrong"), not reached ⇒ none', () => {
    const p = page();
    const t = p.L.tracker(words);
    let v = t.push([...toks(['Imran', 'woke'], {}), ...toks(['up'], { from: 2, final: false })]);
    expect([...v.marks]).toEqual(['ok', 'ok', 'okp', 'none', 'none', 'none']);
    // the non-final "up" was not confirmed (it disappears); the child went on: "up" is passed over
    v = t.push(toks(['early', 'for'], { from: 2 }));
    expect([...v.marks]).toEqual(['ok', 'ok', 'miss', 'ok', 'ok', 'none']);
    expect(v.correct).toBe(4);
    expect(v.attempted).toBe(5);
    expect(v.finished).toBe(false);
  });

  test('a word split over a final and a non-final piece is not final yet; when its last piece is final the reading is finished, with its time', () => {
    const p = page();
    const t = p.L.tracker(words);
    t.push(toks(['Imran', 'woke', 'up', 'early', 'for'], {}));
    let v = t.push([{ text: ' sch', start_ms: 5000, end_ms: 5300, is_final: true }, { text: 'ool', start_ms: 5300, end_ms: 5600, is_final: false }]);
    expect(v.marks[5]).toBe('okp');
    expect(v.finished).toBe(false);
    v = t.push([{ text: 'ool.', start_ms: 5300, end_ms: 5700, is_final: true }, { text: '<fin>', is_final: true }]);
    expect(v.marks[5]).toBe('ok');
    expect(v.finished).toBe(true);
    expect(v.endMs).toBe(5700);
    expect(v.correct).toBe(6);
  });
});

// ── the page ──────────────────────────────────────────────────────────────────────────────────────
const go = async (p) => { await p.click('wqc-ex-read'); await p.click('wqc-go'); };
const routesFor = (story, extra = {}) => ({
  'ch/HUB.TOKEN/read': ok(READ(story)),
  'ch/live': ok(KEY),
  'ch/upload': ok({ put_url: 'https://r2.test/put/abc', key: 'child-voice/sandbox/r/read-1.webm', content_type: 'audio/webm' }),
  'r2.test/put': () => ({ status: 200, body: {} }),
  ...extra,
});

describe('live off: today\'s path is untouched', () => {
  test('no key is asked for, no socket opens, the recorder keeps its 1-s slices', async () => {
    const p = page({ routes: { ...routesFor(EN), 'ch/HUB.TOKEN/read': ok(READ(EN, false)) } });
    await go(p);
    expect(p.fetches.some((f) => f.url === '/api/wq/ch/live')).toBe(false);
    expect(p.sockets).toHaveLength(0);
    expect(p.recs[0].slice).toBe(1000);
    expect(p.screen()).toBe('read-rec');
  });
});

describe('live on', () => {
  test('asks the bot for a key, opens Soniox with the key in the FIRST MESSAGE (never in the URL), streams 250-ms chunks', async () => {
    const p = page({ routes: routesFor(EN) });
    await go(p);
    expect(JSON.parse(p.fetches.find((f) => f.url === '/api/wq/ch/live').init.body)).toEqual({ ct: 'CT1', lang: 'en' });
    const s = p.sockets[0];
    expect(s.url).toBe(KEY.ws);
    expect(s.url).not.toContain('temp:');
    expect(p.recs[0].slice).toBe(250);
    expect(p.screen()).toBe('read-live');
    p.recs[0].tick();            // a chunk before the socket opened is queued, not lost (it carries the webm header)
    s.open();
    expect(JSON.parse(s.sent[0])).toEqual({ api_key: 'temp:key-test-only', model: 'stt-rt-v5', audio_format: 'auto', language_hints: ['en'], language_hints_strict: true });
    expect(s.sent[1]).toMatchObject({ size: 4000 });
    p.recs[0].tick();
    expect(s.sent).toHaveLength(3);
  });

  test('the words light up as tokens arrive and the words-a-minute bar moves', async () => {
    const p = page({ routes: routesFor(EN) });
    await go(p);
    const s = p.sockets[0]; s.open();
    s.msg({ tokens: toks(EN.tokens.slice(0, 10), { gap: 1 }) });
    const html = p.story();
    expect((html.match(/wqc-w wqc-ok/g) || [])).toHaveLength(10);
    expect(html).toContain('Imran');
    expect(html).not.toMatch(/wqc-(wrong|bad|red)/);
    // 10 words right by 9.8 s of audio ⇒ 61 a minute
    expect(p.els['wqc-wpm-n'].textContent).toBe('61');
    expect(p.els['wqc-wpm-bar'].style.width).toMatch(/%$/);
    // a skipped word is "not caught", soft
    s.msg({ tokens: toks(EN.tokens.slice(11, 14), { from: 11, gap: 1 }) });
    expect(p.story()).toContain('wqc-w wqc-miss');
  });

  test('the bar counts words heard before Soniox confirms them (final words trail the voice by seconds); the passage keeps its punctuation', async () => {
    const p = page({ routes: routesFor(EN) });
    await go(p);
    const s = p.sockets[0]; s.open();
    // 6 final + 6 not yet final, by 11.8 s of audio ⇒ 12 heard ⇒ 61 a minute on the bar
    s.msg({ tokens: [...toks(EN.tokens.slice(0, 6), { gap: 1 }), ...toks(EN.tokens.slice(6, 12), { from: 6, gap: 1, final: false })] });
    expect(p.els['wqc-wpm-n'].textContent).toBe('61');
    expect(p.story()).toContain('school.</span>');
  });

  test('the last word heard (even before it is final) ends the reading: finalize is sent at once', async () => {
    const p = page({ routes: routesFor(EN, { 'ch/result$': () => ({ status: 200, body: { pending: true } }) }) });
    await go(p);
    const s = p.sockets[0]; s.open();
    s.msg({ tokens: [...toks(EN.tokens.slice(0, 50), { gap: 0.5 }), ...toks(EN.tokens.slice(50), { from: 50, gap: 0.5, final: false })] });
    expect(s.sent).toContain('{"type":"finalize"}');
    expect(p.recs[0].state).toBe('inactive');
  });

  test('the result keeps "More challenges" on screen however long the story is', async () => {
    const p = page({ routes: routesFor(EN, { 'ch/result$': () => ({ status: 200, body: { pending: true } }) }) });
    await go(p);
    const s = p.sockets[0]; s.open();
    s.msg({ tokens: toks(EN.tokens, { gap: 0.5 }) });
    s.msg({ tokens: [], finished: true });
    await p.flush();
    expect(p.html()).toMatch(/<div class="wqc-sticky"><button class="wq-btn wq-go" id="wqc-menu"/);
  });

  test('the reading ends at the last word: the result is on screen AT ONCE from the live count; the recording still goes up with the live numbers', async () => {
    let resolveResult;
    const held = new Promise((r) => { resolveResult = r; });
    const p = page({ routes: routesFor(EN, { 'ch/result$': () => ({ status: 200, body: { pending: true } }) }) });
    await go(p);
    const s = p.sockets[0]; s.open();
    s.msg({ tokens: toks(EN.tokens, { gap: 0.5 }) });   // the whole passage, 60 words in ~30 s
    s.msg({ tokens: [], finished: true });
    await p.flush();
    expect(p.screen()).toBe('read-result');
    expect(p.html()).toMatch(/You read \d+ words in a minute!/);
    expect(s.sent).toContain('{"type":"finalize"}');
    expect(s.sent).toContain('');
    const res = p.fetches.find((f) => f.url === '/api/wq/ch/result');
    expect(res).toBeTruthy();
    const body = JSON.parse(res.init.body);
    expect(body).toMatchObject({ ct: 'CT1', key: 'child-voice/sandbox/r/read-1.webm' });
    expect(body.live).toEqual({ correct: 60, attempted: 60, secs: 30 });
    expect(p.recs[0].state).toBe('inactive');
    void held; void resolveResult;
  });

  test('the checked count replaces the live one when they differ by 3 or more, and the growth line uses the checked count', async () => {
    const p = page({ routes: routesFor(EN, { 'ch/result$': ok({ score: { correct: 52, attempted: 58, stopped: false }, wcpm: 52, previous: { wcpm: 40 } }) }) });
    await go(p);
    const s = p.sockets[0]; s.open();
    s.msg({ tokens: toks(EN.tokens.slice(0, 45), { gap: 1.3 }) });
    await p.click('wqc-stop');
    s.msg({ tokens: [], finished: true });
    await p.flush();
    expect(p.screen()).toBe('read-result');
    expect(p.els['wqc-score'].textContent).toBe('Jugnu listened again: 52 words a minute!');
    expect(p.els['wqc-growth'].textContent).toBe('12 more words than last time!');
  });

  test('a checked "nothing heard" replaces the praise with "try again"', async () => {
    const p = page({ routes: routesFor(EN, { 'ch/result$': ok({ failed: true, reason: 'unheard' }) }) });
    await go(p);
    const s = p.sockets[0]; s.open();
    s.msg({ tokens: toks(EN.tokens.slice(0, 5)) });
    await p.click('wqc-stop');
    s.msg({ tokens: [], finished: true });
    await p.flush();
    expect(p.html()).toContain("We couldn't hear that clearly. Try again?");
  });

  test('the key cannot be had (Soniox down, 502) ⇒ today\'s path, and the page says so in an event', async () => {
    const p = page({ routes: routesFor(EN, { 'ch/live': () => ({ status: 502, body: { error: 'live_unavailable' } }), 'ch/result$': ok({ score: { correct: 30, stopped: false }, wcpm: 30 }) }) });
    await go(p);
    expect(p.sockets).toHaveLength(0);
    expect(p.screen()).toBe('read-rec');
    expect(p.recs[0].slice).toBe(1000);
    expect(p.events).toContainEqual(expect.objectContaining({ n: 'ch_live', ok: false, err: 'key_502' }));
    await p.click('wqc-stop');
    expect(p.html()).toContain('You read 30 words in a minute!');
  });

  test('the socket drops mid-reading ⇒ the reading goes on, and at the end the usual upload scores it (the wait screens)', async () => {
    const p = page({ routes: routesFor(EN, { 'ch/result$': ok({ score: { correct: 33, stopped: false }, wcpm: 33 }) }) });
    await go(p);
    const s = p.sockets[0]; s.open();
    s.msg({ tokens: toks(EN.tokens.slice(0, 5)) });
    s.drop(1006);
    expect(p.events).toContainEqual(expect.objectContaining({ n: 'ch_live', ok: false, err: 'closed_1006' }));
    expect(p.recs[0].state).toBe('recording');
    await p.click('wqc-stop');
    await p.flush();
    expect(p.html()).toContain('You read 33 words in a minute!');
    const body = JSON.parse(p.fetches.find((f) => f.url === '/api/wq/ch/result').init.body);
    expect(body.live).toBeUndefined();
  });

  test('Soniox refuses the stream (an error message, e.g. the 10-stream limit) ⇒ today\'s path', async () => {
    const p = page({ routes: routesFor(EN) });
    await go(p);
    const s = p.sockets[0]; s.open();
    s.msg({ error_code: 429, error_message: 'too many' });
    expect(p.events).toContainEqual(expect.objectContaining({ n: 'ch_live', ok: false, err: 'soniox_429' }));
  });

  test('Urdu: right to left, the bar in Urdu digits, the copy in Urdu; no test/exam words anywhere', async () => {
    const p = page({ lang: 'ur', menu: { ...MENU, lang: 'ur' }, routes: { ...routesFor(UR), 'ch/HUB.TOKEN/read': ok({ ...READ(UR), lang: 'ur' }), 'ch/live': ok({ ...KEY, lang: 'ur' }) } });
    await go(p);
    const s = p.sockets[0]; s.open();
    expect(JSON.parse(s.sent[0]).language_hints).toEqual(['ur']);
    s.msg({ tokens: toks(UR.tokens.slice(0, 12), { gap: 1 }) });
    expect(p.html()).toContain('dir="rtl"');
    expect(p.html()).toContain('ایک منٹ میں');
    expect(p.els['wqc-wpm-n'].textContent).toMatch(/^[۰-۹]+$/);
    const FORBID = /\b(test|tests|testing|egra|egma|assessment|exam)\b|ٹیسٹ|امتحان|جائزہ|اسیسمنٹ/i;
    expect(p.html() + p.story()).not.toMatch(FORBID);
  });
});

describe('the challenge shell loads the live module before the page (an HTTP render of /c/:token)', () => {
  const http = require('http');
  const express = require('express');
  const { createWebQuizRouter } = require('../routes/web-quiz.routes');
  const TOKEN = `${'a'.repeat(40)}.${'b'.repeat(22)}`;
  test('wq-read-live.js is served versioned, before wq-challenge.js; the page sends no CSP that would block the Soniox socket', async () => {
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(MENU) }) }));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      const res = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: srv.address().port, path: `/c/${TOKEN}?lang=en` }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: b })); }).on('error', reject);
      });
      expect(res.status).toBe(200);
      const live = /<script src="\/wq\/wq-read-live\.js\?v=[0-9a-f]{10}" defer><\/script>/.exec(res.body);
      const page = /<script src="\/wq\/wq-challenge\.js\?v=[0-9a-f]{10}" defer><\/script>/.exec(res.body);
      expect(live).toBeTruthy();
      expect(live.index).toBeLessThan(page.index);
      const csp = res.headers['content-security-policy'];
      if (csp) expect(csp).toMatch(/connect-src[^;]*wss:\/\/stt-rt\.soniox\.com/);
    } finally { srv.close(); }
  });
});
