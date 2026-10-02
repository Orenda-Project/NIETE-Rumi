/**
 * bd-37lyd — a principal who IS a class teacher must be able to mark that class.
 *
 * `route()` forks on `role === 'principal'` before it loads a single class and
 * sends every principal to STAFF attendance. That was the right call when a
 * principal could not be named a class teacher at all. /roster now names them —
 * and its SAVED screen tells the coach, in so many words, "the N children are in
 * their attendance list now". With this router that sentence is false: the
 * principal says "attendance", gets the staff register, and the children are
 * unreachable from every surface.
 *
 * One live principal (Sheikh Zulfiqar Ali) owns a class, and his student marking
 * stopped — which is exactly what this router does.
 *
 * SO: a principal who owns at least one ACTIVE class is asked WHICH register.
 * A principal who owns none keeps today's behaviour, byte for byte — that is the
 * 99% case and the whole reason the fork was written.
 *
 * WHY THE REGISTER QUESTION COMES SECOND. The tap-or-voice question is answerable
 * by TYPING ("voice"), and text-message.handler carries a reader for exactly that.
 * Whichever question is asked second cannot recover the first answer from a typed
 * reply, so the first question has to be the one people type at — and the second
 * one's answer is carried in the button id itself, where it survives a handset
 * sitting on it for a week. Asking "whose register?" first would have put the
 * typed answer path on the question nobody types at.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const router = require('../../bot/shared/services/attendance-router.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const cp = (s) => [...String(s == null ? '' : s)].length;

const SCHOOL = 'sch1';
const PRINCIPAL = { id: 'p1', role: 'principal', school_id: SCHOOL, name: 'Sheikh Zulfiqar Ali' };
const TEACHER = { id: 't1', role: 'teacher', school_id: SCHOOL, name: 'Fiza Khan' };

function db({ user = PRINCIPAL, lists = [], enrolled = [] } = {}) {
  mockDb = createFakeSupabase({
    users: [user],
    schools: [{ id: SCHOOL, name: 'GGPS Dhoke Ratta' }],
    student_lists: lists,
    class_enrollments: enrolled,
    students: [],
  });
}

const ONE_CLASS = [{
  id: 'l1', user_id: PRINCIPAL.id, class_name: 'Grade 5', section: 'A',
  class_id: 'c1', is_active: true, created_at: '2026-09-13T00:00:00Z',
}];
const ONE_CHILD = [{ id: 'e1', class_id: 'c1', student_id: 's1', is_active: true }];

beforeEach(() => jest.clearAllMocks());

describe('a principal who owns a class', () => {
  it('is still asked tap-or-voice first — but the question no longer names a register', async () => {
    db({ lists: ONE_CLASS, enrolled: ONE_CHILD });

    const r = await router.route(PRINCIPAL.id);

    expect(r.action).toBe('ASK_METHOD');
    expect(r.buttons.map((b) => b.id)).toEqual(['att_method_tap', 'att_method_voice']);
    // It cannot say "teacher attendance": which register it is has not been settled.
    expect(r.message).not.toMatch(/teacher attendance/i);
    expect(r.message).toMatch(/tap|voice/i);
  });

  it('is asked WHICH register once the method is chosen, carrying the method in the id', async () => {
    db({ lists: ONE_CLASS, enrolled: ONE_CHILD });

    const tap = await router.resolveMethodChoice(PRINCIPAL.id, 'att_method_tap');
    expect(tap.action).toBe('ASK_REGISTER');
    expect(tap.buttons.map((b) => b.id))
      .toEqual(['att_register_staff_tap', 'att_register_class_tap']);

    const voice = await router.resolveMethodChoice(PRINCIPAL.id, 'att_method_voice');
    expect(voice.action).toBe('ASK_REGISTER');
    expect(voice.buttons.map((b) => b.id))
      .toEqual(['att_register_staff_voice', 'att_register_class_voice']);
  });

  it('names both registers in the body, not only on the buttons', async () => {
    db({ lists: ONE_CLASS, enrolled: ONE_CHILD });
    const r = await router.resolveMethodChoice(PRINCIPAL.id, 'att_method_tap');
    // Reply buttons render below the fold on some clients.
    expect(r.message).toMatch(/teacher/i);
    expect(r.message).toMatch(/class|student/i);
  });

  it('choosing the STAFF register lands exactly where a principal landed before', async () => {
    db({ lists: ONE_CLASS, enrolled: ONE_CHILD });

    const tap = await router.resolveRegisterChoice(PRINCIPAL.id, 'att_register_staff_tap');
    expect(tap.action).toBe('MARK_TEACHERS');
    expect(tap.flowToken).toBe('p1:teacher:sch1');

    const voice = await router.resolveRegisterChoice(PRINCIPAL.id, 'att_register_staff_voice');
    expect(voice.action).toBe('AWAIT_VOICE');
    expect(voice.subject).toBe('teacher');
    expect(voice.schoolId).toBe(SCHOOL);
  });

  it('choosing THEIR CLASS opens the student register, the way a teacher gets it', async () => {
    db({ lists: ONE_CLASS, enrolled: ONE_CHILD });

    const r = await router.resolveRegisterChoice(PRINCIPAL.id, 'att_register_class_tap');
    expect(r.action).toBe('OPEN_REGISTER');
    expect(r.flowToken).toBe('p1:student');
  });

  it('choosing THEIR CLASS by voice arms the wait against that one class', async () => {
    db({ lists: ONE_CLASS, enrolled: ONE_CHILD });

    const r = await router.resolveRegisterChoice(PRINCIPAL.id, 'att_register_class_voice');
    expect(r.action).toBe('AWAIT_VOICE');
    expect(r.subject).toBe('student');
    expect(r.targetId).toBe('l1');
  });

  it('asks which class when they own several and chose voice', async () => {
    db({
      lists: [...ONE_CLASS, {
        id: 'l2', user_id: PRINCIPAL.id, class_name: 'Grade 4', section: 'B',
        class_id: 'c2', is_active: true, created_at: '2026-09-14T00:00:00Z',
      }],
      enrolled: [...ONE_CHILD, { id: 'e2', class_id: 'c2', student_id: 's2', is_active: true }],
    });

    const r = await router.resolveRegisterChoice(PRINCIPAL.id, 'att_register_class_voice');
    expect(r.action).toBe('ASK_CLASS_FOR_VOICE');
  });

  it('an empty class is the readable dead end, not a Flow that cannot be filled', async () => {
    db({ lists: ONE_CLASS, enrolled: [] });

    const r = await router.resolveRegisterChoice(PRINCIPAL.id, 'att_register_class_voice');
    expect(r.action).toBe('EMPTY_CLASS');
  });

  it('re-asks rather than guessing when an unknown register id comes back', async () => {
    db({ lists: ONE_CLASS, enrolled: ONE_CHILD });

    const r = await router.resolveRegisterChoice(PRINCIPAL.id, 'att_register_nonsense');
    expect(r.action).toBe('ASK_REGISTER');
  });

  it('a register button that comes back AFTER the class is gone falls back to staff', async () => {
    // A reply button is a durable artifact on a handset. The class may have been
    // handed to someone else since — re-read, never trust the id.
    db({ lists: [], enrolled: [] });

    const r = await router.resolveRegisterChoice(PRINCIPAL.id, 'att_register_class_tap');
    expect(r.action).toBe('MARK_TEACHERS');
  });
});

describe('a principal who owns NO class — today, byte for byte', () => {
  it('is asked tap-or-voice, naming teacher attendance', async () => {
    db({ lists: [] });

    const r = await router.route(PRINCIPAL.id);
    expect(r.action).toBe('ASK_METHOD');
    expect(r.subject).toBe('teacher');
    expect(r.message).toMatch(/teacher attendance/i);
  });

  it('tap opens the staff register with no register question in between', async () => {
    db({ lists: [] });

    const r = await router.resolveMethodChoice(PRINCIPAL.id, 'att_method_tap');
    expect(r.action).toBe('MARK_TEACHERS');
    expect(r.flowToken).toBe('p1:teacher:sch1');
  });

  it('voice arms the staff wait with no register question in between', async () => {
    db({ lists: [] });

    const r = await router.resolveMethodChoice(PRINCIPAL.id, 'att_method_voice');
    expect(r.action).toBe('AWAIT_VOICE');
    expect(r.subject).toBe('teacher');
  });

  it('a principal with no school still gets the honest refusal', async () => {
    db({ user: { id: 'p9', role: 'principal', school_id: null }, lists: [] });

    const r = await router.route('p9');
    expect(r.action).toBe('NO_SCHOOL');
  });
});

describe('a teacher is untouched', () => {
  it('is asked about their class and never offered a staff register', async () => {
    db({ user: TEACHER, lists: [{ ...ONE_CLASS[0], user_id: TEACHER.id }], enrolled: ONE_CHILD });

    const r = await router.route(TEACHER.id);
    expect(r.action).toBe('ASK_METHOD');
    expect(r.subject).toBe('student');

    const tap = await router.resolveMethodChoice(TEACHER.id, 'att_method_tap');
    expect(tap.action).toBe('OPEN_REGISTER');
    expect(tap.flowToken).toBe('t1:student');
  });
});

describe('the copy', () => {
  const KEYS = {
    attendanceAskRegister: 1024,
    attendanceAskMethodEither: 1024,
    attendanceRegisterStaffButton: 20,
    attendanceRegisterClassButton: 20,
  };

  it('exists in both offered languages and fits its WhatsApp cap, in code points', () => {
    for (const [key, cap] of Object.entries(KEYS)) {
      for (const language of ['en', 'ur']) {
        const value = resolveUx(key, { language });
        expect(typeof value).toBe('string');
        expect(value.trim()).not.toBe('');
        expect(cp(value)).toBeLessThanOrEqual(cap);
      }
      // Urdu is a translation, not a copy of the English.
      expect(resolveUx(key, { language: 'ur' })).not.toBe(resolveUx(key, { language: 'en' }));
    }
  });

  it('serves the register question in the principal\'s own language', async () => {
    db({
      user: { ...PRINCIPAL, preferred_language: 'ur' },
      lists: ONE_CLASS,
      enrolled: ONE_CHILD,
    });

    const r = await router.resolveMethodChoice(PRINCIPAL.id, 'att_method_tap');
    expect(r.message).toBe(resolveUx('attendanceAskRegister', { language: 'ur' }));
    expect(r.buttons[0].title).toBe(resolveUx('attendanceRegisterStaffButton', { language: 'ur' }));
  });
});
