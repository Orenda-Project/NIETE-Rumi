/**
 * /class: one edit screen. (bd-43524)
 *
 * The teacher's complaint was two hops long. Creating a class ended the Flow, so
 * filling it took a second `/class` — fixed already. What was left is the same shape
 * one step later: `ADD_STUDENTS` and `REMOVE_STUDENTS` are both terminal, so adding a
 * child and then removing one is still two visits.
 *
 * The fix is a MERGE, not another screen. Flow routing is forward-only, so there is no
 * legal edge back from a save screen to the roster — a chain of ROSTER → ADD → ROSTER_2
 * would be unbounded. Instead the roster, the removals and the additions become ONE
 * screen submitted once, which is also literally what was asked for: "the complete
 * list of students displayed, and from this screen add new students or remove existing
 * ones."
 *
 * Net effect: seven screens become five.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');
const flowJson = require('../../docs/flows/class-manager-flow.json');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const TEACHER = 'teacher-uuid-1';
const SCHOOL = 'school-uuid-1';
const CLASS_ID = 'class-uuid-1';

const REF = {
  grade_levels: [{ code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], sort_order: 4, is_active: true }],
  subjects: [{ code: 'maths', parent_code: null, aliases: ['maths'], is_active: true }],
  academic_sessions: [
    { code: '2026-2027', kind: 'annual', starts_on: '2026-08-01', ends_on: '2027-07-31', is_active: true },
  ],
  sections: [{ code: 'A', sort_order: 1, is_active: true }],
  shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
};

const kid = (n, roll) => ({ id: `s${n}`, student_name: `Child ${n}`, roll_number: roll, is_active: true });

let ep;
function boot({ students = [], enrollments = [], withClass = true } = {}) {
  jest.resetModules();
  mockDb = createFakeSupabase({
    users: [{ id: TEACHER, school_id: SCHOOL, preferred_language: 'en' }],
    ...REF,
    classes: withClass ? [{
      id: CLASS_ID, school_id: SCHOOL, grade_code: 'grade_4', section: 'A',
      shift_code: 'morning', session_code: '2026-2027', is_active: true,
    }] : [],
    class_teachers: withClass ? [{
      id: 'ct1', class_id: CLASS_ID, teacher_user_id: TEACHER,
      is_class_teacher: true, is_active: true, ended_on: null,
    }] : [],
    class_teacher_subjects: [],
    class_enrollments: enrollments,
    student_lists: [],
    students,
  });
  ep = require('../../bot/shared/routes/class-manager-endpoint');
}

const enrolled = (n, roll) => ({
  id: `e${n}`, class_id: CLASS_ID, student_id: `s${n}`, roll_number: roll, is_active: true,
});

beforeEach(() => boot());

describe('the Flow graph', () => {
  const ids = flowJson.screens.map((s) => s.id);

  it('no longer has separate add and remove screens', () => {
    expect(ids).not.toContain('ADD_STUDENTS');
    expect(ids).not.toContain('REMOVE_STUDENTS');
  });

  it('runs CLASSES → ROSTER → SAVED, and creation joins at ROSTER', () => {
    expect(flowJson.routing_model.CLASSES).toEqual(expect.arrayContaining(['ROSTER']));
    expect(flowJson.routing_model.SUBJECTS).toEqual(expect.arrayContaining(['ROSTER']));
    expect(flowJson.routing_model.ROSTER).toEqual(['SAVED']);
  });

  it('stays forward-only — Meta rejects a backward route at publish', () => {
    const back = [];
    for (const [from, tos] of Object.entries(flowJson.routing_model)) {
      for (const to of tos) if ((flowJson.routing_model[to] || []).includes(from)) back.push(`${from}->${to}`);
    }
    expect(back).toEqual([]);
  });

  it('keeps exactly one terminal screen and one entry screen', () => {
    expect(flowJson.screens.filter((s) => s.terminal).map((s) => s.id)).toEqual(['SAVED']);
    const incoming = new Set(Object.values(flowJson.routing_model).flat());
    expect(ids.filter((id) => !incoming.has(id))).toEqual(['CLASSES']);
  });

  describe('the ROSTER screen carries the whole edit', () => {
    const form = flowJson.screens.find((s) => s.id === 'ROSTER').layout.children
      .find((c) => c.type === 'Form');

    it('shows the roster, a way to remove, and a way to add', () => {
      const types = form.children.map((c) => c.type);
      expect(types).toContain('TextBody');        // the list
      expect(types).toContain('CheckboxGroup');   // tick to remove
      expect(types).toContain('TextArea');        // paste to add
    });

    it('requires neither, so a teacher can do one, the other, or both', () => {
      form.children
        .filter((c) => ['CheckboxGroup', 'TextArea'].includes(c.type))
        .forEach((c) => expect(c.required).toBe(false));
    });

    it('submits both in one action', () => {
      const payload = form.children.find((c) => c.type === 'Footer')['on-click-action'].payload;
      expect(payload.remove).toBe('${form.remove}');
      expect(payload.add).toBe('${form.add}');
    });

    it('no longer asks which of the two she wants', () => {
      // The radio choice was the extra step. The list and both actions are the screen.
      expect(form.children.some((c) => c.type === 'RadioButtonsGroup')).toBe(false);
    });
  });
});

describe('picking an existing class opens the edit screen', () => {
  it('lands on ROSTER with the children listed', async () => {
    boot({ students: [kid(1, 1), kid(2, 2)], enrollments: [enrolled(1, 1), enrolled(2, 2)] });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });

    expect(res.screen).toBe('ROSTER');
    expect(res.data.roster).toContain('Child 1');
    expect(res.data.roster).toContain('Child 2');
    expect(res.data.remove_options.map((o) => o.id)).toEqual(['s1', 's2']);
  });

  it('says so plainly when the class is empty, rather than offering nothing', async () => {
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    expect(res.screen).toBe('ROSTER');
    expect(res.data.remove_options).toEqual([]);
    expect(res.data.roster).toMatch(/no students/i);
  });
});

describe('one submit does both', () => {
  it('adds pasted names', async () => {
    boot();
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', {
      add: 'Aleeha Noor\n2) Bilal Ahmed', remove: [],
    });

    expect(res.screen).toBe('SAVED');
    expect(res.data.detail).toMatch(/2/);
    expect(mockDb._tables.students.map((s) => s.student_name).sort())
      .toEqual(['Aleeha Noor', 'Bilal Ahmed']);
  });

  it('removes ticked children', async () => {
    boot({ students: [kid(1, 1), kid(2, 2)], enrollments: [enrolled(1, 1), enrolled(2, 2)] });
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { remove: ['s1'], add: '' });

    expect(res.screen).toBe('SAVED');
    expect(res.data.detail).toMatch(/remov/i);
    const live = mockDb._tables.class_enrollments.filter((e) => e.is_active);
    expect(live.map((e) => e.student_id)).toEqual(['s2']);
  });

  it('does BOTH in one pass, which is the whole point', async () => {
    boot({ students: [kid(1, 1)], enrollments: [enrolled(1, 1)] });
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', {
      remove: ['s1'], add: 'Fresh Start',
    });

    expect(res.screen).toBe('SAVED');
    const live = mockDb._tables.class_enrollments.filter((e) => e.is_active);
    expect(live).toHaveLength(1);
    expect(mockDb._tables.students.some((s) => s.student_name === 'Fresh Start')).toBe(true);
    // Both halves are reported: a teacher who did two things and is told about one
    // assumes the other silently failed.
    expect(res.data.detail).toMatch(/remov/i);
    expect(res.data.detail).toMatch(/1|added/i);
  });

  it('is a no-op that says so when nothing was entered', async () => {
    boot({ students: [kid(1, 1)], enrollments: [enrolled(1, 1)] });
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { remove: [], add: '' });

    expect(res.screen).toBe('SAVED');
    expect(res.data.detail).toMatch(/nothing changed/i);
    expect(mockDb._tables.class_enrollments.filter((e) => e.is_active)).toHaveLength(1);
  });

  it('removes BEFORE adding, so re-adding a removed name keeps the new one', async () => {
    boot({ students: [kid(1, 1)], enrollments: [enrolled(1, 1)] });
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    await ep.handleClassManagerDataExchange(TEACHER, 'ROSTER', { remove: ['s1'], add: 'Child 1' });

    const live = mockDb._tables.class_enrollments.filter((e) => e.is_active);
    expect(live).toHaveLength(1);
  });
});

describe('creating a class runs into the same screen', () => {
  it('hands a brand-new class straight to its roster', async () => {
    // No class seeded: the one this test creates would otherwise collide with it on
    // the (school, grade, section, shift, session) identity index.
    boot({ withClass: false });
    await ep.handleClassManagerDataExchange(TEACHER, 'ADD', { grade: 'grade_4', section: 'A', shift: 'morning' });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'SUBJECTS', {
      subjects: ['maths'], is_class_teacher: true,
    });

    // Creating a class and filling it is ONE intention. It used to end here.
    expect(res.screen).toBe('ROSTER');
    expect(res.data.remove_options).toEqual([]);
  });
});

describe('a handset still holding the old published asset', () => {
  it('keeps working when it submits the retired ADD_STUDENTS screen', async () => {
    boot();
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'ADD_STUDENTS', { roster: 'Old Path' });

    expect(res.screen).toBe('SAVED');
    expect(mockDb._tables.students.some((s) => s.student_name === 'Old Path')).toBe(true);
  });

  it('keeps working when it submits the retired REMOVE_STUDENTS screen', async () => {
    boot({ students: [kid(1, 1)], enrollments: [enrolled(1, 1)] });
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'REMOVE_STUDENTS', { remove: ['s1'] });

    expect(res.screen).toBe('SAVED');
    expect(mockDb._tables.class_enrollments.filter((e) => e.is_active)).toHaveLength(0);
  });

  it('never ANSWERS with a screen the Flow no longer declares', async () => {
    // The contract that matters: Meta has nowhere to navigate to a screen that is not
    // in the asset, and the teacher is stranded mid-flow with her taps spent.
    const declared = new Set(flowJson.screens.map((s) => s.id));
    boot();
    await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });
    for (const [screen, data] of [['ADD_STUDENTS', { roster: '' }], ['REMOVE_STUDENTS', { remove: [] }]]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await ep.handleClassManagerDataExchange(TEACHER, screen, data);
      expect(declared.has(res.screen)).toBe(true);
    }
  });
});

describe('the removal list against the platform cap', () => {
  it('offers at most 20 to tick, and says how many it could not show', async () => {
    // Meta caps a CheckboxGroup at 20 options. Truncating in silence would leave the
    // 21st child unremovable with no explanation; the roster text still lists everyone.
    const many = Array.from({ length: 25 }, (_, i) => kid(i + 1, i + 1));
    boot({ students: many, enrollments: many.map((_, i) => enrolled(i + 1, i + 1)) });
    const res = await ep.handleClassManagerDataExchange(TEACHER, 'CLASSES', { target: CLASS_ID });

    expect(res.data.remove_options).toHaveLength(20);
    expect(res.data.hint).toMatch(/20|first/i);
  });
});
