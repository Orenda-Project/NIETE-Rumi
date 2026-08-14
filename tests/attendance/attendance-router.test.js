/**
 * attendance-router — who gets which flow when they say "attendance".
 *
 * Three decisions, all of which the old code got wrong or could not make:
 *
 *  1. A principal marks TEACHERS; a teacher marks STUDENTS. A principal who also
 *     runs a class is ASKED rather than guessed. The invariant that matters: a
 *     principal is never silently dropped into the student flow.
 *  2. A teacher with no class yet is handed to /class, which OWNS class creation
 *     since bd-2724. And since bd-2726 route() no longer picks a class at all —
 *     the Flow's CLASS screen does, so route() only decides whether there is
 *     anything markable. The old flow said "You haven't set up any classes yet" and
 *     then, because the Flow id was unset, "class setup is not available right
 *     now" — a dead end with no exit. Attendance no longer creates classes at all.
 *  3. A teacher with several classes picks one. WhatsApp caps reply buttons at 3,
 *     so 4+ classes must become a list, not a silently truncated button row.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const router = require('../../bot/shared/services/attendance-router.service');

/**
 * Stub: users lookup by id, student_lists by user_id, and since bd-2713 an
 * existence probe on `students` — the router will not open the marking Flow for
 * a class with nobody on the roster.
 *
 * `roster` defaults to one student so the role-routing cases below keep testing
 * what they are about. The empty-roster behaviour has its own suite in
 * empty-roster-dead-end.test.js.
 */
function db({ user = {}, classes = [], roster = [{ id: 's1', student_name: 'Aleeha Noor' }] } = {}) {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: user, error: null }) }) }) };
    }
    if (table === 'student_lists') {
      return {
        select: () => ({
          eq: (col, val) => ({
            // loadClasses: .eq('user_id').eq('is_active').order()
            eq: () => ({ order: () => Promise.resolve({ data: classes, error: null }) }),
            // loadList: .eq('id').maybeSingle() — carries class_id, the bridge
            maybeSingle: () => Promise.resolve({
              data: classes.find((c) => c.id === val) || null, error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'students') {
      const tail = {
        limit: (n) => Promise.resolve({ data: roster.slice(0, n), error: null }),
        order: () => Promise.resolve({ data: roster, error: null }),
      };
      return { select: () => ({ eq: () => ({ eq: () => tail, ...tail }) }) };
    }
    return {};
  });
}

beforeEach(() => jest.clearAllMocks());

describe('route — one Flow, opened directly', () => {
  // bd-2726: the picker moved onto the Flow's CLASS screen, because chat allows 3
  // reply buttons or 10 list rows TOTAL and a teacher with 20 class-sections had ten
  // unreachable. route()'s only job now is deciding whether there is anything to
  // mark at all. What the picker SHOWS is covered by flow-preamble.test.js.
  it('opens the register for a teacher with classes, with a bare user id token', async () => {
    db({ user: { id: 't1', role: 'teacher' }, classes: [{ id: 'c1', class_name: 'Grade 5', section: 'A' }] });
    const r = await router.route('t1');
    expect(r.action).toBe('OPEN_REGISTER');
    expect(r.flowToken).toBe('t1');
  });

  it('opens the register for a principal with a school, even with no classes', async () => {
    db({ user: { id: 'p1', role: 'principal', school_id: 'sch1' }, classes: [] });
    const r = await router.route('p1');
    expect(r.action).toBe('OPEN_REGISTER');
    expect(r.flowToken).toBe('p1');
  });

  it('does not ask "teachers or students?" in chat any more — that is the first Dropdown option', async () => {
    db({ user: { id: 'p2', role: 'principal', school_id: 'sch1' }, classes: [{ id: 'c9', class_name: 'Grade 4' }] });
    const r = await router.route('p2');
    expect(r.action).toBe('OPEN_REGISTER');
    expect(r.action).not.toBe('ASK_SUBJECT');
  });

  it('never emits a chat class picker, at any class count', async () => {
    for (const n of [1, 3, 4, 14, 20]) {
      db({
        user: { id: 't9', role: 'teacher' },
        classes: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, class_name: `Grade ${i}` })),
      });
      const r = await router.route('t9');
      expect(['ASK_CLASS_BUTTONS', 'ASK_CLASS_LIST']).not.toContain(r.action);
      expect(r.action).toBe('OPEN_REGISTER');
    }
  });

  it('a principal with no school and no classes is told what is missing', async () => {
    db({ user: { id: 'p4', role: 'principal', school_id: null }, classes: [] });
    const r = await router.route('p4');
    expect(r.action).toBe('NO_SCHOOL');
    expect(r.message).toMatch(/coordinator|not linked/i);
  });

  it('hands a teacher with no class to the class manager', async () => {
    db({ user: { id: 't2', role: 'teacher', school_id: 'sch1' }, classes: [] });
    const r = await router.route('t2');
    expect(r.action).toBe('SEND_CLASS_MANAGER');
    expect(r.message).toMatch(/class/i);
  });
});

describe('the legacy tap paths still work for buttons already on a handset', () => {
  // A picker message delivered before bd-2726 is still tappable. These paths are no
  // longer produced, but must not throw when an old button comes back.
  it('resolves a class tap into a marking token', async () => {
    db({ user: { id: 't3', role: 'teacher' }, classes: [{ id: 'c1', class_name: 'Grade 3', section: 'A' }] });
    const r = await router.resolveClassChoice('t3', 'att_class_c1');
    expect(r.action).toBe('MARK_STUDENTS');
    expect(r.flowToken).toBe('t3:student:c1');
  });

  it('rejects a tap that is not a class id', async () => {
    db({ user: { id: 't3', role: 'teacher' }, classes: [] });
    const r = await router.resolveClassChoice('t3', 'att_subject_student');
    expect(r.action).toBe('ERROR');
  });

  it('keeps legacy picker titles inside the 24-char cap', async () => {
    db({
      user: { id: 'p5', role: 'principal', school_id: 'sch1' },
      classes: Array.from({ length: 4 }, (_, i) => ({
        id: `c${i}`, class_name: 'Higher Secondary (11-12)', section: 'Section Blue',
      })),
    });
    const r = await router.resolveSubjectChoice('p5', 'att_subject_student');
    r.rows.forEach((row) => expect([...row.title].length).toBeLessThanOrEqual(24));
  });
});

describe('detect — the keyword', () => {
  it('fires on the words teachers actually use, in both scripts', () => {
    ['attendance', '/attendance', 'حاضری', 'hazri', 'ATTENDANCE'].forEach((k) => {
      expect(router.detect(k).detected).toBe(true);
    });
  });

  it('does not hijack an unrelated sentence', () => {
    ['send me a lesson plan', 'quiz for grade 5', ''].forEach((k) => {
      expect(router.detect(k).detected).toBe(false);
    });
  });

  it('does not fire on "student list" — that used to steal the LP request', () => {
    // The old detector matched loose substrings, so "I need the student list for
    // my LP" dropped the teacher into attendance.
    expect(router.detect('I need the student list for my LP').detected).toBe(false);
  });
});
