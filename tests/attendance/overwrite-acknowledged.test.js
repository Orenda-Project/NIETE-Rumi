/**
 * Re-marking a day must SAY it is replacing something. (bd-2730)
 *
 * Reported: "i submitted it for the same day again. i am not sure if it overrode it
 * or not, but it should acknowledge that an override is happening within the flow."
 *
 * The write path was already correct — verified on staging, one session per
 * (class, date) with was_manually_edited=true and exactly 3 records, no duplicates.
 * The problem was that the teacher could not tell. CONFIRM carried a STATIC caption,
 * "Marked this day already? Saving replaces the earlier record." — shown whether or
 * not a record existed, so it was a hedge rather than an acknowledgement, and easy to
 * read as boilerplate.
 *
 * Now CONFIRM looks, and says what it found: the earlier tallies and when they were
 * saved. And the teacher path reports `replaced` too, which it never did — markTeachers
 * upserts, so it overwrote silently by design.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const marking = require('../../bot/shared/routes/attendance-marking-endpoint');

const LIST = 'l1';
const ROSTER = [
  { id: 's1', student_name: 'Hataf Atif', roll_number: 1 },
  { id: 's2', student_name: 'Tariq Asim', roll_number: 2 },
  { id: 's3', student_name: 'Shujaan Azhar', roll_number: 3 },
];

function builder(rows) {
  const p = Promise.resolve({ data: rows, error: null });
  p.eq = () => builder(rows);
  p.in = () => builder(rows);
  p.order = () => builder(rows);
  p.limit = (n) => builder(rows.slice(0, n));
  p.maybeSingle = () => Promise.resolve({ data: rows[0] || null, error: null });
  return p;
}

/** @param {object|null} existing an attendance_sessions row already on file */
function db({ existing = null } = {}) {
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
      return {
        select: () => ({
          eq: () => builder(ROSTER),
          in: (col, ids) => builder(col === 'list_id'
            ? ROSTER.map((r) => ({ ...r, list_id: LIST }))
            : []),
        }),
      };
    }
    if (table === 'class_enrollments') return { select: () => ({ eq: () => builder([]), in: () => builder([]) }) };
    if (table === 'attendance_sessions') return { select: () => builder(existing ? [existing] : []) };
    if (table === 'teacher_attendance_records') return { select: () => builder([]) };
    return {};
  });
}

async function toConfirm(token) {
  await marking.handleMarkingDataExchange(token, 'CLASS', { class_id: `student:${LIST}` });
  await marking.handleMarkingDataExchange(token, 'DATE', { register_date: '2026-08-14' });
  await marking.handleMarkingDataExchange(token, 'METHOD', { method: 'tap' });
  await marking.handleMarkingDataExchange(token, 'MARK', { absent: ['s1'] });
  return marking.handleMarkingDataExchange(token, 'LEAVE', { on_leave: [] });
}

beforeEach(() => jest.clearAllMocks());

describe('CONFIRM warns before it replaces', () => {
  it('names the earlier tallies when the day is already marked', async () => {
    db({
      existing: {
        id: 'sess-1', session_date: '2026-08-14', total_students: 3,
        present_count: 2, absent_count: 0, leave_count: 1,
        created_at: '2026-08-14T10:27:41.000Z',
      },
    });

    const confirm = await toConfirm('t-a');

    expect(confirm.screen).toBe('CONFIRM');
    const note = confirm.data.overwrite_note;
    expect(note).toMatch(/already marked/i);
    expect(note).toMatch(/replace/i);
    // The prior numbers, so the teacher can see what they are about to lose.
    expect(note).toMatch(/2 present/);
    expect(note).toMatch(/1 on leave/);
  });

  it('says nothing about replacing when the day is fresh', async () => {
    db({ existing: null });

    const confirm = await toConfirm('t-b');

    expect(confirm.data.overwrite_note || '').not.toMatch(/replace/i);
    expect(confirm.data.overwrite_note || '').not.toMatch(/already marked/i);
  });

  it('does not hedge — the note is absent, not a maybe', async () => {
    db({ existing: null });
    const confirm = await toConfirm('t-c');
    // The old copy asked "Marked this day already?" on every single register.
    expect(confirm.data.overwrite_note || '').not.toMatch(/\?/);
  });
});
