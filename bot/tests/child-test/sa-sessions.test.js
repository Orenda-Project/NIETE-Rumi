'use strict';

/**
 * The results dashboard's read (saSessions): every self-administered session a coach ran — or, for a results admin
 * (asAdmin, set by the portal from sa_results_admins), every coach's — each in the per-session Results shape, with its
 * school and the school's sub-region. Never a child's name, roll number, student id or draw.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000009';
const S1 = 'cccccccc-0000-4000-8000-000000000001';
const S2 = 'cccccccc-0000-4000-8000-000000000002';
const S3 = 'cccccccc-0000-4000-8000-000000000003';

const session = (id, coach, extra = {}) => ({
  id,
  coach_user_id: coach,
  student_id: `st-${id}`,
  draw_id: `d-${id}`,
  school_id: 'sch-1',
  grade: 3,
  form: 'A',
  item_bank_version: 'sa-battery',
  status: 'completed',
  started_at: '2026-10-23T05:00:00Z',
  finished_at: '2026-10-23T05:30:00Z',
  device: { block: 'rdf_auto' },
  ...extra,
});

const block = (sessionId, name, marks, extra = {}) => ({
  session_id: sessionId,
  block: name,
  response_mode: 'record',
  lang: 'ur',
  created_at: '2026-10-23T05:05:00Z',
  ai_status: 'scored',
  ai_marks: marks,
  audio_r2_key: `child-test/sandbox/sch-1/${sessionId}/sa/${name}.webm`,
  responses: [{ kind: 'result', mode: 'record', name: 'Asha Testwala' }],
  ...extra,
});

function world({ sessions, blocks, schools } = {}) {
  const calls = { list: [], blocks: [], schools: [] };
  const all = sessions || [
    session(S1, COACH),
    session(S2, OTHER, { school_id: 'sch-2', grade: 5 }),
    session(S3, COACH, { school_id: 'sch-3' }),
  ];
  const rows = blocks || [
    block(S1, 'ur.story_w3', { correct: 30, attempted: 32, per_minute: 36, seconds_used: 50 }),
    block(S2, 'ur.words4', { correct: 3, attempted: 4 }),
    block(S3, 'ma.missing4', null, { response_mode: 'keypad', ai_status: 'pending', responses: [{ kind: 'result', mode: 'keypad', correct: 2, attempted: 4 }] }),
  ];
  const named = schools || [
    { id: 'sch-1', name: 'School One', region: 'Urban-I' },
    { id: 'sch-2', name: 'School Two', region: 'Nilore' },
    { id: 'sch-3', name: 'School Three', region: null },
  ];
  const store = {
    listSaSessions: async (q) => {
      calls.list.push(q);
      if (!q.coachUserId && q.allCoaches !== true) return { ok: false, error: 'no_coach' };
      return { ok: true, sessions: all.filter((s) => s.item_bank_version === q.mark && (q.allCoaches === true || s.coach_user_id === q.coachUserId)) };
    },
    listBlocksForSessions: async (ids) => {
      calls.blocks.push(ids);
      return { ok: true, blocks: rows.filter((r) => ids.includes(r.session_id)) };
    },
    getSchoolsByIds: async (ids) => {
      calls.schools.push(ids);
      return { ok: true, schools: named.filter((s) => ids.includes(s.id)) };
    },
  };
  return {
    calls,
    deps: {
      enabled: async () => true,
      supabase: { from: () => { throw new Error('no direct reads'); } },
      store,
      saStore: {},
      bank: null,
      now: () => new Date('2026-10-23T08:00:00Z'),
      log: () => {},
      logError: () => {},
    },
  };
}

describe('saSessions', () => {
  test("a coach reads their own sessions only, each with its school and sub-region", async () => {
    const w = world();
    const out = await sa.saSessions({ userId: COACH }, w.deps);
    expect(out.status).toBe('ok');
    expect(w.calls.list).toEqual([{ mark: 'sa-battery', coachUserId: COACH }]);
    expect(out.sessions.map((s) => s.results.session.id).sort()).toEqual([S1, S3]);
    const one = out.sessions.find((s) => s.results.session.id === S1);
    expect(one).toMatchObject({ schoolId: 'sch-1', schoolName: 'School One', sector: 'Urban-I', grade: 3 });
    expect(one.results.session).toMatchObject({ grade: 3, block: 'rdf_auto', status: 'completed', lang: 'ur' });
    expect(one.results.tasks).toEqual([expect.objectContaining({ taskId: 'ur.story_w3', recording: 'scored', score: { correct: 30, attempted: 32, per_minute: 36, seconds_used: 50 } })]);
  });

  test('a results admin (asAdmin: true) reads every coach\'s sessions', async () => {
    const w = world();
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, w.deps);
    expect(w.calls.list).toEqual([{ mark: 'sa-battery', coachUserId: null, allCoaches: true }]);
    expect(out.sessions.map((s) => s.results.session.id).sort()).toEqual([S1, S2, S3]);
  });

  test('asAdmin is honoured only as the boolean the portal sets, never a string', async () => {
    const w = world();
    const out = await sa.saSessions({ userId: COACH, asAdmin: 'true' }, w.deps);
    expect(w.calls.list).toEqual([{ mark: 'sa-battery', coachUserId: COACH }]);
    expect(out.sessions).toHaveLength(2);
  });

  test('blocks and schools are read once for all sessions, not once per session', async () => {
    const w = world();
    await sa.saSessions({ userId: COACH, asAdmin: true }, w.deps);
    expect(w.calls.blocks).toHaveLength(1);
    expect(w.calls.blocks[0].sort()).toEqual([S1, S2, S3]);
    expect(w.calls.schools).toEqual([['sch-1', 'sch-2', 'sch-3']]);
  });

  test('a school with no sub-region is null (the page labels it), and a tap / keypad task keeps the phone\'s count', async () => {
    const out = await sa.saSessions({ userId: COACH }, world().deps);
    const s3 = out.sessions.find((s) => s.results.session.id === S3);
    expect(s3.sector).toBeNull();
    expect(s3.results.tasks[0]).toMatchObject({ taskId: 'ma.missing4', correct: 2, attempted: 4 });
  });

  test('a session with no task rows yet is left out', async () => {
    const w = world({ blocks: [block(S1, 'ur.story_w3', { correct: 1 })] });
    const out = await sa.saSessions({ userId: COACH }, w.deps);
    expect(out.sessions.map((s) => s.results.session.id)).toEqual([S1]);
  });

  test("never a child's name, student id, draw id or a recording's key", async () => {
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, world().deps);
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/Testwala|st-c|d-c|child-test\/|webm|student_id|draw_id/);
  });

  test('no sessions: an empty list, and no block or school read', async () => {
    const w = world({ sessions: [] });
    const out = await sa.saSessions({ userId: COACH }, w.deps);
    expect(out).toEqual({ status: 'ok', sessions: [] });
    expect(w.calls.blocks).toEqual([]);
    expect(w.calls.schools).toEqual([]);
  });

  test('an empty or missing user (not an admin) is refused, and no session is read', async () => {
    for (const userId of ['', null, undefined]) {
      const w = world();
      // eslint-disable-next-line no-await-in-loop
      expect(await sa.saSessions({ userId }, w.deps)).toEqual({ status: 'invalid', reason: 'no_user' });
      expect(w.calls.list).toEqual([]);
    }
  });

  test('the bot route maps /sa/sessions to saSessions with only the user and asAdmin', () => {
    const src = require('fs').readFileSync(require.resolve('../../shared/routes/child-test-app.routes'), 'utf8');
    expect(src).toMatch(/'\/sa\/sessions': \['saSessions', \['userId', 'asAdmin'\], 'sa-api\.service'\]/);
  });

  test('a store error is an error status, never a partial list', async () => {
    const w = world();
    w.deps.store.listBlocksForSessions = async () => ({ ok: false, error: 'boom' });
    const out = await sa.saSessions({ userId: COACH }, w.deps);
    expect(out).toEqual({ status: 'error', reason: 'internal' });
  });
});
