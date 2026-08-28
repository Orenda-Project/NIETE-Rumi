/**
 * Absent and Leave are two pages, not two checkbox groups on one. (bd-2727)
 *
 * Reported from a handset: "it says absent and leave for all students, and i can
 * mark a student as both". The MARK screen bound TWO CheckboxGroups — `absent` and
 * `on_leave` — to the same `${data.roster}`, so both listed every student and a
 * teacher could tick the same child in both. attendance-write.service then
 * arbitrated the contradiction at write time ("leave wins over absent"), which is a
 * data-model conflict papered over in code.
 *
 * The fix makes the overlap INEXPRESSIBLE rather than resolved:
 *
 *   MARK   who is absent?                     (the whole roster)
 *   LEAVE  who is on leave?                   (the roster MINUS the absentees)
 *
 * Successive subsets. A student cannot appear on the leave page once they are
 * marked absent, so the two statuses cannot collide.
 *
 * Nothing is written between the pages. markStudents() derives
 * total/present/absent/leave from the whole roster in a single call, so a partial
 * write would persist wrong tallies — and a teacher who abandoned page two would
 * leave them wrong permanently. Selection is held in `pending` and the register is
 * written once, at CONFIRM.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () =>
  // The real ConversationState runs against a fake `users` row — see the fixture
  // for why stubbing the service itself would prove nothing (bd-2733).
  require('../fixtures/conversation-state-fake').withConversationState(mockSupabase));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const marking = require('../../bot/shared/routes/attendance-marking-endpoint');
const flow = require('../../docs/flows/attendance-marking-flow.json');

function builder(rows) {
  const p = Promise.resolve({ data: rows, error: null });
  p.eq = () => builder(rows);
  p.in = () => builder(rows);
  p.order = () => builder(rows);
  p.limit = (n) => builder(rows.slice(0, n));
  p.maybeSingle = () => Promise.resolve({ data: rows[0] || null, error: null });
  return p;
}

const LIST = 'l1';
const ROSTER = [
  { id: 's1', student_name: 'Hataf Atif', roll_number: 1 },
  { id: 's2', student_name: 'Tariq Asim', roll_number: 2 },
  { id: 's3', student_name: 'Shujaan Azhar', roll_number: 3 },
];

function db() {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: 't1', role: 'teacher' }, error: null }),
            eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }),
      };
    }
    if (table === 'student_lists') {
      const row = { id: LIST, class_name: 'Grade 11', section: 'B', class_id: null };
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: [row], error: null }) }),
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
      };
    }
    if (table === 'students') {
      return { select: () => ({ eq: () => builder(ROSTER), in: () => builder([]) }) };
    }
    if (table === 'class_enrollments') return { select: () => ({ eq: () => builder([]), in: () => builder([]) }) };
    // CONFIRM checks whether this class+date is already on file (bd-2730).
    if (table === 'attendance_sessions') return { select: () => builder([]) };
    if (table === 'teacher_attendance_records') return { select: () => builder([]) };
    return {};
  });
}

/** Walk CLASS -> DATE and land on MARK. */
async function toMark(token = 't1') {
  db();
  await marking.handleMarkingDataExchange(token, 'CLASS', { class_id: `student:${LIST}` });
  return marking.handleMarkingDataExchange(token, 'DATE', { register_date: '2026-08-14' });
}

beforeEach(() => jest.clearAllMocks());

describe('the Flow graph puts LEAVE after MARK', () => {
  it('routes MARK -> LEAVE -> CONFIRM', () => {
    expect(flow.routing_model.MARK).toEqual(['LEAVE']);
    // bd-2729: no leave-TYPE step. Present / Absent / Leave, nothing finer.
    expect(flow.routing_model.LEAVE).toEqual(['CONFIRM']);
  });

  it('declares no LEAVE_TYPE screen', () => {
    expect(flow.screens.map((s) => s.id)).not.toContain('LEAVE_TYPE');
  });

  it('declares a LEAVE screen', () => {
    expect(flow.screens.map((s) => s.id)).toContain('LEAVE');
  });

  it('MARK asks for absentees ONLY — one CheckboxGroup, no on_leave', () => {
    const mark = JSON.stringify(flow.screens.find((s) => s.id === 'MARK'));
    const groups = (mark.match(/"CheckboxGroup"/g) || []).length;
    expect(groups).toBe(1);
    expect(mark).not.toContain('on_leave');
  });
});

