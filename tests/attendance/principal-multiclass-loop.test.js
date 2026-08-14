/**
 * A principal with more than one class must be able to reach their students.
 *
 * Found 2026-08-14 while setting up a 2-class test account. resolveSubjectChoice()
 * ended with `return route(userId)` for the multi-class case, and route() re-enters
 * the principal fork, which answers ASK_SUBJECT whenever a principal has any
 * classes. So:
 *
 *   principal taps "My students"  ->  "Whose attendance — teachers or students?"
 *   principal taps "My students"  ->  "Whose attendance — teachers or students?"
 *   ... forever
 *
 * A principal with exactly one class was fine, which is why nobody hit it: the
 * only principal on staging had one class. The second class is what opens the
 * trap, and the intent was plainly to show the class picker — route()'s fallthrough
 * to ASK_CLASS_BUTTONS/ASK_CLASS_LIST — not to ask the same question again.
 *
 * The invariant from attendance-router.test.js still holds and is re-asserted here:
 * a principal is never silently dropped into the student flow. Answering the
 * question is not the same as being dropped into it.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const router = require('../../bot/shared/services/attendance-router.service');

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
            // loadList (bd-2724): .eq('id').maybeSingle() — the bridge to class_id
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

const PRINCIPAL = { id: 'p1', role: 'principal', school_id: 'sch1' };

beforeEach(() => jest.clearAllMocks());

describe('a principal who runs several classes', () => {
  it('gets a class picker after choosing "My students" — not the same question again', async () => {
    db({
      user: PRINCIPAL,
      classes: [
        { id: 'c1', class_name: '5th', section: 'A' },
        { id: 'c2', class_name: '6th', section: 'B' },
      ],
    });

    const r = await router.resolveSubjectChoice('p1', 'att_subject_student');

    // The loop: ASK_SUBJECT is the question they just answered.
    expect(r.action).not.toBe('ASK_SUBJECT');
    expect(r.action).toBe('ASK_CLASS_BUTTONS');
    expect(r.buttons.map((b) => b.id)).toEqual(['att_class_c1', 'att_class_c2']);
  });

  it('gets a list, not buttons, once there are more classes than WhatsApp allows buttons', async () => {
    db({
      user: PRINCIPAL,
      classes: Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, class_name: `Grade ${i + 1}` })),
    });

    const r = await router.resolveSubjectChoice('p1', 'att_subject_student');

    expect(r.action).toBe('ASK_CLASS_LIST');
    expect(r.rows).toHaveLength(4);
  });

  it('reaches the register in at most two taps from the subject question', async () => {
    const classes = [
      { id: 'c1', class_name: '5th', section: 'A' },
      { id: 'c2', class_name: '6th', section: 'B' },
    ];
    db({ user: PRINCIPAL, classes });

    const pick = await router.resolveSubjectChoice('p1', 'att_subject_student');
    const chosen = pick.buttons[1].id;                       // tap "6th - B"
    const marking = await router.resolveClassChoice('p1', chosen);

    expect(marking.action).toBe('MARK_STUDENTS');
    expect(marking.flowToken).toBe('p1:student:c2');
  });

  it('still never drops a principal into the student flow without asking', async () => {
    db({
      user: PRINCIPAL,
      classes: [{ id: 'c1', class_name: '5th' }, { id: 'c2', class_name: '6th' }],
    });

    const r = await router.route('p1');

    expect(r.action).toBe('ASK_SUBJECT');
    expect(r.action).not.toBe('MARK_STUDENTS');
  });

  it('an empty class chosen from a principal picker is still caught', async () => {
    db({
      user: PRINCIPAL,
      classes: [{ id: 'c1', class_name: '5th' }, { id: 'c2', class_name: '6th' }],
      roster: [],
    });

    const pick = await router.resolveSubjectChoice('p1', 'att_subject_student');
    const marking = await router.resolveClassChoice('p1', pick.buttons[0].id);

    expect(marking.action).toBe('EMPTY_CLASS');
  });
});
