/**
 * Questions after Read aloud on the Challenge page (public/wq/wq-challenge.js): after a reading worth praising, a
 * button opens up to 3 tap questions; each tap asks the server (the key never reaches the page); feedback, then the
 * total. Run whole in a vm with a fake DOM, fetch and media — only the browser and the network are faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LIVE_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-read-live.js'), 'utf8');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-challenge.js'), 'utf8');
const CLIPS = { intro: { text: 'Intro', url: null }, start: { text: 'Ready? Begin.', url: null }, stop: { text: 'Stop.', url: null }, done: { text: 'Great reading! Well done.', url: null } };
const READ = (o = {}) => ({ ex: 'read', ct: 'CT1', secs: 60, live: false, questions_on: true, clips: CLIPS, story: { text: 'Imran woke up early for school.', dir: 'ltr', tokens: [], lines: [] }, ...o });
const MENU = { lang: 'en', form: 'G3', exercises: [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null }] };
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
  class Audio { constructor(u) { this.url = u; } addEventListener() {} play() { played.push(this.url); return Promise.resolve(); } pause() {} }
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
    w: window.__wqc, root, els, fetches, played, flush, runTimers,
    html: () => root.innerHTML.replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
    screen: () => (/data-screen="([^"]+)"/.exec(root.innerHTML) || [])[1],
    click: async (id) => { els[id].click(); await flush(); },
  };
}

const routes = (o = {}) => ({
  'ch/HUB.TOKEN/read': ok(READ(o.read)),
  'ch/upload': ok({ put_url: 'https://r2.test/put/abc', key: 'k', content_type: 'audio/webm' }),
  'r2.test/put': () => ({ status: 200, body: {} }),
  'ch/result$': ok(o.result || { score: { correct: 42, attempted: 45, stopped: false }, wcpm: 42 }),
  'ch/qs': ok(o.qs || QS),
  'ch/qa': (url, init) => { const b = JSON.parse(init.body); const right = { 'en.story.q1': 1, 'en.story.q2': 0, 'en.story.q3': 2 }[b.q]; const q = QS.questions.find((x) => x.id === b.q); return { status: 200, body: { ok: b.pick === right, answer: q.options[right] } }; },
  'ch/HUB.TOKEN\\?': ok(MENU),
  ...(o.extra || {}),
});
const readThrough = async (p) => { await p.click('wqc-ex-read'); await p.click('wqc-go'); await p.click('wqc-stop'); await p.flush(); };

describe('the button', () => {
  test('a praised reading offers "Answer questions about the story" first, More challenges second', async () => {
    const p = page({ routes: routes() });
    await readThrough(p);
    expect(p.screen()).toBe('read-result');
    expect(p.html()).toMatch(/id="wqc-qa"[^>]*>Answer questions about the story</);
    expect(p.html().indexOf('id="wqc-qa"')).toBeLessThan(p.html().indexOf('id="wqc-menu"'));
  });
  test('switch off, a stopped reader, or a reading not heard: no questions', async () => {
    for (const o of [{ read: { questions_on: false } }, { result: { score: { correct: 0, attempted: 4, stopped: true }, wcpm: 0 } }, { result: { failed: true, reason: 'unheard' } }]) {
      const p = page({ routes: routes(o) });
      await readThrough(p);
      expect(p.html()).not.toContain('id="wqc-qa"');
    }
  });
});

describe('three taps', () => {
  test('asks the server for the reached questions with the words read; shows a question with 3 options; the mascot reads it', async () => {
    const p = page({ routes: routes() });
    await readThrough(p);
    await p.click('wqc-qa');
    expect(JSON.parse(p.fetches.find((f) => f.url === '/api/wq/ch/qs').init.body)).toEqual({ ct: 'CT1', attempted: 45, lang: 'en' });
    expect(p.screen()).toBe('qa');
    expect(p.html()).toContain('Why did Imran wake up early?');
    expect((p.html().match(/class="wqc-opt"/g) || [])).toHaveLength(3);
    expect(p.html()).toContain('1 of 3');
    expect(p.played).toContain('https://r2.test/q1.ogg');
  });

  test('a tap goes to the server (never decided on the page): right ⇒ "Yes!"; wrong ⇒ "The answer was: …"; then the total', async () => {
    const p = page({ routes: routes() });
    await readThrough(p);
    await p.click('wqc-qa');
    await p.click('wqc-o1');
    expect(JSON.parse(p.fetches.find((f) => f.url === '/api/wq/ch/qa').init.body)).toEqual({ ct: 'CT1', q: 'en.story.q1', pick: 1, lang: 'en' });
    expect(p.els['wqc-say'].textContent).toBe('Yes!');
    expect(p.els['wqc-o1'].className).toContain('wqc-ok');
    await p.runTimers((x) => x.ms >= 1000);
    expect(p.html()).toContain('What was the class doing?');
    await p.click('wqc-o2');
    expect(p.els['wqc-say'].textContent).toBe('The answer was: planting trees');
    await p.runTimers((x) => x.ms >= 1000);
    await p.click('wqc-o2');
    await p.runTimers((x) => x.ms >= 1000);
    expect(p.screen()).toBe('qa-done');
    expect(p.html()).toContain('You got 2 of 3 right!');
    expect(p.html()).toContain('id="wqc-menu"');
  });

  test('no question reached ⇒ straight back to the challenges', async () => {
    const p = page({ routes: routes({ qs: { questions: [] } }) });
    await readThrough(p);
    await p.click('wqc-qa');
    expect(p.screen()).toBe('menu');
  });

  test('Urdu: the button, the count and the total in Urdu, Urdu digits; no test/exam words', async () => {
    const p = page({ lang: 'ur', routes: routes({ read: { lang: 'ur' } }) });
    await readThrough(p);
    expect(p.html()).toContain('کہانی کے بارے میں سوال');
    await p.click('wqc-qa');
    expect(p.html()).toContain('۳ میں سے ۱');
    await p.click('wqc-o1'); await p.runTimers((x) => x.ms >= 1000);
    await p.click('wqc-o0'); await p.runTimers((x) => x.ms >= 1000);
    await p.click('wqc-o2'); await p.runTimers((x) => x.ms >= 1000);
    expect(p.html()).toContain('آپ نے ۳ میں سے ۳ کے صحیح جواب دیے!');
    expect(p.html()).not.toMatch(/\b(test|exam|assessment)\b|ٹیسٹ|امتحان|جائزہ/i);
  });
});

describe('the portal forwards the two question calls to the bot', () => {
  test('POST /api/wq/ch/qs and /api/wq/ch/qa reach /api/internal/wq/ch/qs and /ch/qa with the body', async () => {
    const http = require('http');
    const express = require('express');
    const { createWebQuizRouter } = require('../routes/web-quiz.routes');
    const calls = [];
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async (url, init) => { calls.push({ url, body: init.body }); return { status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => '{"questions":[]}' }; } }));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const post = (p, body) => new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const rq = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      rq.on('error', reject); rq.end(data);
    });
    try {
      expect(await post('/api/wq/ch/qs', { ct: 'CT1', attempted: 45, lang: 'en' })).toBe(200);
      expect(await post('/api/wq/ch/qa', { ct: 'CT1', q: 'en.story.q1', pick: 1, lang: 'en' })).toBe(200);
      expect(calls.map((c) => c.url)).toEqual(['http://bot.test/api/internal/wq/ch/qs', 'http://bot.test/api/internal/wq/ch/qa']);
      expect(JSON.parse(calls[1].body)).toEqual({ ct: 'CT1', q: 'en.story.q1', pick: 1, lang: 'en' });
    } finally { srv.close(); }
  });
});