describe('MARK — absentees only', () => {
  it('offers the whole roster', async () => {
    const mark = await toMark();
    expect(mark.screen).toBe('MARK');
    // Roll number in the title, no `description` key — WhatsApp Web will not render
    // a CheckboxGroup whose items carry one (bd-2734).
    expect(mark.data.roster.map((r) => r.title))
      .toEqual(['1. Hataf Atif', '2. Tariq Asim', '3. Shujaan Azhar']);
  });
});

describe('LEAVE — the roster minus the absentees', () => {
  it('does not list anyone already marked absent', async () => {
    await toMark();
    const leave = await marking.handleMarkingDataExchange('t1', 'MARK', { absent: ['s1'] });

    expect(leave.screen).toBe('LEAVE');
    const titles = leave.data.roster.map((r) => r.title);
    expect(titles.join(' ')).not.toContain('Hataf Atif');   // the reported bug
    expect(titles).toEqual(['2. Tariq Asim', '3. Shujaan Azhar']);
  });

  it('says what has already been decided', async () => {
    await toMark();
    const leave = await marking.handleMarkingDataExchange('t1', 'MARK', { absent: ['s1'] });
    const copy = JSON.stringify(leave.data);
    expect(copy).toMatch(/absent/i);
    expect(copy).toMatch(/present/i);
  });

  it('skips straight to the confirmation when nobody is on leave', async () => {
    await toMark();
    await marking.handleMarkingDataExchange('t1', 'MARK', { absent: ['s1'] });
    const res = await marking.handleMarkingDataExchange('t1', 'LEAVE', { on_leave: [] });
    expect(res.screen).toBe('CONFIRM');
  });

  it('goes straight to the confirmation when somebody is, naming them', async () => {
    await toMark();
    await marking.handleMarkingDataExchange('t1', 'MARK', { absent: ['s1'] });
    const res = await marking.handleMarkingDataExchange('t1', 'LEAVE', { on_leave: ['s2'] });
    expect(res.screen).toBe('CONFIRM');
    expect(res.data.detail).toMatch(/On leave: Tariq Asim/);
    // No type is asked for or shown.
    expect(res.data.detail).not.toMatch(/casual|sick|official/i);
  });

  it('offers the whole roster when nobody is absent', async () => {
    await toMark();
    const leave = await marking.handleMarkingDataExchange('t1', 'MARK', { absent: [] });
    expect(leave.data.roster).toHaveLength(3);
  });
});

describe('the two statuses cannot collide', () => {
  it('a student marked absent cannot also be sent as on-leave', async () => {
    await toMark();
    await marking.handleMarkingDataExchange('t1', 'MARK', { absent: ['s1'] });
    // Even if a crafted payload names the absentee, LEAVE only governs the subset
    // it offered — the absentee stays absent.
    const confirm = await marking.handleMarkingDataExchange('t1', 'LEAVE', { on_leave: ['s1', 's2'] });

    expect(confirm.screen).toBe('CONFIRM');
    const detail = confirm.data.detail;
    expect(detail).toMatch(/Absent: Hataf Atif/);
    expect(detail).toMatch(/Tariq Asim/);
    // Hataf must appear exactly once, as absent.
    expect((detail.match(/Hataf Atif/g) || []).length).toBe(1);
  });

  it('the confirmation tallies add up to the roster', async () => {
    await toMark();
    await marking.handleMarkingDataExchange('t1', 'MARK', { absent: ['s1'] });
    const confirm = await marking.handleMarkingDataExchange('t1', 'LEAVE', { on_leave: ['s2'] });

    // 3 students: 1 absent, 1 on leave, 1 present.
    expect(confirm.data.heading).toMatch(/1 present/);
    expect(confirm.data.heading).toMatch(/1 absent/);
    expect(confirm.data.heading).toMatch(/1 on leave/);
  });
});
