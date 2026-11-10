'use strict';

/**
 * Which RDF flow a test ran is the session's device.block: 'rdf_auto' (Jugnu gives the instructions) or 'rdf_manual'
 * (the coach does). The coach's page sends it with the present outcome; the store keeps the first one it hears, no later
 * call without a block takes it away, and a failure to record it never stops the child's test.
 */

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const CLIENT = '11111111-2222-4333-8444-555555555555';
const NEW = '22222222-3333-4444-8555-666666666666';
const SID = 'sess-1';

/** sa-store over a fake child_test_sessions row; every update is recorded and applied. */
function storeOver(session) {
  jest.resetModules();
  const updates = [];
  jest.doMock('../../shared/config/supabase', () => ({
    from: (table) => {
      const q = { _patch: null };
      q.select = () => q; q.eq = () => q; q.is = () => q; q.limit = () => q;
      q.update = (p) => { q._patch = p; return q; };
      q.then = (res, rej) => {
        if (q._patch) {
          updates.push([table, q._patch]);
          if (table === 'child_test_sessions') Object.assign(session, q._patch);
          return Promise.resolve({ error: null }).then(res, rej);
        }
        return Promise.resolve({ data: table === 'child_test_sessions' ? [session] : [], error: null }).then(res, rej);
      };
      return q;
    },
  }));
  jest.doMock('../../shared/utils/logger', () => ({ logError: () => {}, logInfo: () => {} }));
  // eslint-disable-next-line global-require
  return { store: require('../../shared/services/child-test/sa-store'), updates };
}

const fresh = () => ({ id: SID, admin_mode: null, client_session_id: null, status: 'in_progress', device: null });

describe('the RDF mode on the session (sa-store)', () => {
  test.each(['rdf_auto', 'rdf_manual'])('the present outcome stores %s', async (block) => {
    const session = fresh();
    const { store } = storeOver(session);
    expect(await store.setClient(SID, { clientSessionId: CLIENT, block })).toEqual({ ok: true });
    expect(session.device.block).toBe(block);
  });

  test('a sync without a block, or a re-sent outcome with another block, keeps the first one', async () => {
    const session = fresh();
    const { store } = storeOver(session);
    await store.setClient(SID, { clientSessionId: CLIENT, block: 'rdf_manual' });
    await store.markSynced(SID, { lastSeq: 4, device: { mic_ok: true }, events: [{ seq: 1, type: 'warmup_result' }] });
    await store.markSynced(SID, { lastSeq: 9, block: 'rdf_auto' });
    await store.setClient(SID, { clientSessionId: CLIENT, block: null });
    await store.setClient(SID, { clientSessionId: CLIENT, block: 'rdf_auto' });
    expect(session.device.block).toBe('rdf_manual');
    expect(session.admin_mode).toBe('coach_present');
  });

  test('a Restart that names no block keeps the block the session had', async () => {
    const session = { ...fresh(), client_session_id: CLIENT, device: { block: 'rdf_manual', events: [] } };
    const { store } = storeOver(session);
    expect(await store.restartAttempt(SID, { clientSessionId: NEW, block: null, at: '2026-11-10T09:00:00.000Z' })).toEqual({ ok: true, attempt: 1 });
    expect(session.device.block).toBe('rdf_manual');
  });

  test('a Restart with a block takes the coach\'s new choice', async () => {
    const session = { ...fresh(), client_session_id: CLIENT, device: { block: 'rdf_manual', events: [] } };
    const { store } = storeOver(session);
    await store.restartAttempt(SID, { clientSessionId: NEW, block: 'rdf_auto', at: '2026-11-10T09:00:00.000Z' });
    expect(session.device.block).toBe('rdf_auto');
  });
});

describe('a failure to record the mode never stops the test (dayOutcome)', () => {
  // eslint-disable-next-line global-require
  const sa = () => require('../../shared/services/child-test/app/sa-api.service');

  function world(setClient) {
    const session = { id: SID, coach_user_id: COACH, draw_id: 'd-1', school_id: SCHOOL, visit_key: 'day:x', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'in_progress', device: null };
    const logged = [];
    const deps = {
      enabled: async () => true,
      supabase: { from: () => { const q = { select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q, then: (r, j) => Promise.resolve({ data: [{ school_id: SCHOOL, school_name: 'Testwala School' }], error: null }).then(r, j) }; return q; } },
      store: {
        getSession: async () => ({ ok: true, session }),
        getSessionByDraw: async () => ({ ok: true, session: null }),
        listSessionsForVisit: async () => ({ ok: true, sessions: [] }),
        createSession: async () => ({ ok: true, session }),
        recordTiming: async () => ({ ok: true }),
      },
      saStore: { findByClient: async () => ({ ok: true, sessionId: null }), setClient },
      draw: { markOutcome: async () => ({ ok: true, list: null }) },
      now: () => new Date('2026-11-10T09:00:00Z'),
      log: () => {}, logError: (k) => { logged.push(k); },
      blockByHistory: false,
      rdfW3Forms: true,
    };
    return { deps, logged };
  }

  const present = (deps, block) => sa().dayOutcome({ userId: COACH, schoolId: SCHOOL, drawId: 'd-1', outcome: 'present', clientSessionId: CLIENT, block }, deps);

  test.each(['rdf_auto', 'rdf_manual'])('%s is handed to the store with the outcome', async (block) => {
    const seen = [];
    const { deps } = world(async (id, v) => { seen.push([id, v]); return { ok: true }; });
    const out = await present(deps, block);
    expect(out).toMatchObject({ status: 'ok', sessionId: SID });
    expect(seen).toEqual([[SID, { clientSessionId: CLIENT, block }]]);
  });

  test('the store answers not ok: the child is still present, the session id comes back', async () => {
    const { deps, logged } = world(async () => ({ ok: false, error: 'boom' }));
    expect(await present(deps, 'rdf_auto')).toMatchObject({ status: 'ok', sessionId: SID });
    expect(logged).toContain('child_test.sa.client_not_kept');
  });

  test('the store throws: the child is still present, the session id comes back', async () => {
    const { deps, logged } = world(async () => { throw new Error('socket hang up'); });
    expect(await present(deps, 'rdf_manual')).toMatchObject({ status: 'ok', sessionId: SID });
    expect(logged).toContain('child_test.sa.client_not_kept');
  });
});
