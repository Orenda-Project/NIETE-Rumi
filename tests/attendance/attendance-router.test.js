/**
 * attendance-router — who gets which flow when they say "attendance".
 *
 * Three decisions, all of which the old code got wrong or could not make:
 *
 *  1. A principal marks TEACHERS; a teacher marks STUDENTS. A principal who also
 *     runs a class is ASKED rather than guessed. The invariant that matters: a
 *     principal is never silently dropped into the student flow.
 *  2. A teacher with no class yet is offered SETUP — the old flow said
 *     "You haven't set up any classes yet" and then, because the Flow id was
 *     unset, "class setup is not available right now". A dead end with no exit.
 *  3. A teacher with several classes picks one. WhatsApp caps reply buttons at 3,
 *     so 4+ classes must become a list, not a silently truncated button row.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const router = require('../../bot/shared/services/attendance-router.service');

/** Stub: users lookup by id, student_lists by user_id. */
function db({ user = {}, classes = [] } = {}) {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: user, error: null }) }) }) };
    }
    if (table === 'student_lists') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: classes, error: null }) }),
          }),
        }),
      };
    }
    return {};
  });
}

beforeEach(() => jest.clearAllMocks());

describe('route by role', () => {
  it('a principal with a school marks teachers', async () => {
    db({ user: { id: 'p1', role: 'principal', school_id: 'sch1' }, classes: [] });
    const r = await router.route('p1');
    expect(r.action).toBe('MARK_TEACHERS');
    expect(r.flowToken).toBe('p1:teacher:sch1');
  });

  it('a plain teacher with one class marks students', async () => {
    db({ user: { id: 't1', role: 'teacher' }, classes: [{ id: 'c1', class_name: 'Grade 5', section: 'A' }] });
    const r = await router.route('t1');
    expect(r.action).toBe('MARK_STUDENTS');
    expect(r.flowToken).toBe('t1:student:c1');
  });

  it('a principal who also runs a class is ASKED, never guessed', async () => {
    db({ user: { id: 'p2', role: 'principal', school_id: 'sch1' }, classes: [{ id: 'c9', class_name: 'Grade 4' }] });
    const r = await router.route('p2');
    expect(r.action).toBe('ASK_SUBJECT');
    expect(r.message).toMatch(/teacher/i);
    expect(r.message).toMatch(/student/i);
  });

  it('a principal is NEVER routed into the student flow silently', async () => {
    for (const classes of [[], [{ id: 'c1', class_name: 'Grade 1' }], [{ id: 'c1' }, { id: 'c2' }]]) {
      db({ user: { id: 'p3', role: 'principal', school_id: 'sch1' }, classes });
      const r = await router.route('p3');
      expect(r.action).not.toBe('MARK_STUDENTS');
    }
  });

  it('a principal with no school is told what is missing, not shown a blank list', async () => {
    db({ user: { id: 'p4', role: 'principal', school_id: null }, classes: [] });
    const r = await router.route('p4');
    expect(r.action).toBe('NO_SCHOOL');
    expect(r.message).toMatch(/coordinator|not linked/i);
  });
});

describe('a teacher with no classes is offered setup', () => {
  it('returns SEND_SETUP rather than a dead end', async () => {
    db({ user: { id: 't2', role: 'teacher' }, classes: [] });
    const r = await router.route('t2');
    expect(r.action).toBe('SEND_SETUP');
    expect(r.message).toMatch(/set up|first class/i);
  });
});

describe('a teacher with several classes picks one', () => {
  const three = [
    { id: 'c1', class_name: 'Grade 3', section: 'A' },
    { id: 'c2', class_name: 'Grade 4', section: null },
    { id: 'c3', class_name: 'Grade 5', section: 'B' },
  ];

  it('offers buttons for up to 3', async () => {
    db({ user: { id: 't3', role: 'teacher' }, classes: three });
    const r = await router.route('t3');
    expect(r.action).toBe('ASK_CLASS_BUTTONS');
    expect(r.buttons).toHaveLength(3);
    expect(r.buttons[0].id).toBe('att_class_c1');
  });

  it('switches to a LIST at 4+ so the 4th class is reachable', async () => {
    db({ user: { id: 't4', role: 'teacher' }, classes: [...three, { id: 'c4', class_name: 'Grade 6' }] });
    const r = await router.route('t4');
    expect(r.action).toBe('ASK_CLASS_LIST');
    expect(r.rows).toHaveLength(4);
    expect(r.rows.map((x) => x.id)).toContain('att_class_c4');
  });

  it('never emits more list rows than WhatsApp allows', async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, class_name: `Grade ${i}` }));
    db({ user: { id: 't5', role: 'teacher' }, classes: many });
    const r = await router.route('t5');
    expect(r.rows.length).toBeLessThanOrEqual(10);
    expect(r.truncated).toBe(true);
  });

  it('keeps every row title inside the 24-char cap', async () => {
    db({
      user: { id: 't6', role: 'teacher' },
      classes: Array.from({ length: 4 }, (_, i) => ({
        id: `c${i}`, class_name: 'Higher Secondary (11-12)', section: 'Section Blue',
      })),
    });
    const r = await router.route('t6');
    r.rows.forEach((row) => expect(row.title.length).toBeLessThanOrEqual(24));
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
