/**
 * One resolver for "who is the teacher" and "who is the coach".
 *
 * `coaching_sessions.user_id` holds the BOUND TEACHER when the coach picked her
 * in the visit Flow, and the coach herself when she did not. Every surface that
 * read `session.users` therefore got whichever of the two the row happened to
 * carry. The same confusion was already solved for LANGUAGE by a single
 * audience-named resolver; identity was left behind, so this mirrors it.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const USERS = {
  'u-teacher': { id: 'u-teacher', name: 'Najma Kousar', phone_number: '923150583765', role: 'teacher' },
  'u-coach': { id: 'u-coach', name: 'Misbah Iqbal', phone_number: '923260000001', role: 'coach' },
  'u-nameless': { id: 'u-nameless', name: null, phone_number: '923335467760', role: 'teacher' },
};
const DB = { reads: [], fail: false };

jest.mock('../../shared/config/supabase', () => ({
  from: () => {
    const st = { filters: [] };
    const settle = () => {
      if (DB.fail) return Promise.resolve({ data: null, error: { message: 'boom' } });
      DB.reads.push(st.filters.slice());
      const [, col, val] = st.filters[0] || [];
      const row = Object.values(USERS).find((u) => u[col] === val) || null;
      return Promise.resolve({ data: row, error: null });
    };
    const api = {
      select: () => api,
      eq: (c, v) => { st.filters.push(['eq', c, v]); return api; },
      limit: () => api,
      maybeSingle: settle,
      single: settle,
      then: (ok, bad) => settle().then(ok, bad),
    };
    return api;
  },
}));

const { teacherOf, coachOf } = require('../../shared/services/observe/observe-people');

const bound = (over = {}) => ({
  id: 'sess-1', user_id: 'u-teacher', observer_user_id: 'u-coach', analysis_data: {}, ...over,
});
const bare = (over = {}) => ({
  id: 'sess-2', user_id: 'u-coach', observer_user_id: 'u-coach', analysis_data: {}, ...over,
});

beforeEach(() => { DB.reads = []; DB.fail = false; });

describe('teacherOf', () => {
  it('RED: prefers the identity the coach named for this report', async () => {
    const t = await teacherOf(bound({
      analysis_data: { teacher_delivery: { teacher_name: 'Hand Typed', teacher_phone: '923009999999' } },
    }));
    expect(t).toMatchObject({ name: 'Hand Typed', phone: '923009999999' });
    // A hand-typed teacher has no user row; the resolver must not invent one.
    expect(DB.reads).toHaveLength(0);
  });

  it("RED: falls back to the session's own user when the observation is BOUND", async () => {
    const t = await teacherOf(bound());
    expect(t).toMatchObject({ userId: 'u-teacher', name: 'Najma Kousar', phone: '923150583765' });
  });

  it('RED: a bare capture has no observed teacher — never the coach', async () => {
    expect(await teacherOf(bare())).toBeNull();
  });

  it('RED: a nameless bound teacher still resolves her phone', async () => {
    const t = await teacherOf(bound({ user_id: 'u-nameless' }));
    expect(t.phone).toBe('923335467760');
    expect(t.name).toBeFalsy();
  });

  it('RED: a read failure returns null rather than throwing', async () => {
    DB.fail = true;
    expect(await teacherOf(bound())).toBeNull();
  });
});

describe('coachOf', () => {
  it('RED: always the observer, on bound and bare sessions alike', async () => {
    for (const s of [bound(), bare()]) {
      const c = await coachOf(s);
      expect(c).toMatchObject({ userId: 'u-coach', name: 'Misbah Iqbal', phone: '923260000001' });
    }
  });

  it('RED: never the teacher, even when the row is owned by her', async () => {
    const c = await coachOf(bound());
    expect(c.phone).not.toBe('923150583765');
  });

  it('RED: a session with no observer returns null', async () => {
    expect(await coachOf({ id: 's', user_id: 'u-teacher', observer_user_id: null })).toBeNull();
  });

  it('RED: a read failure returns null rather than throwing', async () => {
    DB.fail = true;
    expect(await coachOf(bound())).toBeNull();
  });
});
