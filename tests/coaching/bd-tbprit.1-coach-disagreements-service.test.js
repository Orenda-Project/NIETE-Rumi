'use strict';
/**
 * bd-tbprit.1 — the coach's disagreements in the portal (v10 coaching test, C/D only).
 *
 *   shapeList  To do (not visited) and Done (visited). To do: most tags first, then longest waiting. Done: newest
 *              visit. The tags are Rifat's prototype's (bd-tbprit.7-coach-list-prototype.test.js).
 *   listFor    only HER requests (coach_user_id), never no_coach rows, with names and the report's score.
 *   cardFor    one request, only for its own coach: the report view, the evidence per reason, every indicator.
 */
const { shapeList, listFor, cardFor } = require('../../dashboard/services/coach-disagreements.service');

const NOW = new Date('2026-10-26T10:00:00Z');
const H = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
const ROW = (id, extra) => ({
  id, coaching_session_id: `s-${id}`, teacher_user_id: 't1', school_id: 'sch1', status: 'sent', reasons: ['score'],
  voice_note_key: null, created_at: H(1), updated_at: H(1), ...extra,
});
const LOOK = {
  teachers: new Map([['t1', 'Sadia Bibi'], ['t2', 'Hina Tariq']]),
  schools: new Map([['sch1', 'IMSG I-8/1']]),
  sessions: new Map([['s-a', { createdAt: H(30), pct: 64.4 }]]),
};

describe('shapeList', () => {
  it('splits To do and Done; visited is Done, every other status is To do', () => {
    const out = shapeList([ROW('a'), ROW('b', { status: 'visited', updated_at: H(2) }), ROW('c', { status: 'failed' }), ROW('d', { status: 'pending' })], LOOK, NOW);
    expect(out.todo.map((r) => r.id).sort()).toEqual(['a', 'c', 'd']);
    expect(out.done.map((r) => r.id)).toEqual(['b']);
    expect(out.done[0].visitedAt).toBe(H(2));
  });

  it('names the teacher and school, the report score rounded, and whether a voice note waits', () => {
    const [r] = shapeList([ROW('a', { voice_note_key: 'coach-visit-notes/a.webm' })], LOOK, NOW).todo;
    expect(r).toMatchObject({ teacher: 'Sadia Bibi', school: 'IMSG I-8/1', pct: 64, sessionDate: H(30), hasNote: true, reasons: ['score'] });
  });

  it('unknown names and scores stay null, never invented', () => {
    const [r] = shapeList([ROW('z', { teacher_user_id: 'tx', school_id: null })], LOOK, NOW).todo;
    expect(r).toMatchObject({ teacher: null, school: null, pct: null, sessionDate: null });
  });

  it('waiting only on To do older than 48 hours', () => {
    const out = shapeList([ROW('a', { created_at: H(49) }), ROW('b', { created_at: H(47), teacher_user_id: 't2' }), ROW('c', { status: 'visited', created_at: H(90), teacher_user_id: 'x' })], LOOK, NOW);
    expect(out.todo.find((r) => r.id === 'a').tags).toEqual([{ kind: 'waiting', days: 2 }]);
    expect(out.todo.find((r) => r.id === 'b').tags).toEqual([]);
    expect(out.done[0].tags).toEqual([]);
  });

  it('repeat: a teacher\'s later disagreements carry it, her first does not (Done ones count)', () => {
    const out = shapeList([
      ROW('first', { status: 'visited', created_at: H(100) }),
      ROW('later', { created_at: H(3) }),
      ROW('other', { teacher_user_id: 't2', created_at: H(2) }),
    ], LOOK, NOW);
    expect(out.todo.find((r) => r.id === 'later').tags).toEqual([{ kind: 'repeat', nth: 2 }]);
    expect(out.todo.find((r) => r.id === 'other').tags).toEqual([]);
    expect(out.done[0].tags).toEqual([]);
  });

  it('To do: most tags first, then longest waiting; Done: newest visit first', () => {
    const out = shapeList([
      ROW('new', { teacher_user_id: 'n1', created_at: H(1) }),
      ROW('old', { teacher_user_id: 'n2', created_at: H(20) }),
      ROW('both0', { teacher_user_id: 't1', created_at: H(200), status: 'visited', updated_at: H(150) }),
      ROW('both', { teacher_user_id: 't1', created_at: H(60) }),
      ROW('late', { teacher_user_id: 'n3', created_at: H(50) }),
      ROW('d2', { teacher_user_id: 'n4', status: 'visited', updated_at: H(5) }),
    ], LOOK, NOW);
    expect(out.todo.map((r) => r.id)).toEqual(['both', 'late', 'old', 'new']);
    expect(out.done.map((r) => r.id)).toEqual(['d2', 'both0']);
  });
});

