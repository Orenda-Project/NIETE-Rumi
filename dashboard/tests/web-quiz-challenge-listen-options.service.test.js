/**
 * Listen and answer, the options read aloud (public/wq/wq-challenge.js): when a question carries `option_clips`, each
 * option gets its own play button beside it (never the answer tap), the options are read in turn after the question
 * with the row lit, an answer is taken at once and stops the reading, and `wqc_optaudio_done` says once per question
 * whether the child waited ('heard') or answered first ('tapped'). Without option_clips the screen is today's.
 * Run whole in a vm with a fake DOM, fetch and media — only the browser and the network are faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LIVE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-read-live.js'), 'utf8');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-challenge.js'), 'utf8');
const CLIPS = { intro: { text: 'Intro', url: null }, start: { text: 'Ready? Begin.', url: null }, stop: { text: 'Stop.', url: null }, done: { text: 'Great reading! Well done.', url: null } };
const READ = (o = {}) => ({ ex: 'read', ct: 'CT1', secs: 60, live: false, questions_on: true, clips: CLIPS, story: { text: 'Imran woke up early for school.', dir: 'ltr', tokens: [], lines: [] }, ...o });
const MENU = { lang: 'en', form: 'G3', exercises: [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null }, { id: 'listen', name: 'Listen and answer', mins: 2, done: false, last: null }] };
const LCLIPS = { intro: { text: 'Listen to a short story two times. Then answer the questions!', url: null }, start: { text: 'Listen carefully.', url: null }, stop: { text: 'Now the questions!', url: null }, done: { text: 'Well done! Good listening.', url: null } };
const LISTEN = { ex: 'listen', ct: 'CT9', clips: LCLIPS, read_times: 2, story_clip: { url: 'https://r2.test/story.ogg' } };
const QS = { questions: [
  { id: 'en.story.q1', prompt: 'Why did Imran wake up early?', options: ['to play', 'for school', 'he was hungry'], clip: { url: 'https://r2.test/q1.ogg' } },
  { id: 'en.story.q2', prompt: 'What was the class doing?', options: ['planting trees', 'singing', 'reading'], clip: { url: null } },
  { id: 'en.story.q3', prompt: 'What did Imran carry?', options: ['a ball', 'a book', 'a small plant'], clip: { url: null } },
] };
const ok = (body) => () => ({ status: 200, body });

function fakeEl(id) {
  return { id, listeners: {}, className: '', textContent: '', innerHTML: '', style: {}, disabled: false,
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    click() { (this.listeners.click || []).forEach((fn) => fn({})); } };
}

function page({ lang = 'en', routes = {} } = {}) {
  const els = {};
  const root = { innerHTML: '', querySelector: (sel) => { const id = sel.replace(/^#/, ''); if (!els[id]) els[id] = fakeEl(id); return els[id]; } };
  const fetches = []; const timers = []; const played = [];
  const fetch = (url, init = {}) => {
    fetches.push({ url, init });
    if (url === '/api/wq/e') return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
    let r = { status: 200, body: {} };
    for (const [rx, fn] of Object.entries(routes)) if (new RegExp(rx).test(url)) { r = fn(url, init); break; }
    return Promise.resolve({ ok: r.status < 300, status: r.status, text: () => Promise.resolve(JSON.stringify(r.body)) });
  };
  class MediaRecorder {
    constructor(s, o) { this.mimeType = (o && o.mimeType) || 'audio/webm'; this.state = 'inactive'; }
    start(sl) { this.state = 'recording'; this.slice = sl; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: { size: 4000 } }); this.onstop(); }
    static isTypeSupported(t) { return t === 'audio/webm;codecs=opus'; }
  }
  const audios = [];
  class Audio { constructor(u) { this.url = u; this.l = {}; this.currentTime = 0; audios.push(this); } addEventListener(n, fn) { (this.l[n] = this.l[n] || []).push(fn); } play() { played.push(this.url); return Promise.resolve(); } pause() {} end() { (this.l.ended || []).forEach((fn) => fn({})); } }
  const boot = { textContent: JSON.stringify({ token: 'HUB.TOKEN', kid: null, menu: { ...MENU, lang }, mascot: lang === 'ur' ? 'جگنو' : 'Jugnu' }) };
  const window = { MediaRecorder, scrollTo() {}, addEventListener() {} };
  const ctx = {
    window, navigator: { userAgent: 'Android WhatsApp', mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop() {} }] }) } }, fetch, Audio, console, MediaRecorder,
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
    w: window.__wqc, root, els, fetches, played, flush, runTimers, audios,
    html: () => root.innerHTML.replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
    screen: () => (/data-screen="([^"]+)"/.exec(root.innerHTML) || [])[1],
    click: async (id) => { els[id].click(); await flush(); },
  };
}


const routes = (o = {}) => ({
  'ch/HUB.TOKEN/listen': ok(o.listen || LISTEN),
  'ch/qs': ok(o.qs || QS),
  'ch/qa': (url, init) => { const b = JSON.parse(init.body); const right = { 'en.story.q1': 1, 'en.story.q2': 0, 'en.story.q3': 2 }[b.q]; const q = QS.questions.find((x) => x.id === b.q); return { status: 200, body: { ok: b.pick === right, answer: q.options[right] } }; },
  'ch/HUB.TOKEN\\?': ok(MENU),
});
const storyPlays = (p) => p.audios.filter((a) => a.url === 'https://r2.test/story.ogg');


const OC = (i) => ({ url: `https://r2.test/q1-o${i}.ogg` });
const QSO = { questions: QS.questions.map((x, k) => (k === 0 ? { ...x, option_clips: [OC(0), OC(1), OC(2)] } : x)) };
const toQuestions = async (p) => {
  await p.click('wqc-ex-listen');
  await p.click('wqc-go');
  storyPlays(p)[0].end(); await p.runTimers((x) => x.ms >= 1000 && x.ms < 5000);
  storyPlays(p)[0].end(); await p.flush();
};
const audioOf = (p, url) => p.audios.filter((a) => a.url === url).pop();
const evs = (p) => p.fetches.filter((f) => f.url === '/api/wq/e').map((f) => JSON.parse(f.init.body).events).flat();

test('without option clips the question screen is today\'s: no play buttons beside the options', async () => {
  const p = page({ routes: routes() });
  await toQuestions(p);
  expect(p.screen()).toBe('qa');
  expect(p.html()).not.toContain('wqc-ohear');
  expect(p.html()).not.toContain('wqc-orow');
});

test('each option has its own play button (its clip, the page-language label), separate from the answer button', async () => {
  const p = page({ routes: routes({ qs: QSO }) });
  await toQuestions(p);
  const h = p.html();
  for (const i of [0, 1, 2]) {
    expect(h).toMatch(new RegExp(`<div class="wqc-orow"><button class="wqc-ohear" type="button" id="wqc-oh${i}" data-src="https://r2.test/q1-o${i}.ogg" aria-label="Hear this answer">🔊</button><button class="wqc-opt" type="button" id="wqc-o${i}">`));
  }
});

test('after the question, the options are read in turn, each row lit while it plays; then wqc_optaudio_done heard', async () => {
  const p = page({ routes: routes({ qs: QSO }) });
  await toQuestions(p);
  expect(p.played).toContain('https://r2.test/q1.ogg');
  expect(p.played).not.toContain(OC(0).url);
  audioOf(p, 'https://r2.test/q1.ogg').end(); await p.flush();
  expect(p.played).toContain(OC(0).url);
  expect(p.els['wqc-o0'].className).toContain('wqc-reading');
  audioOf(p, OC(0).url).end(); await p.flush();
  expect(p.els['wqc-o1'].className).toContain('wqc-reading');
  expect(p.els['wqc-o0'].className).not.toContain('wqc-reading');
  audioOf(p, OC(1).url).end(); await p.flush();
  audioOf(p, OC(2).url).end(); await p.flush();
  expect(evs(p).filter((e) => e.n === 'wqc_optaudio_done')).toEqual([expect.objectContaining({ how: 'heard', i: 2 })]);
  expect(p.fetches.some((f) => f.url === '/api/wq/ch/qa')).toBe(false);
});

test('the play button plays that option and does NOT answer; the reading in turn stops', async () => {
  const p = page({ routes: routes({ qs: QSO }) });
  await toQuestions(p);
  await p.click('wqc-oh2');
  expect(p.played[p.played.length - 1]).toBe(OC(2).url);
  expect(p.fetches.some((f) => f.url === '/api/wq/ch/qa')).toBe(false);
  expect(p.screen()).toBe('qa');
  audioOf(p, 'https://r2.test/q1.ogg').end(); await p.flush();
  expect(p.played).not.toContain(OC(0).url);
});

test('an answer is taken at once while the options are still being read: the reading stops, tapped is told once', async () => {
  const p = page({ routes: routes({ qs: QSO }) });
  await toQuestions(p);
  audioOf(p, 'https://r2.test/q1.ogg').end(); await p.flush();
  await p.click('wqc-o1');
  expect(JSON.parse(p.fetches.find((f) => f.url === '/api/wq/ch/qa').init.body)).toMatchObject({ q: 'en.story.q1', pick: 1 });
  expect(p.els['wqc-o1'].className).toContain('wqc-ok');
  audioOf(p, OC(0).url).end(); await p.flush();
  expect(p.played).not.toContain(OC(1).url);
  expect(evs(p).filter((e) => e.n === 'wqc_optaudio_done')).toEqual([expect.objectContaining({ how: 'tapped', i: 0 })]);
});

test('an option whose clip is not recorded yet shows no play button and is skipped in the reading', async () => {
  const qs = { questions: [{ ...QS.questions[0], option_clips: [OC(0), { url: null }, OC(2)] }] };
  const p = page({ routes: routes({ qs }) });
  await toQuestions(p);
  expect(p.html()).not.toContain('id="wqc-oh1"');
  expect(p.html()).toContain('id="wqc-o1"');
  audioOf(p, 'https://r2.test/q1.ogg').end(); await p.flush();
  audioOf(p, OC(0).url).end(); await p.flush();
  expect(p.played[p.played.length - 1]).toBe(OC(2).url);
});

test('Urdu: the play button\'s label is Urdu', async () => {
  const qs = { questions: [{ id: 'ur.listening.q1', prompt: 'اسکول میں کون سا دن تھا؟', options: ['چھٹی کا دن', 'کھیل کا دن', 'صفائی کا دن'], clip: { url: null }, option_clips: [OC(0), OC(1), OC(2)] }] };
  const p = page({ lang: 'ur', routes: routes({ qs }) });
  await toQuestions(p);
  expect(p.html()).toContain('aria-label="یہ جواب سنیں"');
});
