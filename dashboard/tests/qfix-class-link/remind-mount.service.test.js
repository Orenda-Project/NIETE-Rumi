/**
 * The reminder ask under the chips on the standing link (/j/<code>, public/wq/class-link.js): when the step answer the
 * bot sends carries push_remind: true, after the step has painted the page loads /wq/wq-remind.js (with its own script's
 * ?v=) once, and on its load calls WQREMIND.mount(slot, {code, lang, chips, host, src: 'class_link'}), code = the
 * answer's remind_code (tonight's round share code), else the link's code. Without the field: no script, no frame
 * work, and the painted step is today's, byte for byte. The bot sends the field only once a child is picked: on "Whose
 * turn?" (a phone that already holds a child) and on the pick's answer, never on the teacher, letter or chips steps;
 * the pick's answer sends the page to the child's hub at once, so nothing is loaded there.
 * The real page from the real edge router; the page's script runs in a vm; the bot is faked at the network boundary.
 */
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createWebQuizRouter } = require('../../routes/web-quiz.routes');

const CLIENT = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'class-link.js'), 'utf8');
const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const CODE = 'KZ7QW3MNPX';

// ---- the edge, with the bot faked ----
function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function start(app) { return new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); }); }
function req(srv, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    // a fresh connection per request (agent: false): no kept-alive socket the server may be closing as it is reused
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p, agent: false,
      headers: { host: 'quiz.example.org', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function edge({ lang, steps }) {
  const fetchImpl = async (url) => {
    if (url.startsWith(`${BOT}/api/internal/wq/cl/${CODE}`)) return jsonRes(200, { lang });
    const m = /\/api\/internal\/wq\/cl\/(arrive|teacher|letter|pick)$/.exec(url);
    if (m && steps[m[1]]) return jsonRes(200, steps[m[1]]);
    return jsonRes(404, { error: 'not_found' });
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, canonicalBase: '' }));
  return app;
}

// ---- a small DOM: the page's root, its buttons (by attribute or id), the slot, the head's own script tag ----
function attrOf(tag, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}
function makeRoot() {
  const root = { innerHTML: '' };
  root.querySelectorAll = (sel) => {
    const id = /^#([\w-]+)$/.exec(sel);
    const at = /^\[([\w-]+)\]$/.exec(sel);
    const tags = root.innerHTML.match(/<button\b[^>]*>/g) || [];
    return tags.filter((t) => (id ? attrOf(t, 'id') === id[1] : at ? attrOf(t, at[1]) !== null : false)).map((t) => {
      const handlers = [];
      const el = { getAttribute: (n) => attrOf(t, n), addEventListener: (type, fn) => { if (type === 'click') handlers.push(fn); }, click: () => handlers.forEach((f) => f()) };
      (root.clicks = root.clicks || []).push({ sel, el });
      return el;
    });
  };
  root.querySelector = (sel) => {
    if (sel !== '#wq-remind') return null;
    const m = /<div id="wq-remind"([^>]*)><\/div>/.exec(root.innerHTML);
    return m ? { id: 'wq-remind', src: attrOf(m[0], 'data-src'), screen: root.innerHTML } : null;
  };
  return root;
}
const tap = (root, sel) => { const hit = (root.clicks || []).filter((c) => c.sel === sel).pop(); hit.el.click(); };

/** A fresh profile opens /j/<code>: the real page, then its own script, whose fetches go to the real edge. */
async function openLink({ lang = 'en', steps, frames: useFrames = true }) {
  const srv = await start(edge({ lang, steps }));
  const page = await req(srv, 'GET', `/j/${CODE}`);
  expect(page.status).toBe(200);
  const boot = JSON.parse(page.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const ownSrc = page.body.match(/<script src="(\/wq\/class-link\.js[^"]*)"/)[1];
  const root = makeRoot();
  const store = new Map();
  const appended = [];
  const created = [];
  const frames = [];
  const timers = [];
  let pending = 0;
  const ctx = {
    document: {
      getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : null),
      querySelector: (sel) => (sel === 'script[src*="/wq/class-link.js"]' ? { getAttribute: (n) => (n === 'src' ? ownSrc : null) } : null),
      createElement: (tag) => { const el = { tagName: String(tag).toUpperCase() }; created.push(el); return el; },
      body: { appendChild: (el) => { appended.push(el); return el; } },
    },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    location: { href: `https://quiz.example.org/j/${CODE}`, host: 'quiz.example.org' },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    fetch: async (url, opts) => {
      pending += 1;
      try {
        const r = await req(srv, opts.method, url, JSON.parse(opts.body));
        return { ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(r.body) };
      } finally { pending -= 1; }
    },
  };
  ctx.window = { crypto: crypto.webcrypto };
  if (useFrames) ctx.window.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  vm.createContext(ctx);
  // the page's round trips done, then a beat for its .then(show)
  const settle = () => new Promise((r) => { const tick = () => (pending ? setTimeout(tick, 5) : setTimeout(r, 20)); tick(); });
  vm.runInContext(CLIENT, ctx);
  await settle();
  const flush = () => { frames.splice(0).forEach((f) => f(0)); timers.splice(0).forEach((f) => f()); };
  return {
    root, ctx, appended, created, frames, timers, flush, ownSrc,
    tap: async (sel) => { tap(root, sel); await settle(); },
    close: () => new Promise((r) => srv.close(r)),
  };
}

