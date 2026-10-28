'use strict';
/**
 * Round 8 (sandbox throttle runs, P4: offline at the school after "Get ready"): navigator.serviceWorker.register() asks the
 * network for the worker's script, so with no signal it REJECTS even though the worker is installed and every file is on
 * the phone. Both the coach page's gate (prepVisit / checkVisit) and the child's page (prepare) used to wait on it, so
 * offline they answered "no worker" → the gate refused and the child's page refused the voice. Now an active registration is
 * used as it is (the update is asked for behind it, its failure ignored); only a phone with no worker yet registers first.
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

function offlineNav() {
  const posted = [];
  const sw = { postMessage: (msg, [port]) => { posted.push(msg); port.cb({ data: { ok: true, cached: msg.urls.length, missing: [], bytes: 0 } }); } };
  const reg = { active: sw, installing: null, waiting: null };
  const nav = {
    serviceWorker: {
      register: jest.fn(() => Promise.reject(new TypeError('Failed to fetch the script'))),
      getRegistration: jest.fn(() => Promise.resolve(reg)),
      get ready() { return Promise.resolve(reg); },
      controller: sw,
    },
  };
  return { nav, posted };
}

test('offline with the worker installed: checkVisit uses it (register rejects, nothing breaks)', async () => {
  const { nav, posted } = offlineNav();
  const { checkVisit } = load(nav);
  const r = await checkVisit({ forms: ['sa.coach.G3.A.ur'], readBattery: async () => ({ tasks: [] }) });
  expect(r.ready).toBe(true);
  expect(posted[0].type).toBe('check');
  expect(nav.serviceWorker.getRegistration).toHaveBeenCalledWith('/sa/');
});

test('offline with the worker installed: the child\'s page prepare() still answers from the phone', async () => {
  const { nav, posted } = offlineNav();
  const { prepare } = load(nav);
  const r = await prepare({ battery_url: '/sa/batteries/sa.coach.G3.A.ur.json', battery: { tasks: [] }, lang: 'ur', base: '/' });
  expect(r.battery).toBe(true);
  expect(r.ready).toBe(true);
  expect(posted.length).toBeGreaterThan(0);
});

test('no worker yet: it registers first (online, the first open)', async () => {
  const sw = { postMessage: (msg, [port]) => port.cb({ data: { ok: true, cached: msg.urls.length, missing: [], bytes: 0 } }) };
  const reg = { active: sw };
  const nav = { serviceWorker: { register: jest.fn(() => Promise.resolve(reg)), getRegistration: jest.fn(() => Promise.resolve(undefined)), get ready() { return Promise.resolve(reg); } } };
  const { checkVisit } = load(nav);
  expect((await checkVisit({ forms: ['sa.coach.G3.A.ur'], readBattery: async () => ({ tasks: [] }) })).ready).toBe(true);
  expect(nav.serviceWorker.register).toHaveBeenCalledWith('/sa/sw.js', { scope: '/sa/' });
});
