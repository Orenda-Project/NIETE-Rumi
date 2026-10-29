'use strict';
/**
 * A phone that still runs the previous worker (an older SESSION) and presses "Get ready": register() with the same script URL
 * does not look for a new worker, so every 'prepare' went to the old one and filled the old SESSION cache. The first
 * online child start then installed the new worker, which deleted that cache: the coach was told "ready for offline" and
 * the preparation was gone. Now an active registration is asked to update(); a new worker that appears is waited for
 * (bounded) and the files go to the worker that is active then. Offline, or with no new worker, the active one is used.
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

/** update: 'new' (a new worker installs, then activates after activateMs), 'none', 'offline', 'stuck' (never activates). */
function phone(update, activateMs) {
  const posted = [];
  const v6 = worker('v6', posted);
  const v7 = worker('v7', posted);
  v7.state = 'installing';
  const reg = { active: v6, installing: null, waiting: null };
  reg.update = jest.fn(() => {
    if (update === 'offline') return Promise.reject(new TypeError('Failed to update a ServiceWorker'));
    if (update === 'new' || update === 'stuck') {
      reg.installing = v7;
      if (update === 'new') setTimeout(() => { reg.installing = null; reg.active = v7; v7.fire('activated'); }, activateMs || 0);
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

test('a new worker that never activates is waited for 10 s at most, then the active one is used', async () => {
  jest.useFakeTimers();
  try {
    const { nav, posted } = phone('stuck');
    const p = load(nav).prepare(SESSION);
    await jest.advanceTimersByTimeAsync(9000);
    expect(posted.length).toBe(0);
    await jest.advanceTimersByTimeAsync(1500);
    await p;
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((x) => x.to === 'v6')).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