const KIDS = [
  { chip: 'ch-zara', first: 'Zara', animal: 'cat', round: true },
  { chip: 'ch-ali', first: 'Ali', animal: 'dog' },
];
const CHIPS = [{ chip: 'ch-zara', first: 'Zara' }, { chip: 'ch-zain', first: 'Zain' }, { chip: 'ch-zoya', first: 'Zoya' }];
const remindScripts = (p) => p.appended.filter((el) => el.tagName === 'SCRIPT' && /^\/wq\/wq-remind\.js(\?|$)/.test(el.src || ''));

describe('push_remind: true on the step answer', () => {
  test('"Whose turn?": after the paint, ONE /wq/wq-remind.js with the page script\'s own ?v=; on its load, mount once with src class_link and the round code', async () => {
    const p = await openLink({ steps: { arrive: { step: 'who', s: 'st', kids: KIDS, push_remind: true, remind_code: 'RND234' } } });
    try {
      // the paint never waits on it: nothing appended until the next frame
      expect(p.root.innerHTML).toContain('<div id="wq-remind" data-src="class_link"></div>');
      expect(p.appended).toHaveLength(0);
      p.flush();
      const s = remindScripts(p);
      expect(s).toHaveLength(1);
      const v = /[?&]v=([A-Za-z0-9_-]+)/.exec(p.ownSrc)[1];
      expect(s[0].src).toBe(`/wq/wq-remind.js?v=${v}`);
      const mount = jest.fn();
      p.ctx.window.WQREMIND = { mount };
      s[0].onload();
      expect(mount).toHaveBeenCalledTimes(1);
      const [slot, ctx] = mount.mock.calls[0];
      expect(slot).toMatchObject({ id: 'wq-remind', src: 'class_link' });
      expect(ctx).toEqual({ code: 'RND234', lang: 'en', chips: 2, host: 'quiz.example.org', src: 'class_link' });
    } finally { await p.close(); }
  });

  test('"Whose turn?" in Urdu, no remind_code: mount with the link\'s code, the chips this screen shows, the page\'s language', async () => {
    const p = await openLink({ lang: 'ur', steps: { arrive: { step: 'who', s: 'st', kids: KIDS, push_remind: true } } });
    try {
      p.flush();
      const s = remindScripts(p);
      expect(s).toHaveLength(1);
      const mount = jest.fn();
      p.ctx.window.WQREMIND = { mount };
      s[0].onload();
      expect(mount).toHaveBeenCalledTimes(1);
      expect(mount.mock.calls[0][1]).toEqual({ code: CODE, lang: 'ur', chips: 2, host: 'quiz.example.org', src: 'class_link' });
    } finally { await p.close(); }
  });

  test('a fresh phone: teacher -> letter -> "Is your name here?" (no field on any) -> the pick, whose answer carries it: nothing is loaded, the page goes to the hub', async () => {
    const href = '/h/tok123?from=class_link';
    const steps = {
      arrive: { step: 'teacher', s: 'st1', teachers: [{ tk: 'tk1', name: 'Rifat Test' }] },
      teacher: { step: 'letter', script: 'latin', letters: ['A', 'Z'], s: 'st2' },
      letter: { step: 'chips', s: 'st3', kids: CHIPS },
      pick: { href, push_remind: true, remind_code: 'RND234' },
    };
    const p = await openLink({ steps });
    try {
      await p.tap('[data-tk]');
      await p.tap('[data-l]');
      expect(p.root.innerHTML).toContain('Is your name here?');
      p.flush();
      expect(p.frames).toHaveLength(0);
      expect(p.appended).toHaveLength(0);
      await p.tap('[data-chip]');
      expect(p.ctx.location.href).toBe(href);
      p.flush();
      expect(remindScripts(p)).toHaveLength(0);
    } finally { await p.close(); }
  });

  // a guard of the page's own: the bot sends the field on no step before a pick, so a second ask never comes this way
  test('once per page: "Whose turn?" -> a child not listed -> teacher -> letter -> chips loads the script once and mounts once', async () => {
    const steps = {
      arrive: { step: 'who', s: 'st', kids: KIDS, push_remind: true, remind_code: 'RND234', other: { step: 'teacher', s: 'st2', teachers: [{ tk: 'tk1', name: 'Rifat Test' }] } },
      teacher: { step: 'letter', script: 'latin', letters: ['A', 'Z'], s: 'st3' },
      letter: { step: 'chips', s: 'st4', kids: CHIPS, push_remind: true, remind_code: 'RND234' },
    };
    const p = await openLink({ steps });
    try {
      p.flush();
      const mount = jest.fn();
      p.ctx.window.WQREMIND = { mount };
      remindScripts(p)[0].onload();
      await p.tap('#wq-cl-other');
      await p.tap('[data-tk]');
      await p.tap('[data-l]');
      expect(p.root.innerHTML).toContain('Is your name here?');
      p.flush();
      expect(remindScripts(p)).toHaveLength(1);
      expect(mount).toHaveBeenCalledTimes(1);
    } finally { await p.close(); }
  });

  test('no requestAnimationFrame: the load still waits for a timer, never the paint', async () => {
    const p = await openLink({ frames: false, steps: { arrive: { step: 'who', s: 'st', kids: KIDS, push_remind: true } } });
    try {
      expect(p.appended).toHaveLength(0);
      p.flush(); // the first timer
      p.flush(); // the timer it sets
      expect(remindScripts(p)).toHaveLength(1);
    } finally { await p.close(); }
  });

  test('the card script failing to define WQREMIND (or the slot gone): no mount, no throw', async () => {
    const p = await openLink({ steps: { arrive: { step: 'who', s: 'st', kids: KIDS, push_remind: true } } });
    try {
      p.flush();
      expect(() => remindScripts(p)[0].onload()).not.toThrow();
    } finally { await p.close(); }
  });
});

