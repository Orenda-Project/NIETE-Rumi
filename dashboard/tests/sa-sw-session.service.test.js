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
  vm.runInNewContext(SRC, { self, caches, URL, Promise, fetch: () => Promise.reject(new Error('offline')), setTimeout, console });
  return { listeners, kept, deleted };
}

test('the session cache is sa-session-v7 (round 8 close: v4 clips re-made under their keys, the batteries\' new lines)', () => {
  expect(require('../sa/sw').SESSION).toBe('sa-session-v7');
});

test('activate deletes every older sa-session cache (v1 to v6) and keeps v7, the current core and other caches', async () => {
  const { CORE } = require('../sa/sw');
  const w = bootWorker(['sa-session-v1', 'sa-session-v2', 'sa-session-v3', 'sa-session-v4', 'sa-session-v5', 'sa-session-v6', 'sa-session-v7', CORE, 'sa-core-sa-3', 'sa-core-sa-4', 'sa-core-sa-5', 'sa-core-sa-14', 'wq-cache']);
  let done;
  w.listeners.activate({ waitUntil: (p) => { done = p; } });
  await done;
  expect(w.deleted.sort()).toEqual(['sa-core-sa-14', 'sa-core-sa-3', 'sa-core-sa-4', 'sa-core-sa-5', 'sa-session-v1', 'sa-session-v2', 'sa-session-v3', 'sa-session-v4', 'sa-session-v5', 'sa-session-v6']);
  expect([...w.kept].sort()).toEqual([CORE, 'sa-session-v7', 'wq-cache'].sort());
});
