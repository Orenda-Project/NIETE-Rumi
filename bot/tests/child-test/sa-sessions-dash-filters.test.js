'use strict';

/**
 * Round 7b (items 11–13): the results dashboard's read (saSessions) with sa_dash_filters ON adds, per session, what the
 * page filters and audits by: mode (coach_led for RDF manual, else auto), block, the coach (id and name: staff, never a
 * child), when it started, and every skip and stop kept on the session (device.events of the six STOP_TYPES). A session
 * with no task yet but with a stop (a test ended at once) comes back under stopSessions, so no stop is hidden; it never
 * enters the results. OFF: the answer is exactly today's.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000009';
const S1 = 'cccccccc-0000-4000-8000-000000000001';
const S2 = 'cccccccc-0000-4000-8000-000000000002';
const S3 = 'cccccccc-0000-4000-8000-000000000003';
const S4 = 'cccccccc-0000-4000-8000-000000000004';
const S5 = 'cccccccc-0000-4000-8000-000000000005';

const session = (id, coach, extra = {}) => ({
  id, coach_user_id: coach, student_id: `st-${id}`, draw_id: `d-${id}`, school_id: 'sch-1', grade: 3, form: 'A',
  item_bank_version: 'sa-battery', status: 'completed', started_at: '2026-10-23T05:00:00Z', finished_at: '2026-10-23T05:30:00Z',
  created_at: '2026-10-23T04:59:00Z', device: { block: 'rdf_auto' }, ...extra,
});
const block = (sessionId, name, marks) => ({
  session_id: sessionId, block: name, response_mode: 'record', lang: 'ur', created_at: '2026-10-23T05:05:00Z', ai_status: 'scored',
  ai_marks: marks, audio_r2_key: `k/${sessionId}/${name}.webm`, responses: [{ kind: 'result', mode: 'record' }],
});
const ev = (seq, type, data = null, task = 'ur.letter_names5') => ({ seq, type, task_id: task, at: `2026-10-23T05:0${seq < 0 ? 0 : seq}:00Z`, data });

function world({ dash = true } = {}) {
  const calls = { names: [] };
  const all = [
    session(S1, COACH, { device: { block: 'rdf_manual', events: [ev(1, 'warmup_result', { correct: 3 }), ev(2, 'end_section', { by: 'coach', section: 'ur' }), ev(3, 'back', { by: 'child', from: 4, to: 3 }), ev(4, 'visibility_lost')] } }),
    session(S2, OTHER, { school_id: 'sch-2', grade: 5, started_at: '2026-10-25T06:00:00Z', device: { block: 'rdf_auto', events: [ev(-1, 'restart', { by: 'coach', prev: S5 }, null), ev(2, 'silence_repeat', { by: 'app', attempt: 1 })] } }),
    session(S3, COACH, { device: { block: 'B2' } }),
    session(S4, COACH, { device: { block: 'rdf_auto', events: [ev(1, 'handover_out')] } }),
    session(S5, OTHER, { device: { block: 'rdf_auto', events: [ev(1, 'end_test', { by: 'coach', mode: 'auto' })] } }),
  ];
  const rows = [
    block(S1, 'ur.story_w3', { correct: 30, attempted: 32, per_minute: 36 }),
    block(S2, 'ur.words4', { correct: 3, attempted: 4 }),
    block(S3, 'en.words4', { correct: 5, attempted: 6 }),
  ];
  const store = {
    listSaSessions: async (q) => ({ ok: true, sessions: all.filter((s) => q.allCoaches === true || s.coach_user_id === q.coachUserId) }),
    listBlocksForSessions: async (ids) => ({ ok: true, blocks: rows.filter((r) => ids.includes(r.session_id)) }),
    getSchoolsByIds: async (ids) => ({ ok: true, schools: [{ id: 'sch-1', name: 'School One', region: 'Urban-I' }, { id: 'sch-2', name: 'School Two', region: 'Nilore' }].filter((s) => ids.includes(s.id)) }),
    getUserNamesByIds: async (ids) => { calls.names.push(ids); return { ok: true, users: [{ id: COACH, name: 'Coach Testwala' }, { id: OTHER, name: 'Other Testwala' }].filter((u) => ids.includes(u.id)) }; },
  };
  return {
    calls,
    deps: {
      enabled: async () => true, practiceSwitch: false, dashFilters: dash,
      supabase: { from: () => { throw new Error('no direct reads'); } },
      store, saStore: {}, bank: null, now: () => new Date('2026-10-27T08:00:00Z'), log: () => {}, logError: () => {},
    },
  };
}

describe('saSessions with sa_dash_filters', () => {
  test('OFF: today\'s rows, no mode/coach/stops, no name read, no stopSessions', async () => {
    const w = world({ dash: false });
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, w.deps);
    expect(out.status).toBe('ok');
    expect(out.stopSessions).toBeUndefined();
    expect(w.calls.names).toEqual([]);
    for (const r of out.sessions) expect(Object.keys(r).sort()).toEqual(['grade', 'results', 'schoolId', 'schoolName', 'sector']);
  });

  test('ON (admin): mode, block, coach id + name (read once), startedAt and the stops of each session', async () => {
    const w = world();
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, w.deps);
    expect(w.calls.names).toHaveLength(1);
    expect(w.calls.names[0].sort()).toEqual([COACH, OTHER].sort());
    const byId = Object.fromEntries(out.sessions.map((r) => [r.results.session.id, r]));
    expect(Object.keys(byId).sort()).toEqual([S1, S2, S3].sort());
    expect(byId[S1]).toEqual(expect.objectContaining({ mode: 'coach_led', block: 'rdf_manual', coachId: COACH, coachName: 'Coach Testwala', startedAt: '2026-10-23T05:00:00Z' }));
    expect(byId[S1].stops).toEqual([
      { type: 'end_section', taskId: 'ur.letter_names5', at: '2026-10-23T05:02:00Z', by: 'coach', data: { by: 'coach', section: 'ur' } },
      { type: 'back', taskId: 'ur.letter_names5', at: '2026-10-23T05:03:00Z', by: 'child', data: { by: 'child', from: 4, to: 3 } },
    ]);
    expect(byId[S2]).toEqual(expect.objectContaining({ mode: 'auto', coachName: 'Other Testwala', startedAt: '2026-10-25T06:00:00Z' }));
    expect(byId[S2].stops.map((s) => s.type)).toEqual(['restart', 'silence_repeat']);
    expect(byId[S2].stops[0].taskId).toBeNull();
    expect(byId[S3]).toEqual(expect.objectContaining({ mode: 'auto', block: 'B2', stops: [] }));
    // never a child: no student id, draw id or name anywhere in the answer
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/st-cccc|d-cccc/);
  });

  test('ON: a session with no task but a stop comes back under stopSessions; one with neither stays out', async () => {
    const w = world();
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, w.deps);
    expect(out.stopSessions.map((r) => r.results.session.id)).toEqual([S5]);
    expect(out.stopSessions[0]).toEqual(expect.objectContaining({ mode: 'auto', coachId: OTHER, coachName: 'Other Testwala' }));
    expect(out.stopSessions[0].results.tasks).toEqual([]);
    expect(out.stopSessions[0].stops.map((s) => s.type)).toEqual(['end_test']);
  });

  test('ON (a coach): only their own sessions and their own name', async () => {
    const w = world();
    const out = await sa.saSessions({ userId: COACH }, w.deps);
    expect(out.sessions.every((r) => r.coachId === COACH && r.coachName === 'Coach Testwala')).toBe(true);
    expect(out.stopSessions).toEqual([]);
    expect(w.calls.names[0]).toEqual([COACH]);
  });
});
