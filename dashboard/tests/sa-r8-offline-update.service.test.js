'use strict';
/**
 * A phone that still runs the previous worker (an older SESSION) and presses "Get ready": register() with the same script URL
 * does not look for a new worker, so every 'prepare' went to the old one and filled the old SESSION cache. The first
 * online child start then installed the new worker, which deleted that cache: the coach was told "ready for offline" and
 * the preparation was gone. Now an active registration is asked to update(); a new worker that appears (or is already
 * installing) is waited for, up to 30 s, and the files go to it. If it is still not active, or its install failed, "Get ready"
 * answers not ready instead of filling a cache that is about to go. Offline, or with no new worker, the active one is used.
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

function worker(name, posted) {
  const listeners = [];
  return {
    name,
    state: 'activated',
    addEventListener: (ev, f) => { if (ev === 'statechange') listeners.push(f); },
    fire(state) { this.state = state; listeners.forEach((f) => f()); },
    postMessage: (msg, [port]) => { posted.push({ to: name, type: msg.type }); port.cb({ data: { ok: true, cached: (msg.urls || []).length, missing: [], bytes: 0 } }); },
  };
}

/**
 * update: 'new' (a new worker installs, then activates after activateMs), 'none', 'offline', 'stuck' (never activates),
 * 'redundant' (its install fails after activateMs), 'already' (it is installing before update() is called; activates after activateMs).
 */
function phone(update, activateMs) {
  const posted = [];
  const v6 = worker('v6', posted);
  const v7 = worker('v7', posted);
  v7.state = 'installing';
  const reg = { active: v6, installing: null, waiting: null };
  const activate = () => setTimeout(() => { reg.installing = null; reg.active = v7; v7.fire('activated'); }, activateMs || 0);
  if (update === 'already') { reg.installing = v7; activate(); }
  reg.update = jest.fn(() => {
    if (update === 'offline') return Promise.reject(new TypeError('Failed to update a ServiceWorker'));
    if (update === 'new' || update === 'stuck' || update === 'redundant') {
      reg.installing = v7;
      if (update === 'new') activate();
      if (update === 'redundant') setTimeout(() => { reg.installing = null; v7.fire('redundant'); }, activateMs || 0);
    }
    return Promise.resolve(reg);
  });
  const nav = {
    serviceWorker: {
      register: jest.fn(() => Promise.resolve(reg)),
      getRegistration: jest.fn(() => Promise.resolve(reg)),
      get ready() { return Promise.resolve(reg); },
      controller: v6,
    },
  };
  return { nav, posted, reg };
}

const SESSION = { battery_url: '/sa/batteries/sa.coach.G2.A.ur.json', battery: { tasks: [] }, lang: 'ur', base: '/' };

test('a new worker is waiting: "Get ready" (prepVisit) prepares into it, not into the old one', async () => {
  const { nav, posted, reg } = phone('new', 50);
  const { prepVisit } = load(nav);
  const r = await prepVisit({ forms: ['sa.coach.G2.A.ur'], readBattery: async () => ({ tasks: [] }) });
  expect(reg.update).toHaveBeenCalled();
  expect(r.ok).toBe(true);
  expect(posted.length).toBeGreaterThan(0);
  expect(posted.every((p) => p.to === 'v7')).toBe(true);
});

test('a new worker is waiting: the child page prepare() and checkVisit go to it', async () => {
  const a = phone('new', 20);
  await load(a.nav).prepare(SESSION);
  expect(a.posted.length).toBeGreaterThan(0);
  expect(a.posted.every((p) => p.to === 'v7')).toBe(true);
  const b = phone('new', 20);
  await load(b.nav).checkVisit({ forms: ['sa.coach.G2.A.ur'], readBattery: async () => ({ tasks: [] }) });
  expect(b.posted.length).toBeGreaterThan(0);
  expect(b.posted.every((p) => p.to === 'v7')).toBe(true);
});

test('offline (update rejects): the installed worker serves at once', async () => {
  const { nav, posted } = phone('offline');
  const r = await load(nav).prepare(SESSION);
  expect(r.battery).toBe(true);
  expect(posted.every((p) => p.to === 'v6')).toBe(true);
});

test('no new worker: nothing changes, the active one is used', async () => {
  const { nav, posted, reg } = phone('none');
  await load(nav).prepare(SESSION);
  expect(reg.update).toHaveBeenCalled();
  expect(posted.every((p) => p.to === 'v6')).toBe(true);
});

const VISIT = { forms: ['sa.coach.G2.A.ur'], readBattery: async () => ({ tasks: [] }) };

async function withTimers(fn) {
  jest.useFakeTimers();
  try { await fn(); } finally { jest.useRealTimers(); }
}

test('a slow install (15 s, a cold portal) is still waited for: "Get ready" goes to the new worker', () => withTimers(async () => {
  const { nav, posted } = phone('new', 15000);
  const p = load(nav).prepVisit(VISIT);
  await jest.advanceTimersByTimeAsync(16000);
  const r = await p;
  expect(r.ok).toBe(true);
  expect(posted.length).toBeGreaterThan(0);
  expect(posted.every((x) => x.to === 'v7')).toBe(true);
}));

test('a worker already installing before update() is waited for too', () => withTimers(async () => {
  const { nav, posted } = phone('already', 3000);
  const p = load(nav).prepVisit(VISIT);
  await jest.advanceTimersByTimeAsync(4000);
  expect((await p).ok).toBe(true);
  expect(posted.every((x) => x.to === 'v7')).toBe(true);
}));

test('a new worker that never activates: "Get ready" says not ready after 30 s and puts nothing into the old worker', () => withTimers(async () => {
  const { nav, posted } = phone('stuck');
  const off = load(nav);
  const p = off.prepVisit(VISIT);
  await jest.advanceTimersByTimeAsync(29000);
  expect(posted.length).toBe(0);
  await jest.advanceTimersByTimeAsync(2000);
  const r = await p;
  expect(r.ok).toBe(false);
  expect(r.why).toBe('worker_update_pending');
  expect(posted.length).toBe(0);
  const c = off.checkVisit(VISIT);
  await jest.advanceTimersByTimeAsync(31000);
  expect((await c).ready).toBe(false);
}));

test('a new worker whose install fails: "Get ready" says not ready (the next online start would replace the old worker)', () => withTimers(async () => {
  const { nav, posted } = phone('redundant', 2000);
  const p = load(nav).prepVisit(VISIT);
  await jest.advanceTimersByTimeAsync(3000);
  const r = await p;
  expect(r.ok).toBe(false);
  expect(r.why).toBe('worker_update_failed');
  expect(posted.length).toBe(0);
}));

test('the child page never waits on it: prepare() with a stuck new worker uses the active one after 30 s', () => withTimers(async () => {
  const { nav, posted } = phone('stuck');
  const p = load(nav).prepare(SESSION);
  await jest.advanceTimersByTimeAsync(31000);
  await p;
  expect(posted.length).toBeGreaterThan(0);
  expect(posted.every((x) => x.to === 'v6')).toBe(true);
}));
