/**
 * /attendance for a PRINCIPAL is teacher attendance. Nothing else. (bd-43520)
 *
 * bd-2726 moved the picker onto the Flow's CLASS screen and, because CLASS was the
 * only screen without incoming edges, parked the principal's "teachers or students?"
 * question there as the first Dropdown option. That is correct about the platform
 * constraint and wrong about the product: a principal saying /attendance is taking
 * STAFF attendance, and every screen that asks them to choose a class first is a
 * screen asking them to re-answer something their role already settled.
 *
 * The fix is a SECOND entry screen. A Flow may not be OPENED on a screen with
 * incoming edges (bd-2713) — but nothing stops a Flow having more than one screen
 * with none, so STAFF_DATE is a root beside CLASS, and the principal enters there.
 *
 * The tap/voice question moves OUT of the Flow entirely and becomes the two reply
 * buttons that answer /attendance, because it is the first thing to decide and the
 * Flow cannot receive a voice note.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const fs = require('fs');
const path = require('path');

const router = require('../../bot/shared/services/attendance-router.service');
const marking = require('../../bot/shared/routes/attendance-marking-endpoint');
const flow = require('../../docs/flows/attendance-marking-flow.json');

function builder(rows) {
  const p = Promise.resolve({ data: rows, error: null });
  p.eq = () => builder(rows);
  p.order = () => builder(rows);
  p.limit = (n) => builder(rows.slice(0, n));
  p.maybeSingle = () => Promise.resolve({ data: rows[0] || null, error: null });
  return p;
}

function db({ user = {}, lists = [], staff = [], schools = [], teacherRecords = [] } = {}) {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: user, error: null }),
            eq: () => ({ order: () => Promise.resolve({ data: staff, error: null }) }),
          }),
        }),
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
      return { select: () => ({ eq: () => builder([]), in: () => builder([]) }) };
    }
    if (table === 'class_enrollments') {
      return { select: () => ({ eq: () => builder([]), in: () => builder([]) }) };
    }
    if (table === 'schools') {
      return {
        select: () => ({
          eq: (c, v) => ({ maybeSingle: () => Promise.resolve({ data: schools.find((s) => s.id === v) || null, error: null }) }),
        }),
      };
    }
    if (table === 'teacher_attendance_records') {
      return { select: () => ({ eq: () => builder(teacherRecords) }) };
    }
    return {};
  });
}

const PRINCIPAL = { id: 'p1', role: 'principal', school_id: 'sch1' };
const STAFF = [
  { id: 'u1', first_name: 'Ayesha', last_name: 'Khan' },
  { id: 'u2', first_name: 'Bilal', last_name: 'Ahmed' },
  { id: 'u3', first_name: 'Sana', last_name: 'Iqbal' },
];
const SCHOOLS = [{ id: 'sch1', name: 'GGPS Dhoke Ratta' }];

beforeEach(() => jest.clearAllMocks());

describe('the chat question: how would you like to mark?', () => {
  it('asks tap-or-voice, and nothing else, the moment a principal says /attendance', async () => {
    db({ user: PRINCIPAL, staff: STAFF, schools: SCHOOLS });
    const r = await router.route('p1');

    expect(r.action).toBe('ASK_METHOD');
    expect(r.buttons.map((b) => b.id)).toEqual(['att_method_tap', 'att_method_voice']);
    // The question is answerable from the text alone — buttons render below the
    // fold on some clients, and a bare "how?" is unanswerable there.
    expect(r.message).toMatch(/mark/i);
  });

  it('asks it even when the principal also runs their own class', async () => {
    // This is the case bd-2726 answered with a class Dropdown. A principal's
    // /attendance is staff attendance whether or not they teach.
    db({
      user: PRINCIPAL,
      staff: STAFF,
      schools: SCHOOLS,
      lists: [{ id: 'c1', class_name: 'Grade 5', section: 'A' }],
    });
    const r = await router.route('p1');

    expect(r.action).toBe('ASK_METHOD');
    expect(r.action).not.toBe('OPEN_REGISTER');
  });

  it('still says what is missing when the principal has no school', async () => {
    db({ user: { id: 'p9', role: 'principal', school_id: null } });
    const r = await router.route('p9');
    expect(r.action).toBe('NO_SCHOOL');
    expect(r.message).toMatch(/coordinator|not linked/i);
  });

  it('leaves the teacher path alone — they still open the register directly', async () => {
    db({ user: { id: 't1', role: 'teacher', school_id: 'sch1' }, lists: [{ id: 'c1', class_name: 'Grade 5' }] });
    const r = await router.route('t1');
    expect(r.action).toBe('OPEN_REGISTER');
    expect(r.flowToken).toBe('t1');
  });
});

describe('resolving the tap', () => {
  it('tap opens the staff register, targeted at the school', async () => {
    db({ user: PRINCIPAL, staff: STAFF, schools: SCHOOLS });
    const r = await router.resolveMethodChoice('p1', 'att_method_tap');
    expect(r.action).toBe('MARK_TEACHERS');
    expect(r.flowToken).toBe('p1:teacher:sch1');
  });

  it('voice asks for the voice note rather than opening a Flow', async () => {
    db({ user: PRINCIPAL, staff: STAFF, schools: SCHOOLS });
    const r = await router.resolveMethodChoice('p1', 'att_method_voice');
    expect(r.action).toBe('AWAIT_VOICE');
    expect(r.schoolId).toBe('sch1');
    expect(r.message).toMatch(/voice note/i);
  });

  it('refuses a method tap from someone with no school to mark', async () => {
    db({ user: { id: 'p9', role: 'principal', school_id: null } });
    const r = await router.resolveMethodChoice('p9', 'att_method_tap');
    expect(r.action).toBe('NO_SCHOOL');
  });
});

describe('the class fork is gone', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/attendance-router.service.js'), 'utf8',
  );

  it('no longer offers a "my teachers / my students" subject choice anywhere', () => {
    expect(src).not.toMatch(/att_subject_/);
    expect(router.resolveSubjectChoice).toBeUndefined();
  });
});

describe('the Flow: a principal enters on the date, not on a class', () => {
  const declared = new Set(flow.screens.map((s) => s.id));
  const incoming = new Set(Object.values(flow.routing_model).flat());
  const roots = [...declared].filter((s) => !incoming.has(s));

  it('has no METHOD screen — that question is asked in chat now', () => {
    expect(declared.has('METHOD')).toBe(false);
    expect(flow.routing_model.METHOD).toBeUndefined();
  });

  it('declares STAFF_DATE as a root, so the staff path can be opened on it', () => {
    expect(declared.has('STAFF_DATE')).toBe(true);
    expect(roots).toContain('STAFF_DATE');
  });

  it('keeps CLASS a root for teachers', () => {
    expect(roots).toContain('CLASS');
  });

  it('routes the staff path straight into the register', () => {
    expect(flow.routing_model.STAFF_DATE).toEqual(['MARK']);
  });

  it('still ends on exactly one terminal screen', () => {
    expect(flow.screens.filter((s) => s.terminal).map((s) => s.id)).toEqual(['SAVED']);
  });
});

describe('the endpoint: a staff token skips the picker', () => {
  it('INIT on a staff token renders STAFF_DATE', async () => {
    db({ user: PRINCIPAL, staff: STAFF, schools: SCHOOLS });
    const res = await marking.handleMarkingInit('p1:teacher:sch1');
    expect(res.screen).toBe('STAFF_DATE');
    // Named, so the principal can see WHOSE register this is.
    expect(res.data.heading).toContain('GGPS Dhoke Ratta');
  });

  it('the staff date screen bounds the picker to real days', async () => {
    db({ user: PRINCIPAL, staff: STAFF, schools: SCHOOLS });
    const res = await marking.handleMarkingInit('p1:teacher:sch1');
    expect(res.data.max_date).toBe(marking.regionToday());
    expect(res.data.min_date < res.data.max_date).toBe(true);
  });

  it('submitting the staff date lands on the register, with the staff roster', async () => {
    db({ user: PRINCIPAL, staff: STAFF, schools: SCHOOLS });
    await marking.handleMarkingInit('p1:teacher:sch1');
    const res = await marking.handleMarkingDataExchange(
      'p1:teacher:sch1', 'STAFF_DATE', { register_date: marking.regionToday() },
    );

    expect(res.screen).toBe('MARK');
    expect(res.data.roster.map((r) => r.title)).toEqual(['Ayesha Khan', 'Bilal Ahmed', 'Sana Iqbal']);
    expect(res.data.subject_note).toMatch(/teacher/i);
    // No student vocabulary on a principal's register.
    expect(JSON.stringify(res.data)).not.toMatch(/student/i);
  });

  it('a bare user id still enters on CLASS, so the teacher path is untouched', async () => {
    db({ user: { id: 't1', role: 'teacher', school_id: 'sch1' }, lists: [{ id: 'c1', class_name: 'Grade 5' }] });
    const res = await marking.handleMarkingInit('t1');
    expect(res.screen).toBe('CLASS');
  });

  it('never offers "My teachers" as a class option again', async () => {
    db({ user: PRINCIPAL, staff: STAFF, schools: SCHOOLS, lists: [{ id: 'c1', class_name: 'Grade 5' }] });
    const res = await marking.renderClassScreen('p1');
    expect(res.data.classes.map((o) => o.id)).not.toContain('teacher:sch1');
  });
});
