/**
 * A pending-debrief row shows who it is about.
 *
 * `teacher_name` has exactly one source — the `observation_schedules` join on
 * session_id — and the second arm of the label, the delivery blob's
 * teacher_name, is written only when a report is SENT, so at the pending stage
 * it is never populated. One source, then the literal 'Observation'.
 *
 * Measured on prod, 15 Sep 2026, over 163 stage-B rows: 83 (50%) carry a name
 * from the join, 80 (49%) render as 'Observation'. Of those 80, 53 are bound
 * (user_id != observer_user_id) and 52 of the 53 have a resolvable name on
 * their users row. Reach goes 50% -> 82%. This is a decay of an earlier fix
 * that closed at 86%: the share of observations recorded without a schedule row
 * has grown.
 *
 * The name comes from the observe patch resolver's `displayNameOf`, NOT the
 * generic person-name helper. The generic one falls back to a RAW phone number,
 * and `name` is read aloud on a voice call, so digits must never reach that
 * field. The patch resolver's version was built for exactly this: the real name
 * when there is one, else the role plus the last four digits only.
 *
 * `registration_pending_name` is a boolean flag on every users row, not a name.
 * It is never a fallback.
 *
 * Read-only: nothing is written to the database.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

// Two tables, one query each. The users read must be BATCHED — one .in() for
// the whole list, never one query per row.
const DB = {
  sessions: [],
  schedules: [],
  users: [],
  queries: [],
};

jest.mock('../../shared/config/supabase', () => {
  const make = (table) => {
    const st = { table, filters: [] };
    const settle = () => {
      DB.queries.push({ table: st.table, filters: st.filters });
      const key = { coaching_sessions: 'sessions', observation_schedules: 'schedules', users: 'users' }[st.table];
      let rows = DB[key] || [];
      for (const [op, col, val] of st.filters) {
        if (op === 'eq') rows = rows.filter((r) => r[col] === val);
        if (op === 'in') rows = rows.filter((r) => val.includes(r[col]));
      }
      return Promise.resolve({ data: rows, error: null });
    };
    const api = {
      select: () => api,
      eq: (c, v) => { st.filters.push(['eq', c, v]); return api; },
      in: (c, v) => { st.filters.push(['in', c, v]); return api; },
      order: () => api,
      range: () => settle(),
      limit: () => settle(),
      maybeSingle: () => settle().then((r) => ({ data: (r.data || [])[0] || null, error: null })),
      single: () => settle().then((r) => ({ data: (r.data || [])[0] || null, error: null })),
      then: (ok, bad) => settle().then(ok, bad),
    };
    return api;
  };
  return { from: (t) => make(t) };
});

const Debrief = require('../../shared/services/observe/observe-debrief.service');

const COACH = 'u-coach';
const session = (over = {}) => ({
  id: 'sess-1',
  created_at: '2026-09-14T09:00:00Z',
  updated_at: '2026-09-14T09:00:00Z',
  status: 'observer_review_complete',
  debrief_status: 'pending',
  observation_type: 'leader_observation',
  observer_user_id: COACH,
  user_id: 'u-teacher',
  analysis_data: { framework: 'fico' },
  ...over,
});

beforeEach(() => {
  DB.sessions = [session()];
  DB.schedules = [];
  DB.users = [{ id: 'u-teacher', name: 'Najma Kousar', phone_number: '923150583765', role: 'teacher', registration_pending_name: false }];
  DB.queries = [];
});

describe('the bound teacher is named from her users row', () => {
  it('RED: a row with no schedule match still carries the teacher name', async () => {
    const [row] = await Debrief.listPendingDebriefs(COACH);
    expect(row.teacher_name).toBe('Najma Kousar');
  });

  it('the schedule join still wins when it matches', async () => {
    DB.schedules = [{ session_id: 'sess-1', teacher_name: 'Ayesha Khan', school_name: 'IMS G-7' }];
    const [row] = await Debrief.listPendingDebriefs(COACH);
    expect(row.teacher_name).toBe('Ayesha Khan');
    expect(row.school_name).toBe('IMS G-7');
  });

  it('RED: a nameless bound teacher gets the role plus four digits, never a raw phone', async () => {
    DB.users = [{ id: 'u-teacher', name: null, phone_number: '923150583765', role: 'teacher', registration_pending_name: true }];
    const [row] = await Debrief.listPendingDebriefs(COACH);
    expect(row.teacher_name).toBe('Teacher …3765');
    expect(row.teacher_name).not.toContain('923150583765');
    // registration_pending_name is a boolean flag, never a name.
    expect(String(row.teacher_name)).not.toMatch(/true|false/);
  });

  it('a self-owned observation stays nameless — no read can name it', async () => {
    DB.sessions = [session({ user_id: COACH })];
    const [row] = await Debrief.listPendingDebriefs(COACH);
    expect(row.teacher_name).toBeFalsy();
  });

  it('RED: the users read is ONE batched query for the whole list, not one per row', async () => {
    DB.sessions = [
      session({ id: 's1', user_id: 't1' }),
      session({ id: 's2', user_id: 't2' }),
      session({ id: 's3', user_id: 't3' }),
    ];
    DB.users = [
      { id: 't1', name: 'A One', phone_number: '923000000001', role: 'teacher' },
      { id: 't2', name: 'B Two', phone_number: '923000000002', role: 'teacher' },
      { id: 't3', name: null, phone_number: '923000000003', role: 'principal' },
    ];
    const rows = await Debrief.listPendingDebriefs(COACH);
    expect(rows.map((r) => r.teacher_name)).toEqual(['A One', 'B Two', 'Principal …0003']);
    expect(DB.queries.filter((q) => q.table === 'users')).toHaveLength(1);
  });

  it('every resolved label fits the row title caps', async () => {
    const rows = await Debrief.listPendingDebriefs(COACH);
    for (const r of rows) expect([...String(r.teacher_name)].length).toBeLessThanOrEqual(30);
  });
});

describe('the same source feeds the other two lists', () => {
  it('RED: an unsent-report row is named', async () => {
    DB.sessions = [session({ debrief_status: 'done', analysis_data: { framework: 'fico', teacher_delivery: {} } })];
    const [row] = await Debrief.listUnsentReports(COACH);
    expect(row.teacher_name).toBe('Najma Kousar');
  });

  it('RED: an unfinished stage-A row is named', async () => {
    DB.sessions = [session({ status: 'analyzing' })];
    const [row] = await Debrief.listUnfinished(COACH);
    expect(row.teacher_name).toBe('Najma Kousar');
  });
});

describe('a users read failure costs the name, never the list', () => {
  it('degrades to the rows as they were', async () => {
    DB.users = null;   // the read throws inside the helper
    const rows = await Debrief.listPendingDebriefs(COACH);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sess-1');
  });
});
