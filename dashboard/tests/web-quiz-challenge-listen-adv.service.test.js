/**
 * "Listen and answer" under the adventure look (<html class="wq-adv">, web_quiz_adventure_look): while the story
 * plays the child sees Jugnu listening, a ring that fills with the play, which play it is ("1 of 2"), the speaker
 * pulsing while the sound runs, and one Replay. With the look off the screen is today's, byte for byte.
 * The same vm harness as web-quiz-challenge-listen.service.test.js.
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

function page({ lang = 'en', routes = {}, adv = false } = {}) {
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
  const audios = []; const made = [];
  class Audio { constructor(u) { this.url = u; this.l = {}; this.currentTime = 0; audios.push(this); } addEventListener(n, fn) { (this.l[n] = this.l[n] || []).push(fn); } play() { played.push(this.url); return Promise.resolve(); } pause() {} fire(n) { (this.l[n] || []).forEach((fn) => fn({})); } end() { (this.l.ended || []).forEach((fn) => fn({})); } }
  const boot = { textContent: JSON.stringify({ token: 'HUB.TOKEN', kid: null, menu: { ...MENU, lang, ...(adv ? { adv: true } : {}) }, mascot: lang === 'ur' ? 'جگنو' : 'Jugnu' }) };
  const window = { MediaRecorder, scrollTo() {}, addEventListener() {} };
  const ctx = {
    window, navigator: { userAgent: 'Android WhatsApp', mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop() {} }] }) } }, fetch, Audio, console, MediaRecorder,
    Blob: function Blob(parts, o) { this.size = parts.reduce((a, p) => a + (p.size || 0), 0); this.type = o && o.type; },
    location: { href: 'https://portal.test/c/HUB.TOKEN', host: 'portal.test', pathname: '/c/HUB.TOKEN', search: '' },
    document: { documentElement: { classList: { contains: (c) => adv && (c === 'wq-adv' || c === 'wq-1b') } }, getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? boot : null), createElement: () => { const e = {}; made.push(e); return e; }, head: { appendChild() {} }, visibilityState: 'visible', addEventListener() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    Date, JSON, Math, String, Number, Promise, Error, RegExp, Object, Array, encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(LIVE_SRC, ctx);
  vm.runInContext(SRC, ctx);
  const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };
  const runTimers = async (pred = () => true) => { const due = timers.splice(0).filter((x) => { if (pred(x)) return true; timers.push(x); return false; }); due.forEach((x) => x.fn()); await flush(); };
  return {
    w: window.__wqc, made, root, els, fetches, played, flush, runTimers, audios,
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
async function toPlay(p) { await p.click('wqc-ex-listen'); await p.click('wqc-go'); expect(p.screen()).toBe('listen-play'); }

test('look on: Jugnu listening, the ring, "1 of 2" and Replay; never the lone grey speaker', async () => {
  const p = page({ routes: routes(), adv: true });
  await toPlay(p);
  const h = p.html();
  expect(h).toContain('class="wqc-lst"');
  expect(h).toMatch(/class="wqc-lhero[^"]*" id="wqc-lhero"/);
  expect(h).toMatch(/<img[^>]*src="\/wq\/jugnu\/thinking\.webp"/);
  expect(h).toMatch(/id="wqc-lbar"/);
  expect(h).toMatch(/id="wqc-lof"[^>]*>1 of 2</);
  expect(h).toMatch(/id="wqc-replay"[^>]*>[^<]*Replay</);
  expect(h).toContain('id="wqc-say"');
  expect(h).not.toContain('wqc-ear');
});

test('look on: the second play says "2 of 2", and the questions still come after two whole plays', async () => {
  const p = page({ routes: routes(), adv: true });
  await toPlay(p);
  storyPlays(p)[0].end();
  await p.runTimers((x) => x.ms >= 1000 && x.ms < 5000);
  expect(p.els['wqc-lof'].textContent).toBe('2 of 2');
  expect(p.fetches.some((f) => f.url === '/api/wq/ch/qs')).toBe(false);
  storyPlays(p)[0].end();
  await p.flush();
  expect(p.screen()).toBe('qa');
});

test('look on: the ring follows the sound, and the speaker pulses only while it plays', async () => {
  const p = page({ routes: routes(), adv: true });
  await toPlay(p);
  const a = storyPlays(p)[0];
  a.duration = 40; a.currentTime = 10; a.fire('timeupdate');
  expect(Number(p.els['wqc-lbar'].style.strokeDashoffset)).toBeCloseTo(0.75 * 2 * Math.PI * 54, 1);
  a.fire('playing');
  expect(p.els['wqc-lhero'].className).toContain('wqc-on');
  a.fire('pause');
  expect(p.els['wqc-lhero'].className).not.toContain('wqc-on');
});

test('look on: a clip whose length the phone cannot tell (an Opus stream says Infinity) still fills the ring', async () => {
  const p = page({ routes: routes(), adv: true });
  await toPlay(p);
  const a = storyPlays(p)[0];
  a.duration = Infinity; a.src = a.url; a.fire('loadedmetadata');
  const probe = p.audios.find((x) => x !== a && x.src === 'https://r2.test/story.ogg');
  expect(probe).toBeTruthy();
  probe.duration = Infinity; probe.fire('loadedmetadata');
  expect(probe.currentTime).toBeGreaterThan(1e100);
  probe.duration = 40; probe.removeAttribute = () => {}; probe.load = () => {}; probe.fire('durationchange');
  expect(p.played.filter((u) => u === undefined)).toHaveLength(0);
  a.currentTime = 10; a.fire('timeupdate');
  expect(Number(p.els['wqc-lbar'].style.strokeDashoffset)).toBeCloseTo(0.75 * 2 * Math.PI * 54, 1);
  a.currentTime = 40; a.end();
  await p.runTimers((x) => x.ms >= 1000 && x.ms < 5000);
  a.currentTime = 20; a.fire('timeupdate');
  expect(Number(p.els['wqc-lbar'].style.strokeDashoffset)).toBeCloseTo(0.5 * 2 * Math.PI * 54, 1);
  // a probe that never answers: the second play uses the first play's measured end
  const q2 = page({ routes: routes(), adv: true });
  await toPlay(q2);
  const b = storyPlays(q2)[0];
  b.duration = Infinity; b.currentTime = 30; b.end();
  await q2.runTimers((x) => x.ms >= 1000 && x.ms < 5000);
  b.currentTime = 15; b.fire('timeupdate');
  expect(Number(q2.els['wqc-lbar'].style.strokeDashoffset)).toBeCloseTo(0.5 * 2 * Math.PI * 54, 1);
});

test('look on: Replay starts this play again from the top, and does not count as a play', async () => {
  const p = page({ routes: routes(), adv: true });
  await toPlay(p);
  const a = storyPlays(p)[0];
  a.currentTime = 30;
  await p.click('wqc-replay');
  expect(a.currentTime).toBe(0);
  expect(p.played.filter((u) => u === 'https://r2.test/story.ogg')).toHaveLength(2);
  a.end(); await p.runTimers((x) => x.ms >= 1000 && x.ms < 5000);
  expect(p.els['wqc-lof'].textContent).toBe('2 of 2');
  expect(p.fetches.some((f) => f.url === '/api/wq/ch/qs')).toBe(false);
});

test('look on, Urdu: «۲ میں سے ۱» in Urdu digits and «دوبارہ سنیں»; no test words', async () => {
  const p = page({ lang: 'ur', routes: routes(), adv: true });
  await toPlay(p);
  const h = p.html();
  expect(h).toMatch(/id="wqc-lof"[^>]*>۲ میں سے ۱</);
  expect(h).toMatch(/id="wqc-replay"[^>]*>[^<]*دوبارہ سنیں</);
  expect(h).not.toMatch(/\b(test|exam|assessment)\b|ٹیسٹ|امتحان|جائزہ/i);
});

test('look on, a story title: its card sits under Jugnu (the story\'s art when the serve has it)', async () => {
  const p = page({ routes: routes({ listen: { ...LISTEN, title: { en: 'The Little Plant', ur: 'چھوٹا پودا' } } }), adv: true });
  await toPlay(p);
  expect(p.html()).toMatch(/class="wqc-ltitle"[^>]*>The Little Plant</);
});

test('look off: the listen screen is today\'s, byte for byte', async () => {
  const p = page({ routes: routes() });
  await toPlay(p);
  expect(p.root.innerHTML).toBe('<section class="wq-screen wqc" data-screen="listen-play"><div class="wq-jug wq-big"><span class="wq-jimg"><img src="/wq/jugnu/thinking.webp" alt="" width="92" height="92"></span><div class="wq-say" id="wqc-say">Listen carefully.</div></div><p class="wqc-ear" aria-hidden="true">🔊</p></section>');
});

test('the page styles (look only): the light screens sit in the middle with a bigger bubble, and the trail\'s Next is a full-size tag', () => {
  const p = page({ routes: routes(), adv: true });
  const css = p.made.map((e) => e.textContent || '').join('\n');
  expect(css).toMatch(/html\.wq-adv \.wqc-mid\{[^}]*min-height:100dvh/);
  expect(css).toMatch(/html\.wq-adv \.wqc-mid \.wq-jug\.wq-big \.wq-say[,{][^}]*font-size:var\(--fs-5/);
  expect(css).toMatch(/html\.wq-adv \.wqc-pill\.wqc-pnext\{[^}]*font-size:var\(--fs-3/);
  expect(css).toMatch(/prefers-reduced-motion:reduce\)\{[^}]*\.wqc-lhero/);
});

test('look on: intro, help-ask and listen screens are marked to sit in the middle; the quiz screens are not', async () => {
  const p = page({ routes: routes(), adv: true });
  await p.click('wqc-ex-listen');
  expect(p.html()).toMatch(/<section class="wq-screen wqc wqc-mid" data-screen="intro"/);
  await p.click('wqc-go');
  expect(p.html()).toMatch(/<section class="wq-screen wqc wqc-mid" data-screen="listen-play"/);
  storyPlays(p)[0].end(); await p.runTimers((x) => x.ms >= 1000 && x.ms < 5000);
  storyPlays(p)[0].end(); await p.flush();
  expect(p.html()).not.toContain('wqc-mid');
});
