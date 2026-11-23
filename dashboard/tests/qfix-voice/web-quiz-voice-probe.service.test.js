/**
 * Web quiz page voice: a clip the browser calls "source not supported" says whether its address answered
 * (public/wq/wq.js speak → probeSrc → web_quiz.audio_probe; always on, telemetry only).
 *
 * Runs the page's OWN voice block, cut from the shipped file between its markers, in a vm with the browser's audio and
 * fetch boundaries faked, so each test executes the real speak() and the real probe.
 *
 * The bug (production, 16-22 Nov 2026): 92% of the `error` class of lost clips came from VivoBrowser on Android 8 and
 * Samsung Internet 7, every one `media_err_4` (MEDIA_ERR_SRC_NOT_SUPPORTED), on our own mp3 route and on storage alike.
 * That code is the same whether the browser never got the bytes or got them and refused to decode them, so the fix
 * (open in Chrome vs Web Audio playback) could not be chosen from the event. The lost-clip event itself must never wait
 * for the probe: a child who leaves because of the silence would take it along and thin the lost-clip meter.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf('  var player = null;');
const END = SRC.indexOf('  /* ---------------- tiny DOM helpers');

const R2_CLIP = 'https://acct0123.r2.cloudflarestorage.com/digital-coach-audio/quiz-audio/production/0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c/en/7d1e2c3b-4a5f-4e6d-8c7b-9a8b7c6d5e4f/q-reyna-1a2b3c4d.ogg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc';
const SAME_CLIP = '/wq/voice/one/sx-reyna-68567f-en/right-0.mp3?v=1';

// fetchPlan(mode) → { status, type } (answers), 'reject' (no answer), or 'hang' (never settles)
function harness({ v2 = false, fetchPlan = null } = {}) {
  const events = [];
  const timers = [];
  const clips = [];
  const fetches = [];
  const cls = new Set();
  class FakeAudio {
    constructor(url) { this.url = url; this.paused = true; this.listeners = {}; clips.push(this); }
    set src(v) { this.url = v; }
    get src() { return this.url; }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    play() { this.paused = false; return new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; }); }
    pause() { this.paused = true; }
  }
  const ctx = {
    LANG: 'en', VLANG: 'en', SOUND: true, ONE_VOICE: true, GAP_PHONE: false, GAP_SLOW: false,
    B: { voice_v2: v2 },
    ROOT: { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } },
    speakable: (t) => /[A-Za-z0-9؀-ۿ]/.test(String(t || '')),
    ev: (name, data) => events.push({ name, data: JSON.parse(JSON.stringify(data)) }),
    document: { visibilityState: 'visible', createElement: () => ({ canPlayType: () => 'probably' }), addEventListener: () => {}, removeEventListener: () => {} },
    location: { origin: 'https://quiz.example.test' },
    navigator: { connection: { effectiveType: '4g' } },
    Date: { now: () => 1000 },
    URL,
    Audio: FakeAudio,
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: () => {}, cancel: () => {}, getVoices: () => [] },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].ran = true; },
  };
  if (fetchPlan) {
    ctx.fetch = (url, opts) => {
      fetches.push({ url, opts });
      const a = fetchPlan(opts.mode, url);
      if (a === 'hang') return new Promise(() => {});
      if (a === 'reject') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ status: a.status, headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? a.type || null : null) } });
    };
  }
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.speak = speak;`, ctx);
  const runTimers = (ms) => timers.filter((t) => t.ms === ms && !t.ran).forEach((t) => { t.ran = true; t.fn(); });
  const fail = (i, code) => { clips[i].error = { code }; clips[i].onerror(); };
  return { ctx, events, clips, fetches, cls, runTimers, fail, fallbacks: () => events.filter((e) => e.name === 'audio_fallback'), probes: () => events.filter((e) => e.name === 'audio_probe') };
}
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); };

describe('the first media_err_4 in a sitting fetches 2 bytes of the same clip and names the answer in audio_probe', () => {
  test('our own mp3 route answered 206 audio/mpeg: the bytes were there, so the browser refused to decode them', async () => {
    const h = harness({ fetchPlan: () => ({ status: 206, type: 'audio/mpeg' }) });
    h.ctx.speak('Well done!', SAME_CLIP, null, { part: 'fb', qid: 'q1aaaaaaaa' });
    h.fail(0, 4);
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0].url).toBe('https://quiz.example.test/wq/voice/one/sx-reyna-68567f-en/right-0.mp3?v=1');
    expect(h.fetches[0].opts).toMatchObject({ method: 'GET', headers: { Range: 'bytes=0-1' }, cache: 'no-store', mode: 'same-origin', keepalive: true });
    await flush();
    expect(h.probes()).toHaveLength(1);
    expect(h.probes()[0].data).toMatchObject({ err: 'media_err_4', host: 'self', fmt: 'mp3', part: 'fb', qid: 'q1aaaaaaaa', vis: 'visible', net: '4g', fst: '206', fct: 'audio/mpeg' });
    expect(typeof h.probes()[0].data.ms).toBe('number');
  });

  test('an error page: the status and a bare content-type (no parameters), never the address or the body', async () => {
    const h = harness({ fetchPlan: () => ({ status: 404, type: 'text/html; charset=utf-8' }) });
    h.ctx.speak('Well done!', SAME_CLIP, null);
    h.fail(0, 4);
    await flush();
    const d = h.probes()[0].data;
    expect(d).toMatchObject({ fst: '404', fct: 'text/html' });
    expect(JSON.stringify(d)).not.toMatch(/wq\/voice|charset/);
  });

  test('a storage clip the page may read (CORS) gives its real status; one it may not read but that answered = opaque', async () => {
    const h1 = harness({ fetchPlan: (mode) => (mode === 'cors' ? { status: 403, type: 'application/xml' } : 'reject') });
    h1.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h1.fail(0, 4);
    await flush();
    expect(h1.fetches.map((f) => f.opts.mode)).toEqual(['cors']);
    expect(h1.fetches[0].opts.credentials).toBe('omit');
    expect(h1.probes()[0].data).toMatchObject({ host: 'r2', fst: '403', fct: 'application/xml' });

    const h2 = harness({ fetchPlan: (mode) => (mode === 'cors' ? 'reject' : { status: 0, type: null }) });
    h2.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h2.fail(0, 4);
    await flush();
    expect(h2.fetches.map((f) => f.opts.mode)).toEqual(['cors', 'no-cors']);
    expect(h2.probes()[0].data).toMatchObject({ host: 'r2', fst: 'opaque' });
    expect(h2.probes()[0].data.fct).toBeUndefined();
  });

  test('no answer at all = net; no answer in 3 s = timeout (the probe event still goes, once)', async () => {
    const h1 = harness({ fetchPlan: () => 'reject' });
    h1.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h1.fail(0, 4);
    await flush();
    expect(h1.probes().map((e) => e.data.fst)).toEqual(['net']);

    const h2 = harness({ fetchPlan: () => 'hang' });
    h2.ctx.speak('Well done!', SAME_CLIP, null);
    h2.fail(0, 4);
    await flush();
    expect(h2.probes()).toHaveLength(0);
    h2.runTimers(3000);
    await flush();
    expect(h2.probes().map((e) => e.data.fst)).toEqual(['timeout']);
  });
});

describe('the lost-clip event never waits: audio_fallback goes at once, unchanged; the probe is once per sitting', () => {
  test('audio_fallback is logged at once, with no probe fields, while the probe is still waiting', () => {
    const h = harness({ fetchPlan: () => 'hang' });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    const fb = h.fallbacks();
    expect(fb).toHaveLength(1);
    expect(fb[0].data).toMatchObject({ reason: 'error', err: 'media_err_4', host: 'r2', part: 'q', qid: 'q1aaaaaaaa' });
    expect(fb[0].data.fst).toBeUndefined();
    expect(fb[0].data.fct).toBeUndefined();
  });

  test('a second media_err_4 in the same sitting: its own audio_fallback, no second fetch, no second probe', async () => {
    const h = harness({ fetchPlan: () => ({ status: 206, type: 'audio/mpeg' }) });
    h.ctx.speak('Well done!', SAME_CLIP, null);
    h.fail(0, 4);
    await flush();
    h.ctx.speak('Try again!', SAME_CLIP.replace('right-0', 'wrong-0'), null);
    h.fail(1, 4);
    await flush();
    expect(h.fetches).toHaveLength(1);
    expect(h.fallbacks()).toHaveLength(2);
    expect(h.probes()).toHaveLength(1);
  });

  test('another media error (2 = network) fetches nothing and sends no probe', async () => {
    const h = harness({ fetchPlan: () => ({ status: 206, type: 'audio/mpeg' }) });
    h.ctx.speak('Well done!', SAME_CLIP, null);
    h.fail(0, 2);
    await flush();
    expect(h.fetches).toHaveLength(0);
    expect(h.probes()).toHaveLength(0);
    expect(h.fallbacks()[0].data).toMatchObject({ err: 'media_err_2' });
  });

  test('V2 on: the line is held for the child\'s tap at once, and logged at once, while the probe is still waiting', () => {
    const h = harness({ v2: true, fetchPlan: () => 'hang' });
    let done = 0;
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, () => { done += 1; }, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    expect(done).toBe(1);
    expect(h.cls.has('wq-novoice')).toBe(true);
    expect(h.fallbacks()).toHaveLength(1);
  });

  test('a browser with no fetch logs the error at once, as before, and sends no probe', async () => {
    const h = harness();
    h.ctx.speak('Well done!', SAME_CLIP, null);
    h.fail(0, 4);
    await flush();
    expect(h.fallbacks()[0].data).toMatchObject({ err: 'media_err_4' });
    expect(h.probes()).toHaveLength(0);
  });
});