/** A supabase-js stand-in: records each chain's filters, answers from `tables`. */
function fakeSupabase(tables) {
  const calls = [];
  const from = (table) => {
    const q = { table, filters: [] };
    calls.push(q);
    const rowsOf = () => (tables[table] || []).filter((r) => q.filters.every(([op, k, v]) => (op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : true)));
    const chain = {
      select() { return chain; },
      eq(k, v) { q.filters.push(['eq', k, v]); return chain; },
      in(k, v) { q.filters.push(['in', k, v]); return chain; },
      gte() { return chain; },
      lte() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() { return Promise.resolve({ data: rowsOf()[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: rowsOf(), error: null }).then(res, rej); },
    };
    return chain;
  };
  return { from, calls };
}

const TABLES = () => ({
  coach_visit_requests: [
    ROW('a', { coach_user_id: 'me' }),
    ROW('b', { coach_user_id: 'other', teacher_user_id: 't2' }),
    ROW('c', { coach_user_id: 'me', status: 'no_coach' }),
  ],
  users: [{ id: 't1', name: 'Sadia Bibi' }, { id: 't2', name: 'Hina Tariq' }],
  leader_schools: [{ school_id: 'sch1', leader_user_id: 'me', school_name: 'IMSG I-8/1' }],
  coaching_sessions: [{ id: 's-a', created_at: H(30), analysis_data: { scores: { overall_percentage: 71.6 } } }],
});

describe('listFor', () => {
  it('only her requests, never no_coach, with names and the report score', async () => {
    const db = fakeSupabase(TABLES());
    const out = await listFor(db, 'me', { now: NOW });
    expect(out.todo.map((r) => r.id)).toEqual(['a']);
    expect(out.todo[0]).toMatchObject({ teacher: 'Sadia Bibi', school: 'IMSG I-8/1', pct: 72 });
    expect(db.calls[0].filters).toContainEqual(['eq', 'coach_user_id', 'me']);
  });

  it('no requests: empty lists and no further reads', async () => {
    const db = fakeSupabase({ coach_visit_requests: [] });
    expect(await listFor(db, 'me', { now: NOW })).toEqual({ todo: [], done: [] });
    expect(db.calls).toHaveLength(1);
  });
});

describe('cardFor', () => {
  const A = {
    scores: { has_lesson_plan: false, overall_percentage: 57 },
    domains: { high_leverage_practices: { domain_score: 25, domain_max: 48, indicators: [{ id: 'C3', name: 'Checks', score: 1, evidence: '[04:00] x', timestamp: '04:00' }] } },
    lp_fidelity: { status: 'lp_absent' },
  };
  const report = { session: { id: 's-a', created_at: H(30), analysis_data: A, prioritized_action: { thing_to_try: { text: 'Ask two children' } } }, language: 'en', firstName: 'Sadia', trend: [{ created_at: H(400), pct: 50 }, { created_at: H(30), pct: 57 }], quizMessage: null };
  const deps = (extra = {}) => ({ loadReport: async (_db, sid, uid) => (sid === 's-a' && uid === 't1' ? report : null), presign: async (k) => `https://r2/${k}?sig`, ...extra });

  it('her own request: names, status, the report view, evidence per reason, every indicator, the plan state', async () => {
    const db = fakeSupabase({ ...TABLES(), coach_visit_requests: [ROW('a', { coach_user_id: 'me', reasons: ['missed', 'unclear'], voice_note_key: 'coach-visit-notes/a.webm' })] });
    const c = await cardFor(db, 'me', 'a', deps());
    expect(c).toMatchObject({ id: 'a', teacher: 'Sadia Bibi', school: 'IMSG I-8/1', status: 'sent', done: false, reasons: ['missed', 'unclear'], noteUrl: 'https://r2/coach-visit-notes/a.webm?sig' });
    expect(c.view.journey).toMatchObject({ first: 50, now: 57 });
    expect(c.evidence.map((e) => e.code)).toEqual(['missed', 'unclear']);
    expect(c.evidence[0]).toMatchObject({ noPlan: true });
    expect(c.evidence[1].thing).toMatchObject({ text: 'Ask two children' });
    expect(c.indicators[0].items[0]).toMatchObject({ id: 'C3', score: 1, at: 240 });
    expect(c.moves).toBeNull();
  });

  it('someone else\'s request, an unknown id or a missing report: null', async () => {
    const db = fakeSupabase({ ...TABLES() });
    expect(await cardFor(db, 'me', 'b', deps())).toBeNull();
    expect(await cardFor(db, 'me', 'nope', deps())).toBeNull();
    expect(await cardFor(db, 'me', 'a', deps({ loadReport: async () => null }))).toBeNull();
  });

  it('a visited request is done and its note link is gone', async () => {
    const db = fakeSupabase({ ...TABLES(), coach_visit_requests: [ROW('a', { coach_user_id: 'me', status: 'visited' })] });
    expect(await cardFor(db, 'me', 'a', deps())).toMatchObject({ done: true, noteUrl: null });
  });

  it('a note that cannot be signed leaves the card standing without it', async () => {
    const db = fakeSupabase({ ...TABLES(), coach_visit_requests: [ROW('a', { coach_user_id: 'me', voice_note_key: 'k' })] });
    const c = await cardFor(db, 'me', 'a', deps({ presign: async () => { throw new Error('r2 down'); } }));
    expect(c.noteUrl).toBeNull();
  });
});

/* bd-tbprit.2 — the recording behind the clip: hers only, presigned for five minutes, never sent to the browser. */
describe('recordingFor', () => {
  const { recordingFor } = require('../../dashboard/services/coach-disagreements.service');
  const tables = () => ({
    ...TABLES(),
    coaching_sessions: [{ id: 's-a', audio_url: 'https://acc.r2.cloudflarestorage.com/b/rec.ogg' }, { id: 's-b', audio_url: null }],
  });
  const presign = jest.fn(async (url, s) => `${url}?sig&ttl=${s}`);

  it('her request: the session recording, presigned for 300 seconds', async () => {
    expect(await recordingFor(fakeSupabase(tables()), 'me', 'a', presign)).toBe('https://acc.r2.cloudflarestorage.com/b/rec.ogg?sig&ttl=300');
  });

  it('someone else\'s request, an unknown id, or no recording: null, nothing signed', async () => {
    presign.mockClear();
    const db = fakeSupabase(tables());
    expect(await recordingFor(db, 'me', 'b', presign)).toBeNull();
    expect(await recordingFor(db, 'me', 'nope', presign)).toBeNull();
    const noAudio = fakeSupabase({ ...tables(), coach_visit_requests: [ROW('x', { coach_user_id: 'me', coaching_session_id: 's-b' })] });
    expect(await recordingFor(noAudio, 'me', 'x', presign)).toBeNull();
    expect(presign).not.toHaveBeenCalled();
  });
});
