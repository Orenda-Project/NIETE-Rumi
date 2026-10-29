'use strict';
/**
 * "Get ready" on a phone that still runs the previous worker: no 'prepare' or 'check' may go to a worker while
 * (a) reg.update() is still unanswered, or (b) the registration holds a worker newer than the one the message would go to.
 * A busy old worker keeps the new one from activating, and everything it keeps is deleted when the new one takes over.
 * A field run on a slow portal: update() answered after 10.5 s, the first prepare had already gone to the old worker at
 * 10 s, the new worker installed at 37.5 s and never activated while the old one took 37 more prepares; the card then
 * said "1 file left" instead of the real reason. These tests replay that run with a fake registration.
 */

function load(nav) {
  let mod;
  jest.isolateModules(() => {
    global.self = { navigator: nav, MessageChannel: class { constructor() { const p2 = { onmessage: null }; this.port1 = { set onmessage(f) { p2.cb = f; } }; this.port2 = p2; } } };
    mod = require('../sa/sa-offline');
  });
  delete global.self;
  return mod;
}

function worker(name, posted, opts) {
  const listeners = [];
  return {
    name,
    state: 'activated',
    addEventListener: (ev, f) => { if (ev === 'statechange') listeners.push(f); },
    fire(state) { this.state = state; listeners.forEach((f) => f()); },
    postMessage(msg, [port]) {
      posted.push({ to: name, type: msg.type, urls: msg.urls || [] });
      if (opts && opts.onPost) opts.onPost(posted.length);
      const missing = opts && opts.missing ? (msg.urls || []).slice(0, opts.missing) : [];
      port.cb({ data: { ok: !missing.length, cached: (msg.urls || []).length - missing.length, missing, bytes: 0 } });
    },
  };
}

/** A v6 phone: the old worker active, v7 on the server. o.updateMs = when update() answers (Infinity: never). */
function phone(o) {
  const posted = [];
  const v6 = worker('v6', posted, o.old);
  const v7 = worker('v7', posted);
  v7.state = 'installing';
  const reg = { active: v6, installing: null, waiting: null };
  const arrive = () => {
    reg.installing = v7;
    if (o.activateMs != null) setTimeout(() => { reg.installing = null; reg.active = v7; v7.fire('activated'); }, o.activateMs);
  };
  reg.update = jest.fn(() => new Promise((ok) => {
    if (o.updateMs === Infinity) return;
    setTimeout(() => { if (o.finds !== false) arrive(); ok(reg); }, o.updateMs || 0);
  }));
  const nav = {
    serviceWorker: {
      register: jest.fn(() => Promise.resolve(reg)),
      getRegistration: jest.fn(() => Promise.resolve(reg)),
      get ready() { return Promise.resolve(reg); },
      controller: v6,
    },
  };
  return { nav, posted, reg, v6, v7, arrive };
}

const VISIT = { forms: ['sa.coach.G2.A.ur'], chunk: 2, readBattery: async () => ({ tasks: [] }) };

async function withTimers(fn) {
  jest.useFakeTimers();
  try { await fn(); } finally { jest.useRealTimers(); }
}

test('update() answers after 10.5 s: nothing is posted before it answers, and every prepare goes to the new worker', () => withTimers(async () => {
  const p0 = phone({ updateMs: 10500, activateMs: 2000 });
  const run = load(p0.nav).prepVisit(VISIT);
  await jest.advanceTimersByTimeAsync(10400);
  expect(p0.posted.length).toBe(0);
  await jest.advanceTimersByTimeAsync(3000);
  const r = await run;
  expect(r.ok).toBe(true);
  expect(p0.posted.length).toBeGreaterThan(0);
  expect(p0.posted.filter((x) => x.to === 'v6')).toEqual([]);
}));

test('update() never answers: not ready, why worker_update_pending, and nothing is posted to any worker', () => withTimers(async () => {
  const p0 = phone({ updateMs: Infinity });
  const off = load(p0.nav);
  const run = off.prepVisit(VISIT);
  await jest.advanceTimersByTimeAsync(61000);
  const r = await run;
  expect(r.ok).toBe(false);
  expect(r.why).toBe('worker_update_pending');
  expect(p0.posted).toEqual([]);
  const c = off.checkVisit(VISIT);
  await jest.advanceTimersByTimeAsync(61000);
  const k = await c;
  expect(k.ready).toBe(false);
  expect(k.why).toBe('worker_update_pending');
  expect(p0.posted).toEqual([]);
}));

test('a newer worker turns up mid-loop and activates: posting stops, then the whole visit goes to the new worker', () => withTimers(async () => {
  let p0;
  // update() finds nothing; another page's update finds v7 after the old worker took 2 messages
  p0 = phone({ updateMs: 100, finds: false, old: { onPost: (n) => { if (n === 2) { p0.arrive(); setTimeout(() => { p0.reg.installing = null; p0.reg.active = p0.v7; p0.v7.fire('activated'); }, 1500); } } } });
  const run = load(p0.nav).prepVisit(VISIT);
  await jest.advanceTimersByTimeAsync(5000);
  const r = await run;
  expect(r.ok).toBe(true);
  expect(p0.posted.filter((x) => x.to === 'v6').length).toBe(2);
  const toNew = p0.posted.filter((x) => x.to === 'v7');
  // the new worker got the battery and every picture again (the old worker's copies go when it is replaced)
  const sentNew = new Set(toNew.flatMap((x) => x.urls));
  const sentOld = new Set(p0.posted.filter((x) => x.to === 'v6').flatMap((x) => x.urls));
  sentOld.forEach((u) => expect(sentNew.has(u)).toBe(true));
  expect(sentNew.has('/sa/batteries/sa.coach.G2.A.ur.json')).toBe(true);
}));

test('a newer worker turns up mid-loop and never activates: no more posts to the old one, not ready worker_update_pending', () => withTimers(async () => {
  let p0;
  p0 = phone({ updateMs: 100, finds: false, old: { onPost: (n) => { if (n === 2) p0.arrive(); } } });
  const run = load(p0.nav).prepVisit(VISIT);
  await jest.advanceTimersByTimeAsync(61000);
  const r = await run;
  expect(r.ok).toBe(false);
  expect(r.why).toBe('worker_update_pending');
  expect(p0.posted.length).toBe(2);
}));

test('the old worker also missed a file: the answer names the update, not the file count', () => withTimers(async () => {
  let p0;
  p0 = phone({ updateMs: 100, finds: false, old: { missing: 1, onPost: (n) => { if (n === 1) p0.arrive(); } } });
  const run = load(p0.nav).prepVisit(VISIT);
  await jest.advanceTimersByTimeAsync(61000);
  const r = await run;
  expect(r.ok).toBe(false);
  expect(r.why).toBe('worker_update_pending');
}));

test('checkVisit: no check is posted while update() is unanswered; it goes to the new worker once that is active', () => withTimers(async () => {
  const p0 = phone({ updateMs: 10500, activateMs: 2000 });
  const run = load(p0.nav).checkVisit(VISIT);
  await jest.advanceTimersByTimeAsync(10400);
  expect(p0.posted.length).toBe(0);
  await jest.advanceTimersByTimeAsync(3000);
  const r = await run;
  expect(r.ready).toBe(true);
  expect(p0.posted.length).toBeGreaterThan(0);
  expect(p0.posted.every((x) => x.to === 'v7')).toBe(true);
}));
