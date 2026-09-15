/**
 * bd-tf3jg — change a saved class's grade / section / shift from the
 * saved-roster view, with the twin-class refuse-or-merge.
 *
 * Those three fields ARE the class identity (classes is unique on school +
 * grade + section + shift + session), so a change either renames the class in
 * place — children, attendance history and class_teachers all key on the class
 * id and follow — or lands on a class that already exists. 13 such twins are
 * known on prod. The rule: never merge silently. Name the existing class and its
 * child count, and let the coach choose: keep both (cancel) or merge into the
 * existing class, which moves the active enrolments, closes the source with a
 * reason (merged_into_class_id) and deletes nothing.
 *
 * Service half: the real ClassService against the fake Supabase's
 * roster_change_class_details twin. Endpoint half: the real screens with
 * ClassService mocked at the one new write. Asset half: the Flow JSON.
 */
const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const SCHOOL = 'school-1';
const COACH = 'coach-1';
const TEACHER_A = 'teacher-a';
const TEACHER_B = 'teacher-b';
const SESSION = (() => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
})();

/**
 * cls-a: Grade 3-A morning, 2 children, class teacher A (mirror list-a).
 * cls-b: Grade 3-B morning, 2 children (one of them ALSO in cls-a — the twin
 *        case where the same child was scanned into both), class teacher B.
 */
