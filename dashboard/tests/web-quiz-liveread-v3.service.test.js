/**
 * Live reading v3 (public/wq/wq-liveread.js, and the Challenge page under the read payload's `lr3`; app_settings
 * web_quiz_live_read_v3 on the bot). The reading finishes itself and the result shows at once:
 *   - the matcher folds case, punctuation, Urdu letter forms and numerals (digits, Urdu digits, number words) on both
 *     sides; a skipped word is "skipped" (never wrong), a repeated word costs nothing
 *   - finish rules: the last word heard + a 1-s tail; or ≥ 80 % heard then 4 s quiet (never on a counted
 *     read); Done always on a practice read, on a counted read only past 80 %; a counted read shows no skip marks;
 *     Jugnu glows brighter per word lit (never per second, never a number); the row learns live_ui_v and the ending
 *   - Story Time keeps the live words (only the meter was ever to go), the Done button shows under the read guard,
 *     a quiet end finishes the reading, the result is handed off as `wq:liveread:result`, and a reading that could not
 *     go live waits at most 10 s for its check before the card
 *   - no `lr3` on the payload: today's page, unchanged (the existing suites are the golden)
 * Only the browser and the network are faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./wqc-page-harness');
const { ok, CLIPS, STORY, COPY } = H;

const PUB = path.join(__dirname, '..', 'public', 'wq');
const LIVE_SRC = fs.readFileSync(path.join(PUB, 'wq-read-live.js'), 'utf8');
const TRAIL_SRC = fs.readFileSync(path.join(PUB, 'wq-trail.js'), 'utf8');
const LR_PATH = path.join(PUB, 'wq-liveread.js');
const LR_SRC = fs.existsSync(LR_PATH) ? fs.readFileSync(LR_PATH, 'utf8') : '';

// the component alone, on a bare window
function lib() {
  const window = {};
  const ctx = { window, console, Date, Math, JSON, String, Number, Object, Array, RegExp, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(LIVE_SRC, ctx);
  vm.runInContext(LR_SRC, ctx);
  return window.WQLiveRead;
}
const toks = (ws, { from = 0, gap = 1, final = true } = {}) => ws.map((w, k) => ({ text: (from + k === 0 ? '' : ' ') + w, start_ms: (from + k) * gap * 1000, end_ms: ((from + k) * gap + 0.8) * 1000, is_final: final }));

describe('the matcher: transcript tokens → passage words', () => {
  test('case and punctuation fold; a read word is "read", the next one "current", the rest "ahead"', () => {
    const m = lib().matcher(['Imran', 'woke', 'up', 'early', 'for', 'school.'], 'en');
    const v = m.push(toks(['imran', 'WOKE,', 'up']));
    expect([...v.states]).toEqual(['read', 'read', 'read', 'current', 'ahead', 'ahead']);
    expect(v.read).toBe(3);
    expect(v.total).toBe(6);
  });

  test('a skipped word is "skipped" (never wrong); a repeated word costs nothing', () => {
    const m = lib().matcher(['The', 'cat', 'sat', 'on', 'the', 'mat'], 'en');
    const v = m.push(toks(['the', 'cat', 'cat', 'on', 'the']));
    expect([...v.states]).toEqual(['read', 'read', 'skipped', 'read', 'read', 'current']);
    expect(v.skipped).toBe(1);
    expect(v.read).toBe(4);
  });

  test('not final yet ⇒ "heard" (lit for the eye, not counted as read)', () => {
    const m = lib().matcher(['one', 'small', 'kite'], 'en');
    const v = m.push([...toks(['one']), ...toks(['small'], { from: 1, final: false })]);
    expect([...v.states]).toEqual(['read', 'heard', 'current']);
    expect(v.read).toBe(1);
    expect(v.heard).toBe(2);
  });

  test('numerals: "3", "three", "۳" and "تین" all match the passage\'s number, both languages', () => {
    const L = lib();
    expect([...L.matcher(['I', 'have', '3', 'kites'], 'en').push(toks(['I', 'have', 'three', 'kites'])).states]).toEqual(['read', 'read', 'read', 'read']);
    expect([...L.matcher(['I', 'have', 'three', 'kites'], 'en').push(toks(['I', 'have', '3', 'kites'])).states]).toEqual(['read', 'read', 'read', 'read']);
    expect([...L.matcher(['میرے', 'پاس', '۳', 'پتنگیں'], 'ur').push(toks(['میرے', 'پاس', 'تین', 'پتنگیں'])).states]).toEqual(['read', 'read', 'read', 'read']);
    expect([...L.matcher(['میرے', 'پاس', 'تین', 'پتنگیں'], 'ur').push(toks(['میرے', 'پاس', '3', 'پتنگیں'])).states]).toEqual(['read', 'read', 'read', 'read']);
  });

  test('Urdu letter forms fold (ي/ی، ك/ک، ہ/ھ/ة) and diacritics drop', () => {
    const m = lib().matcher(['کتاب', 'یہ', 'بچہ', 'ساتھ'], 'ur');
    const v = m.push(toks(['كتاب', 'يه', 'بچة', 'ساتہ']));
    expect([...v.states]).toEqual(['read', 'read', 'read', 'read']);
    expect(v.lastHeard).toBe(true);
  });

  test('end(): what was not yet final becomes read; the result counts', () => {
    const m = lib().matcher(['one', 'small', 'kite'], 'en');
    m.push([...toks(['one', 'small']), ...toks(['kite'], { from: 2, final: false })]);
    const v = m.end();
    expect([...v.states]).toEqual(['read', 'read', 'read']);
    expect(v.read).toBe(3);
  });
});

describe('the finish rules', () => {
  const F = { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet: true };
  test('the last word heard ⇒ last_word after its 1-s tail', () => {
    expect(lib().shouldFinish({ heard: 10, total: 10, lastHeard: true }, 1999, 1000, F)).toBeNull();
    expect(lib().shouldFinish({ heard: 10, total: 10, lastHeard: true }, 2000, 1000, F)).toBe('last_word');
  });
  test('the defaults: 4 s quiet, 1 s tail', () => {
    expect(lib().shouldFinish({ heard: 8, total: 10, lastHeard: false }, 13999, 10000, {})).toBeNull();
    expect(lib().shouldFinish({ heard: 8, total: 10, lastHeard: false }, 14000, 10000, {})).toBe('quiet');
    expect(lib().shouldFinish({ heard: 10, total: 10, lastHeard: true }, 10999, 10000, {})).toBeNull();
  });
  test('≥ 80 % heard and 4 s quiet ⇒ quiet; under 80 %, or not quiet long enough ⇒ keep reading', () => {
    const L = lib();
    expect(L.shouldFinish({ heard: 8, total: 10, lastHeard: false }, 14000, 10000, F)).toBe('quiet');
    expect(L.shouldFinish({ heard: 8, total: 10, lastHeard: false }, 13999, 10000, F)).toBeNull();
    expect(L.shouldFinish({ heard: 7, total: 10, lastHeard: false }, 30000, 10000, F)).toBeNull();
  });
  test('a counted read (quiet:false) never ends on the quiet rule; the last word still ends it', () => {
    const L = lib();
    expect(L.shouldFinish({ heard: 9, total: 10, lastHeard: false }, 60000, 10000, { ...F, quiet: false })).toBeNull();
    expect(L.shouldFinish({ heard: 10, total: 10, lastHeard: true }, 1001, 1, { ...F, quiet: false })).toBe('last_word');
  });
  test('nothing heard is never a finish', () => {
    expect(lib().shouldFinish({ heard: 0, total: 0, lastHeard: false }, 99999, 0, F)).toBeNull();
  });
});

// ── the Challenge page under lr3 ──────────────────────────────────────────────────────────────────
const TC = { title: "{name}'s Trail", sub: '{done} of {total} stops done.', allDone: 'All done', badge: 'Done', next: 'Next', mic: 'uses the microphone', needsMic: 'needs a microphone', micWait: 'wait', other: 'Go to another stop', back: 'Back to the trail', practice: 'Practice round.', stopDone: 'Stop done!' };
const EXS = [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null, badge: false, mic: true }];
const V2 = { pool: true, story: true, consent: false };
const MENU = { lang: 'en', form: 'G3', record: true, trail: true, trail_copy: TC, exercises: EXS, v2: V2, lr3: true };
const ROOM = 'https://portal.test/c/HUB.TOKEN?kid=&lang=en&room=story&pid=en.read.1.kite';
const KEY = { api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt.test/ws', model: 'stt-rt-v5', lang: 'en' };
const LR3 = (quiet = true) => ({ meter: 'glow', done: true, done_from: quiet ? 0 : 0.8, counted: !quiet, finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet } });
const SREAD = (extra = {}) => ({ ex: 'read', ct: 'CTS', secs: 60, clips: CLIPS, story: STORY, story_clip: { url: '/clips/story-kite.mp3' }, trail: true, trail_copy: TC, v2: V2, practice_round: true, mode: 'practice', questions_on: false, live: true, ...extra });
// a fake Soniox socket and the window's event bus, on the page's own window
const WS = 'var __socks = []; window.WebSocket = function (u) { this.url = u; this.sent = []; this.bufferedAmount = 0; __socks.push(this); };'
  + 'window.WebSocket.prototype.send = function (x) { this.sent.push(x); }; window.WebSocket.prototype.close = function () { this.closed = true; };'
  + 'var __evs = []; window.dispatchEvent = function (e) { __evs.push(e); return true; }; CustomEvent = function (n, o) { this.type = n; this.detail = o && o.detail; };';
const ROUTES = (read, extra = {}) => ({ 'ch/HUB.TOKEN/read': ok(read), 'ch/live': ok(KEY), 'ch/upload': ok({ put_url: 'https://store.test/put', content_type: 'audio/webm', key: 'k1' }), 'store.test': ok({}), ...extra });
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const room = (o = {}) => H.page({ menu: MENU, href: ROOM, freshEls: true, session: store(), ...o, pre: [LIVE_SRC, WS, ...(o.pre || []), LR_SRC, TRAIL_SRC] });
const startRead = async (p) => { await p.flush(); await p.click('wqc-story-read'); await p.flush(); };
const sock = (p) => p.ctx.__socks[0];

describe('Story Time under lr3: the words light, the reading finishes itself, the card at once', () => {
  test('the story read stays live: a key is asked for and the words light up (today: forced off, a 60-s recording)', async () => {
    const p = room({ routes: ROUTES(SREAD({ lr3: LR3() })) });
    await startRead(p);
    expect(p.fetches.some((f) => f.url === '/api/wq/ch/live')).toBe(true);
    expect(p.screen()).toBe('read-live');
    const s = sock(p); s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 3)) }) });
    expect(((p.els['wqc-live-story'] || {}).innerHTML.match(/wqc-ok/g) || []).length).toBe(3);
    // no speed meter, no number on the story screen
    expect(p.html()).not.toContain('wqc-wpm');
  });

  test('the last word heard ends the reading and the story card shows; the result is handed off as wq:liveread:result', async () => {
    const clock = { t: 1000000 };
    const p = room({ clock, routes: ROUTES(SREAD({ lr3: LR3() })) });
    await startRead(p);
    const s = sock(p); s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens) }) });
    await p.flush();
    expect(p.screen()).toBe('read-live');   // the 1-s tail: the child's last word is not cut off
    expect(s.sent).not.toContain('{"type":"finalize"}');
    clock.t += 1100;
    await p.runTimers((x) => x.ms === 1000);
    s.onmessage({ data: JSON.stringify({ tokens: [], finished: true }) });
    await p.flush();
    expect(p.screen()).toBe('read-result');
    const ev = p.ctx.__evs.find((e) => e.type === 'wq:liveread:result');
    expect(ev).toBeTruthy();
    expect(ev.detail).toMatchObject({ v: 1, source: 'passage', words_total: 10, words_read: 10, ended: 'last_word', counted: false, live: true, wpm: null });
    expect(ev.detail).not.toHaveProperty('transcript_final');
  });

  test('8 of 10 words then 4 s of quiet ends the reading (quiet) — no 60-s wait', async () => {
    const clock = { t: 1000000 };
    const p = room({ clock, routes: ROUTES(SREAD({ lr3: LR3() })) });
    await startRead(p);
    const s = sock(p); s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 8)) }) });
    clock.t += 4100;
    await p.runTimers((x) => x.ms === 4000);
    s.onmessage({ data: JSON.stringify({ tokens: [], finished: true }) });
    await p.flush();
    expect(p.screen()).toBe('read-result');
    expect(p.ctx.__evs.find((e) => e.type === 'wq:liveread:result').detail.ended).toBe('quiet');
  });

  test('a counted read (quiet:false) does not end on the quiet rule', async () => {
    const clock = { t: 1000000 };
    const p = room({ clock, routes: ROUTES(SREAD({ lr3: LR3(false) })) });
    await startRead(p);
    const s = sock(p); s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 9)) }) });
    clock.t += 9000;
    await p.runTimers((x) => x.ms === 4000);
    expect(p.screen()).toBe('read-live');
  });
});

describe('the read guard under lr3: Done is always there', () => {
  const GUARD_READ = { ex: 'read', ct: 'CT1', secs: 60, clips: CLIPS, story: STORY, record: true, guard: true, copy: COPY };
  test('a guarded practice read with lr3 shows the Done button from the first second (today: none until "too hard")', async () => {
    const p = H.page({ menu: { ...H.MENU, lr3: true }, pre: [LIVE_SRC, LR_SRC], routes: { 'ch/HUB.TOKEN/read': ok({ ...GUARD_READ, lr3: LR3(true) }) }, micLevel: 200 });
    await p.click('wqc-ex-read'); await p.click('wqc-go');
    await p.runTimers((x) => x.ms === 3000);   // the local mic check passes
    await p.flush();
    expect(['read-rec', 'read-live']).toContain(p.screen());
    expect(p.has('wqc-stop')).toBe(true);
  });
  test('without lr3 the guarded read is today\'s: no Done button', async () => {
    const p = H.page({ pre: [LIVE_SRC], routes: { 'ch/HUB.TOKEN/read': ok(GUARD_READ) }, micLevel: 200 });
    await p.click('wqc-ex-read'); await p.click('wqc-go');
    await p.runTimers((x) => x.ms === 3000);
    await p.flush();
    expect(p.has('wqc-stop')).toBe(false);
  });
});

describe('a counted read under lr3 (Done only past 80 %, a quiet Stop, no skip marks)', () => {
  const GUARD_READ = { ex: 'read', ct: 'CT1', secs: 60, clips: CLIPS, story: STORY, record: true, guard: true, copy: COPY, live: true };
  const WSP = WS;
  const counted = async (clock = { t: 1000000 }) => {
    const p = H.page({ clock, menu: { ...H.MENU, lr3: true }, pre: [LIVE_SRC, WSP, LR_SRC], routes: { 'ch/HUB.TOKEN/read': ok({ ...GUARD_READ, lr3: LR3(false) }), 'ch/live': ok(KEY) }, micLevel: 200 });
    await p.click('wqc-ex-read'); await p.click('wqc-go');
    await p.runTimers((x) => x.ms === 3000);
    await p.flush();
    const s = p.ctx.__socks[0]; s.onopen({});
    return { p, s };
  };
  test('"I\'m done ✓" only once 80 % of the words are lit; before that no Done (an early Done loses the reading)', async () => {
    const { p, s } = await counted();
    expect(p.screen()).toBe('read-live');
    expect(p.has('wqc-stop')).toBe(false);
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 7)) }) });
    await p.flush();
    expect(p.has('wqc-stop')).toBe(false);
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(7, 8), { from: 7 }) }) });
    await p.flush();
    expect(p.has('wqc-stop')).toBe(true);
  });
  test('past 80 % and 4 s quiet the counted read does NOT end — the Done button pulses once instead', async () => {
    const clock = { t: 1000000 };
    const { p, s } = await counted(clock);
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 9)) }) });
    await p.flush();
    clock.t += 4100;
    await p.runTimers((x) => x.ms === 4000);
    expect(p.screen()).toBe('read-live');
    expect(p.els['wqc-stop'].className).toContain('lr-pulse');
  });
  test('a quiet "Stop for now" is there from the first second (an honest way out: stored like today\'s "too hard")', async () => {
    const { p, s } = await counted();
    expect(p.has('wqc-stuck')).toBe(true);
    expect(p.html()).toContain('Stop for now');
    expect(p.html()).not.toContain('The rest is too hard');
    await p.click('wqc-stuck');
    expect(s.sent).toContain('{"type":"finalize"}');   // the reading stopped
    s.onmessage({ data: JSON.stringify({ tokens: [], finished: true }) });
    await p.flush(); await p.flush();
    const body = JSON.parse((p.fetches.find((f) => f.url === '/api/wq/ch/result') || { init: { body: '{}' } }).init.body);
    expect(body.ended).toBe('stuck');
  });
  test('no skip marks on a counted read: a word passed over stays plain', async () => {
    const { p, s } = await counted();
    s.onmessage({ data: JSON.stringify({ tokens: toks(['Imran', 'up', 'early']) }) });
    await p.flush();
    const h = (p.els['wqc-live-story'] || {}).innerHTML || p.html();
    expect(h).not.toContain('wqc-miss');
    expect((h.match(/wqc-ok/g) || []).length).toBe(3);
  });
  test('the result call tells the row this was a v3 reading', async () => {
    const clock = { t: 1000000 };
    const { p, s } = await counted(clock);
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens) }) });
    clock.t += 1100;
    await p.runTimers((x) => x.ms === 1000);
    s.onmessage({ data: JSON.stringify({ tokens: [], finished: true }) });
    await p.flush(); await p.flush();
    const body = JSON.parse((p.fetches.find((f) => f.url === '/api/wq/ch/result') || { init: { body: '{}' } }).init.body);
    expect(body).toMatchObject({ live_ui_v: 3, ended: 'last_word' });
  });
});

describe('Jugnu glows brighter per word lit (never per second, never a number)', () => {
  test('the glow level follows the share of words lit', async () => {
    const p = room({ routes: ROUTES(SREAD({ lr3: LR3() })) });
    await startRead(p);
    const s = sock(p); s.onopen({});
    expect(p.html()).toContain('id="wqc-lr-glow"');
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 5)) }) });
    expect(p.els['wqc-lr-glow'].className).toBe('lr-glow lr-glow-3');   // 5 of 10 lit
    expect(p.html()).not.toMatch(/wqc-wpm|words a minute/);
  });
});

describe('real-time not available: an honest "checking…" for at most 10 s', () => {
  test('no socket: Done → the recording goes up; the check has not answered in 10 s ⇒ the card, not a 60-s poll', async () => {
    const NOWS = 'window.WebSocket = undefined;';
    const p = room({ pre: [NOWS], routes: ROUTES(SREAD({ live: true, lr3: LR3() }), { 'ch/result': ok({ pending: true }) }) });
    await startRead(p);
    expect(p.screen()).toBe('read-rec');
    expect(p.has('wqc-stop')).toBe(true);
    await p.click('wqc-stop');
    await p.flush();
    expect(['read-send', 'read-wait']).toContain(p.screen());
    await p.runTimers((x) => x.ms === 10000);
    expect(p.screen()).toBe('read-result');
  });
});

describe('the page loads the component only when the bot says lr3', () => {
  const { renderChallengePage } = require('../routes/web-quiz.routes');
  const page = (menu) => renderChallengePage({ menu: { lang: 'en', exercises: [], ...menu }, token: 't', kid: null, origin: 'https://x', assetV: 'v1', chV: 'c', brandKey: 'niete' });
  test('lr3 on the menu ⇒ the stylesheet and the script, after wq-read-live.js and before wq-challenge.js', () => {
    const h = page({ lr3: true });
    expect(h).toMatch(/wq-read-live\.js[^]*wq-liveread\.css[^]*wq-liveread\.js[^]*wq-challenge\.js/);
  });
  test('no lr3 ⇒ today\'s page, byte for byte', () => {
    expect(page({ lr3: undefined })).toBe(page({}));
    expect(page({})).not.toContain('wq-liveread');
  });
});

describe('mount(): a story page reads itself (the component alone, a fake DOM and socket)', () => {
  function dom() {
    const made = [];
    function El(sel) { this.sel = sel; this.className = ''; this.style = {}; this.l = {}; this.innerHTML = ''; }
    El.prototype.addEventListener = function (n, fn) { this.l[n] = fn; };
    const el = new El('root');
    const kids = {};
    el.querySelector = (sel) => { if (!kids[sel]) kids[sel] = new El(sel); return kids[sel]; };
    el.querySelectorAll = (sel) => { const n = (el.innerHTML.match(/class="lr-w[^"]*"/g) || []).length; if (!kids[sel] || kids[sel].length !== n) kids[sel] = Array.from({ length: n }, () => new El(sel)); return kids[sel]; };
    return { el, kids, made };
  }
  function env() {
    const socks = []; const recs = []; const evs = [];
    const window = {};
    function WebSocket(u) { this.url = u; this.sent = []; this.bufferedAmount = 0; socks.push(this); }
    WebSocket.prototype.send = function (x) { this.sent.push(x); }; WebSocket.prototype.close = function () {};
    function MediaRecorder() { this.state = 'inactive'; recs.push(this); }
    MediaRecorder.prototype.start = function (s) { this.state = 'recording'; this.slice = s; };
    MediaRecorder.prototype.stop = function () { this.state = 'inactive'; };
    window.WebSocket = WebSocket; window.MediaRecorder = MediaRecorder;
    window.dispatchEvent = (e) => evs.push(e);
    const timers = [];
    const ctx = { window, console, Date, Math, JSON, String, Number, Object, Array, RegExp, Promise, Blob: function () {},
      CustomEvent: function (n, o) { this.type = n; this.detail = o && o.detail; },
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
      navigator: { userAgent: 'Android' }, location: { host: 'x', pathname: '/', search: '' } };
    vm.createContext(ctx);
    vm.runInContext(LIVE_SRC, ctx);
    vm.runInContext(LR_SRC, ctx);
    const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };
    return { L: window.WQLiveRead, socks, recs, evs, timers, flush, window, ctx };
  }
  const PAGE = [{ t: 'The', box: [10, 20, 40, 18] }, { t: 'kite', box: [55, 20, 50, 18] }, { t: 'flew', box: [110, 20, 50, 18] }];

  test('words with boxes over the picture: one box per word, in percent of the image, and the states paint on them', async () => {
    const E = env(); const D = dom();
    E.L.mount(D.el, { words: PAGE, image: { url: '/s/b1/p1.webp', w: 200, h: 100 }, lang: 'en', getKey: () => Promise.resolve({ ws: 'wss://x', api_key: 'k', model: 'm', lang: 'en' }), stream: {} });
    expect(D.el.innerHTML).toContain('src="/s/b1/p1.webp"');
    expect((D.el.innerHTML.match(/class="lr-w lr-box/g) || []).length).toBe(3);
    expect(D.el.innerHTML).toContain('left:5%;top:20%;width:20%;height:18%');
    await E.flush();
    const s = E.socks[0]; s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(['the', 'kite']) }) });
    const spans = D.el.querySelectorAll('.lr-w');
    expect(spans[0].className).toBe('lr-w lr-box lr-read');
    expect(spans[2].className).toBe('lr-w lr-box lr-current');
  });

  test('the mic ask always has a listen-only door ("Not now, just listen"), before any permission prompt', async () => {
    const E = env(); const D = dom();
    let why = null;
    D.el.querySelector = (sel) => { const k = D.kids; if (!k[sel]) { k[sel] = { l: {}, addEventListener(n, fn) { this.l[n] = fn; } }; } return k[sel]; };
    E.L.askMic(D.el, { lang: 'ur', onStream: () => {}, onDenied: (w) => { why = w; } });
    expect(D.el.innerHTML).toContain('ابھی نہیں، صرف سنیں');
    D.kids['.lr-listen'].l.click();
    expect(why).toBe('not_now');
  });

  test('a refused key ({error}) is the fallback, never a socket to "undefined"', async () => {
    const E = env(); const D = dom();
    let why = null;
    E.L.mount(D.el, { words: PAGE, lang: 'en', getKey: () => Promise.resolve({ error: 'no_key' }), stream: {}, onFallback: (w) => { why = w; } });
    await E.flush();
    expect(E.socks).toHaveLength(0);
    expect(why).toBe('key');
  });

  test('the last chunk reaches the speech service before "finalize" (the recorder stops first)', async () => {
    const E = env(); const D = dom();
    const h = E.L.mount(D.el, { words: PAGE, lang: 'en', getKey: () => Promise.resolve({ ws: 'wss://x', api_key: 'k', model: 'm', lang: 'en' }), stream: {} });
    await E.flush();
    const s = E.socks[0]; s.onopen({});
    const mr = E.recs[0];
    mr.stop = function () { this.state = 'inactive'; const self = this; Promise.resolve().then(() => { self.ondataavailable({ data: { size: 900, last: true } }); self.onstop && self.onstop(); }); };
    h.stop('done_tap');
    await E.flush();
    const iLast = s.sent.findIndex((x) => x && x.last);
    const iFin = s.sent.indexOf('{"type":"finalize"}');
    expect(iLast).toBeGreaterThan(-1);
    expect(iFin).toBeGreaterThan(iLast);
  });

  test('a story page: the last word + its tail ends the reading; the result says story_page, not counted, no number', async () => {
    const E = env(); const D = dom();
    let got = null;
    E.L.mount(D.el, { words: PAGE, lang: 'en', id: 'b1:1', getKey: () => Promise.resolve({ ws: 'wss://x', api_key: 'k', model: 'm', lang: 'en' }), stream: {}, onResult: (r) => { got = r; } });
    await E.flush();
    const s = E.socks[0]; s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(['the', 'kite', 'flew']) }) });
    expect(E.timers.some((x) => x.ms === 1020)).toBe(true);   // the tail timer
    expect(got).toBeNull();
  });

  test('the sound kit on a story page: mic(true) at mount, a tink per new word (practice), the sentence chime, mic(false) at the end', async () => {
    const E = env(); const D = dom();
    const calls = [];
    E.window.WQJ = { word: (o) => { calls.push(['word', o.i, o.ok]); return true; }, sentence: () => calls.push(['sentence']), mic: (on) => calls.push(['mic', on]) };
    const h = E.L.mount(D.el, { words: [{ t: 'The' }, { t: 'kite.' }, { t: 'It' }, { t: 'flew.' }], lang: 'en', getKey: () => Promise.resolve({ ws: 'wss://x', api_key: 'k', model: 'm', lang: 'en' }), stream: {} });
    expect(calls).toEqual([['mic', true]]);
    await E.flush();
    const s = E.socks[0]; s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(['the', 'kite']) }) });
    expect(calls.slice(1)).toEqual([['word', 0, true], ['word', 1, true], ['sentence']]);
    h.stop('done_tap');
    await E.flush();
    expect(calls[calls.length - 1]).toEqual(['mic', false]);
  });

  test('a counted mount: no tink, a quiet Stop from the first second, "I\'m done" only from 80 % lit', async () => {
    const E = env(); const D = dom();
    const calls = [];
    E.window.WQJ = { word: (o) => { calls.push(['word', o.i]); return true; }, sentence: () => calls.push(['sentence']), mic: (on) => calls.push(['mic', on]) };
    const W5 = ['a', 'b', 'c', 'd', 'e'].map((t) => ({ t }));
    E.L.mount(D.el, { words: W5, lang: 'en', counted: true, getKey: () => Promise.resolve({ ws: 'wss://x', api_key: 'k', model: 'm', lang: 'en' }), stream: {} });
    expect(D.el.innerHTML).toContain('Stop for now');
    expect(D.el.innerHTML).toMatch(/class="[^"]*lr-done[^"]*" type="button" hidden/);
    await E.flush();
    const s = E.socks[0]; s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(['a', 'b', 'c']) }) });
    expect(D.el.querySelector('.lr-done').hidden).toBe(true);
    s.onmessage({ data: JSON.stringify({ tokens: toks(['d'], { from: 3 }) }) });
    expect(D.el.querySelector('.lr-done').hidden).toBe(false);
    expect(calls.filter((c) => c[0] !== 'mic')).toEqual([]);
  });

  test('a practice mount shows "I\'m done" + the drawn tick from the first second (one Done label)', async () => {
    const E = env(); const D = dom();
    E.L.mount(D.el, { words: PAGE, lang: 'ur', getKey: () => Promise.resolve({ ws: 'wss://x', api_key: 'k', model: 'm', lang: 'ur' }), stream: {} });
    expect(D.el.innerHTML).toMatch(/میں نے پڑھ لیا <svg class="lr-tick"/);
    expect(D.el.innerHTML).not.toMatch(/lr-done[^"]*" type="button" hidden/);
  });

  test('the mic sheet: the child line, the phone\'s prompt as a picture, Start (a drawn mic), "Not now, just listen", the grown-ups facts closed', async () => {
    const E = env(); const D = dom();
    const evs = []; let notNow = 0;
    D.el.querySelector = (sel) => { const k = D.kids; if (!k[sel]) { k[sel] = { l: {}, addEventListener(n, fn) { this.l[n] = fn; } }; } return k[sel]; };
    E.L.askMic(D.el, { lang: 'en', src: 'story', onStream: () => {}, onNotNow: () => { notNow += 1; }, onDenied: () => { throw new Error('not a denial'); }, ev: (n, d) => evs.push([n, d]) });
    const h = D.el.innerHTML;
    expect(h).toContain('<svg class="lr-os"');                       // the OS prompt as a picture
    expect(h).toMatch(/class="wq-btn wq-go lr-go" type="button"><svg class="lr-mic"/);
    expect(h).toContain('Not now, just listen');
    expect(h).toMatch(/<details class="lr-grown"><summary>For grown-ups<\/summary><p>[^<]*nothing is kept/);
    expect(h).not.toMatch(/🎤|✓/u);
    expect(evs).toEqual([['mic_ask', { src: 'story' }]]);
    D.kids['.lr-listen'].l.click();
    expect(notNow).toBe(1);
    expect(evs[1]).toEqual(['mic_declined', { src: 'story', how: 'not_now' }]);
  });

  test('a blocked microphone: "That\'s OK, let\'s listen with Jugnu", mic_declined with how, then listening (never a dead end)', async () => {
    const E = env(); const D = dom();
    const evs = []; let why = null;
    E.ctx.navigator.mediaDevices = { getUserMedia: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) };
    D.el.querySelector = (sel) => { const k = D.kids; if (!k[sel]) { k[sel] = { l: {}, addEventListener(n, fn) { this.l[n] = fn; } }; } return k[sel]; };
    E.L.askMic(D.el, { lang: 'ur', src: 'story', onStream: () => {}, onDenied: (w) => { why = w; }, ev: (n, d) => evs.push([n, d]) });
    D.kids['.lr-go'].l.click();   // getUserMedia only inside this tap
    await E.flush();
    expect(D.el.innerHTML).toContain('کوئی بات نہیں۔ آئیں، جگنو سے سنتے ہیں۔');
    expect(D.el.innerHTML).not.toContain('intent://');   // blocked: Chrome would ask the same, so no Chrome door
    expect(evs).toContainEqual(['mic_declined', { src: 'story', how: 'notallowederror' }]);
    D.kids['.lr-listen'].l.click();
    expect(why).toBe('notallowederror');
  });

  test('real-time fell through and the host\'s check answered: the hand-off keeps the one result shape, wpm null', async () => {
    const E = env(); const D = dom();
    let got = null;
    E.L.mount(D.el, { words: PAGE, lang: 'en', record: true, check: () => Promise.resolve({ words_read: 3, correct: 3, wpm: 99, transcript: 'the kite flew' }), getKey: () => Promise.resolve({ error: 'no_key' }), stream: {}, onResult: (r) => { got = r; } });
    await E.flush();
    E.window.Blob = function () {};
    D.el.querySelector('.lr-done').l.click();
    await E.flush();
    expect(got).toMatchObject({ v: 1, words_total: 3, words_read: 3, correct: 3, wpm: null, live: false, ended: 'done_tap' });
    expect(got).not.toHaveProperty('transcript');
  });
});

// ── one push of fixes: the counted read without the read guard, one green, one Done label, "Listening…", no rate, the sound kit ──
const CSS_SRC = fs.readFileSync(path.join(PUB, 'wq-liveread.css'), 'utf8');
// the declarations of one exact selector (the last rule that names it alone), as a sorted "prop:value" list
function rule(sel) {
  const out = {};
  const rx = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = rx.exec(CSS_SRC.replace(/\/\*[^]*?\*\//g, '')))) {
    const sels = m[1].split(',').map((x) => x.trim());
    if (!sels.includes(sel)) continue;
    m[2].split(';').map((x) => x.trim()).filter(Boolean).forEach((d) => { const k = d.slice(0, d.indexOf(':')).trim(); out[k] = d.slice(d.indexOf(':') + 1).trim(); });
  }
  return out;
}
const JUICE = 'window.WQJ = { calls: [], word: function (o) { this.calls.push(["word", o.i, o.ok]); return true; }, sentence: function () { this.calls.push(["sentence"]); }, mic: function (on) { this.calls.push(["mic", on]); } };';

describe('a counted read with the read guard OFF still gets the counted controls', () => {
  const PLAIN = { ex: 'read', ct: 'CT1', secs: 60, clips: CLIPS, story: STORY, record: true, live: true };
  const counted = async (clock = { t: 1000000 }, o = {}) => {
    const p = H.page({ clock, menu: { ...H.MENU, lr3: true }, pre: [LIVE_SRC, WS, ...(o.pre || []), LR_SRC], routes: { 'ch/HUB.TOKEN/read': ok({ ...PLAIN, lr3: LR3(false) }), 'ch/live': ok(KEY) }, micLevel: 200 });
    await p.click('wqc-ex-read'); await p.click('wqc-go');
    await p.flush();
    const s = p.ctx.__socks[0]; s.onopen({});
    return { p, s };
  };
  test('"Stop for now" from the first second and no Done until 80 % lit (today: a plain Done from the first second)', async () => {
    const { p, s } = await counted();
    expect(p.screen()).toBe('read-live');
    expect(p.has('wqc-stuck')).toBe(true);
    expect(p.html()).toContain('Stop for now');
    expect(p.has('wqc-stop')).toBe(false);
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 8)) }) });
    await p.flush();
    expect(p.has('wqc-stop')).toBe(true);
    expect(p.html()).toMatch(/id="wqc-stop" type="button">I(&#39;|')m done <svg class="lr-tick"/);
  });
  test('no words-a-minute anywhere: not while reading, not on the result (today: the live meter and "You read N words in a minute!")', async () => {
    const clock = { t: 1000000 };
    const { p, s } = await counted(clock);
    expect(p.html()).not.toMatch(/wqc-wpm|words a minute/);
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens) }) });
    await p.flush();
    expect(p.html()).not.toMatch(/wqc-wpm|words a minute/);
    clock.t += 1100;
    await p.runTimers((x) => x.ms === 1000);
    s.onmessage({ data: JSON.stringify({ tokens: [], finished: true }) });
    await p.flush(); await p.flush();
    expect(p.screen()).toBe('read-result');
    expect(p.html()).not.toMatch(/words in a minute|words a minute|wqc-wpm/);
    expect((p.els['wqc-score'] || { innerHTML: '' }).innerHTML || '').toBe('');
  });
  test('Stop for now ends the reading as "stuck"', async () => {
    const { p, s } = await counted();
    expect(p.has('wqc-stuck')).toBe(true);
    await p.click('wqc-stuck');
    expect(s.sent).toContain('{"type":"finalize"}');
    s.onmessage({ data: JSON.stringify({ tokens: [], finished: true }) });
    await p.flush(); await p.flush();
    const body = JSON.parse((p.fetches.find((f) => f.url === '/api/wq/ch/result') || { init: { body: '{}' } }).init.body);
    expect(body).toMatchObject({ ended: 'stuck', live_ui_v: 3 });
  });
  test('past 80 % and quiet: the Done button pulses and the line above asks "Done?"', async () => {
    const clock = { t: 1000000 };
    const { p, s } = await counted(clock);
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 9)) }) });
    await p.flush();
    clock.t += 4100;
    await p.runTimers((x) => x.ms === 4000);
    expect(p.screen()).toBe('read-live');
    expect(p.els['wqc-stop'].className).toContain('lr-pulse');
    expect(p.els['wqc-nudge'].textContent).toBe('Done?');
  });
  test('a counted read never plays a word or sentence sound (the sound kit present)', async () => {
    const { p, s } = await counted({ t: 1000000 }, { pre: [JUICE] });
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 7)) }) });
    await p.flush();
    const calls = p.ctx.window.WQJ.calls;
    expect(calls.filter((c) => c[0] === 'word' || c[0] === 'sentence')).toEqual([]);
    expect(calls).toContainEqual(['mic', true]);
  });
});

describe('one Done label on every reading surface: "I\'m done" / «میں نے پڑھ لیا» with a drawn tick', () => {
  test('the component\'s copy: Done, Done?, Stop, the listen-only door, and "Listening…" / «آپ کی آواز سنی جا رہی ہے…» (neutral)', () => {
    const L = lib();
    expect(L.COPY.en).toMatchObject({ done: 'I\'m done', doneAsk: 'Done?', stop: 'Stop for now', notNow: 'Not now, just listen', checking: 'Listening…' });
    expect(L.COPY.ur).toMatchObject({ done: 'میں نے پڑھ لیا', doneAsk: 'ہو گیا؟', stop: 'ابھی کے لیے بس', notNow: 'ابھی نہیں، صرف سنیں', checking: 'آپ کی آواز سنی جا رہی ہے…' });
    expect(JSON.stringify(L.COPY)).not.toMatch(/پڑھائی|I'm finished|میرا ہو گیا|Checking|سن رہا|✓|⏹|🎤/u);
    // the tick is drawn (SVG), never the ✓ character that falls into the Nastaliq face
    expect(L.doneHtml(L.COPY.ur)).toMatch(/^میں نے پڑھ لیا <svg class="lr-tick"[^>]*aria-hidden="true"/);
  });
  test('a practice Story Time read shows "I\'m done" + the drawn tick from the first second (today: "Done")', async () => {
    const p = room({ routes: ROUTES(SREAD({ lr3: LR3() })) });
    await startRead(p);
    expect(p.has('wqc-stop')).toBe(true);
    expect(p.html()).toMatch(/id="wqc-stop" type="button">I(&#39;|')m done <svg class="lr-tick"/);
    expect(p.html()).not.toMatch(/⏹|✓|🎤/u);
  });
  test('the waiting screen of a reading that could not go live says "Listening…", never "Sending your reading…"', async () => {
    const NOWS = 'window.WebSocket = undefined;';
    const p = room({ pre: [NOWS], routes: ROUTES(SREAD({ live: true, lr3: LR3() }), { 'ch/result': ok({ pending: true }) }) });
    await startRead(p);
    await p.click('wqc-stop');
    await p.flush();
    expect(['read-send', 'read-wait']).toContain(p.screen());
    expect(p.html()).toContain('Listening…');
    expect(p.html()).not.toContain('Sending your reading');
  });
});

describe('one green on screen', () => {
  test('a word heard but not final draws exactly like a word read (one class, wqc-ok)', async () => {
    const p = room({ routes: ROUTES(SREAD({ lr3: LR3() })) });
    await startRead(p);
    const s = sock(p); s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: [...toks(STORY.tokens.slice(0, 3)), ...toks(STORY.tokens.slice(3, 5), { from: 3, final: false })] }) });
    const h = p.els['wqc-live-story'].innerHTML;
    expect(h).not.toContain('wqc-okp');
    expect((h.match(/wqc-ok/g) || []).length).toBe(5);
  });
  test('text mode: read and heard have the same declarations — green ink #15803D on #BBF7D0', () => {
    expect(rule('.lr-read')).toEqual(rule('.lr-heard'));
    expect(rule('.lr-read')).toMatchObject({ color: '#15803D', background: '#BBF7D0' });
    expect(rule('.lr3 .wqc-w.wqc-ok')).toMatchObject({ color: '#15803D', background: '#BBF7D0' });
  });
  test('a picture: read = a green bar in the bottom 22 % of the box; skipped = a dashed amber bar; only current is filled/outlined', () => {
    const read = rule('.lr-box.lr-read');
    expect(read).toEqual(rule('.lr-box.lr-heard'));
    expect(read.background).toMatch(/linear-gradient\(to top, #15803D 0(%)?, #15803D 22%, transparent 22%\)/);
    expect(read['box-shadow']).toBe('none');
    const skip = rule('.lr-box.lr-skipped');
    expect(skip.background).toMatch(/#E65100/);
    expect(skip.background).toMatch(/repeating-linear-gradient/);
    expect(skip['background-size']).toMatch(/22%/);
    expect(skip['box-shadow']).toBe('none');
    const cur = rule('.lr-box.lr-current');
    expect(cur.background).toBe('rgba(187, 247, 208, .3)');
    expect(cur['box-shadow']).toBe('inset 0 0 0 3px #15803D');
    expect(rule('.lr-box.lr-ahead')).toMatchObject({ background: 'none', 'box-shadow': 'none' });
  });
});

describe('no rate leaves the component', () => {
  test('result() says wpm: null even when the host passes a rate', () => {
    const L = lib();
    const v = { states: ['read', 'read'], read: 2, heard: 2, skipped: 0, total: 2 };
    expect(L.result(v, { wpm: 80, counted: true, ms: 60000 }).wpm).toBeNull();
    expect(L.result(v, { wpm: true, counted: true, ms: 60000 }).wpm).toBeNull();
  });
});

describe('the sound kit (window.WQJ): a tink per word on a practice read, a sentence chime, the mic window; nothing without it', () => {
  test('practice Story Time: WQJ.word per new word lit, WQJ.sentence at a sentence\'s last word, mic(true) then mic(false)', async () => {
    const clock = { t: 1000000 };
    const p = room({ clock, pre: [JUICE], routes: ROUTES(SREAD({ lr3: LR3() })) });
    await startRead(p);
    const s = sock(p); s.onopen({});
    const W = p.ctx.window.WQJ;
    expect(W.calls).toContainEqual(['mic', true]);
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 2)) }) });
    expect(W.calls.filter((c) => c[0] === 'word')).toEqual([['word', 0, true], ['word', 1, true]]);
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(2, 6), { from: 2 }) }) });
    expect(W.calls.filter((c) => c[0] === 'word').map((c) => c[1])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(W.calls.filter((c) => c[0] === 'sentence')).toHaveLength(1);   // "school." ends the first sentence
    // a word already lit is never tinked again
    s.onmessage({ data: JSON.stringify({ tokens: [] }) });
    expect(W.calls.filter((c) => c[0] === 'word')).toHaveLength(6);
    await p.click('wqc-stop');
    expect(W.calls[W.calls.length - 1]).toEqual(['mic', false]);
  });
  test('without the kit the same read runs and lights its words (no throw)', async () => {
    const p = room({ routes: ROUTES(SREAD({ lr3: LR3() })) });
    await startRead(p);
    const s = sock(p); s.onopen({});
    expect(() => s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 6)) }) })).not.toThrow();
    expect(((p.els['wqc-live-story'] || {}).innerHTML.match(/wqc-ok/g) || []).length).toBe(6);
  });
});
