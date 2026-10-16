'use strict';
/**
 * bd-v0toag.32 — the reads behind one teacher's weekly report, and the group B cohort. Supabase is the
 * boundary (a recording fake); the v10 group lookup (coaching/ab-v10-arms, on staging) is mocked at its
 * module boundary — the reader's contract with it is groupsForUsers(ids) → Map<id, {group}|null>.
 */

const { fakeSupabase } = require('./fake-supabase');

const mockDb = fakeSupabase();
jest.mock('../../../shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
const mockLog = jest.fn();
jest.mock('../../../shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
const mockGroups = jest.fn();
jest.mock('../../../shared/services/coaching/ab-v10-arms', () => ({
  TABLE: 'niete_coaching_ab_assignment',
  groupsForUsers: (...a) => mockGroups(...a),
}), { virtual: true });

const reader = require('../../../shared/services/coaching/weekly-report/reader');

const WEEK = { weekStart: '2026-10-12', fromIso: '2026-10-11T19:00:00.000Z', toIso: '2026-10-16T19:00:00.000Z' };
const has = (ops, ...want) => ops.some((o) => JSON.stringify(o) === JSON.stringify(want));

beforeEach(() => { jest.clearAllMocks(); mockDb.reset(); });

describe('groupBTeachers — the cohort', () => {
  test('B schools → their live, non-test teachers with a phone → confirmed B by the group lookup', async () => {
    mockDb.results.niete_coaching_ab_assignment = { data: [{ school_id: 's1' }, { school_id: 's2' }], error: null };
    mockDb.results.users = {
      data: [
        { id: 'u1', phone_number: '923001', is_test_user: null },
        { id: 'u2', phone_number: '923002', is_test_user: true }, // test account
        { id: 'u3', phone_number: null, is_test_user: false }, //   no phone
        { id: 'u4', phone_number: '923004', is_test_user: false },
      ],
      error: null,
    };
    mockGroups.mockResolvedValue(new Map([['u1', { group: 'B' }], ['u4', null]]));

    expect(await reader.groupBTeachers()).toEqual(['u1']);

    const [a] = mockDb.callsTo('niete_coaching_ab_assignment');
    expect(has(a.ops, 'eq', 'ab_group', 'B')).toBe(true);
    const [u] = mockDb.callsTo('users');
    expect(has(u.ops, 'in', 'school_id', ['s1', 's2'])).toBe(true);
    expect(has(u.ops, 'eq', 'role', 'teacher')).toBe(true);
    expect(has(u.ops, 'is', 'deleted_at', null)).toBe(true);
    expect(mockGroups).toHaveBeenCalledWith(['u1', 'u4']);
  });

  test('no B schools: no user read, no lookup', async () => {
    mockDb.results.niete_coaching_ab_assignment = { data: [], error: null };
    expect(await reader.groupBTeachers()).toEqual([]);
    expect(mockDb.callsTo('users')).toHaveLength(0);
    expect(mockGroups).not.toHaveBeenCalled();
  });

  test('an assignment read error throws (the cohort must not be silently empty) and is logged', async () => {
    mockDb.results.niete_coaching_ab_assignment = { data: null, error: { message: 'down' } };
    await expect(reader.groupBTeachers()).rejects.toThrow('down');
    expect(mockLog).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error: 'down' }), 'error');
  });
});

describe('teacher — who the report goes to', () => {
  test('name, phone and preferred_language of a live account', async () => {
    mockDb.results.users = { data: { id: 'u1', name: 'A', phone_number: '923', preferred_language: 'ur' }, error: null };
    expect(await reader.teacher('u1')).toEqual({ id: 'u1', name: 'A', phone_number: '923', preferred_language: 'ur' });
    const [u] = mockDb.callsTo('users');
    expect(has(u.ops, 'select', 'id, name, phone_number, preferred_language')).toBe(true);
    expect(has(u.ops, 'is', 'deleted_at', null)).toBe(true);
  });

  test('a read error throws', async () => {
    mockDb.results.users = { data: null, error: { message: 'x' } };
    await expect(reader.teacher('u1')).rejects.toThrow('x');
  });
});