function seed(extra = {}) {
  return createFakeSupabase({
    schools: [{ id: SCHOOL, name: 'IMSG (I-8/4)' }],
    grade_levels: [
      { code: 'grade_1', ordinal: 1, band: 'primary', is_active: true },
      { code: 'grade_2', ordinal: 2, band: 'primary', is_active: true },
      { code: 'grade_3', ordinal: 3, band: 'primary', is_active: true },
      { code: 'grade_4', ordinal: 4, band: 'primary', is_active: true },
      { code: 'grade_5', ordinal: 5, band: 'primary', is_active: true },
    ],
    sections: [{ code: 'A', sort_order: 1, is_active: true }, { code: 'B', sort_order: 2, is_active: true }, { code: 'C', sort_order: 3, is_active: true }],
    shifts: [{ code: 'morning', sort_order: 1, is_active: true }, { code: 'evening', sort_order: 2, is_active: true }],
    users: [
      { id: COACH, name: 'Coach One', role: 'coach' },
      { id: TEACHER_A, name: 'Teacher A', role: 'teacher', school_id: SCHOOL },
      { id: TEACHER_B, name: 'Teacher B', role: 'teacher', school_id: SCHOOL },
    ],
    leader_teachers: [],
    classes: [
      { id: 'cls-a', school_id: SCHOOL, grade_code: 'grade_3', section: 'A', shift_code: 'morning', session_code: SESSION, is_active: true },
      { id: 'cls-b', school_id: SCHOOL, grade_code: 'grade_3', section: 'B', shift_code: 'morning', session_code: SESSION, is_active: true },
    ],
    class_teachers: [
      { id: 'ct-a', class_id: 'cls-a', teacher_user_id: TEACHER_A, is_class_teacher: true, is_active: true },
      { id: 'ct-b', class_id: 'cls-b', teacher_user_id: TEACHER_B, is_class_teacher: true, is_active: true },
    ],
    student_lists: [
      { id: 'list-a', user_id: TEACHER_A, class_name: 'Grade 3 - A', academic_year: SESSION, class_id: 'cls-a', is_active: true, student_count: 2 },
      { id: 'list-b', user_id: TEACHER_B, class_name: 'Grade 3 - B', academic_year: SESSION, class_id: 'cls-b', is_active: true, student_count: 2 },
    ],
    students: [
      { id: 'st-1', student_name: 'Ayesha', list_id: 'list-a', is_active: true },
      { id: 'st-2', student_name: 'Minahil', list_id: 'list-a', is_active: true },
      { id: 'st-3', student_name: 'Hooria', list_id: 'list-b', is_active: true },
    ],
    class_enrollments: [
      { id: 'e1', class_id: 'cls-a', student_id: 'st-1', roll_number: 1, is_active: true },
      { id: 'e2', class_id: 'cls-a', student_id: 'st-2', roll_number: 2, is_active: true },
      { id: 'e3', class_id: 'cls-b', student_id: 'st-3', roll_number: 1, is_active: true },
      { id: 'e4', class_id: 'cls-b', student_id: 'st-2', roll_number: 2, is_active: true },
    ],
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// A. THE WRITE
// ---------------------------------------------------------------------------

describe('ClassService.changeClassDetails', () => {
  let ClassService;
  beforeEach(() => {
    jest.resetModules();
    mockDb = seed();
    // eslint-disable-next-line global-require
    ClassService = require('../../bot/shared/services/classes/class.service');
  });

  it('renames in place when the target identity is free — the children, the teacher and the mirror all follow', async () => {
    const res = await ClassService.changeClassDetails({
      classId: 'cls-a', schoolId: SCHOOL, gradeCode: 'grade_3', section: 'C', shiftCode: 'evening', actorUserId: COACH,
    });
    expect(res.error).toBeUndefined();
    expect(res.action).toBe('renamed');
    const cls = mockDb._tables.classes.find((c) => c.id === 'cls-a');
    expect(cls.section).toBe('C');
    expect(cls.shift_code).toBe('evening');
    expect(cls.is_active).toBe(true);
    // Nothing else moved: same enrolment rows, same assignment, mirror renamed.
    expect(mockDb._tables.class_enrollments.filter((e) => e.class_id === 'cls-a' && e.is_active)).toHaveLength(2);
    expect(mockDb._tables.class_teachers.find((r) => r.id === 'ct-a').is_active).toBe(true);
    expect(mockDb._tables.student_lists.find((l) => l.id === 'list-a').class_name).toBe('Grade 3 - C (evening)');
    expect(res.label).toBe('Grade 3 - C (evening)');
  });

  it('a target that already exists is a COLLISION unless merge is asked for — nothing is written, the twin is named with its count', async () => {
    const res = await ClassService.changeClassDetails({
      classId: 'cls-a', schoolId: SCHOOL, gradeCode: 'grade_3', section: 'B', shiftCode: 'morning', actorUserId: COACH,
    });
    expect(res.error).toBeUndefined();
    expect(res.action).toBe('collision');
    expect(res.existingClassId).toBe('cls-b');
    expect(res.existingCount).toBe(2);
    expect(res.sourceCount).toBe(2);
    expect(mockDb._tables.classes.find((c) => c.id === 'cls-a').section).toBe('A');
    expect(mockDb._writes).toHaveLength(0);
  });

  it('merge moves the active enrolments into the existing class, closes the duplicate, closes the source with a reason, deletes nothing', async () => {
    const studentsBefore = mockDb._tables.students.length;
    const res = await ClassService.changeClassDetails({
      classId: 'cls-a', schoolId: SCHOOL, gradeCode: 'grade_3', section: 'B', shiftCode: 'morning', actorUserId: COACH, merge: true,
    });
    expect(res.error).toBeUndefined();
    expect(res.action).toBe('merged');
    expect(res.targetClassId).toBe('cls-b');
    expect(res.moved).toBe(1);        // Ayesha
    expect(res.closedDuplicates).toBe(1); // Minahil was already in cls-b

    const enr = mockDb._tables.class_enrollments;
    expect(enr.find((e) => e.id === 'e1').class_id).toBe('cls-b');
    expect(enr.find((e) => e.id === 'e1').is_active).toBe(true);
    expect(enr.find((e) => e.id === 'e2').is_active).toBe(false);
    expect(enr.find((e) => e.id === 'e2').outcome).toBe('roster_correction');
    expect(enr.filter((e) => e.class_id === 'cls-b' && e.is_active)).toHaveLength(3);
    // The source class is CLOSED, not deleted, and says where it went.
    const src = mockDb._tables.classes.find((c) => c.id === 'cls-a');
    expect(src.is_active).toBe(false);
    expect(src.merged_into_class_id).toBe('cls-b');
    // Nothing deleted anywhere.
    expect(mockDb._tables.students).toHaveLength(studentsBefore);
    expect(enr).toHaveLength(4);
    expect(mockDb._writes.some((w) => w.op === 'delete')).toBe(false);
    // The source teacher keeps a foothold on the target (not as class teacher — B holds it); the source assignment closes.
    expect(mockDb._tables.class_teachers.find((r) => r.id === 'ct-a').is_active).toBe(false);
    const aOnB = mockDb._tables.class_teachers.find((r) => r.class_id === 'cls-b' && r.teacher_user_id === TEACHER_A && r.is_active);
    expect(aOnB).toBeTruthy();
    expect(aOnB.is_class_teacher).toBe(false);
    expect(mockDb._tables.class_teachers.find((r) => r.id === 'ct-b').is_class_teacher).toBe(true);
    // The moved child now sits in the target's attendance list; the source mirror is retired, not deleted.
    expect(mockDb._tables.students.find((s) => s.id === 'st-1').list_id).toBe('list-b');
    expect(mockDb._tables.student_lists.find((l) => l.id === 'list-a').is_active).toBe(false);
  });

  it('a roll already taken in the target is dropped from the moved enrolment rather than refusing the child', async () => {
    mockDb = seed({
      class_enrollments: [
        { id: 'e1', class_id: 'cls-a', student_id: 'st-1', roll_number: 1, is_active: true },
        { id: 'e3', class_id: 'cls-b', student_id: 'st-3', roll_number: 1, is_active: true },
      ],
    });
    jest.resetModules();
    // eslint-disable-next-line global-require
    ClassService = require('../../bot/shared/services/classes/class.service');
    const res = await ClassService.changeClassDetails({
      classId: 'cls-a', schoolId: SCHOOL, gradeCode: 'grade_3', section: 'B', shiftCode: 'morning', actorUserId: COACH, merge: true,
    });
    expect(res.moved).toBe(1);
    const moved = mockDb._tables.class_enrollments.find((e) => e.id === 'e1');
    expect(moved.class_id).toBe('cls-b');
    expect(moved.roll_number).toBeNull();
  });

  it('the same identity is "unchanged" and writes nothing; scope and actor are enforced', async () => {
    const same = await ClassService.changeClassDetails({
      classId: 'cls-a', schoolId: SCHOOL, gradeCode: 'grade_3', section: 'A', shiftCode: 'morning', actorUserId: COACH,
    });
    expect(same.action).toBe('unchanged');
    expect(mockDb._writes).toHaveLength(0);

    const wrong = await ClassService.changeClassDetails({
      classId: 'cls-a', schoolId: 'school-9', gradeCode: 'grade_3', section: 'C', shiftCode: 'morning', actorUserId: COACH,
    });
    expect(wrong.error).toBe('wrong_school');

    const noActor = await ClassService.changeClassDetails({
      classId: 'cls-a', schoolId: SCHOOL, gradeCode: 'grade_3', section: 'C', shiftCode: 'morning',
    });
    expect(noActor.error).toBe('missing_actor');
    expect(mockDb._rpcCalls.filter((c) => c.name === 'roster_change_class_details')).toHaveLength(2);
    expect(mockDb._rpcCalls[0].args.p_actor).toBe(COACH);
  });
});

// ---------------------------------------------------------------------------
// B. THE SCREENS
// ---------------------------------------------------------------------------

describe('/roster endpoint — change class details', () => {
  let endpoint;
  let mockChange;

  function boot(extra = {}) {
    jest.resetModules();
    jest.doMock('../../bot/shared/services/classes/class.service', () => ({
      importRoster: jest.fn(),
      applyRosterEdits: jest.fn(),
      handOverClass: jest.fn(),
      changeClassDetails: (...a) => mockChange(...a),
    }));
    jest.doMock('../../bot/shared/services/roster/roster-storage', () => ({
      newRunId: jest.fn(() => 'run-1'),
      putPage: jest.fn(async () => ({})),
      putManifest: jest.fn(async () => ({})),
    }));
    jest.doMock('../../bot/shared/services/roster/roster-extraction.service', () => ({
      extractPages: jest.fn(async () => ({ students: [], problems: [] })),
    }));
    // eslint-disable-next-line global-require
    endpoint = require('../../bot/shared/routes/roster-flow-endpoint');
    endpoint._pending.set('u1', {
      user: { id: COACH, role: 'coach', name: 'Coach One' },
      schools: [{ id: SCHOOL, title: 'IMSG (I-8/4)' }],
      schoolId: SCHOOL,
      schoolName: 'IMSG (I-8/4)',
      ...extra,
    });
    return endpoint._pending.get('u1');
  }

  async function openA() {
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-a' });
  }

  beforeEach(() => {
    mockDb = seed();
    mockChange = jest.fn();
  });

  it('the saved-roster view offers "Change class details"', async () => {
    boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-a' });
    expect(res.data.actions.map((a) => a.id)).toEqual(expect.arrayContaining(['edit', 'teacher', 'details']));
  });

  it('opens the details screen pre-filled with the class as it is, offering the seeded grades, sections and shifts', async () => {
    boot();
    await openA();
    const res = await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'details' });
    expect(res.screen).toBe('CLASS_DETAILS');
    expect(res.data.grade_code).toBe('grade_3');
    expect(res.data.section).toBe('A');
    expect(res.data.shift_code).toBe('morning');
    expect(res.data.grades.map((g) => g.id)).toContain('grade_3');
    expect(res.data.sections.map((s) => s.id)).toEqual(expect.arrayContaining(['A', 'B', 'C', 'none']));
    expect(res.data.shifts.map((s) => s.id)).toEqual(['morning', 'evening']);
    expect(res.data.heading).toMatch(/Grade 3-A/);
  });

  it('a submit that changes nothing writes nothing', async () => {
    boot();
    await openA();
    await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'details' });
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_DETAILS', { grade_code: 'grade_3', section: 'A', shift_code: 'morning' });
    expect(mockChange).not.toHaveBeenCalled();
    expect(res.screen).toBe('SAVED');
    expect(res.data.roster_action).toBe('unchanged');
  });

  it('a free target renames in place through ONE service call carrying the acting coach', async () => {
    mockChange.mockResolvedValue({ action: 'renamed', label: 'Grade 3 - C (evening)', mirrorsRenamed: 1 });
    boot();
    await openA();
    await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'details' });
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_DETAILS', { grade_code: 'grade_3', section: 'C', shift_code: 'evening' });
    expect(mockChange).toHaveBeenCalledTimes(1);
    expect(mockChange.mock.calls[0][0]).toEqual({
      classId: 'cls-a', schoolId: SCHOOL, gradeCode: 'grade_3', section: 'C', shiftCode: 'evening', actorUserId: COACH, merge: false,
    });
    expect(res.screen).toBe('SAVED');
    expect(res.data.roster_action).toBe('details_changed');
    expect(res.data.body).toMatch(/Grade 3-A/);
    expect(res.data.body).toMatch(/Grade 3-C \(Evening\)/);
    expect(res.data.roster_class).toBe('Grade 3-C (Evening)');
  });

  it('the write runs inside the actor context (the ledger names the coach, not the connection role)', async () => {
    let seen = null;
    mockChange.mockImplementation(async () => {
      // eslint-disable-next-line global-require
      seen = require('../../bot/shared/utils/actor-context').currentActor();
      return { action: 'renamed', label: 'Grade 3 - C', mirrorsRenamed: 1 };
    });
    boot({ user: { id: '11111111-2222-4333-8444-555555555555', role: 'coach', name: 'Coach One' } });
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-a' });
    await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'details' });
    endpoint._pending.set('11111111-2222-4333-8444-555555555555', endpoint._pending.get('u1'));
    await endpoint.handleRosterDataExchange('11111111-2222-4333-8444-555555555555', 'CLASS_DETAILS', { grade_code: 'grade_3', section: 'C', shift_code: 'morning' });
    expect(mockChange.mock.calls[0][0].actorUserId).toBe('11111111-2222-4333-8444-555555555555');
    expect(seen).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('a target that exists is NOT merged silently: the coach sees the existing class, its child count, and a choice', async () => {
    mockChange.mockResolvedValue({ action: 'collision', existingClassId: 'cls-b', existingCount: 2, sourceCount: 2, existingLabel: 'Grade 3 - B' });
    boot();
    await openA();
    await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'details' });
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_DETAILS', { grade_code: 'grade_3', section: 'B', shift_code: 'morning' });
    expect(mockChange.mock.calls[0][0].merge).toBe(false);
    expect(res.screen).toBe('CLASS_MERGE');
    expect(res.data.body).toMatch(/Grade 3-B/);
    expect(res.data.body).toMatch(/2 children/);
    expect(res.data.decisions.map((d) => d.id)).toEqual(['cancel', 'merge']);
    for (const d of res.data.decisions) expect([...d.title].length).toBeLessThanOrEqual(30);
  });

  it('cancel keeps both classes and writes nothing more', async () => {
    mockChange.mockResolvedValue({ action: 'collision', existingClassId: 'cls-b', existingCount: 2, sourceCount: 2, existingLabel: 'Grade 3 - B' });
    boot();
    await openA();
    await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'details' });
    await endpoint.handleRosterDataExchange('u1', 'CLASS_DETAILS', { grade_code: 'grade_3', section: 'B', shift_code: 'morning' });
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_MERGE', { decision: 'cancel' });
    expect(mockChange).toHaveBeenCalledTimes(1);
    expect(res.screen).toBe('SAVED');
    expect(res.data.roster_action).toBe('unchanged');
    expect(res.data.body).toMatch(/[Bb]oth classes/);
  });

  it('merge asks the service again WITH merge, on the same target, and reports what moved', async () => {
    mockChange
      .mockResolvedValueOnce({ action: 'collision', existingClassId: 'cls-b', existingCount: 2, sourceCount: 2, existingLabel: 'Grade 3 - B' })
      .mockResolvedValueOnce({ action: 'merged', targetClassId: 'cls-b', moved: 1, closedDuplicates: 1, targetCount: 3, label: 'Grade 3 - B' });
    boot();
    await openA();
    await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'details' });
    await endpoint.handleRosterDataExchange('u1', 'CLASS_DETAILS', { grade_code: 'grade_3', section: 'B', shift_code: 'morning' });
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_MERGE', { decision: 'merge' });
    expect(mockChange).toHaveBeenCalledTimes(2);
    expect(mockChange.mock.calls[1][0]).toEqual({
      classId: 'cls-a', schoolId: SCHOOL, gradeCode: 'grade_3', section: 'B', shiftCode: 'morning', actorUserId: COACH, merge: true,
    });
    expect(res.screen).toBe('SAVED');
    expect(res.data.roster_action).toBe('merged');
    expect(res.data.body).toMatch(/3 children/);
    expect(res.data.roster_class).toBe('Grade 3-B');
  });

  it('a merge decision with no collision pending is refused, not applied', async () => {
    boot();
    await openA();
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_MERGE', { decision: 'merge' });
    expect(mockChange).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).toMatch(/expired|start again/i);
  });

  it('a refused change is a readable screen, not the generic error', async () => {
    mockChange.mockResolvedValue({ error: 'unknown_section' });
    boot();
    await openA();
    await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'details' });
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_DETAILS', { grade_code: 'grade_3', section: 'Z', shift_code: 'morning' });
    expect(res.data.error).toBeUndefined();
    expect(JSON.stringify(res)).toMatch(/Nothing was changed/);
  });
});

