'use strict';

/**
 * Restart test (app_settings sa_end_test_restart, default OFF). A child the coach ended early (wrong language, wrong child)
 * stays on the list with Restart test. One session per drawn child (child_test_sessions.draw_id is unique), so a restart
 * is a new ATTEMPT on that session: the ended attempt's rows are set aside (r<n>~<task>, never scored, never on Results),
 * its kept events move below a `restart` event (seq -1, { by:'coach', prev:<the ended attempt's phone id>, attempt }),
 * and the session takes the phone's new id and block. A finished child is never restarted. OFF: `restart` is refused.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const OLD = '11111111-2222-4333-8444-555555555555';
const NEW = '22222222-3333-4444-8555-666666666666';
const SID = 'sess-1';

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

function world({ on, status = 'in_progress', coach = COACH, client = OLD } = {}) {
  const session = { id: SID, coach_user_id: coach, draw_id: 'd-1', school_id: SCHOOL, visit_key: 'day:x', grade: 3, form: 'A', item_bank_version: 'sa-battery', status, client_session_id: client, device: { block: 'rdf_auto' } };
  const calls = { restart: [], timings: [], created: 0, markOutcome: 0 };
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store: {
      getSession: async () => ({ ok: true, session }),
      getSessionByDraw: async () => ({ ok: true, session }),
      listSessionsForVisit: async () => ({ ok: true, sessions: [session] }),
      createSession: async () => { calls.created += 1; return { ok: true, session }; },
      recordTiming: async (id, k) => { calls.timings.push([id, k]); return { ok: true }; },
    },
    saStore: {
      findByClient: async () => ({ ok: true, sessionId: null }),
      restartAttempt: async (id, v) => { calls.restart.push([id, v]); return { ok: true, attempt: 1 }; },
    },
    draw: { markOutcome: async () => { calls.markOutcome += 1; return { ok: false, reason: 'already_marked' }; } },
    now: () => new Date('2026-10-27T09:00:00Z'),
    log: () => {}, logError: () => {},
    blockByHistory: false,
    rdfW3Forms: true,
    ...(on === undefined ? {} : { endTestRestart: on }),
  };
  return { deps, calls };
}

const restart = (deps, extra) => sa.dayOutcome({
  userId: COACH, schoolId: SCHOOL, drawId: 'd-1', outcome: 'present', clientSessionId: NEW, block: 'rdf_auto', restart: true, ...extra,
}, deps);

describe('Restart test (bot)', () => {
  test('ON: a new attempt on the same session, with the phone\'s new id and block', async () => {
    const { deps, calls } = world({ on: true });
    expect(await restart(deps)).toEqual({ status: 'ok', sessionId: SID, list: null, restarted: true, block: 'rdf_auto' });
    expect(calls.restart).toEqual([[SID, { clientSessionId: NEW, block: 'rdf_auto', at: '2026-10-27T09:00:00.000Z' }]]);
    expect(calls.timings).toEqual([[SID, 'sa.restarted']]);
    expect(calls.created).toBe(0);
    expect(calls.markOutcome).toBe(0);
  });
  test('ON, re-sent with the same new id (a lost answer): the same answer, no second restart', async () => {
    const { deps, calls } = world({ on: true, client: NEW });
    expect(await restart(deps)).toEqual({ status: 'ok', sessionId: SID, list: null, restarted: true, block: 'rdf_auto' });
    expect(calls.restart).toEqual([]);
  });
  test('ON: a finished child is not restarted; another coach\'s child is not found; no phone id is invalid', async () => {
    expect(await restart(world({ on: true, status: 'completed' }).deps)).toEqual({ status: 'invalid', reason: 'completed' });
    expect(await restart(world({ on: true, coach: 'cccccccc-0000-4000-8000-000000000003' }).deps)).toEqual({ status: 'not_found' });
    expect(await restart(world({ on: true }).deps, { clientSessionId: undefined })).toEqual({ status: 'invalid', reason: 'bad_client_id' });
  });
  test('OFF: restart is refused, nothing changes', async () => {
    const { deps, calls } = world({ on: false });
    expect(await restart(deps)).toEqual({ status: 'invalid', reason: 'restart_off' });
    expect(calls.restart).toEqual([]);
  });
});

describe('restartAttempt (sa-store)', () => {
  test('sets the attempt\'s rows aside, moves the kept events below the restart event, takes the new id and block', async () => {
    jest.resetModules();
    const updates = [];
    const rows = [
      { id: 'r1', block: 'ur.letters', ai_marks: null },
      { id: 'r2', block: 'ur.words', ai_marks: { x: 1 } },
      { id: 'r3', block: 'zz.r1_ur_letters', ai_marks: null },
    ];
    const session = { id: SID, admin_mode: 'coach_present', client_session_id: OLD, status: 'in_progress',
      device: { block: 'rdf_auto', last_seq: 40, mic_ok: true, events: [{ seq: 3, type: 'warmup_result' }, { seq: 9, type: 'end_test', task_id: 'ur.words', data: { by: 'coach' } }] } };
    jest.doMock('../../shared/config/supabase', () => ({
      from: (table) => {
        const q = { _patch: null, _f: {} };
        q.select = () => q; q.eq = (k, v) => { q._f[k] = v; return q; }; q.is = (k, v) => { q._f[`is:${k}`] = v; return q; }; q.limit = () => q;
        q.update = (p) => { q._patch = p; return q; };
        q.then = (res, rej) => {
          if (q._patch) { updates.push([table, q._f.id, q._patch, q._f['is:ai_marks'] === null]); return Promise.resolve({ error: null }).then(res, rej); }
          return Promise.resolve({ data: table === 'child_test_sessions' ? [session] : rows, error: null }).then(res, rej);
        };
        return q;
      },
    }));
    const store = require('../../shared/services/child-test/sa-store');
    const out = await store.restartAttempt(SID, { clientSessionId: NEW, block: 'B2', at: '2026-10-27T09:00:00.000Z' });
    expect(out).toEqual({ ok: true, attempt: 2 });
    const blocks = updates.filter((u) => u[0] === 'child_test_blocks');
    expect(blocks.filter((u) => u[2].block).map((u) => [u[1], u[2].block])).toEqual([['r1', 'zz.r2_ur_letters'], ['r2', 'zz.r2_ur_words']]);
    // the live CHECK child_test_blocks_block_check: a set-aside name is still a valid block name
    for (const u of blocks.filter((x) => x[2].block)) expect(u[2].block).toMatch(/^[a-z]{2}\.[a-z0-9_]{1,40}$/);
    expect(blocks.filter((u) => u[2].ai_reason).map((u) => [u[1], u[2], u[3]])).toEqual([
      ['r1', { ai_status: 'failed', ai_reason: 'final:restarted' }, true], ['r2', { ai_status: 'failed', ai_reason: 'final:restarted' }, true]]);
    const sess = updates.find((u) => u[0] === 'child_test_sessions')[2];
    expect(sess.client_session_id).toBe(NEW);
    expect(sess.device.block).toBe('B2');
    expect(sess.device.last_seq).toBeUndefined();
    expect(sess.device.mic_ok).toBe(true);
    expect(sess.device.events).toEqual([
      { seq: -3, type: 'warmup_result' },
      { seq: -2, type: 'end_test', task_id: 'ur.words', data: { by: 'coach' } },
      { seq: -1, type: 'restart', task_id: null, at: '2026-10-27T09:00:00.000Z', data: { by: 'coach', prev: OLD, attempt: 2 } },
    ]);
  });
  test('summary() leaves a set-aside attempt out', async () => {
    jest.resetModules();
    jest.doMock('../../shared/config/supabase', () => ({
      from: (table) => {
        const q = {}; q.select = () => q; q.eq = () => q; q.limit = () => q;
        q.then = (res, rej) => Promise.resolve({ data: table === 'child_test_sessions' ? [{ id: SID, device: {} }]
          : [{ block: 'zz.r1_ur_letters', responses: [{ kind: 'result' }] }, { block: 'ur.letters', responses: [{ kind: 'result' }] }], error: null }).then(res, rej);
        return q;
      },
    }));
    const store = require('../../shared/services/child-test/sa-store');
    expect((await store.summary(SID)).tasksDone).toEqual(['ur.letters']);
  });
});

describe('a set-aside attempt is left out wherever tasks are read', () => {
  const SA = require('../../shared/services/child-test/sa/set-aside');
  test('names: valid block names (the DB CHECK), never a task the battery has, long ids kept within 40', () => {
    expect(SA.setAsideName(1, 'ur.story_comp_w3')).toBe('zz.r1_ur_story_comp_w3');
    const long = SA.setAsideName(12, `en.${'a'.repeat(40)}`);
    expect(long).toMatch(/^[a-z]{2}\.[a-z0-9_]{1,40}$/);
    expect(SA.isSetAside('zz.r1_ur_letters')).toBe(true);
    expect(SA.isSetAside('ur.letters')).toBe(false);
    expect(SA.attemptOf('zz.r3_ma_add')).toBe(3);
  });
  test('Results (saResults) list only the live attempt\'s tasks', async () => {
    const sess = { id: SID, coach_user_id: COACH, school_id: SCHOOL, grade: 3, form: 'A', status: 'in_progress', item_bank_version: 'sa-battery', device: {} };
    const deps = {
      enabled: async () => true,
      store: {
        getSession: async () => ({ ok: true, session: sess }),
        listBlocks: async () => ({ ok: true, blocks: [
          { block: 'zz.r1_ur_letters', responses: [{ kind: 'result', mode: 'tap', correct: 1, attempted: 2 }], created_at: '2026-10-27T09:00:00Z' },
          { block: 'ur.letters', responses: [{ kind: 'result', mode: 'tap', correct: 2, attempted: 2 }], created_at: '2026-10-27T09:05:00Z' }] }),
      },
      saStore: { findByClient: async () => ({ ok: true, sessionId: null }) },
      bank: { forms: {}, tasks: {} }, stopRules: false,
      now: () => new Date('2026-10-27T09:00:00Z'), log: () => {}, logError: () => {},
    };
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, deps);
    expect(out.status).toBe('ok');
    expect(out.tasks.map((t) => t.taskId)).toEqual(['ur.letters']);
  });
  test('the scorer\'s asked questions skip a set-aside row', async () => {
    const score = require('../../shared/services/child-test/sa/score');
    const supabase = { from: () => { const q = { select: () => q, eq: () => q, then: (res) => Promise.resolve({ data: [
      { block: 'zz.r1_en_story_comp_w3', responses: [{ kind: 'result', asked: ['q_old'] }] },
      { block: 'en.story_comp_w3', responses: [{ kind: 'result', asked: ['q_new'] }] }], error: null }).then(res) }; return q; } };
    expect(await score.__internals.askedOf(SID, supabase)).toEqual(['q_new']);
  });
});
