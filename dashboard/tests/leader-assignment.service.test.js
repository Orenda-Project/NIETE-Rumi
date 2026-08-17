/**
 * bd-88krt — coach self-service: edit a visit, and own your school list (TDD, red-first).
 *
 * Riffat, HITL R38/R39/R41. R41's root cause: assigning a school is a TWO-TABLE
 * write (leader_schools + leader_teachers) done by hand, so half of it gets
 * forgotten. Live proof: school niete:273 sat in Syeda's leader_schools with 0
 * teachers, while all 8 of its teachers were still mapped to coach Rabia — and
 * niete:273 was never removed from Rabia either.
 *
 * Live data that shapes these rules (queried 2026-08-17, not assumed):
 *   · schools (master)      465 rows  ← the searchable universe
 *   · leader_schools        434 rows / 412 distinct schools
 *   · leader_teachers     7,149 rows / 412 schools, median 13, max 160
 *   · 0 schools have teachers but no coach, and 0 assigned schools have no
 *     teachers — so leader_teachers IS the de-facto school->teacher roster
 *   · 139 (school,teacher) pairs are ALREADY held by >1 coach — co-assignment
 *     is normal and must not be treated as an error
 *   · 51 master schools have NO coach and therefore NO teacher rows at all —
 *     adding one of those CANNOT map any teachers, and the coach must be told
 *     rather than handed a silently empty school (which is R41's symptom again)
 */

const {
  editSchedule, searchSchools, addSchool, removeSchool, searchTeachers,
} = require('../services/leader-assignment.service');

const LEADER = 'leader-1';
const OTHER = 'leader-2';
const TODAY = '2026-08-17';

function makeQuery(handlers = {}) {
  const writes = [];
  const q = jest.fn(async (sql, params) => {
    for (const [pattern, rows] of Object.entries(handlers)) {
      // 's' (dotAll): the SQL is multi-line, so '.' must span newlines
      if (new RegExp(pattern, 'is').test(sql)) {
        if (/^\s*(insert|update|delete)/i.test(sql)) writes.push({ sql, params });
        return { rows: typeof rows === 'function' ? rows(params) : rows };
      }
    }
    if (/^\s*(insert|update|delete)/i.test(sql)) { writes.push({ sql, params }); return { rows: [{}] }; }
    return { rows: [] };
  });
  q.writes = writes;
  return q;
}

// ── R39 · edit a scheduled visit ───────────────────────────────────────

describe('editSchedule', () => {
  const owned = [{ id: 's1', status: 'upcoming', leader_user_id: LEADER }];

  it('moves the coach\'s own upcoming visit to a new date and slot', async () => {
    const q = makeQuery({ 'select .* observation_schedules': owned });
    await editSchedule(q, LEADER, 's1', { date: '2026-08-25', slot: '11:30' }, { today: TODAY });
    const w = q.writes.find((x) => /update/i.test(x.sql));
    expect(w).toBeTruthy();
    expect(w.params).toContain('2026-08-25');
    expect(w.params).toContain('11:30');
  });

  it('refuses a date in the past, and a malformed one', async () => {
    const q = makeQuery({ 'select .* observation_schedules': owned });
    await expect(editSchedule(q, LEADER, 's1', { date: '2026-01-01' }, { today: TODAY })).rejects.toThrow(/past/i);
    await expect(editSchedule(q, LEADER, 's1', { date: '25-08-2026' }, { today: TODAY })).rejects.toThrow(/date/i);
  });

  it('refuses an unknown slot', async () => {
    const q = makeQuery({ 'select .* observation_schedules': owned });
    await expect(editSchedule(q, LEADER, 's1', { date: '2026-08-25', slot: '23:00' }, { today: TODAY }))
      .rejects.toThrow(/slot/i);
  });

  it('never edits another coach\'s visit', async () => {
    const q = makeQuery({ 'select .* observation_schedules': [{ id: 's1', status: 'upcoming', leader_user_id: OTHER }] });
    await expect(editSchedule(q, LEADER, 's1', { date: '2026-08-25' }, { today: TODAY })).rejects.toThrow(/not found/i);
    expect(q.writes.filter((w) => /update/i.test(w.sql))).toHaveLength(0);
  });

  it('never edits a completed visit — that row is the record of who was observed', async () => {
    const q = makeQuery({ 'select .* observation_schedules': [{ id: 's1', status: 'done', leader_user_id: LEADER }] });
    await expect(editSchedule(q, LEADER, 's1', { date: '2026-08-25' }, { today: TODAY }))
      .rejects.toThrow(/completed|done/i);
  });
});

