'use strict';
/**
 * The worker's session cache (dashboard/sa/sw.js): batteries are kept cache-first under SESSION, so a phone that cached a
 * battery before a switch flip keeps the old one until SESSION changes. v4 drops what v3 kept; activate deletes every older
 * sa-session-* cache and leaves the current one, the core cache and anything that is not the engine's.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../sa/sw.js'), 'utf8');

function bootWorker(existing) {
  const listeners = {};
  const kept = new Set(existing);
  const deleted = [];
  const self = {
    location: { href: 'https://portal.test/sa/sw.js' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const caches = {
    keys: () => Promise.resolve([...kept]),
    delete: (k) => { deleted.push(k); kept.delete(k); return Promise.resolve(true); },
    open: () => Promise.resolve({ put: () => Promise.resolve(), match: () => Promise.resolve(undefined) }),
  };
  vm.runInNewContext(SRC, { self, caches, URL, Promise, fetch: () => Promise.reject(new Error('offline')), setTimeout, clearTimeout, console });
  return { listeners, kept, deleted };
}

test('the session cache is sa-session-v34 (the English letter names e, B, t and d play production\'s v4 takes again)', () => {
  expect(require('../sa/sw').SESSION).toBe('sa-session-v34');
});

test('activate deletes every older sa-session cache (v1 to v33) and keeps v34, the current core and other caches', async () => {
  const { CORE } = require('../sa/sw');
  const w = bootWorker(['sa-session-v1', 'sa-session-v2', 'sa-session-v3', 'sa-session-v4', 'sa-session-v5', 'sa-session-v6', 'sa-session-v7', 'sa-session-v8', 'sa-session-v9', 'sa-session-v10', 'sa-session-v11', 'sa-session-v12', 'sa-session-v13', 'sa-session-v14', 'sa-session-v15', 'sa-session-v16', 'sa-session-v17', 'sa-session-v18', 'sa-session-v19', 'sa-session-v20', 'sa-session-v21', 'sa-session-v22', 'sa-session-v23', 'sa-session-v24', 'sa-session-v25', 'sa-session-v26', 'sa-session-v27', 'sa-session-v28', 'sa-session-v29', 'sa-session-v30', 'sa-session-v31', 'sa-session-v32', 'sa-session-v33', 'sa-session-v34', CORE, 'sa-core-sa-3', 'sa-core-sa-4', 'sa-core-sa-5', 'sa-core-sa-14', 'wq-cache']);
  let done;
  w.listeners.activate({ waitUntil: (p) => { done = p; } });
  await done;
  expect(w.deleted.sort()).toEqual(['sa-core-sa-14', 'sa-core-sa-3', 'sa-core-sa-4', 'sa-core-sa-5', 'sa-session-v1', 'sa-session-v2', 'sa-session-v3', 'sa-session-v4', 'sa-session-v5', 'sa-session-v6', 'sa-session-v7', 'sa-session-v8', 'sa-session-v9', 'sa-session-v10', 'sa-session-v11', 'sa-session-v12', 'sa-session-v13', 'sa-session-v14', 'sa-session-v15', 'sa-session-v16', 'sa-session-v17', 'sa-session-v18', 'sa-session-v19', 'sa-session-v20', 'sa-session-v21', 'sa-session-v22', 'sa-session-v23', 'sa-session-v24', 'sa-session-v25', 'sa-session-v26', 'sa-session-v27', 'sa-session-v28', 'sa-session-v29', 'sa-session-v30', 'sa-session-v31', 'sa-session-v32', 'sa-session-v33'].sort());
  expect([...w.kept].sort()).toEqual([CORE, 'sa-session-v34', 'wq-cache'].sort());
});
