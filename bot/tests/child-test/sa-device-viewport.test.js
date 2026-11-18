'use strict';

/**
 * Round 28 (data only, no switch): the session's `device` records the phone's viewport and user agent, so a screen-fit
 * read can be cut by the phone that ran it. The coach sink (dashboard/sa/sink-coach.js device()) sends vw / vh (CSS px,
 * whole), dpr (2 decimals) and ua with every batch; the batch route hands `device` to the store (sa-store.js markSynced),
 * whose DEVICE_FIELDS keep them and still drop anything it does not list. Across a session's batches vw is the narrowest
 * CSS width any batch was drawn in (MIN), vh the tallest height (MAX), dpr and ua the last. No schema change: `device` is
 * JSON. The frame of each item rides on the engine's own reads, not on this row.
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
const UA = 'Mozilla/5.0 (Linux; Android 12) Test';

beforeEach(() => {
  mockPatches.length = 0;
  mockRow = { id: 's1', admin_mode: 'coach_present', device: { block: 'rdf_auto' }, client_started_at: null, client_finished_at: null };
});

const win = (w, h, dpr) => ({ innerWidth: w, innerHeight: h, devicePixelRatio: dpr, navigator: { userAgent: UA } });

/** The phone's batch, end to end: the coach sink's POST body → the batch route's arguments → saBatch → the real store. */
async function sync(w, seq) {
  const bodies = [];
  const f = async (u, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ackedTo: seq }) }; };
  await create({ fetch: f, localStorage: null, window: w }).putBatch({ session_id: 's1', seq_from: seq, seq_to: seq, events: [], results: [] });
  const body = bodies[0];
  // bot/shared/routes/child-test-app.routes.js '/sa/batch': userId, sessionId, seqFrom, seqTo, events, results, lang, device
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

test('end to end: the coach sink sends vw / vh / dpr / ua; the batch reaches the store; the session row keeps them', async () => {
  const { body, out } = await sync(win(360.4, 639.6, 2.625), 1);
  expect(body.device).toEqual({ mic_ok: false, vw: 360, vh: 640, dpr: 2.63, ua: UA });
  expect(out).toEqual({ status: 'ok', ackedTo: 1 });
  const stored = mockPatches[mockPatches.length - 1].p.device;
  expect(stored).toMatchObject({ block: 'rdf_auto', vw: 360, vh: 640, dpr: 2.63, ua: UA, mic_ok: false, last_seq: 1 });
});

test('the store keeps vw, vh, dpr and ua and drops a field it does not list', async () => {
  const out = await store.markSynced('s1', { lastSeq: 3, device: { ua: 'x', mic_ok: true, vw: 360, vh: 640, dpr: 2.63, colour: 'blue', phone: '0000' } });
  expect(out.device).toEqual({ block: 'rdf_auto', ua: 'x', mic_ok: true, vw: 360, vh: 640, dpr: 2.63, last_seq: 3 });
  expect(mockPatches[0].p.device).not.toHaveProperty('colour');
  expect(mockPatches[0].p.device).not.toHaveProperty('phone');
});

test('(i) a phone turned between batches (360×640, then 640×360): the row keeps vw 360, vh 640; dpr the last', async () => {
  await sync(win(360, 640, 2), 1);
  await sync(win(640, 360, 3), 2);
  expect(mockRow.device).toMatchObject({ vw: 360, vh: 640, dpr: 3, ua: UA, last_seq: 2 });
});

test('(ii) vw is the narrowest CSS width any batch of this session was drawn in, vh the tallest (412×915, then 320×568 → 320, 915)', async () => {
  await sync(win(412, 915, 2.63), 1);
  await sync(win(320, 568, 2), 2);
  expect(mockRow.device).toMatchObject({ vw: 320, vh: 915, dpr: 2 });
});

test('no window (or no numbers): no viewport fields, nothing else changes', async () => {
  const calls = [];
  const f = async (u, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ackedTo: 2 }) }; };
  await create({ fetch: f, localStorage: null, window: null }).putBatch({ session_id: 's1', seq_from: 1, seq_to: 2, events: [], results: [] });
  await create({ fetch: f, localStorage: null, window: { innerWidth: 'x' } }).putBatch({ session_id: 's1', seq_from: 1, seq_to: 2, events: [], results: [] });
  expect(calls[0].device).toEqual({ mic_ok: false });
  expect(calls[1].device).toEqual({ mic_ok: false });
});