// ---------------------------------------------------------------------------
// C. THE ASSET
// ---------------------------------------------------------------------------

describe('roster Flow asset — CLASS_DETAILS and CLASS_MERGE', () => {
  const FLOW = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'flows', 'roster-flow-v1.json'), 'utf8'));
  const screen = (id) => FLOW.screens.find((s) => s.id === id);
  const fields = (id) => {
    const out = [];
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.type) out.push(n);
      (n.children || []).forEach(walk);
    };
    walk(screen(id).layout);
    return out;
  };

  it('routing: ROSTER_VIEW → CLASS_DETAILS → SAVED | CLASS_MERGE → SAVED, acyclic', () => {
    expect(FLOW.routing_model.ROSTER_VIEW).toEqual(expect.arrayContaining(['ROSTER_EDIT', 'CLASS_TEACHER', 'CLASS_DETAILS']));
    expect(FLOW.routing_model.CLASS_DETAILS).toEqual(expect.arrayContaining(['SAVED', 'CLASS_MERGE']));
    expect(FLOW.routing_model.CLASS_MERGE).toEqual(['SAVED']);
    const seen = new Set(); const stack = new Set();
    const visit = (n) => {
      if (stack.has(n)) throw new Error(`cycle at ${n}`);
      if (seen.has(n)) return;
      seen.add(n); stack.add(n);
      (FLOW.routing_model[n] || []).forEach(visit);
      stack.delete(n);
    };
    expect(() => Object.keys(FLOW.routing_model).forEach(visit)).not.toThrow();
  });

  it('CLASS_DETAILS: three required Dropdowns pre-filled from data, one Save — within the caps', () => {
    const s = screen('CLASS_DETAILS');
    expect(s).toBeTruthy();
    const form = s.layout.children.find((c) => c.type === 'Form');
    expect(form['init-values']).toEqual({
      grade_code: '${data.grade_code}', section: '${data.section}', shift_code: '${data.shift_code}',
    });
    for (const name of ['grade_code', 'section', 'shift_code']) {
      const dd = fields('CLASS_DETAILS').find((f) => f.name === name);
      expect(dd.type).toBe('Dropdown');
      expect(dd.required).toBe(true);
      expect([...dd.label].length).toBeLessThanOrEqual(20);
    }
    const footer = fields('CLASS_DETAILS').find((f) => f.type === 'Footer');
    expect([...footer.label].length).toBeLessThanOrEqual(35);
    expect(footer['on-click-action'].payload).toEqual({
      screen: 'CLASS_DETAILS', grade_code: '${form.grade_code}', section: '${form.section}', shift_code: '${form.shift_code}',
    });
    for (const key of ['heading', 'grades', 'sections', 'shifts', 'grade_code', 'section', 'shift_code']) expect(s.data[key]).toBeDefined();
  });

  it('CLASS_MERGE: the warning body, a required decision group bound to data, one Continue', () => {
    const s = screen('CLASS_MERGE');
    expect(s).toBeTruthy();
    const group = fields('CLASS_MERGE').find((f) => f.name === 'decision');
    expect(group.type).toBe('RadioButtonsGroup');
    expect(group.required).toBe(true);
    expect(group['data-source']).toBe('${data.decisions}');
    const footer = fields('CLASS_MERGE').find((f) => f.type === 'Footer');
    expect(footer['on-click-action'].payload).toEqual({ screen: 'CLASS_MERGE', decision: '${form.decision}' });
    for (const key of ['heading', 'body', 'decisions']) expect(s.data[key]).toBeDefined();
  });
});
