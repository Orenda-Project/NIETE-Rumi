'use strict';

/**
 * The session row says which engine served the child's page: device.bundle_v, the service worker's engine cache
 * (dashboard/sa/sw.js CORE = 'sa-core-' + VERSION). The coach sink (dashboard/sa/sink-coach.js) reads it from the page's
 * own caches when a worker controls the page: exactly one sa-core-* cache is the served engine. No worker, no cache, two
 * of them (a new worker installing) or a read that fails is unknown and is left out, so it never overwrites what the row
 * already has. The store's DEVICE_FIELDS already list bundle_v; no server change.
 */

const mockPatches = [];
let mockRow;
jest.mock('../../shared/config/supabase', () => {
  const q = (table) => {
    const c = {
      select: () => c, eq: () => c, limit: () => Promise.resolve({ data: [mockRow], error: null }),
      update: (p) => { mockPatches.push({ table, p }); if (p.device) mockRow = { ...mockRow, device: p.device }; return { eq: () => Promise.resolve({ error: null }) }; },
    };
    return c;
  };
  return { from: (t) => q(t) };
});

const store = require('../../shared/services/child-test/sa-store');
const sa = require('../../shared/services/child-test/app/sa-api.service');
const { create } = require('../../../dashboard/sa/sink-coach.js');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';

beforeEach(() => {
  mockPatches.length = 0;
  mockRow = { id: 's1', admin_mode: 'coach_present', device: { block: 'rdf_auto' }, client_started_at: null, client_finished_at: null };
});

/** A page: controlled by a worker (or not), its caches' names (or a keys() that fails / never answers). */
function win({ controlled = true, keys = ['sa-core-sa-27', 'sa-session-v26'], fail = false, hang = false } = {}) {
  return {
    innerWidth: 360, innerHeight: 640, devicePixelRatio: 2,
    navigator: { userAgent: 'Test', serviceWorker: { controller: controlled ? { state: 'activated' } : null } },
    caches: { keys: () => (hang ? new Promise(() => {}) : fail ? Promise.reject(new Error('blocked')) : Promise.resolve(keys)) },
  };
}

/** The phone's batch, end to end: the coach sink's POST body → saBatch → the real store. */
async function sync(w, seq) {
  const bodies = [];
  const f = async (u, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ackedTo: seq }) }; };
  await create({ fetch: f, localStorage: null, window: w }).putBatch({ session_id: 's1', seq_from: seq, seq_to: seq, events: [], results: [] });
  const body = bodies[0];
  const session = { id: 's1', coach_user_id: COACH, school_id: SCHOOL, item_bank_version: 'sa-battery', status: 'in_progress', device: mockRow.device };
  const deps = {
    enabled: async () => true,
    supabase: { from: () => ({ select() { return this; }, eq() { return this; }, in() { return this; }, limit() { return this; }, then: (res) => Promise.resolve({ data: [{ school_id: SCHOOL, school_name: 'Testwala School' }], error: null }).then(res) }) },
    store: { getSession: async () => ({ ok: true, session }), recordTiming: async () => ({ ok: true }), setSessionStatus: async () => ({ ok: true }) },
    saStore: store,
    now: () => new Date('2026-11-18T09:00:00Z'), log: () => {}, logError: () => {},
  };
  const out = await sa.saBatch({ userId: COACH, sessionId: 's1', seqFrom: body.seqFrom, seqTo: body.seqTo, events: body.events, results: body.results, device: body.device }, deps);
  return { body, out };
}
const rowBundle = () => (mockRow.device.bundle_v === undefined ? null : mockRow.device.bundle_v);

test('a page served by the worker: the batch carries bundle_v sa-core-sa-27 and the session row keeps it', async () => {
  const { body, out } = await sync(win(), 1);
  expect(body.device.bundle_v).toBe('sa-core-sa-27');
  expect(out).toEqual({ status: 'ok', ackedTo: 1 });
  expect(mockPatches[mockPatches.length - 1].p.device).toMatchObject({ bundle_v: 'sa-core-sa-27', vw: 360, vh: 640 });
  expect(rowBundle()).toBe('sa-core-sa-27');
});

test.each([
  ['no worker controls the page', { controlled: false }],
  ['no engine cache', { keys: ['sa-session-v26', 'other'] }],
  ['two engine caches (a new worker installing)', { keys: ['sa-core-sa-26', 'sa-core-sa-27'] }],
  ['the caches read fails', { fail: true }],
])('%s: no bundle_v is sent; the row has none (null)', async (_, o) => {
  const { body } = await sync(win(o), 1);
  expect(body.device).not.toHaveProperty('bundle_v');
  expect(rowBundle()).toBeNull();
});

test('a caches read that never answers does not hold the batch: it goes without bundle_v', async () => {
  const t0 = Date.now();
  const { body, out } = await sync(win({ hang: true }), 1);
  expect(out).toEqual({ status: 'ok', ackedTo: 1 });
  expect(body.device).not.toHaveProperty('bundle_v');
  expect(Date.now() - t0).toBeLessThan(2000);
});

test('a later batch that cannot tell keeps the row\'s known bundle_v; a new engine replaces it', async () => {
  await sync(win(), 1);
  await sync(win({ controlled: false }), 2);
  expect(rowBundle()).toBe('sa-core-sa-27');
  await sync(win({ keys: ['sa-core-sa-28'] }), 3);
  expect(rowBundle()).toBe('sa-core-sa-28');
});

test('a page with no caches API (an old browser, the Node harness): the batch is as before', async () => {
  const { body } = await sync({ innerWidth: 360, innerHeight: 640, devicePixelRatio: 2, navigator: { userAgent: 'Test' } }, 1);
  expect(body.device).toEqual({ mic_ok: false, vw: 360, vh: 640, dpr: 2, ua: 'Test' });
});