describe('readWeek — every read is bounded to the teacher and the week', () => {
  beforeEach(() => {
    mockDb.results.conversations = { data: [{ created_at: '2026-10-12T05:00:00' }], error: null };
    mockDb.results.niete_lp_downloads = { data: [{ lesson_id: 'L1', created_at: '2026-10-12T05:00:00Z' }], error: null };
    mockDb.results.niete_lp_opens = { data: [{ plan_ref: 'L2', opened_at: '2026-10-13T05:00:00Z' }], error: null };
    mockDb.results.coaching_sessions = { data: [{ id: 's1', created_at: '2026-10-14T05:00:00Z' }], error: null };
    mockDb.results.coaching_quality_metrics = { data: [{ coaching_session_id: 's1', user_satisfaction_rating: 1 }], error: null };
  });

  test('returns the rows the summariser needs', async () => {
    const w = await reader.readWeek('u1', WEEK);
    expect(w.messages).toHaveLength(1);
    expect(w.deliveries[0].lesson_id).toBe('L1');
    expect(w.opens[0].plan_ref).toBe('L2');
    expect(w.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(w).not.toHaveProperty('priors');
    expect(w.ratings[0].user_satisfaction_rating).toBe(1);
  });

  test('the filters', async () => {
    await reader.readWeek('u1', WEEK);
    for (const t of ['conversations', 'niete_lp_downloads', 'niete_lp_opens', 'coaching_sessions']) {
      for (const c of mockDb.callsTo(t)) {
        expect(has(c.ops, 'eq', 'user_id', 'u1')).toBe(true);
        expect(c.ops.some((o) => o[0] === 'limit' || o[0] === 'range')).toBe(true);
      }
    }
    const [conv] = mockDb.callsTo('conversations');
    expect(has(conv.ops, 'eq', 'role', 'user')).toBe(true);
    // conversations.created_at is naive UTC: compared as a zone-less UTC wall clock.
    expect(has(conv.ops, 'gte', 'created_at', '2026-10-11T19:00:00')).toBe(true);
    expect(has(conv.ops, 'lt', 'created_at', '2026-10-16T19:00:00')).toBe(true);
    const [dl] = mockDb.callsTo('niete_lp_downloads');
    expect(has(dl.ops, 'eq', 'status', 'sent')).toBe(true);
    const [op] = mockDb.callsTo('niete_lp_opens');
    expect(has(op.ops, 'eq', 'plan_kind', 'k5')).toBe(true);
    expect(has(op.ops, 'gte', 'opened_at', WEEK.fromIso)).toBe(true);
    const sessionCalls = mockDb.callsTo('coaching_sessions');
    expect(sessionCalls).toHaveLength(1); // no prior-session read: no thing to try
    const [week] = sessionCalls;
    expect(has(week.ops, 'is', 'observation_type', null)).toBe(true);
    expect(has(week.ops, 'not', 'analysis_data->scores', 'is', null)).toBe(true);
    // Class R: the narrow JSON path, never the whole analysis_data.
    expect(week.ops.find((o) => o[0] === 'select')[1]).toBe('id, created_at');
    const [q] = mockDb.callsTo('coaching_quality_metrics');
    expect(has(q.ops, 'in', 'coaching_session_id', ['s1'])).toBe(true);
  });

  test('no recordings: no ratings read', async () => {
    mockDb.results.coaching_sessions = { data: [], error: null };
    const w = await reader.readWeek('u1', WEEK);
    expect(w.ratings).toEqual([]);
    expect(mockDb.callsTo('coaching_quality_metrics')).toHaveLength(0);
  });

  test('any read error throws — a report with a silently missing count is worse than none', async () => {
    mockDb.results.niete_lp_opens = { data: null, error: { message: 'opens down' } };
    await expect(reader.readWeek('u1', WEEK)).rejects.toThrow('opens down');
  });
});

describe('readWeek — bd-v0toag.32.1 reads from the Saturday before the week', () => {
  test('every week read starts at weekendFromIso when the week carries one', async () => {
    await reader.readWeek('u1', { ...WEEK, weekendFromIso: '2026-10-09T19:00:00.000Z' });
    const [conv] = mockDb.callsTo('conversations');
    expect(has(conv.ops, 'gte', 'created_at', '2026-10-09T19:00:00')).toBe(true);
    for (const [t, col] of [['niete_lp_downloads', 'created_at'], ['niete_lp_opens', 'opened_at'], ['coaching_sessions', 'created_at']]) {
      const [c] = mockDb.callsTo(t);
      expect(has(c.ops, 'gte', col, '2026-10-09T19:00:00.000Z')).toBe(true);
    }
  });
});
