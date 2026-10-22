'use strict';

/**
 * The coach re-picks the part of a resumed child (app_settings sa_resume_repick, default OFF). A child Present was
 * sent for earlier (another sitting, another host) keeps one unfinished session; ON, a present re-sent with a block
 * and `repick` moves that session to the coach's block, so the battery served is the one the coach chose. OFF, or a
 * finished session, the session keeps its block, as today.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const CLIENT = '11111111-2222-4333-8444-555555555555';
const SID = 'sess-old';

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

/** known: the phone's client id matches the session; else the draw is already marked present (another phone, a reload). */
function world({ on, known = true, status = 'in_progress' } = {}) {
  const session = { id: SID, coach_user_id: COACH, draw_id: 'd-1', visit_key: 'day:x', grade: 5, form: 'A', item_bank_version: 'sa-battery', status, device: { block: 'B4' } };
  const calls = { setBlock: [], setClient: [], created: 0 };
  const store = {
    getSession: async () => ({ ok: true, session }),
    getSessionByDraw: async () => ({ ok: true, session }),
    listSessionsForVisit: async () => ({ ok: true, sessions: [session] }),
    createSession: async () => { calls.created += 1; return { ok: true, session, created: true }; },
    recordTiming: async () => ({ ok: true }),
  };
  const saStore = {
    findByClient: async () => ({ ok: true, sessionId: known ? SID : null }),
    setClient: async (id, v) => { calls.setClient.push([id, v]); return { ok: true }; },
    setBlock: async (id, block) => { calls.setBlock.push([id, block]); return { ok: true }; },
  };
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store, saStore,
    draw: { markOutcome: async () => ({ ok: false, reason: 'already_marked' }) },
    now: () => new Date('2026-10-22T08:00:00Z'),
    log: () => {}, logError: () => {},
    blockByHistory: false,
    ...(on === undefined ? {} : { resumeRepick: on }),
  };
  return { deps, calls };
}

const present = (deps, extra) => sa.dayOutcome({
  userId: COACH, schoolId: SCHOOL, drawId: 'd-1', outcome: 'present', clientSessionId: CLIENT, ...extra,
}, deps);

describe('the coach re-picks the part of a resumed child', () => {
  test('ON, the phone knows the session: the re-sent present moves it to the chosen block and says so', async () => {
    const { deps, calls } = world({ on: true });
    expect(await present(deps, { block: 'B1', repick: true })).toEqual({ status: 'ok', sessionId: SID, list: null, block: 'B1' });
    expect(calls.setBlock).toEqual([[SID, 'B1']]);
    expect(calls.created).toBe(0);
  });

  test('ON, a session the server opened elsewhere (draw already present): moved too', async () => {
    const { deps, calls } = world({ on: true, known: false });
    expect(await present(deps, { block: 'full', repick: true })).toEqual({ status: 'ok', sessionId: SID, list: null, block: 'full' });
    expect(calls.setBlock).toEqual([[SID, 'full']]);
  });

  test('ON, a finished session keeps its block', async () => {
    const { deps, calls } = world({ on: true, status: 'completed' });
    expect(await present(deps, { block: 'B1', repick: true })).toEqual({ status: 'ok', sessionId: SID, list: null });
    expect(calls.setBlock).toEqual([]);
  });

  test('ON, a re-sent present without repick is today\'s answer', async () => {
    const { deps, calls } = world({ on: true });
    expect(await present(deps, { block: 'B1' })).toEqual({ status: 'ok', sessionId: SID, list: null });
    expect(calls.setBlock).toEqual([]);
  });

  test('OFF: repick is ignored, the session keeps its block', async () => {
    for (const known of [true, false]) {
      const { deps, calls } = world({ on: false, known });
      expect(await present(deps, { block: 'B1', repick: true })).toEqual({ status: 'ok', sessionId: SID, list: null });
      expect(calls.setBlock).toEqual([]);
    }
  });

  test('ON, a session opened under another phone\'s id (another host, cleared storage): this phone\'s id now names it', async () => {
    const { deps, calls } = world({ on: true, known: false });
    await present(deps, { block: 'B1', repick: true });
    expect(calls.setClient).toEqual([[SID, { clientSessionId: CLIENT }]]);
  });

  test('ON, the phone already names the session, or a finished one, or OFF: its id is left as it is', async () => {
    for (const w of [world({ on: true, known: true }), world({ on: true, known: false, status: 'completed' }), world({ on: false, known: false })]) {
      await present(w.deps, { block: 'B1', repick: true });
      expect(w.calls.setClient).toEqual([]);
    }
  });

  test('an unknown block is still refused', async () => {
    const { deps, calls } = world({ on: true });
    expect(await present(deps, { block: 'B9', repick: true })).toEqual({ status: 'invalid', reason: 'bad_block' });
    expect(calls.setBlock).toEqual([]);
  });
});
