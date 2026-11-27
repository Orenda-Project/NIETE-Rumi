/**
 * Web quiz page voice: a clip the browser fetched and then refused plays through Web Audio
 * (public/wq/wq.js speak → playWa; app_settings web_quiz_voice_webaudio → the answer's voice_wa; default off).
 *
 * Runs the page's OWN voice block, cut from the shipped file between its markers, in a vm with the browser's audio,
 * Web Audio and fetch boundaries faked, so each test executes the real speak().
 *
 * The bug (production, 26-27 Nov 2026, web_quiz.audio_probe): the `error` class of lost clips is MEDIA_ERR_SRC_NOT_SUPPORTED
 * on old Android browsers (VivoBrowser on Android 8, Samsung Internet 7), and the probe's winning cell is
 * `r2 206 audio/ogg` = 8 phones: the bytes arrive and the media element refuses them. Today that child gets the words
 * and no voice for every clip of the sitting. The fix: fetch the clip whole and decode it with
 * decodeAudioData; once one plays, the sitting's clips go that way; once one will not decode, the sitting never tries again.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'wq.js'), 'utf8');
const START = SRC.indexOf('  var player = null;');
const END = SRC.indexOf('  /* ---------------- tiny DOM helpers');

const R2_CLIP = 'https://acct0123.r2.cloudflarestorage.com/digital-coach-audio/quiz-audio/production/0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c/en/7d1e2c3b-4a5f-4e6d-8c7b-9a8b7c6d5e4f/q-reyna-1a2b3c4d.ogg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc';
const R2_CLIP2 = R2_CLIP.replace('q-reyna-1a2b3c4d', 'o-reyna-5e6f7a8b');
const SAME_CLIP = '/wq/voice/one/sx-reyna-68567f-en/right-0.mp3?v=1';

// decode: 'ok' | 'fail' | 'hang'; body: 'ok' | 'reject' | 404; ac: false = no Web Audio in this browser
function harness({ wa = false, v2 = false, decode = 'ok', body = 'ok', ac = true, decodeStyle = 'callback' } = {}) {
  const events = [];
  const timers = [];
  const clips = [];
  const fetches = [];
  const decodes = [];
  const sources = [];
  const ctxs = [];
  const cls = new Set();
  const listeners = {};
  class FakeAudio {
    constructor(url) { this.url = url; this.paused = true; this.listeners = {}; clips.push(this); }
    set src(v) { this.url = v; }
    get src() { return this.url; }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    play() { this.paused = false; return new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; }); }
    pause() { this.paused = true; }
  }
  class FakeCtx {
    constructor() { this.state = 'running'; this.destination = { dest: true }; ctxs.push(this); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    decodeAudioData(buf, ok, bad) {
      decodes.push(buf);
      const p = decode === 'ok' ? Promise.resolve({ duration: 1.2 }) : decode === 'fail' ? Promise.reject(new Error('EncodingError')) : new Promise(() => {});
      if (decodeStyle === 'promise') return p;
      p.then((b) => ok && ok(b), (e) => bad && bad(e));
      return undefined;
    }
    createBufferSource() {
      const s = { started: false, stopped: false, connect(d) { this.to = d; }, start() { this.started = true; }, stop() { this.stopped = true; } };
      sources.push(s);
      return s;
    }
  }
  const ctx = {
    LANG: 'en', VLANG: 'en', SOUND: true, ONE_VOICE: true, GAP_PHONE: false, GAP_SLOW: false,
    B: { voice_v2: v2, voice_wa: wa },
    ROOT: { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } },
    speakable: (t) => /[A-Za-z0-9؀-ۿ]/.test(String(t || '')),
    ev: (name, data) => events.push({ name, data: JSON.parse(JSON.stringify(data)) }),
    document: {
      visibilityState: 'visible',
      createElement: () => ({ canPlayType: () => 'probably' }),
      addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); },
      removeEventListener: () => {},
    },
    location: { origin: 'https://quiz.example.test' },
    navigator: { connection: { effectiveType: '4g' } },
    Date: { now: () => 1000 },
    URL,
    Audio: FakeAudio,
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    speechSynthesis: { speak: () => {}, cancel: () => {}, getVoices: () => [] },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].ran = true; },
    fetch: (url, opts) => {
      fetches.push({ url, opts });
      // the 2-byte probe (always on) answers 206; the whole-clip fetch answers per `body`
      if (opts && opts.headers && opts.headers.Range) return Promise.resolve({ status: 206, ok: true, headers: { get: () => 'audio/ogg' } });
      if (body === 'reject') return Promise.reject(new TypeError('Failed to fetch'));
      if (body === 404) return Promise.resolve({ status: 404, ok: false, headers: { get: () => 'text/html' }, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
      return Promise.resolve({ status: 200, ok: true, headers: { get: () => 'audio/ogg' }, arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)) });
    },
  };
  if (ac) ctx.AudioContext = FakeCtx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}\nthis.speak = speak; this.stopVoice = stopVoice;`, ctx);
  const runTimers = (ms) => timers.filter((t) => t.ms === ms && !t.ran).forEach((t) => { t.ran = true; t.fn(); });
  const fail = (i, code) => { clips[i].error = { code }; clips[i].onerror(); };
  const whole = () => fetches.filter((f) => !(f.opts && f.opts.headers && f.opts.headers.Range));
  const named = (n) => events.filter((e) => e.name === n);
  const tap = () => (listeners.pointerdown || []).forEach((fn) => fn({}));
  return { ctx, events, clips, fetches, whole, decodes, sources, ctxs, cls, runTimers, fail, named, tap };
}
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };

describe('web_quiz_voice_webaudio off (no voice_wa): today\'s page', () => {
  test('a media_err_4 clip makes no Web Audio context and fetches nothing but the 2-byte probe', async () => {
    const h = harness({ wa: false });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    await flush();
    expect(h.ctxs).toHaveLength(0);
    expect(h.whole()).toHaveLength(0);
    expect(h.named('audio_wa')).toHaveLength(0);
    expect(h.cls.has('wq-novoice')).toBe(true); // the words, big, as today
  });
});

describe('web_quiz_voice_webaudio on: a clip the element refused (media_err_4) is fetched whole and played through Web Audio', () => {
  test('the same address, no Range, credentials omitted for storage; decoded; a buffer source plays it; audio_wa ok', async () => {
    const h = harness({ wa: true });
    const done = jest.fn();
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, done, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    await flush();
    expect(h.named('audio_fallback')).toHaveLength(1); // the element's failure is still counted, as it happened
    expect(h.whole()).toHaveLength(1);
    expect(h.whole()[0].url).toBe(R2_CLIP);
    expect(h.whole()[0].opts).toMatchObject({ credentials: 'omit', mode: 'cors' });
    expect(h.decodes).toHaveLength(1);
    expect(h.sources).toHaveLength(1);
    expect(h.sources[0].started).toBe(true);
    expect(h.sources[0].to).toBe(h.ctxs[0].destination);
    const wa = h.named('audio_wa');
    expect(wa).toHaveLength(1);
    expect(wa[0].data).toMatchObject({ ok: true, how: 'rescue', part: 'q', qid: 'q1aaaaaaaa', host: 'r2', fmt: 'ogg' });
    expect(typeof wa[0].data.ms).toBe('number');
    expect(JSON.stringify(wa[0].data)).not.toMatch(/cloudflarestorage|Signature/);
    expect(h.cls.has('wq-novoice')).toBe(false);
    expect(done).not.toHaveBeenCalled();
    h.sources[0].onended();
    expect(done).toHaveBeenCalledTimes(1);
  });

  test('a browser whose decodeAudioData only returns a promise (no callbacks) plays the same way', async () => {
    const h = harness({ wa: true, decodeStyle: 'promise' });
    h.ctx.speak('Well done!', SAME_CLIP, null, { part: 'fb', qid: 'q1aaaaaaaa' });
    h.fail(0, 4);
    await flush();
    expect(h.whole()[0].opts).toMatchObject({ credentials: 'same-origin', mode: 'same-origin' });
    expect(h.sources).toHaveLength(1);
    expect(h.named('audio_wa')[0].data).toMatchObject({ ok: true, how: 'rescue', host: 'self', fmt: 'mp3' });
  });

  test('once one clip played, the sitting\'s next clip skips the element and plays through Web Audio at once', async () => {
    const h = harness({ wa: true });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    await flush();
    const before = h.clips.length;
    h.ctx.speak('Roots', R2_CLIP2, null, { qid: 'q1aaaaaaaa', part: 'opt' });
    await flush();
    expect(h.clips.length).toBe(before); // no new media element
    expect(h.whole().map((f) => f.url)).toEqual([R2_CLIP, R2_CLIP2]);
    expect(h.sources).toHaveLength(2);
    expect(h.sources[1].started).toBe(true);
    expect(h.ctxs).toHaveLength(1); // one context for the sitting
    expect(h.named('audio_fallback')).toHaveLength(1); // the second clip was never lost
  });

  test('a stopped line (the child answered) stops its Web Audio voice, and a decode that lands late never plays', async () => {
    const h = harness({ wa: true });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    await flush();
    h.ctx.stopVoice();
    expect(h.sources[0].stopped).toBe(true);

    const h2 = harness({ wa: true });
    h2.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h2.fail(0, 4);
    h2.ctx.stopVoice();
    await flush();
    expect(h2.sources).toHaveLength(0);
    expect(h2.named('audio_wa')).toHaveLength(0); // a line the child moved past is not a Web Audio failure
  });
});

describe('web_quiz_voice_webaudio on: when Web Audio cannot help, the child gets today\'s words, never a wait', () => {
  test('a clip that will not decode: audio_wa ok false step decode, the words big, and the sitting never tries again', async () => {
    const h = harness({ wa: true, decode: 'fail' });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    await flush();
    expect(h.named('audio_wa').map((e) => e.data)).toEqual([expect.objectContaining({ ok: false, how: 'rescue', step: 'decode' })]);
    expect(h.cls.has('wq-novoice')).toBe(true);
    h.ctx.speak('Roots', R2_CLIP2, null, { qid: 'q1aaaaaaaa', part: 'opt' });
    h.fail(1, 4);
    await flush();
    expect(h.whole()).toHaveLength(1);
    expect(h.named('audio_wa')).toHaveLength(1);
  });

  test('the whole-clip fetch fails or answers 404: step fetch, the words big, and the next refused clip may try again', async () => {
    for (const body of ['reject', 404]) {
      const h = harness({ wa: true, body });
      h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
      h.fail(0, 4);
      await flush();
      expect(h.named('audio_wa')[0].data).toMatchObject({ ok: false, step: 'fetch' });
      expect(h.cls.has('wq-novoice')).toBe(true);
      expect(h.sources).toHaveLength(0);
      h.ctx.speak('Roots', R2_CLIP2, null, { qid: 'q1aaaaaaaa', part: 'opt' });
      h.fail(1, 4);
      await flush();
      expect(h.whole()).toHaveLength(2);
    }
  });

  test('a decode that never answers gives up at the 8 s mark: step timeout, the words big', async () => {
    const h = harness({ wa: true, decode: 'hang' });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    await flush();
    expect(h.named('audio_wa')).toHaveLength(0);
    h.runTimers(8000);
    await flush();
    expect(h.named('audio_wa')[0].data).toMatchObject({ ok: false, step: 'timeout' });
    expect(h.cls.has('wq-novoice')).toBe(true);
  });

  test('a browser with no Web Audio: step ctx once, then never again; nothing fetched', async () => {
    const h = harness({ wa: true, ac: false });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    h.ctx.speak('Roots', R2_CLIP2, null, { qid: 'q1aaaaaaaa', part: 'opt' });
    h.fail(1, 4);
    await flush();
    expect(h.named('audio_wa').map((e) => e.data.step)).toEqual(['ctx']);
    expect(h.whole()).toHaveLength(0);
  });

  test('only "source not supported" is rescued: a network error, a stall or a refused start keeps today\'s path', async () => {
    const h = harness({ wa: true });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 2);
    h.ctx.speak('Roots', R2_CLIP2, null, { qid: 'q1aaaaaaaa', part: 'opt' });
    h.runTimers(8000);
    h.ctx.speak('Leaves', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'opt' });
    h.clips[2].rejectPlay(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    await flush();
    expect(h.whole()).toHaveLength(0);
    expect(h.named('audio_wa')).toHaveLength(0);
  });

  test('a Web Audio clip that fails after the sitting switched to it is logged as a lost clip (audio_fallback err wa_fetch)', async () => {
    const h = harness({ wa: true });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    await flush();
    h.ctx.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    h.ctx.speak('Roots', R2_CLIP2, null, { qid: 'q1aaaaaaaa', part: 'opt' });
    await flush();
    const fb = h.named('audio_fallback');
    expect(fb).toHaveLength(2);
    expect(fb[1].data).toMatchObject({ reason: 'error', err: 'wa_fetch', part: 'opt', qid: 'q1aaaaaaaa', host: 'r2', fmt: 'ogg' });
    expect(h.cls.has('wq-novoice')).toBe(true);
  });
});

describe('web_quiz_voice_webaudio on: the child\'s tap wakes a suspended context', () => {
  test('a context the browser suspended is resumed on the next tap', async () => {
    const h = harness({ wa: true });
    h.ctx.speak('Which part of a plant takes in water?', R2_CLIP, null, { qid: 'q1aaaaaaaa', part: 'q' });
    h.fail(0, 4);
    await flush();
    h.ctxs[0].state = 'suspended';
    h.tap();
    expect(h.ctxs[0].state).toBe('running');
  });
});