describe('no push_remind: today\'s page', () => {
  // today's painted steps, byte for byte (the slot is drawn empty, as before)
  const WHO_TODAY = '<section class="wq-screen"><img class="wq-jugnu" src="/wq/jugnu/hello.webp" alt="" width="96" height="96"><h1>Whose turn?</h1>'
    + '<div class="wq-kids-big"><button class="wq-kid wq-kid-big" data-chip="ch-zara"><span class="wq-ani" aria-hidden="true">🐱</span><span class="wq-cl-nm"><bdi>Zara</bdi><span class="wq-chip wq-cl-ready">Quiz ready</span></span></button>'
    + '<button class="wq-kid wq-kid-big" data-chip="ch-ali"><span class="wq-ani" aria-hidden="true">🐶</span><bdi>Ali</bdi></button></div>'
    + '<div id="wq-remind" data-src="class_link"></div></section>';
  const CHIPS_TODAY = '<section class="wq-screen"><img class="wq-jugnu" src="/wq/jugnu/hello.webp" alt="" width="96" height="96"><h1>Is your name here?</h1>'
    + '<div class="wq-kids-big"><button class="wq-kid wq-kid-big" data-chip="ch-zara"><bdi>Zara</bdi></button><button class="wq-kid wq-kid-big" data-chip="ch-zain"><bdi>Zain</bdi></button><button class="wq-kid wq-kid-big" data-chip="ch-zoya"><bdi>Zoya</bdi></button></div>'
    + '<div id="wq-remind" data-src="class_link"></div><button class="wq-linkbtn" id="wq-cl-back">My name isn&#39;t here</button></section>';

  test.each([
    ['"Whose turn?"', { step: 'who', s: 'st', kids: KIDS }, WHO_TODAY],
    ['the chips step', { step: 'chips', s: 'st', kids: CHIPS }, CHIPS_TODAY],
  ])('%s: no script element, no frame or timer asked for, the paint is today\'s', async (_, arrive, today) => {
    const p = await openLink({ steps: { arrive } });
    try {
      expect(p.root.innerHTML).toBe(today);
      expect(p.frames).toHaveLength(0);
      expect(p.timers).toHaveLength(0);
      p.flush();
      expect(p.created).toHaveLength(0);
      expect(p.appended).toHaveLength(0);
    } finally { await p.close(); }
  });

  test('push_remind anything but true (the string "true", false): nothing loaded', async () => {
    for (const v of ['true', false, 1]) {
      // eslint-disable-next-line no-await-in-loop
      const p = await openLink({ steps: { arrive: { step: 'who', s: 'st', kids: KIDS, push_remind: v } } });
      try {
        p.flush();
        expect(p.appended).toHaveLength(0);
      } finally { await p.close(); } // eslint-disable-line no-await-in-loop
    }
  });

  test('push_remind: true paints the same step as without it (the field changes nothing before the frame)', async () => {
    const a = await openLink({ steps: { arrive: { step: 'who', s: 'st', kids: KIDS } } });
    const b = await openLink({ steps: { arrive: { step: 'who', s: 'st', kids: KIDS, push_remind: true, remind_code: 'RND234' } } });
    try {
      expect(b.root.innerHTML).toBe(a.root.innerHTML);
    } finally { await a.close(); await b.close(); }
  });
});