// ── R38 · search and own your school list ──────────────────────────────

describe('searchSchools', () => {
  const master = [
    { school_ext_id: 'niete:273', school_name: 'IMS(I-V) No.2 G-10/2', emis: '273', teacher_count: 8, assigned_to_me: 0 },
    { school_ext_id: 'niete:916', school_name: 'IMCG, G-10/2', emis: '916', teacher_count: 0, assigned_to_me: 0 },
    { school_ext_id: 'niete:272', school_name: 'IMS(I-V) No.1 G-10/2', emis: '272', teacher_count: 9, assigned_to_me: 1 },
  ];

  it('searches by name because Meta gives no built-in search', async () => {
    const q = makeQuery({ 'select .* schools': master });
    const out = await searchSchools(q, LEADER, 'G-10/2');
    expect(out).toHaveLength(3);
    expect(q.mock.calls[0][1]).toContain('%G-10/2%');
  });

  it('says which are already mine, and which have no roster to map', async () => {
    const out = await searchSchools(makeQuery({ 'select .* schools': master }), LEADER, 'G-10/2');
    const byId = Object.fromEntries(out.map((s) => [s.schoolExtId, s]));
    expect(byId['niete:272'].alreadyMine).toBe(true);
    expect(byId['niete:273']).toMatchObject({ alreadyMine: false, teacherCount: 8, hasRoster: true });
    // 51 master schools have no teacher rows at all — adding one maps nobody
    expect(byId['niete:916']).toMatchObject({ teacherCount: 0, hasRoster: false });
  });

  it('refuses a search term too short to be useful', async () => {
    await expect(searchSchools(makeQuery(), LEADER, 'a')).rejects.toThrow(/two|short/i);
  });
});

