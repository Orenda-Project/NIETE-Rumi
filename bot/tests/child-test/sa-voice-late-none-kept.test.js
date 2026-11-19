'use strict';

/**
 * A late "no voice" verdict inside a timed task (dashboard/sa/sa-page.js voiceGate): the phone logs voice_late_none
 * { task, ms } and marks that task's result voice_deferred: true. Both must reach the session's row: the batch keeps
 * only listed event types (DEVICE_TYPES), and the result's own fields are kept as the phone sent them.
 */

jest.mock('../../shared/config/supabase', () => {
  const rows = [];
  const api = {
    rows,
    from() {
      const f = []; let patch = null; let ins = null;
      const q = {
        select() { return q; }, limit() { return q; },
        eq(c, v) { f.push((r) => r[c] === v); return q; },
        insert(x) { ins = x; return q; },
        update(x) { patch = x; return q; },
        then(ok, bad) {
          if (ins) { const r = { id: `row-${rows.length + 1}`, ai_marks: null, responses: null, ...ins }; rows.push(r); return Promise.resolve({ data: [r], error: null }).then(ok, bad); }
          const hit = rows.filter((r) => f.every((fn) => fn(r)));
          if (patch) { hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit, error: null }).then(ok, bad); }
          return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(ok, bad);
        },
      };
      return q;
    },
  };
  return api;
});

const sa = require('../../shared/services/child-test/app/sa-api.service');
const saStore = require('../../shared/services/child-test/sa-store');
const memDb = require('../../shared/config/supabase');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const SID = 'cccccccc-0000-4000-8000-0000000000c1';

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

function world() {
  const session = { id: SID, coach_user_id: COACH, draw_id: 'd-1', school_id: SCHOOL, visit_key: 'day:x', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'in_progress', device: { block: 'rdf_auto' } };
  const synced = [];
  const put = [];
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store: { getSession: async () => ({ ok: true, session }), recordTiming: async () => ({ ok: true }), setSessionStatus: async () => ({ ok: true }) },
    saStore: {
      findByClient: async () => ({ ok: true, sessionId: null }),
      markSynced: async (id, v) => { synced.push(v); return { ok: true }; },
      putResults: async (id, results, lang) => { put.push(results); return saStore.putResults(id, results, lang, { mcq: false }); },
    },
    now: () => new Date('2026-11-19T09:00:00Z'),
    log: () => {}, logError: () => {},
  };
  return { deps, synced, put };
}

const result = {
  task_id: 'ur.letter_names5', legacy_block: null, mode: 'record', attempted: 31, correct: null, incorrect: null, last_item_index: 30,
  time_used_ms: 60000, time_left_ms: 0, stop_reason: 'time_up', scored_on: 'later', resumed: false, per_minute: null, elapsed_ms: 60000,
  voice_deferred: true, answers: [],
};

test('voice_late_none { task, ms } and voice_deferred_end { task, ms, by } are kept on the session with their task; voice_deferred: true stays on the stored result', async () => {
  const { deps, synced, put } = world();
  const events = [
    { seq: 1, type: 'session_start', at: '2026-11-19T08:58:00Z' },
    { seq: 2, type: 'task_start', task_id: 'ur.letter_names5', at: '2026-11-19T08:58:30Z' },
    { seq: 3, type: 'device_ready', at: '2026-11-19T08:58:50Z', value: { ready: false, voice: 'none', clips_total: 150, clips_cached: 40 } },
    { seq: 4, type: 'voice_late_none', task_id: 'ur.letter_names5', at: '2026-11-19T08:58:50Z', value: { task: 'ur.letter_names5', ms: 20000 } },
    { seq: 5, type: 'task_end', task_id: 'ur.letter_names5', at: '2026-11-19T08:59:30Z', value: result },
    { seq: 6, type: 'voice_deferred_end', task_id: 'ur.letter_names5', at: '2026-11-19T08:59:30Z', value: { task: 'ur.letter_names5', ms: 60000, by: 'task_end' } },
    { seq: 7, type: 'voice_not_ready', at: '2026-11-19T08:59:30Z' },
  ];
  const out = await sa.saBatch({ userId: COACH, sessionId: SID, seqFrom: 1, seqTo: 7, events, results: [result], lang: 'ur' }, deps);
  expect(out).toEqual({ status: 'ok', ackedTo: 7 });
  const kept = synced[0].events;
  expect(kept.map((e) => e.type).filter((t) => t !== 'session_start')).toEqual(['device_ready', 'voice_late_none', 'voice_deferred_end', 'voice_not_ready']);
  expect(kept.find((e) => e.type === 'voice_deferred_end')).toEqual({ seq: 6, type: 'voice_deferred_end', task_id: 'ur.letter_names5', at: '2026-11-19T08:59:30Z', data: { task: 'ur.letter_names5', ms: 60000, by: 'task_end' } });
  expect(kept.find((e) => e.type === 'voice_late_none')).toEqual({ seq: 4, type: 'voice_late_none', task_id: 'ur.letter_names5', at: '2026-11-19T08:58:50Z', data: { task: 'ur.letter_names5', ms: 20000 } });
  expect(put[0][0].voice_deferred).toBe(true);
  const row = memDb.rows.find((r) => r.session_id === SID && r.block === 'ur.letter_names5');
  expect(row.responses[0]).toMatchObject({ kind: 'result', task_id: 'ur.letter_names5', voice_deferred: true, time_used_ms: 60000, stop_reason: 'time_up' });
});
