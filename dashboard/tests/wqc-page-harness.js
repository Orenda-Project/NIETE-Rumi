/**
 * The Challenge page (public/wq/wq-challenge.js) run whole in a vm with a small fake DOM, fake fetch and fake
 * browser media — the same harness as web-quiz-challenge-page.service.test.js, with a fake Web Audio
 * (AudioContext → MediaStreamSource → Analyser) whose level a test sets, so the page's local microphone
 * check can be driven and proven local (no network, no recorder). Only the browser and the network are faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-challenge.js'), 'utf8');

const MENU = {
  lang: 'en', form: 'G3',
  exercises: [
    { id: 'bigger', name: 'Which is bigger?', mins: 2, done: true, last: { correct: 7, n: 10 } },
    { id: 'read', name: 'Read aloud', mins: 2, done: false, last: null },
  ],
};
const CLIPS = { intro: { text: 'Intro line', url: null }, start: { text: 'Ready? Begin.', url: null }, stop: { text: 'Stop. Thank you!', url: null }, done: { text: 'Great reading! Well done.', url: null } };
const COPY = {
  stuck: 'The rest is too hard', incomplete: 'You read {words} words. Read for the whole minute to get your number!',
  micSay: 'Say "Jugnu!" so I can hear you.', micHeard: 'I can hear you! Nothing is saved.', micSilent: "Jugnu can't hear you yet.",
  stopAsk: 'Stop reading?', wholeMinute: 'You read for the whole minute!',
};
const STORY = { text: 'Imran woke up early for school. He washed his face.', dir: 'ltr', tokens: ['Imran', 'woke', 'up', 'early', 'for', 'school.', 'He', 'washed', 'his', 'face.'], lines: [{ from: 0, to: 5 }, { from: 6, to: 9 }] };
const READ = { ex: 'read', ct: 'CT1', secs: 60, clips: CLIPS, story: STORY };
const READ_GUARD = { ...READ, record: true, guard: true, copy: COPY };

function fakeEl(id) {
  return {
    id, listeners: {}, className: '', textContent: '', style: {},
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    click() { (this.listeners.click || []).forEach((fn) => fn({ preventDefault() {} })); },
  };
}

function page({ htmlClass = '', freshEls = false, storage = null, perm = null, clock = null, lang = 'en', menu = MENU, ua = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 WhatsApp', media = 'grant', routes = {}, recorder = 'ok', chunk = 4000, href = 'https://portal.test/c/HUB.TOKEN', micLevel = 128 } = {}) {
  const els = {};
  const root = { querySelector: (sel) => { const id = sel.replace(/^#/, ''); if (!els[id]) els[id] = fakeEl(id); return els[id]; } };
  // freshEls: each render replaces the elements, as a real DOM does (a key bound on one screen is not the next one's)
  let html0 = '';
  Object.defineProperty(root, 'innerHTML', { get: () => html0, set: (v) => { html0 = v; if (freshEls) Object.keys(els).forEach((k) => { delete els[k]; }); } });
  const fetches = [];
  const events = [];
  const timers = [];
  const recs = [];
  const answer = (url, init) => {
    for (const [rx, fn] of Object.entries(routes)) if (new RegExp(rx).test(url)) return fn(url, init);
    return { status: 200, body: {} };
  };
  const fetch = (url, init = {}) => {
    fetches.push({ url, init });
    if (url === '/api/wq/e') { events.push(...JSON.parse(init.body).events); return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') }); }
    const r = answer(url, init);
    return Promise.resolve({ ok: r.status < 300, status: r.status, text: () => Promise.resolve(JSON.stringify(r.body)) });
  };
  const mic = { stops: 0, ctx: 0, analysers: 0, closed: 0, level: micLevel };
  class MediaRecorder {
    constructor(stream, opts) {
      if (recorder === 'throw') throw new Error('NotSupportedError');
      this.stream = stream; this.mimeType = (opts && opts.mimeType) || 'audio/webm'; this.state = 'inactive'; recs.push(this);
    }
    start(slice) { this.state = 'recording'; this.slice = slice; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: { size: chunk } }); this.onstop(); }
    static isTypeSupported(t) { return t === 'audio/webm;codecs=opus'; }
  }
  const navigator = { userAgent: ua, mediaDevices: undefined };
  // perm: what navigator.permissions says about the microphone ('denied' | 'prompt' | 'granted'); null = no API
  if (perm) navigator.permissions = { query: () => Promise.resolve({ state: perm }) };
  if (media !== 'none') {
    navigator.mediaDevices = {
      getUserMedia: () => (media === 'grant' ? Promise.resolve({ getTracks: () => [{ stop() { mic.stops += 1; } }] })
        : Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))),
    };
  }
  const played = [];
  class Audio {
    constructor(url) { this.url = url; this.l = {}; }
    addEventListener(n, fn) { this.l[n] = fn; }
    play() { played.push(this.url); return Promise.resolve(); }
    pause() {}
  }
  // Web Audio, as the page's microphone check uses it: a source from the stream, an analyser whose samples sit
  // at `micLevel` (128 = silence on a byte time-domain scale).
  function AudioContext() {
    mic.ctx += 1;
    this.resume = () => Promise.resolve();
    this.close = () => { mic.closed += 1; return Promise.resolve(); };
    this.createMediaStreamSource = () => ({ connect() {} });
    this.createAnalyser = () => { mic.analysers += 1; return { fftSize: 2048, frequencyBinCount: 1024, getByteTimeDomainData(arr) { for (let i = 0; i < arr.length; i += 1) arr[i] = i % 2 ? mic.level : 256 - mic.level; } }; };
  }
  const boot = { textContent: JSON.stringify({ token: 'HUB.TOKEN', kid: null, menu: { ...menu, lang }, mascot: lang === 'ur' ? 'جگنو' : 'Jugnu' }) };
  const wl = {};
  const window = { MediaRecorder, scrollTo() {}, AudioContext, ...(storage ? { localStorage: storage } : {}), addEventListener(n, fn) { (wl[n] = wl[n] || []).push(fn); } };
  const ctx = {
    window, navigator, fetch, Audio, console, Uint8Array,
    Blob: function Blob(parts, o) { this.size = parts.reduce((a, p) => a + (p.size || 0), 0); this.type = o && o.type; },
    location: (() => { const u = new URL(href); return { href, host: u.host, pathname: u.pathname, search: u.search }; })(),
    document: {
      getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? boot : null),
      createElement: () => ({}), head: { appendChild() {} }, visibilityState: 'visible',
      // the edge's class on <html> (htmlClass: e.g. 'wq-ur2' when the Urdu polish is on)
      documentElement: { classList: { contains: (c) => String(htmlClass).split(/\s+/).includes(c) } },
      addEventListener(n, fn) { (wl[`doc:${n}`] = wl[`doc:${n}`] || []).push(fn); },
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    // clock: { t } — a test-held time for Date.now() (the page's item timings); null = the real clock
    Date: clock ? Object.assign(function D() { return new Date(clock.t); }, { now: () => clock.t }) : Date, JSON, Math, String, Number, Promise, Error, RegExp, Object, Array, encodeURIComponent,
  };
  ctx.MediaRecorder = MediaRecorder;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };
  const runTimers = async (pred = () => true) => {
    const due = timers.splice(0).filter((x) => { if (pred(x)) return true; timers.push(x); return false; });
    due.forEach((x) => x.fn());
    await flush();
  };
  return {
    w: window.__wqc, root, els, fetches, events, played, recs, flush, runTimers, mic, timers,
    fire: async (n) => { (wl[n] || []).forEach((fn) => fn({})); await flush(); },
    fireDoc: async (n) => { (wl[`doc:${n}`] || []).forEach((fn) => fn({})); await flush(); },
    setHidden: () => { ctx.document.visibilityState = 'hidden'; },
    html: () => root.innerHTML.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    screen: () => (/data-screen="([^"]+)"/.exec(root.innerHTML) || [])[1],
    click: async (id) => { els[id].click(); await flush(); },
    has: (id) => root.innerHTML.indexOf(`id="${id}"`) >= 0,
  };
}

const ok = (body) => () => ({ status: 200, body });

module.exports = { page, ok, MENU, CLIPS, COPY, STORY, READ, READ_GUARD };