describe('addSchool', () => {
  const roster = [
    { teacher_ext_id: 'p1', teacher_name: 'Farzana Kausar', teacher_phone_e164: '923001', level: 'PRIMARY' },
    { teacher_ext_id: 'p2', teacher_name: 'Nafeesa Noor', teacher_phone_e164: '923002', level: 'PRIMARY' },
  ];
  const handlers = {
    'select .* from schools': [{ school_ext_id: 'niete:273', school_name: 'IMS(I-V) No.2 G-10/2', emis: '273' }],
    'select .* leader_teachers': roster,
    'select .* leader_schools': [],
  };

  it('adds the school AND maps its whole roster — the two-table write, together', async () => {
    const q = makeQuery(handlers);
    const out = await addSchool(q, LEADER, 'niete:273');
    expect(out).toMatchObject({ schoolExtId: 'niete:273', teachersMapped: 2 });
    const sqls = q.writes.map((w) => w.sql).join(' | ');
    expect(sqls).toMatch(/leader_schools/i);
    expect(sqls).toMatch(/leader_teachers/i);
  });

  it('carries the teacher NAME and PHONE from the roster, never from the caller', async () => {
    const q = makeQuery(handlers);
    await addSchool(q, LEADER, 'niete:273');
    const flat = JSON.stringify(q.writes.map((w) => w.params));
    expect(flat).toContain('Farzana Kausar');
    expect(flat).toContain('923001');
  });

  it('is safe to run twice — a coach tapping add again must not double her roster', async () => {
    // Already mine AND I already have teachers there -> a true no-op. The count
    // handler must precede the roster one: both queries hit leader_teachers.
    const q = makeQuery({
      'count\\(\\*\\) as n\\s+from leader_teachers': [{ n: 2 }],
      ...handlers,
      'select .* leader_schools': [{ school_ext_id: 'niete:273' }],
    });
    const out = await addSchool(q, LEADER, 'niete:273');
    expect(out.alreadyMine).toBe(true);
    expect(q.writes.filter((w) => /insert/i.test(w.sql))).toHaveLength(0);
  });

  it('tells the coach plainly when a school has no roster, instead of adding an empty one', async () => {
    const q = makeQuery({ ...handlers, 'select .* leader_teachers': [] });
    const out = await addSchool(q, LEADER, 'niete:916');
    expect(out.teachersMapped).toBe(0);
    expect(out.warning).toMatch(/no teacher/i);   // R41's symptom must not be recreated silently
  });

  it('REPAIRS the R41 case: school already mine but with 0 of my teachers -> map the roster', async () => {
    // This is Syeda's live state for niete:273 — the school row exists, her
    // teacher rows do not. Refusing as "already mine" would leave the exact bug
    // this service exists to fix, so the add doubles as a repair.
    const q = makeQuery({
      'count\\(\\*\\) as n\\s+from leader_teachers': [{ n: 0 }],
      ...handlers,
      'select .* leader_schools': [{ school_ext_id: 'niete:273' }],
    });
    const out = await addSchool(q, LEADER, 'niete:273');
    expect(out.repaired).toBe(true);
    expect(out.teachersMapped).toBe(2);
    expect(q.writes.filter((w) => /insert .* leader_schools/is.test(w.sql))).toHaveLength(0);
  });

  it('writes a source the live CHECK constraint accepts (23514 guard)', async () => {
    // Both tables carry CHECK (source = 'niete_ict'). A 'coach_self_assign'
    // value fails EVERY insert with a CHECK violation — and no injected-query
    // test can see that, so assert the literal the schema actually permits.
    const { INSERT_SQL_SOURCE } = require('../services/leader-assignment.service');
    expect(INSERT_SQL_SOURCE).toBe('niete_ict');
  });

  it('refuses a school that is not in the master list', async () => {
    const q = makeQuery({ 'select .* from schools': [] });
    await expect(addSchool(q, LEADER, 'niete:99999')).rejects.toThrow(/not found/i);
  });
});

describe('removeSchool', () => {
  it('removes the school and only THIS coach\'s teacher rows for it', async () => {
    const q = makeQuery({ 'select .* leader_schools': [{ school_ext_id: 'niete:273' }] });
    const out = await removeSchool(q, LEADER, 'niete:273');
    expect(out.removed).toBe(true);
    for (const w of q.writes.filter((x) => /delete/i.test(x.sql))) {
      expect(w.params).toContain(LEADER);          // never another coach's rows
    }
  });

  it('refuses to remove a school that is not hers', async () => {
    const q = makeQuery({ 'select .* leader_schools': [] });
    await expect(removeSchool(q, LEADER, 'niete:273')).rejects.toThrow(/not (in your|found)/i);
  });
});

describe('searchTeachers', () => {
  it('searches within HER OWN teachers only', async () => {
    const q = makeQuery({ 'select .* leader_teachers': [{ teacher_ext_id: 'p1', teacher_name: 'Tahira Manzoor', school_name: 'IMSG', teacher_phone_e164: '923001' }] });
    const out = await searchTeachers(q, LEADER, 'tahira');
    expect(out).toHaveLength(1);
    expect(q.mock.calls[0][1]).toContain(LEADER);
    expect(q.mock.calls[0][1]).toContain('%tahira%');
  });

  it('caps results so a Flow dropdown can always render them', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      teacher_ext_id: `p${i}`, teacher_name: `Teacher ${i}`, teacher_phone_e164: `9230${i}`,
    }));
    const out = await searchTeachers(makeQuery({ 'select .* leader_teachers': many }), LEADER, 'teacher');
    expect(out.length).toBeLessThanOrEqual(20);     // RadioButtonsGroup ceiling
  });
});
