/**
 * Web quiz page mascot (public/wq/wq.js jug / jugImg / jugWake / jugStop).
 *
 * Jugnu was a still picture. Each pose now has a few short seamless loops that
 * play over the still once the screen is up. The still stays the poster and the
 * fallback: reduced motion, Save-Data / 2G, a refused autoplay, an off-screen
 * mascot or a hidden page all leave (or put back) the still.
 *
 * Runs the page's OWN mascot block, cut from the shipped file between its
 * markers, in a vm with the browser boundary faked (DOM, <video>, matchMedia,
 * navigator.connection, page lifecycle events).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'), 'utf8');
const START = SRC.indexOf('  /* ---------------- mascot (Jugnu)');
const END = SRC.indexOf('  /* ---------------- end mascot');
const ASSETS = path.join(__dirname, '..', 'public', 'wq', 'jugnu');

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.className = '';
    this.parentNode = null; this.listeners = {}; this.paused = true;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }
  fire(n) { (this.listeners[n] || []).forEach((fn) => fn({ type: n })); if (this['on' + n]) this['on' + n]({ type: n }); }
  all() { return this.children.reduce((a, c) => a.concat([c], c.all()), []); }
  querySelectorAll(sel) {
    const all = this.all();
    if (sel === '.wq-jimg') return all.filter((e) => /(^| )wq-jimg( |$)/.test(e.className));
    throw new Error('unexpected selector ' + sel);
  }
}

function page(opts = {}) {
  const docL = {}; const winL = {};
  const plays = [];
  const observed = [];
  class Video extends El {
    play() {
      this.paused = false;
      return new Promise((resolve, reject) => { plays.push({ v: this, resolve, reject }); });
    }
    pause() { this.paused = true; }
    canPlayType(t) { return opts.webm === false ? '' : (/webm/.test(t) ? 'probably' : ''); }
  }
  const ROOT = new El('main');
  const events = [];
  const ctx = {
    ROOT,
    ev: (n, props) => events.push({ n, props }),
    Math: Object.assign(Object.create(Math), { random: () => (opts.random != null ? opts.random : 0) }),
    navigator: { userAgent: opts.ua || 'Mozilla/5.0 (Linux; Android 11; wv) Chrome/120', connection: opts.connection },
    document: {
      readyState: 'complete',
      createElement: (t) => (t === 'video' ? new Video(t) : new El(t)),
      addEventListener: (n, fn) => { (docL[n] = docL[n] || []).push(fn); },
      visibilityState: 'visible',
    },
    window: {
      matchMedia: (q) => ({ matches: !!opts.reduce && /reduce/.test(q) }),
      addEventListener: (n, fn) => { (winL[n] = winL[n] || []).push(fn); },
    },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    esc: (s) => String(s),
  };
  if (opts.io) {
    ctx.window.IntersectionObserver = function IO(cb) { this.observe = (el) => observed.push({ el, cb, io: this }); this.unobserve = () => {}; };
  }
  vm.createContext(ctx);
  vm.runInContext(`${SRC.slice(START, END)}
    this.jug = jug; this.jugImg = jugImg; this.jugWake = jugWake; this.jugStop = jugStop; this.jugResume = jugResume;
    this.JUG_V = JUG_V; this.wqJug = window.wqJug;`, ctx);
  const mount = (html) => {
    // the page renders markup; the test builds the same tree the markup describes
    const m = /data-jpose="([a-z]+)"/.exec(html);
    const span = new El('span'); span.className = 'wq-jimg'; span.setAttribute('data-jpose', m[1]);
    const still = new El('img'); still.setAttribute('src', /<img src="([^"]+)"/.exec(html)[1]); span.appendChild(still);
    ROOT.appendChild(span);
    return span;
  };
  const fire = (target, n) => ((target === 'doc' ? docL : winL)[n] || []).forEach((fn) => fn({ type: n }));
  const flush = () => new Promise((r) => setImmediate(r));
  return { ctx, ROOT, plays, observed, mount, fire, flush, events };
}
const anims = (span) => span.children.filter((c) => /wq-anim/.test(c.className));

test('the mascot block is still where this test cuts it from', () => {
  expect(START).toBeGreaterThan(0);
  expect(END).toBeGreaterThan(START);
});

test('jug() draws the pose still as the poster, inside a box the loop can play over', () => {
  const p = page();
  const html = p.ctx.jug('idle', 'Hello', true);
  expect(html).toContain('class="wq-jug wq-big"');
  expect(html).toContain('data-jpose="idle"');
  expect(html).toContain('<img src="/wq/jugnu/idle.webp"');
  expect(html).toContain('<div class="wq-say">Hello</div>');
});

test('on Android a random variant loop plays as a muted inline looping video over the still', async () => {
  const p = page({ random: 0.5 });
  const span = p.mount(p.ctx.jug('correct', 'Yes'));
  p.ctx.jugWake();
  const [v] = anims(span);
  expect(v.tagName).toBe('VIDEO');
  expect(v.getAttribute('src') || v.src).toBe('/wq/jugnu/correct_b.webm');
  expect(v.muted).toBe(true);
  expect(v.loop).toBe(true);
  expect(v.getAttribute('playsinline')).toBe('');
  expect(span.className).not.toContain('wq-live'); // still shows until the loop really plays
  v.fire('playing');
  expect(span.className).toContain('wq-live');
});

test('the same pose twice in a row never repeats the same variant', () => {
  const p = page({ random: 0 });
  const a = p.mount(p.ctx.jug('idle', '')); p.ctx.jugWake();
  const b = p.mount(p.ctx.jug('idle', '')); p.ctx.jugWake();
  expect(anims(a)[0].src).toBe('/wq/jugnu/idle_a.webm');
  expect(anims(b)[0].src).toBe('/wq/jugnu/idle_b.webm');
});

test('a refused autoplay falls back to the animated WebP of the same loop', async () => {
  const p = page({ random: 0 });
  const span = p.mount(p.ctx.jug('hello', ''));
  p.ctx.jugWake();
  const e = new Error('play() requires a user gesture'); e.name = 'NotAllowedError';
  p.plays[0].reject(e);
  await p.flush();
  const a = anims(span);
  expect(a).toHaveLength(1);
  expect(a[0].tagName).toBe('IMG');
  expect(a[0].src).toBe('/wq/jugnu/hello_a.webp');
  a[0].fire('load');
  expect(span.className).toContain('wq-live');
  // logged once, so the logs say how often an in-app browser refuses muted autoplay
  expect(p.events).toEqual([{ n: 'jug_fallback', props: { reason: 'notallowederror' } }]);
});

test('iPhone gets the animated WebP, never the WebM (no VP9 alpha in WebKit)', () => {
  const p = page({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' });
  const span = p.mount(p.ctx.jug('thinking', ''));
  p.ctx.jugWake();
  expect(anims(span)[0].tagName).toBe('IMG');
  expect(anims(span)[0].src).toBe('/wq/jugnu/thinking_a.webp');
});

test.each([
  ['prefers-reduced-motion', { reduce: true }],
  ['Save-Data', { connection: { saveData: true } }],
  ['2G', { connection: { effectiveType: 'slow-2g' } }],
])('%s keeps the still pose: no loop is fetched', (_, opts) => {
  const p = page(opts);
  const span = p.mount(p.ctx.jug('celebrate', '', true));
  p.ctx.jugWake();
  expect(anims(span)).toHaveLength(0);
});

test('hiding the page removes the loops (no decoding in the background) and showing it again restarts them', () => {
  const p = page();
  const span = p.mount(p.ctx.jug('idle', ''));
  p.ctx.jugWake();
  const v = anims(span)[0];
  v.fire('playing');
  p.ctx.document.visibilityState = 'hidden';
  p.fire('doc', 'visibilitychange');
  expect(v.paused).toBe(true);
  expect(anims(span)).toHaveLength(0);
  expect(span.className).not.toContain('wq-live');
  p.ctx.document.visibilityState = 'visible';
  p.fire('doc', 'visibilitychange');
  expect(anims(span)).toHaveLength(1);
});

test('pagehide (the in-app browser closing) and freeze stop the loops; stop/resume are exposed for the audio stop', () => {
  const p = page();
  const span = p.mount(p.ctx.jug('idle', ''));
  p.ctx.jugWake();
  p.fire('win', 'pagehide');
  expect(anims(span)).toHaveLength(0);
  p.fire('win', 'pageshow');
  expect(anims(span)).toHaveLength(1);
  p.fire('doc', 'freeze');
  expect(anims(span)).toHaveLength(0);
  expect(typeof p.ctx.wqJug.stop).toBe('function');
  expect(typeof p.ctx.wqJug.resume).toBe('function');
});

test('a loop stopped while the page hides does not fall back to the WebP when its play() is aborted', async () => {
  const p = page();
  const span = p.mount(p.ctx.jug('idle', ''));
  p.ctx.jugWake();
  p.fire('win', 'pagehide');
  const e = new Error('The play() request was interrupted'); e.name = 'AbortError';
  p.plays[0].reject(e);
  await p.flush();
  expect(anims(span)).toHaveLength(0);
});

test('an off-screen mascot is not animated; it starts when it scrolls into view', () => {
  const p = page({ io: true });
  const span = p.mount(p.ctx.jug('idle', ''));
  p.ctx.jugWake();
  expect(anims(span)).toHaveLength(0);
  const o = p.observed.find((x) => x.el === span);
  o.cb([{ target: span, isIntersecting: true }]);
  expect(anims(span)).toHaveLength(1);
  o.cb([{ target: span, isIntersecting: false }]);
  expect(anims(span)).toHaveLength(0);
});

test('every pose and variant the page can ask for ships as a still, a WebM and a WebP under 250 KB', () => {
  const p = page();
  const V = p.ctx.JUG_V;
  expect(Object.keys(V).sort()).toEqual(['celebrate', 'correct', 'hello', 'idle', 'notyet', 'sleep', 'thinking']);
  Object.keys(V).forEach((pose) => {
    expect(fs.existsSync(path.join(ASSETS, pose + '.webp'))).toBe(true);
    V[pose].split('').forEach((k) => {
      ['webm', 'webp'].forEach((ext) => {
        const f = path.join(ASSETS, `${pose}_${k}.${ext}`);
        expect(fs.existsSync(f)).toBe(true);
        expect(fs.statSync(f).size).toBeLessThan(250 * 1024);
      });
    });
  });
});

test('the stylesheet hides the loop until it plays, and reduced motion keeps the still', () => {
  expect(CSS).toMatch(/\.wq-jimg>\.wq-anim\{[^}]*opacity:0/);
  expect(CSS).toMatch(/\.wq-jimg\.wq-live>\.wq-anim\{[^}]*opacity:1/);
});

test('on the answer screen Jugnu is smaller, so a long reason (Urdu above all) keeps a wide column', () => {
  const m = /#wq-fb \.wq-jimg\{[^}]*width:(\d+)px[^}]*height:(\d+)px/.exec(CSS);
  expect(m).not.toBeNull();
  expect(Number(m[1])).toBeLessThanOrEqual(72);
  expect(Number(m[2])).toBe(Number(m[1]));
});
