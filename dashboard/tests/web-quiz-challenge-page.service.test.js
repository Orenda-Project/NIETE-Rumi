/**
 * The Challenge page (public/wq/wq-challenge.js), run whole in a vm with a small fake DOM, fake fetch and
 * fake browser media (getUserMedia / MediaRecorder / Audio). Only the browser and the network are faked.
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
const CLIPS = { intro: { text: 'Intro line', url: 'https://r2.test/intro.ogg' }, start: { text: 'Ready? Begin.', url: null }, stop: { text: 'Stop. Thank you!', url: null }, done: { text: 'Great reading! Well done.', url: null } };
const READ = { ex: 'read', ct: 'CT1', secs: 60, clips: CLIPS, story: { text: 'Imran woke up early for school.', dir: 'ltr', tokens: [], lines: [] } };
const BIGGER = { ex: 'bigger', ct: 'CT2', clips: CLIPS, per_item_s: 10, stop_after: 4, practice: [{ a: 8, b: 4, answer: 8 }], items: [{ a: 7, b: 5 }, { a: 11, b: 24 }, { a: 39, b: 23 }, { a: 58, b: 49 }, { a: 65, b: 67 }] };

function fakeEl(id) {
  return {
    id, listeners: {}, className: '', textContent: '', style: {},
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
    click() { (this.listeners.click || []).forEach((fn) => fn({})); },
  };
}

function page({ lang = 'en', menu = MENU, ua = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 WhatsApp', media = 'grant', routes = {}, recorder = 'ok', chunk = 4000, href = 'https://portal.test/c/HUB.TOKEN' } = {}) {
  const els = {};
  const root = { innerHTML: '', querySelector: (sel) => { const id = sel.replace(/^#/, ''); if (!els[id]) els[id] = fakeEl(id); return els[id]; } };
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
  const mic = { stops: 0, ctx: 0 };
  class MediaRecorder {
    constructor(stream, opts) {
      if (recorder === 'throw') throw new Error('NotSupportedError');
      this.stream = stream; this.mimeType = (opts && opts.mimeType) || 'audio/webm'; this.state = 'inactive'; recs.push(this);
    }
    start(slice) { this.state = 'recording'; this.slice = slice; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: { size: chunk } }); this.onstop(); }
    die(withChunk) { if (withChunk) this.ondataavailable({ data: { size: chunk } }); this.state = 'inactive'; this.onerror({ error: { name: 'UnknownError' } }); }
    static isTypeSupported(t) { return t === 'audio/webm;codecs=opus'; }
  }
  const navigator = { userAgent: ua, mediaDevices: undefined };
  if (media !== 'none') {
    navigator.mediaDevices = {
      getUserMedia: () => (media === 'hang' ? new Promise(() => {})
        : media === 'grant' ? Promise.resolve({ getTracks: () => [{ stop() { mic.stops += 1; } }] })
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
  const boot = { textContent: JSON.stringify({ token: 'HUB.TOKEN', kid: null, menu: { ...menu, lang }, mascot: lang === 'ur' ? 'جگنو' : 'Jugnu' }) };
  const wl = {};
  const window = { MediaRecorder: media === 'norecorder' ? undefined : MediaRecorder, scrollTo() {},
    AudioContext: function AudioContext() { mic.ctx += 1; this.resume = () => Promise.resolve(); },
    addEventListener(n, fn) { (wl[n] = wl[n] || []).push(fn); } };
  const ctx = {
    window, navigator, fetch, Audio, console,
    Blob: function Blob(parts, o) { this.size = parts.reduce((a, p) => a + (p.size || 0), 0); this.type = o && o.type; },
    location: (() => { const u = new URL(href); return { href, host: u.host, pathname: u.pathname, search: u.search }; })(),
    document: {
      getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? boot : null),
      createElement: () => ({}), head: { appendChild() {} }, visibilityState: 'visible',
      addEventListener(n, fn) { (wl[`doc:${n}`] = wl[`doc:${n}`] || []).push(fn); },
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    Date, JSON, Math, String, Number, Promise, Error, RegExp, Object, Array, encodeURIComponent,
  };
  if (media === 'norecorder') delete window.MediaRecorder;
  window.MediaRecorder = window.MediaRecorder;
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
    setHidden: () => { ctx.document.visibilityState = 'hidden'; },
    fire: async (n) => { (wl[n] || []).forEach((fn) => fn({})); await flush(); },
    html: () => root.innerHTML.replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
    screen: () => (/data-screen="([^"]+)"/.exec(root.innerHTML) || [])[1],
    click: async (id) => { els[id].click(); await flush(); },
  };
}

const ok = (body) => () => ({ status: 200, body });

describe('menu', () => {
  test('two tiles, names from the server, a done badge with the last score; no other exercise', () => {
    const p = page();
    expect(p.screen()).toBe('menu');
    expect(p.html()).toContain("Jugnu's Challenge");
    expect(p.html()).toContain('Which is bigger?');
    expect(p.html()).toContain('Read aloud');
    expect(p.html()).toContain('✓ 7 / 10');
    expect((p.html().match(/class="wqc-tile"/g) || [])).toHaveLength(2);
    expect(p.html()).not.toMatch(/EGRA|EGMA|assessment|\btest\b/i);
  });

  test('Urdu: the title and the minutes in Urdu digits', () => {
    const p = page({ lang: 'ur', menu: { ...MENU, exercises: [{ id: 'bigger', name: 'کون سا بڑا ہے؟', mins: 2, done: true, last: { correct: 7, n: 10 } }] } });
    expect(p.html()).toContain('جگنو کا چیلنج');
    expect(p.html()).toContain('۲ منٹ');
    expect(p.html()).toContain('۱۰ میں سے ۷');
  });
});

describe('read aloud: the microphone', () => {
  const routes = { 'ch/HUB.TOKEN/read': ok(READ) };

  test('refused ⇒ the fallback: the line, Open in Chrome (Android intent), Skip; ch_mic {ok:false, err}', async () => {
    const p = page({ media: 'deny', routes });
    await p.click('wqc-ex-read');
    expect(p.screen()).toBe('intro');
    expect(p.played).toEqual(['https://r2.test/intro.ogg']);
    await p.click('wqc-go');
    expect(p.screen()).toBe('no-mic');
    expect(p.html()).toContain("Your WhatsApp browser can't use the microphone.");
    expect(p.html()).toContain('intent://portal.test/c/HUB.TOKEN#Intent;scheme=https;package=com.android.chrome;end');
    expect(p.html()).toContain('Skip this one');
    expect(p.events).toContainEqual(expect.objectContaining({ n: 'ch_mic', ok: false, err: 'notallowederror' }));
  });

  test('no getUserMedia at all ⇒ the same fallback, err unsupported; no Chrome button off Android', async () => {
    const p = page({ media: 'none', routes, ua: 'Mozilla/5.0 (iPhone) AppleWebKit Safari' });
    await p.click('wqc-ex-read');
    await p.click('wqc-go');
    expect(p.screen()).toBe('no-mic');
    expect(p.html()).not.toContain('intent://');
    expect(p.events).toContainEqual(expect.objectContaining({ n: 'ch_mic', ok: false, err: 'unsupported' }));
  });

  test('Urdu fallback copy', async () => {
    const p = page({ lang: 'ur', media: 'deny', routes });
    await p.click('wqc-ex-read');
    await p.click('wqc-go');
    expect(p.html()).toContain('آپ کا واٹس ایپ براؤزر مائیک استعمال نہیں کر سکتا۔');
    expect(p.html()).toContain('کروم میں کھولیں');
    expect(p.html()).toContain('اسے چھوڑ دیں');
  });

  test('Skip returns to the menu', async () => {
    const p = page({ media: 'deny', routes: { ...routes, 'ch/HUB.TOKEN\\?': ok(MENU) } });
    await p.click('wqc-ex-read');
    await p.click('wqc-go');
    await p.click('wqc-skip');
    expect(p.screen()).toBe('menu');
  });

  test('granted ⇒ the story with a 60 s countdown and Done; the opus/webm type is picked; Done uploads by PUT and shows the words per minute', async () => {
    const p = page({ routes: {
      ...routes,
      'ch/upload': ok({ put_url: 'https://r2.test/put/abc', key: 'challenge/sandbox/r/read-1.webm', content_type: 'audio/webm' }),
      'r2.test/put': () => ({ status: 200, body: {} }),
      'ch/result$': ok({ score: { correct: 42, stopped: false }, wcpm: 42 }),
    } });
    await p.click('wqc-ex-read');
    await p.click('wqc-go');
    // the start cue has no clip here, so recording starts straight after it
    expect(p.events).toContainEqual(expect.objectContaining({ n: 'ch_mic', ok: true }));
    expect(p.screen()).toBe('read-rec');
    expect(p.html()).toContain('id="wqc-left">60<');
    expect(p.html()).toContain('Imran woke up early for school.');
    expect(p.recs[0].mimeType).toBe('audio/webm;codecs=opus');
    expect(p.recs[0].state).toBe('recording');
    await p.click('wqc-stop');
    await p.flush();
    const put = p.fetches.find((f) => f.url === 'https://r2.test/put/abc');
    expect(put.init.method).toBe('PUT');
    expect(put.init.headers['content-type']).toBe('audio/webm');
    const up = p.fetches.find((f) => f.url === '/api/wq/ch/upload');
    expect(JSON.parse(up.init.body)).toMatchObject({ ct: 'CT1', type: 'audio/webm;codecs=opus', size: 4000 });
    const res = p.fetches.find((f) => f.url === '/api/wq/ch/result');
    expect(JSON.parse(res.init.body)).toMatchObject({ ct: 'CT1', key: 'challenge/sandbox/r/read-1.webm' });
    expect(p.screen()).toBe('read-result');
    expect(p.html()).toContain('You read 42 words in a minute!');
  });

  test('pending ⇒ the page polls GET result/<ct> every 3 s until the score lands', async () => {
    let calls = 0;
    const p = page({ routes: {
      ...routes,
      'ch/upload': ok({ put_url: 'https://r2.test/put/abc', key: 'k', content_type: 'audio/webm' }),
      'r2.test/put': () => ({ status: 200, body: {} }),
      'ch/result$': ok({ pending: true }),
      'ch/result/CT1': () => { calls += 1; return { status: 200, body: calls < 2 ? { pending: true } : { score: { correct: 30, stopped: false }, wcpm: 30 } }; },
    } });
    await p.click('wqc-ex-read');
    await p.click('wqc-go');
    await p.click('wqc-stop');
    expect(p.screen()).toBe('read-wait');
    await p.runTimers((x) => x.ms === 3000);
    expect(p.screen()).toBe('read-wait');
    await p.runTimers((x) => x.ms === 3000);
    expect(calls).toBe(2);
    expect(p.html()).toContain('You read 30 words in a minute!');
  });

  test('a stopped reader (line 1) sees encouragement, never a 0; a failed scoring offers Try again', () => {
    const p = page();
    p.w.S.data = READ;
    p.w.readResult({ score: { correct: 0, stopped: true }, wcpm: 0 });
    expect(p.html()).toContain('Good try! Reading gets easier every day you practise.');
    expect(p.html()).not.toMatch(/\b0 words/);
    p.w.readResult({ failed: true, reason: 'stt_failed' });
    expect(p.html()).toContain("We couldn't hear that clearly. Try again?");
    expect(p.html()).toContain('id="wqc-again"');
  });
});

describe('a reading with nothing to praise is never praised', () => {
  test('heard but no word right (wcpm 0, not stopped): encouragement, no celebration, no "0 words"', () => {
    const p = page();
    p.w.S.data = READ;
    p.w.readResult({ score: { correct: 0, attempted: 3, stopped: false }, wcpm: 0 });
    expect(p.html()).toContain('Good try! Reading gets easier every day you practise.');
    expect(p.html()).not.toContain('Great reading! Well done.');
    expect(p.html()).not.toMatch(/\b0 words/);
    expect(p.html()).not.toContain('celebrate');
  });

  test('nothing attempted (an old server answer): "we couldn\'t hear" + Try again, never praise', () => {
    const p = page();
    p.w.S.data = READ;
    p.w.readResult({ score: { correct: 0, attempted: 0, stopped: false }, wcpm: 0 });
    expect(p.html()).toContain("We couldn't hear that clearly. Try again?");
    expect(p.html()).toContain('id="wqc-again"');
    expect(p.html()).not.toContain('Great reading! Well done.');
  });

  test('Urdu: the same two branches, never «بہت اچھا پڑھا»', () => {
    const p = page({ lang: 'ur', menu: { ...MENU, lang: 'ur' } });
    p.w.S.data = { ...READ, clips: { ...CLIPS, done: { text: 'بہت اچھا پڑھا! شاباش!', url: null } } };
    p.w.readResult({ score: { correct: 0, attempted: 0, stopped: false }, wcpm: 0 });
    expect(p.html()).toContain('آواز صاف سنائی نہیں دی۔ دوبارہ کوشش کریں؟');
    p.w.readResult({ score: { correct: 0, attempted: 4, stopped: false }, wcpm: 0 });
    expect(p.html()).toContain('اچھی کوشش! روز مشق سے پڑھنا آسان ہو جاتا ہے۔');
    expect(p.html()).not.toContain('بہت اچھا پڑھا');
  });

  test('the menu ticks a read only for a real result (words per minute above 0)', () => {
    const p = page({ menu: { lang: 'en', form: 'G3', exercises: [
      { id: 'bigger', name: 'Which is bigger?', mins: 2, done: true, last: { correct: 7, n: 10 } },
      { id: 'read', name: 'Read aloud', mins: 2, done: true, last: { correct: 0, wcpm: 0, stopped: false } },
    ] } });
    expect(p.html()).toContain('✓');                    // the bigger tile
    expect((p.html().match(/✓/g) || []).length).toBe(1); // not the read tile
    const q = page({ menu: { lang: 'en', form: 'G3', exercises: [
      { id: 'read', name: 'Read aloud', mins: 2, done: true, last: { correct: 41, wcpm: 41, stopped: false } },
    ] } });
    expect(q.html()).toMatch(/✓[^<]*41/);
  });
});

describe('which is bigger', () => {
  test('practice with feedback, then the scored pairs; the taps go to the server, the server\'s score is shown', async () => {
    const p = page({ routes: { 'ch/HUB.TOKEN/bigger': ok(BIGGER), 'ch/result$': ok({ score: { correct: 4, n: 5, stopped: false } }) } });
    await p.click('wqc-ex-bigger');
    await p.click('wqc-go');
    expect(p.screen()).toBe('bigger-practice');
    await p.click('wqc-a');
    expect(p.els['wqc-say'].textContent).toBe('Yes! 8 is bigger.');
    await p.runTimers((x) => x.ms === 1600);
    expect(p.screen()).toBe('bigger-go');
    await p.runTimers((x) => x.ms === 300);
    expect(p.screen()).toBe('bigger-play');
    expect(p.html()).toContain('1 of 5');
    for (let i = 0; i < 5; i += 1) {
      await p.click(i === 2 ? 'wqc-b' : 'wqc-a');
      await p.runTimers((x) => x.ms === 350);
    }
    const res = p.fetches.find((f) => f.url === '/api/wq/ch/result');
    expect(JSON.parse(res.init.body).taps.map((x) => x.pick)).toEqual([7, 11, 23, 58, 65]);
    expect(p.screen()).toBe('bigger-result');
    expect(p.html()).toContain('You got 4 out of 5!');
  });

  test('4 misses in a row: the phone stops showing pairs and sends what it has', async () => {
    const items = [{ a: 9, b: 1 }, { a: 9, b: 1 }, { a: 9, b: 1 }, { a: 9, b: 1 }, { a: 9, b: 1 }, { a: 9, b: 1 }];
    const p = page({ routes: { 'ch/HUB.TOKEN/bigger': ok({ ...BIGGER, practice: [], items }), 'ch/result$': ok({ score: { correct: 0, n: 6, stopped: true } }) } });
    await p.click('wqc-ex-bigger');
    await p.click('wqc-go');
    await p.runTimers((x) => x.ms === 300);
    for (let i = 0; i < 4; i += 1) {
      await p.click('wqc-b');
      await p.runTimers((x) => x.ms === 350);
    }
    const res = p.fetches.find((f) => f.url === '/api/wq/ch/result');
    expect(JSON.parse(res.init.body).taps).toHaveLength(4);
    expect(p.html()).toContain('Good try! Numbers get easier with practice.');
  });
});

describe('review fixes: the microphone is always given back, and every failure says what happened', () => {
  const routes = { 'ch/HUB.TOKEN/read': ok(READ) };
  const sendRoutes = (put = 200) => ({
    ...routes,
    'ch/upload': ok({ put_url: 'https://r2.test/put/abc', key: 'k', content_type: 'audio/webm' }),
    'r2.test/put': () => ({ status: put, body: {} }),
    'ch/result$': ok({ score: { correct: 42, stopped: false }, wcpm: 42, previous: { wcpm: 38 } }),
  });
  const toRecording = async (p) => { await p.click('wqc-ex-read'); await p.click('wqc-go'); };

  test('no AudioContext is made (nothing used it)', async () => {
    const p = page({ routes: sendRoutes() });
    await toRecording(p);
    expect(p.screen()).toBe('read-rec');
    expect(p.mic.ctx).toBe(0);
  });

  test('the recorder dies mid-read with audio: the mic is released and what was read is sent', async () => {
    const p = page({ routes: sendRoutes() });
    await toRecording(p);
    p.recs[0].die(true);
    await p.flush();
    expect(p.mic.stops).toBe(1);
    expect(p.fetches.some((f) => f.url === '/api/wq/ch/upload')).toBe(true);
  });

  test('the recorder dies with nothing recorded: the mic is released and the page says so, nothing is uploaded', async () => {
    const p = page({ routes: sendRoutes() });
    await toRecording(p);
    p.recs[0].die(false);
    await p.flush();
    expect(p.mic.stops).toBe(1);
    expect(p.html()).toContain('Nothing was recorded. Try again.');
    expect(p.fetches.some((f) => f.url === '/api/wq/ch/upload')).toBe(false);
  });

  test('the recorder cannot be made: the mic it already holds is released, then the fallback', async () => {
    const p = page({ routes: sendRoutes(), recorder: 'throw' });
    await toRecording(p);
    expect(p.mic.stops).toBe(1);
    expect(p.screen()).toBe('no-mic');
  });

  test('a recording under 1 KB is not uploaded', async () => {
    const p = page({ routes: sendRoutes(), chunk: 300 });
    await toRecording(p);
    await p.click('wqc-stop');
    expect(p.html()).toContain('Nothing was recorded. Try again.');
    expect(p.fetches.some((f) => f.url === '/api/wq/ch/upload')).toBe(false);
  });

  test('getUserMedia that never answers: after 12 s the fallback, ch_mic err timeout; the asking screen has Skip', async () => {
    const p = page({ media: 'hang', routes });
    await toRecording(p);
    expect(p.screen()).toBe('mic-ask');
    expect(p.html()).toContain('id="wqc-skip"');
    await p.runTimers((x) => x.ms === 12000);
    expect(p.screen()).toBe('no-mic');
    expect(p.events).toContainEqual(expect.objectContaining({ n: 'ch_mic', ok: false, err: 'timeout' }));
  });

  test('leaving the page while reading releases the mic', async () => {
    const p = page({ routes: sendRoutes() });
    await toRecording(p);
    await p.fire('pagehide');
    expect(p.mic.stops).toBe(1);
  });

  test('switching away from the browser mid-read stops, releases the mic and sends what was read', async () => {
    const p = page({ routes: sendRoutes() });
    await toRecording(p);
    p.setHidden();
    await p.fire('doc:visibilitychange');
    expect(p.mic.stops).toBe(1);
    expect(p.fetches.some((f) => f.url === '/api/wq/ch/upload')).toBe(true);
  });

  test('a failed upload says "Something went wrong", never "we couldn\'t hear"', async () => {
    const p = page({ routes: sendRoutes(500) });
    await toRecording(p);
    await p.click('wqc-stop');
    expect(p.html()).toContain('Something went wrong. Try again.');
    expect(p.html()).not.toContain("couldn't hear");
  });

  test('the poll stops on a 4xx with the generic message', async () => {
    const p = page({ routes: { ...sendRoutes(), 'ch/result$': ok({ pending: true }), 'ch/result/CT1': () => ({ status: 401, body: { error: 'bad_token' } }) } });
    await toRecording(p);
    await p.click('wqc-stop');
    await p.runTimers((x) => x.ms === 3000);
    expect(p.html()).toContain('Something went wrong. Try again.');
    expect(p.timers.filter((x) => x.ms === 3000)).toHaveLength(0);
  });

  test('the growth line: "4 more words than last time!"', async () => {
    const p = page({ routes: sendRoutes() });
    await toRecording(p);
    await p.click('wqc-stop');
    expect(p.html()).toContain('You read 42 words in a minute!');
    expect(p.html()).toContain('4 more words than last time!');
  });

  test('60 s with no result: "Your result is on its way." (nothing is "saved")', () => {
    const p = page();
    p.w.S.data = READ;
    p.w.readResult({ later: true });
    expect(p.html()).toContain('Your result is on its way.');
  });

  test('Open in Chrome carries host, path and query, never the hash', async () => {
    const p = page({ media: 'deny', routes, href: 'https://portal.test/c/HUB.TOKEN?lang=en#x' });
    await toRecording(p);
    expect(p.html()).toContain('intent://portal.test/c/HUB.TOKEN?lang=en#Intent;scheme=https;package=com.android.chrome;end');
  });

  test('a double tap on a practice pair moves on once', async () => {
    const p = page({ routes: { 'ch/HUB.TOKEN/bigger': ok(BIGGER) } });
    await p.click('wqc-ex-bigger');
    await p.click('wqc-go');
    await p.click('wqc-a');
    await p.click('wqc-a');
    expect(p.timers.filter((x) => x.ms === 1600)).toHaveLength(1);
  });
});
