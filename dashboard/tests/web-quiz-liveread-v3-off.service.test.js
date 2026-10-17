/**
 * Live reading v3 switched OFF (no `lr3` on the menu or the read payload), against a golden RECORDED FROM THE BASE:
 * fixtures/liveread-off-golden.json was written by this same file run on the sandbox tip before live reading v3 (the
 * record step runs only when the file is missing). With the switch off, the Challenge page's HTML and every read flow
 * here (Story Time live, a counted Trail read, no WebSocket, a socket that drops, the read guard) must give the same
 * screens, the same socket sends and the same calls, step by step.
 */
const fs = require('fs');
const path = require('path');
const H = require('./wqc-page-harness');
const { ok, CLIPS, STORY, COPY } = H;
const { renderChallengePage } = require('../routes/web-quiz.routes');

const GOLDEN = path.join(__dirname, 'fixtures', 'liveread-off-golden.json');
const PUB = path.join(__dirname, '..', 'public', 'wq');
const LIVE_SRC = fs.readFileSync(path.join(PUB, 'wq-read-live.js'), 'utf8');
const TRAIL_SRC = fs.readFileSync(path.join(PUB, 'wq-trail.js'), 'utf8');

const toks = (ws, { from = 0 } = {}) => ws.map((w, k) => ({ text: (from + k === 0 ? '' : ' ') + w, start_ms: (from + k) * 1000, end_ms: ((from + k) + 0.8) * 1000, is_final: true }));
const TC = { title: "{name}'s Trail", sub: '{done} of {total} stops done.', allDone: 'All done', badge: 'Done', next: 'Next', mic: 'uses the microphone', needsMic: 'needs a microphone', micWait: 'wait', other: 'Go to another stop', back: 'Back to the trail', practice: 'Practice round.', stopDone: 'Stop done!' };
const EXS = [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null, badge: false, mic: true }];
const V2 = { pool: true, story: true, consent: false };
const MENU = { lang: 'en', form: 'G3', record: true, trail: true, trail_copy: TC, exercises: EXS, v2: V2 };
const ROOM = 'https://portal.test/c/HUB.TOKEN?kid=&lang=en&room=story&pid=en.read.1.kite';
const KEY = { api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt.test/ws', model: 'stt-rt-v5', lang: 'en' };
const SREAD = (extra = {}) => ({ ex: 'read', ct: 'CTS', secs: 60, clips: CLIPS, story: STORY, story_clip: { url: '/clips/story-kite.mp3' }, trail: true, trail_copy: TC, v2: V2, practice_round: true, mode: 'practice', questions_on: false, live: true, ...extra });
const GUARD_READ = { ex: 'read', ct: 'CT1', secs: 60, clips: CLIPS, story: STORY, record: true, guard: true, copy: COPY, live: true };
const WS = 'var __socks = []; window.WebSocket = function (u) { this.url = u; this.sent = []; this.bufferedAmount = 0; __socks.push(this); };'
  + 'window.WebSocket.prototype.send = function (x) { this.sent.push(x); }; window.WebSocket.prototype.close = function () { this.closed = true; };';
const ROUTES = (read, extra = {}) => ({ 'ch/HUB.TOKEN/read': ok(read), 'ch/live': ok(KEY), 'ch/upload': ok({ put_url: 'https://store.test/put', content_type: 'audio/webm', key: 'k1' }), 'store.test': ok({}), ...extra });
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// one step of a flow: the screen, its HTML, the socket's text sends and every call made so far
const snap = (p) => ({
  screen: p.screen(),
  html: p.html(),
  sent: ((p.ctx.__socks || [])[0] || { sent: [] }).sent.filter((x) => typeof x === 'string'),
  calls: p.fetches.map((f) => `${(f.init && f.init.method) || 'GET'} ${f.url} ${(f.init && typeof f.init.body === 'string') ? f.init.body : ''}`),
});
const tail = async (p, clock) => { clock.t += 1100; await p.runTimers((x) => x.ms === 1000); };
// the first socket, or a stand-in when the page opened none (Story Time today: no live words)
const sock0 = (p) => (p.ctx.__socks || [])[0] || { onopen() {}, onmessage() {}, onclose() {}, none: true };

async function flows() {
  const out = {};
  // the page shell
  const norm = (h) => h.replace(/\?v=[0-9a-zA-Z._-]+/g, '?v=V');
  for (const lang of ['en', 'ur']) {
    for (const v2 of [false, true]) {
      for (const card of [false, true]) {
        const menu = { lang, exercises: [], ...(v2 ? { v2: V2 } : {}), ...(card ? { card_v3: true } : {}) };
        out[`shell_${lang}_${v2 ? 'v2' : 'v1'}_${card ? 'card' : 'nocard'}`] = norm(renderChallengePage({ menu, token: 't', kid: null, origin: 'https://x', assetV: 'v1', chV: 'c', brandKey: 'niete' }));
      }
    }
  }
  // Story Time, practice, live: 3 words, all words, the tail, the end
  {
    const clock = { t: 1000000 };
    const p = H.page({ clock, menu: MENU, href: ROOM, freshEls: true, session: store(), pre: [LIVE_SRC, WS, TRAIL_SRC], routes: ROUTES(SREAD()) });
    const f = [];
    await p.flush(); await p.click('wqc-story-read'); await p.flush(); f.push(snap(p));
    const s = sock0(p); s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 3)) }) }); await p.flush(); f.push(snap(p));
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(3), { from: 3 }) }) }); await p.flush(); f.push(snap(p));
    await tail(p, clock); f.push(snap(p));
    s.onmessage({ data: JSON.stringify({ tokens: [], finished: true }) }); await p.flush(); await p.flush(); f.push(snap(p));
    out.story_time_live = f;
  }
  // a counted Trail read, live, Done at 5 words, the result pending
  const trail = async (o = {}) => {
    const clock = { t: 1000000 };
    const p = H.page({ clock, menu: MENU, pre: [LIVE_SRC, ...(o.ws === false ? [] : [WS]), TRAIL_SRC], routes: ROUTES(SREAD({ practice_round: false, mode: 'check', story_clip: undefined }), { 'ch/result': ok({ pending: true }) }), session: store() });
    await p.flush();
    await p.click('wqc-ex-read'); await p.flush();
    await p.click('wqc-help-no'); await p.flush();
    await p.click('wqc-go'); await p.flush();
    return { p, clock };
  };
  {
    const { p } = await trail();
    const f = [snap(p)];
    const s = sock0(p); s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 5)) }) }); await p.flush(); f.push(snap(p));
    if (p.has('wqc-stop')) { await p.click('wqc-stop'); await p.flush(); }
    s.onmessage({ data: JSON.stringify({ tokens: [], finished: true }) }); await p.flush(); await p.flush(); f.push(snap(p));
    await p.runTimers((x) => x.ms === 10000); f.push(snap(p));
    out.trail_counted_live = f;
  }
  // the same read in a browser without WebSocket
  {
    const { p } = await trail({ ws: false });
    const f = [snap(p)];
    if (p.has('wqc-stop')) { await p.click('wqc-stop'); await p.flush(); }
    f.push(snap(p));
    await p.runTimers((x) => x.ms === 10000); f.push(snap(p));
    out.trail_no_socket = f;
  }
  // the live words drop after 3 words
  {
    const { p } = await trail();
    const s = sock0(p); s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 3)) }) }); await p.flush();
    s.onclose({ code: 1006 }); await p.flush();
    const f = [snap(p)];
    if (p.has('wqc-stop')) { await p.click('wqc-stop'); await p.flush(); }
    f.push(snap(p));
    out.trail_socket_drop = f;
  }
  // the read guard (today's Challenge, no Trail), live
  {
    const p = H.page({ clock: { t: 1000000 }, menu: H.MENU, pre: [LIVE_SRC, WS], routes: { 'ch/HUB.TOKEN/read': ok(GUARD_READ), 'ch/live': ok(KEY) }, micLevel: 200 });
    await p.click('wqc-ex-read'); await p.click('wqc-go');
    await p.runTimers((x) => x.ms === 3000); await p.flush();
    const f = [snap(p)];
    const s = sock0(p); s.onopen({});
    s.onmessage({ data: JSON.stringify({ tokens: toks(STORY.tokens.slice(0, 4)) }) }); await p.flush();
    f.push(snap(p));
    out.guard_live = f;
  }
  return out;
}

test('switch off: the Challenge page and every read flow equal the base\'s, step by step', async () => {
  const out = await flows();
  if (!fs.existsSync(GOLDEN)) { fs.mkdirSync(path.dirname(GOLDEN), { recursive: true }); fs.writeFileSync(GOLDEN, `${JSON.stringify(out, null, 1)}\n`); }
  const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  for (const k of Object.keys(want)) expect([k, out[k]]).toEqual([k, want[k]]);
  expect(Object.keys(out)).toEqual(Object.keys(want));
});
