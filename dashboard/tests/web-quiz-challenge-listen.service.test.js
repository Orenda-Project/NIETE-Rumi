/**
 * "Listen and answer" on the Challenge page (public/wq/wq-challenge.js): the mascot's line, a Listen button, the
 * story played twice from its clip (its text never on the page), then the tap questions (server-checked) and the
 * total. Run whole in a vm with a fake DOM, fetch and media — only the browser and the network are faked.
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

test('the tile opens the mascot\'s line and a Listen button; nothing plays until the child taps', async () => {
  const p = page({ routes: routes() });
  expect(p.html()).toContain('Listen and answer');
  await p.click('wqc-ex-listen');
  expect(p.screen()).toBe('intro');
  expect(p.html()).toContain('Listen to a short story two times.');
  expect(p.html()).toMatch(/id="wqc-go"[^>]*>Listen</);
  expect(storyPlays(p)).toHaveLength(0);
});

test('Listen plays the story twice (EGRA reads it twice), never shows its text, then asks the questions with the run\'s token', async () => {
  const p = page({ routes: routes() });
  await p.click('wqc-ex-listen');
  await p.click('wqc-go');
  expect(p.screen()).toBe('listen-play');
  expect(p.played.filter((u) => u === 'https://r2.test/story.ogg')).toHaveLength(1);
  expect(p.html()).not.toMatch(/Sara|bread/);
  storyPlays(p)[0].end();
  await p.runTimers((x) => x.ms >= 1000 && x.ms < 5000);
  expect(p.played.filter((u) => u === 'https://r2.test/story.ogg')).toHaveLength(2);
  expect(p.fetches.some((f) => f.url === '/api/wq/ch/qs')).toBe(false);
  storyPlays(p)[0].end();
  await p.flush();
  expect(JSON.parse(p.fetches.find((f) => f.url === '/api/wq/ch/qs').init.body)).toMatchObject({ ct: 'CT9', lang: 'en' });
  expect(p.screen()).toBe('qa');
});

test('after the three taps: the total and More challenges', async () => {
  const p = page({ routes: routes() });
  await p.click('wqc-ex-listen');
  await p.click('wqc-go');
  storyPlays(p)[0].end(); await p.runTimers((x) => x.ms >= 1000 && x.ms < 5000);
  storyPlays(p)[0].end(); await p.flush();
  for (const pick of [1, 0, 0]) { await p.click(`wqc-o${pick}`); await p.runTimers((x) => x.ms >= 1000 && x.ms < 5000); }
  expect(p.screen()).toBe('qa-done');
  expect(p.html()).toContain('You got 2 of 3 right!');
});

test('a story that will not play (a broken clip) says so and offers the challenges, never a silent screen', async () => {
  const p = page({ routes: routes() });
  await p.click('wqc-ex-listen');
  await p.click('wqc-go');
  (storyPlays(p)[0].l.error || []).forEach((fn) => fn({}));
  await p.flush();
  expect(p.screen()).toBe('error');
  expect(p.html()).toContain('id="wqc-menu"');
});

test('Urdu: the Listen button in Urdu', async () => {
  const p = page({ lang: 'ur', routes: routes({ listen: { ...LISTEN, clips: { ...LCLIPS, intro: { text: 'ایک چھوٹی سی کہانی دو بار سنیں۔ پھر سوالوں کے جواب دیں!', url: null } } } }) });
  await p.click('wqc-ex-listen');
  expect(p.html()).toMatch(/id="wqc-go"[^>]*>سنیں</);
  expect(p.html()).not.toMatch(/\b(test|exam|assessment)\b|ٹیسٹ|امتحان|جائزہ/i);
});
