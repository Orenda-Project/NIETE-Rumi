/**
 * Student attendance: the four asks, and the reuse they are built on. (bd-43523)
 *
 * The principal path already had every moving part — the chat method question, the
 * voice pipeline, the pre-ticked REVIEW screen, the monthly register. So none of this
 * is a second copy of any of it; each ask is the same function learning a second
 * subject. The suite asserts BOTH the behaviour and, where it is cheap, that the
 * behaviour comes from ONE implementation rather than two.
 *
 *   1. the classes are on the first screen — radio up to five, a dropdown past that
 *   2. tap-or-voice is asked in chat for a teacher too
 *   3. a teacher can mark by voice
 *   4. and gets the month-to-date register afterwards
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const fs = require('fs');
const path = require('path');

const router = require('../../bot/shared/services/attendance-router.service');
const marking = require('../../bot/shared/routes/attendance-marking-endpoint');
const voice = require('../../bot/shared/services/voice-attendance.service');
const flow = require('../../docs/flows/attendance-marking-flow.json');

function builder(rows) {
  const p = Promise.resolve({ data: rows, error: null });
  p.eq = () => builder(rows);
  p.order = () => builder(rows);
  p.limit = (n) => builder(rows.slice(0, n));
  p.maybeSingle = () => Promise.resolve({ data: rows[0] || null, error: null });
  return p;
}

// The conversation-state row is STORED, not stubbed: arm() writes it and armed()
// reads it back, so a fake that always answered "ok" would assert nothing about the
// thing under test. (Same reason voice-session-state.contract.test.js exists.)
const mockUserRow = {};

function db({ user = {}, lists = [], rosters = {} } = {}) {
  Object.keys(mockUserRow).forEach((k) => delete mockUserRow[k]);
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { ...user, ...mockUserRow }, error: null }),
            eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }),
        update: (patch) => ({ eq: () => { Object.assign(mockUserRow, patch); return Promise.resolve({ error: null }); } }),
      };
    }
    if (table === 'student_lists') {
      return {
        select: () => ({
          eq: (col, val) => ({
            eq: () => ({ order: () => Promise.resolve({ data: lists, error: null }) }),
            maybeSingle: () => Promise.resolve({ data: lists.find((l) => l.id === val) || null, error: null }),
          }),
        }),
      };
    }
    if (table === 'students') {
      return {
        select: () => ({
          eq: (col, val) => builder(col === 'list_id' ? (rosters[val] || []) : []),
          in: (col, ids) => builder(ids.flatMap((l) => (rosters[l] || []).map((r) => ({ ...r, list_id: l })))),
        }),
      };
    }
    if (table === 'class_enrollments') return { select: () => ({ eq: () => builder([]), in: () => builder([]) }) };
    if (table === 'schools') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    if (table === 'attendance_sessions') return { select: () => ({ eq: () => builder([]) }) };
    return {};
  });
}

const TEACHER = { id: 't1', role: 'teacher', school_id: 'sch1' };
const KIDS = [
  { id: 's1', student_name: 'Aleeha Noor', roll_number: 1 },
  { id: 's2', student_name: 'Bilal Ahmed', roll_number: 2 },
];
const classes = (n) => Array.from({ length: n }, (_, i) => ({
  id: `l${i}`, class_name: `Grade ${i + 1}`, section: 'A', class_id: null,
}));

beforeEach(() => jest.clearAllMocks());

// ── 1. the classes are on the first screen ───────────────────────────────────
describe('the class picker is the first screen, not a field that opens one', () => {
  it('offers radio buttons for a teacher with five classes or fewer', async () => {
    db({ user: TEACHER, lists: classes(5), rosters: {} });
    const res = await marking.renderClassScreen('t1');

    expect(res.screen).toBe('CLASS');
    expect(res.data.use_radio).toBe(true);
    expect(res.data.use_dropdown).toBe(false);
  });

  it('falls back to the dropdown past five, because radio caps out', async () => {
    db({ user: TEACHER, lists: classes(6), rosters: {} });
    const res = await marking.renderClassScreen('t1');

    expect(res.data.use_radio).toBe(false);
    expect(res.data.use_dropdown).toBe(true);
  });

  it('offers the same options to whichever control is showing', async () => {
    db({ user: TEACHER, lists: classes(3), rosters: {} });
    const res = await marking.renderClassScreen('t1');
    expect(res.data.classes.map((c) => c.id)).toEqual(['student:l0', 'student:l1', 'student:l2']);
  });

  it('accepts a submission from either control', async () => {
    db({ user: TEACHER, lists: classes(2), rosters: { l0: KIDS } });
    const viaRadio = await marking.handleMarkingDataExchange('t1', 'CLASS', { class_radio: 'student:l0' });
    expect(viaRadio.screen).toBe('DATE');

    db({ user: TEACHER, lists: classes(9), rosters: { l0: KIDS } });
    const viaDropdown = await marking.handleMarkingDataExchange('t1', 'CLASS', { class_dropdown: 'student:l0' });
    expect(viaDropdown.screen).toBe('DATE');
  });

  it('still accepts the old class_id key, for a Flow already open on a handset', async () => {
    db({ user: TEACHER, lists: classes(2), rosters: { l0: KIDS } });
    const res = await marking.handleMarkingDataExchange('t1', 'CLASS', { class_id: 'student:l0' });
    expect(res.screen).toBe('DATE');
  });

  describe('the Flow JSON', () => {
    const screen = flow.screens.find((s) => s.id === 'CLASS');
    const form = screen.layout.children.find((c) => c.type === 'Form');
    const kids = form.children;

    it('carries both controls on the one screen', () => {
      expect(kids.find((c) => c.type === 'RadioButtonsGroup')?.name).toBe('class_radio');
      expect(kids.find((c) => c.type === 'Dropdown')?.name).toBe('class_dropdown');
    });

    it('shows exactly one of them, chosen by the endpoint', () => {
      expect(kids.find((c) => c.type === 'RadioButtonsGroup').visible).toBe('${data.use_radio}');
      expect(kids.find((c) => c.type === 'Dropdown').visible).toBe('${data.use_dropdown}');
    });

    it('makes neither one required — a hidden required field cannot be satisfied', () => {
      // Meta blocks the Footer on an unsatisfied `required`, and one of these two is
      // always hidden. The endpoint validates instead.
      expect(kids.find((c) => c.type === 'RadioButtonsGroup').required).toBe(false);
      expect(kids.find((c) => c.type === 'Dropdown').required).toBe(false);
    });

    it('sends both values, so the endpoint can take whichever was filled', () => {
      const payload = kids.find((c) => c.type === 'Footer')['on-click-action'].payload;
      expect(payload.class_radio).toBe('${form.class_radio}');
      expect(payload.class_dropdown).toBe('${form.class_dropdown}');
    });

    it('puts `visible` on the CHILDREN and never on the Form', () => {
      // Meta refuses to publish a Form carrying `visible`.
      expect(form.visible).toBeUndefined();
    });
  });
});

// ── 2. tap or voice, in chat, for a teacher ──────────────────────────────────
describe('a teacher is asked how, in chat, before anything opens', () => {
  it('asks tap-or-voice on /attendance', async () => {
    db({ user: TEACHER, lists: classes(2), rosters: { l0: KIDS } });
    const r = await router.route('t1');

    expect(r.action).toBe('ASK_METHOD');
    expect(r.buttons.map((b) => b.id)).toEqual(['att_method_tap', 'att_method_voice']);
  });

  it('says CLASS attendance to a teacher and TEACHER attendance to a principal', async () => {
    db({ user: TEACHER, lists: classes(1), rosters: { l0: KIDS } });
    const teacherAsk = await router.route('t1');

    db({ user: { id: 'p1', role: 'principal', school_id: 'sch1' } });
    const principalAsk = await router.route('p1');

    expect(teacherAsk.message).toMatch(/class|student/i);
    expect(principalAsk.message).toMatch(/teacher/i);
    expect(teacherAsk.message).not.toBe(principalAsk.message);
  });

  it('sends a tapping teacher into the register, class picker and all', async () => {
    db({ user: TEACHER, lists: classes(2), rosters: { l0: KIDS } });
    const r = await router.resolveMethodChoice('t1', 'att_method_tap');

    expect(r.action).toBe('OPEN_REGISTER');
    expect(r.flowToken).toBe('t1');
  });

  it('still has no classes to offer a teacher who has none', async () => {
    db({ user: TEACHER, lists: [], rosters: {} });
    const r = await router.route('t1');
    expect(r.action).toBe('SEND_CLASS_MANAGER');
  });
});

// ── 3. voice, for students ───────────────────────────────────────────────────
describe('a teacher marking by voice', () => {
  it('goes straight to the voice note when there is only one class', async () => {
    db({ user: TEACHER, lists: classes(1), rosters: { l0: KIDS } });
    const r = await router.resolveMethodChoice('t1', 'att_method_voice');

    expect(r.action).toBe('AWAIT_VOICE');
    expect(r.subject).toBe('student');
    expect(r.targetId).toBe('l0');
  });

  it('asks WHICH class first when there are several — a roster is needed to match names', async () => {
    db({ user: TEACHER, lists: classes(3), rosters: { l0: KIDS, l1: KIDS, l2: KIDS } });
    const r = await router.resolveMethodChoice('t1', 'att_method_voice');

    expect(r.action).toBe('ASK_CLASS_FOR_VOICE');
    expect(r.buttons.map((b) => b.id)).toEqual(['att_voice_l0', 'att_voice_l1', 'att_voice_l2']);
  });

  it('uses a list once the classes outnumber WhatsApp buttons', async () => {
    db({ user: TEACHER, lists: classes(6), rosters: {} });
    const r = await router.resolveMethodChoice('t1', 'att_method_voice');

    expect(r.action).toBe('ASK_CLASS_FOR_VOICE_LIST');
    expect(r.rows).toHaveLength(6);
  });

  it('resolves that class tap into the voice wait', async () => {
    db({ user: TEACHER, lists: classes(3), rosters: { l1: KIDS } });
    const r = await router.resolveVoiceClassChoice('t1', 'att_voice_l1');

    expect(r.action).toBe('AWAIT_VOICE');
    expect(r.subject).toBe('student');
    expect(r.targetId).toBe('l1');
  });

  it('refuses to arm on an empty class rather than open a register against nobody', async () => {
    db({ user: TEACHER, lists: classes(3), rosters: {} });
    const r = await router.resolveVoiceClassChoice('t1', 'att_voice_l1');
    expect(r.action).toBe('EMPTY_CLASS');
  });

  it('matches a child by name, and by roll number, which is how registers are read', () => {
    expect(voice.matchPerson('Aleeha', KIDS)?.id).toBe('s1');
    expect(voice.matchPerson('roll number 2', KIDS)?.id).toBe('s2');
    expect(voice.matchPerson('number 1', KIDS)?.id).toBe('s1');
    expect(voice.matchPerson('roll 7', KIDS)).toBeNull();
  });

  it('holds the subject as well as the target while it waits', async () => {
    // The wait used to carry only a schoolId, which cannot say "this class".
    db({ user: TEACHER });
    await voice.arm('t1', { subject: 'student', targetId: 'l0' });
    expect(await voice.armed('t1')).toMatchObject({ subject: 'student', targetId: 'l0' });
  });

  it('opens the review screen on a student voice token, with the children pre-ticked', async () => {
    db({ user: TEACHER, lists: classes(2), rosters: { l0: KIDS } });
    await voice.stashResult('t1', {
      subject: 'student', targetId: 'l0', absentIds: ['s1'], leaveIds: [], transcript: 'Aleeha absent',
    });

    const res = await marking.handleMarkingInit('t1:student:l0:voice');
    expect(res.screen).toBe('REVIEW');
    expect(res.data.preselected).toEqual(['s1']);
    expect(res.data.roster.map((r) => r.title)).toEqual(['1. Aleeha Noor', '2. Bilal Ahmed']);
  });
});

// ── 4. the register ──────────────────────────────────────────────────────────
describe('the register a teacher gets afterwards', () => {
  const delivery = require('../../bot/shared/services/attendance-register-delivery.service');

  it('is one delivery path that knows both subjects, not two copies', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/services/attendance-register-delivery.service.js'), 'utf8',
    );
    expect(typeof delivery.deliverRegister).toBe('function');
    // A second generator would be the duplication this whole change is trying to avoid.
    expect(src.match(/createMonthlyRegisterBuffer/g) || []).toHaveLength(1);
  });

  it('names a student register for the class, not the school', () => {
    const register = require('../../bot/shared/services/attendance-register.service');
    expect(register.formatMonthlyFileName('Grade 5 - B', 8, 2026, 'student'))
      .toBe('Attendance_Grade_5_B_August_2026.xlsx');
    expect(register.formatMonthlyFileName('GGPS Dhoke Ratta', 8, 2026, 'teacher'))
      .toBe('Teacher_Attendance_GGPS_Dhoke_Ratta_August_2026.xlsx');
  });

  it('gives a student register a roll-number column', async () => {
    const register = require('../../bot/shared/services/attendance-register.service');
    const buffer = await register.createMonthlyRegisterBuffer(
      { title: 'Grade 5 - B', subject: 'student' }, 8, 2026, KIDS,
      [{ student_id: 's1', date: '2026-08-03', status: 'present' }],
    );
    const sheet = JSON.parse(buffer.toString())[0];
    const header = sheet.rows.find((r) => String(r[0]).includes('Roll'));
    expect(header).toBeDefined();
    expect(header[1]).toBe('Student');
  });
});
