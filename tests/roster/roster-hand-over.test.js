/**
 * bd-dz6qb.5 (a)+(b) — a coach hands a saved class to its teacher from /roster.
 *
 * A scan saved with "Not listed" writes no class_teachers row, and /class and
 * /attendance list only classes a teacher is assigned to, so the class is
 * invisible to everyone — 19 classes / 727 children on prod (15 Sep). The only
 * repair was to photograph the register again. These tests pin the repair:
 *
 *   (a) SCHOOL_STATUS marks a teacherless class, so the coach can see which
 *       classes need a teacher without opening each one;
 *   (b) the saved-roster view offers a class-teacher picker, and choosing a
 *       teacher writes her assignment AND her attendance mirror together,
 *       repoints the children's legacy list, retires the coach's mirror, and
 *       adopts an existing same-name legacy list of hers rather than duplicating.
 *
 * The service half runs the REAL ClassService against the fake Supabase, whose
 * `roster_hand_over_class` twin mirrors the SQL's observable contract. The
 * endpoint half drives the real data_exchange screens with ClassService mocked
 * only at the one new write. The asset half reads the Flow JSON that Meta renders.
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
const OTHER_SCHOOL = 'school-2';
const COACH = 'coach-1';
const TEACHER = 'teacher-1';
const PREV = 'teacher-0';
const SESSION = (() => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
})();

function seed(extra = {}) {
  return createFakeSupabase({
    schools: [{ id: SCHOOL, name: 'IMSG (I-8/4)' }, { id: OTHER_SCHOOL, name: 'Elsewhere' }],
    grade_levels: [
      { code: 'grade_1', ordinal: 1, band: 'primary', is_active: true },
      { code: 'grade_3', ordinal: 3, band: 'primary', is_active: true },
    ],
    sections: [{ code: 'A', sort_order: 1, is_active: true }, { code: 'B', sort_order: 2, is_active: true }],
    shifts: [{ code: 'morning', sort_order: 1, is_active: true }, { code: 'evening', sort_order: 2, is_active: true }],
    users: [
      { id: COACH, name: 'Coach One', role: 'coach', school_id: null },
      { id: TEACHER, name: 'Sana Teacher', role: 'teacher', school_id: SCHOOL },
      { id: PREV, name: 'Previous Teacher', role: 'teacher', school_id: SCHOOL },
    ],
    leader_teachers: [],
    // cls-1: scanned by the coach with "Not listed" — no teacher, coach's fallback mirror.
    // cls-2: has a class teacher already.
    classes: [
      { id: 'cls-1', school_id: SCHOOL, grade_code: 'grade_3', section: 'B', shift_code: 'morning', session_code: SESSION, is_active: true },
      { id: 'cls-2', school_id: SCHOOL, grade_code: 'grade_1', section: 'A', shift_code: 'morning', session_code: SESSION, is_active: true },
      { id: 'cls-x', school_id: OTHER_SCHOOL, grade_code: 'grade_1', section: 'A', shift_code: 'morning', session_code: SESSION, is_active: true },
    ],
    class_teachers: [
      { id: 'ct-2', class_id: 'cls-2', teacher_user_id: PREV, is_class_teacher: true, is_active: true },
    ],
    student_lists: [
      { id: 'list-coach', user_id: COACH, class_name: 'Grade 3 - B', academic_year: SESSION, class_id: 'cls-1', is_active: true, student_count: 2 },
      { id: 'list-prev', user_id: PREV, class_name: 'Grade 1 - A', academic_year: SESSION, class_id: 'cls-2', is_active: true, student_count: 1 },
    ],
    students: [
      { id: 'st-1', student_name: 'Ayesha', father_name: 'Bilal', list_id: 'list-coach', is_active: true },
      { id: 'st-2', student_name: 'Minahil', father_name: 'Asif', list_id: 'list-coach', is_active: true },
      { id: 'st-3', student_name: 'Hooria', father_name: null, list_id: 'list-prev', is_active: true },
      { id: 'st-x', student_name: 'Faraway', father_name: null, list_id: null, is_active: true },
    ],
    class_enrollments: [
      { id: 'e1', class_id: 'cls-1', student_id: 'st-1', roll_number: 1, is_active: true },
      { id: 'e2', class_id: 'cls-1', student_id: 'st-2', roll_number: 2, is_active: true },
      { id: 'e3', class_id: 'cls-2', student_id: 'st-3', roll_number: 1, is_active: true },
      { id: 'ex', class_id: 'cls-x', student_id: 'st-x', roll_number: 1, is_active: true },
    ],
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// A. THE WRITE — ClassService.handOverClass, one call, all of it or none of it
// ---------------------------------------------------------------------------

describe('ClassService.handOverClass', () => {
  let ClassService;
  beforeEach(() => {
    jest.resetModules();
    mockDb = seed();
    // eslint-disable-next-line global-require
    ClassService = require('../../bot/shared/services/classes/class.service');
  });

  it('writes her assignment and her mirror together; the class then appears in listClassesForTeacher(her) and her attendance list holds the children', async () => {
    const res = await ClassService.handOverClass({
      classId: 'cls-1', schoolId: SCHOOL, teacherUserId: TEACHER, actorUserId: COACH,
    });
    expect(res.error).toBeUndefined();

    // Assignment: one row, prime-responsible.
    const mine = mockDb._tables.class_teachers.filter((r) => r.class_id === 'cls-1' && r.teacher_user_id === TEACHER && r.is_active);
    expect(mine).toHaveLength(1);
    expect(mine[0].is_class_teacher).toBe(true);
    const listed = await ClassService.listClassesForTeacher(TEACHER);
    expect(listed.map((c) => c.classId)).toEqual(['cls-1']);
    expect(listed[0].isClassTeacher).toBe(true);

    // Her attendance markable: an active legacy list of hers linked to the class, holding the children.
    const hers = mockDb._tables.student_lists.filter((l) => l.user_id === TEACHER && l.is_active);
    expect(hers).toHaveLength(1);
    expect(hers[0].class_id).toBe('cls-1');
    expect(hers[0].class_name).toBe('Grade 3 - B');
    const kids = mockDb._tables.students.filter((s) => ['st-1', 'st-2'].includes(s.id));
    expect(kids.every((s) => s.list_id === hers[0].id)).toBe(true);
    expect(res.repointed).toBe(2);

    // The coach's fallback mirror is retired, not deleted.
    const coachList = mockDb._tables.student_lists.find((l) => l.id === 'list-coach');
    expect(coachList.is_active).toBe(false);
    expect(res.retiredMirrors).toBe(1);
  });

  it('an existing same-name legacy list of hers is ADOPTED, not duplicated', async () => {
    mockDb = seed({
      student_lists: [
        { id: 'list-coach', user_id: COACH, class_name: 'Grade 3 - B', academic_year: SESSION, class_id: 'cls-1', is_active: true },
        // She added "Grade 3 - B" the old way, by hand, before the coach scanned it.
        { id: 'list-hers', user_id: TEACHER, class_name: 'grade 3 - b', academic_year: SESSION, class_id: null, is_active: true },
      ],
    });
    jest.resetModules();
    // eslint-disable-next-line global-require
    ClassService = require('../../bot/shared/services/classes/class.service');

    const res = await ClassService.handOverClass({
      classId: 'cls-1', schoolId: SCHOOL, teacherUserId: TEACHER, actorUserId: COACH,
    });
    expect(res.error).toBeUndefined();
    expect(res.listAdopted).toBe(true);
    const hers = mockDb._tables.student_lists.filter((l) => l.user_id === TEACHER && l.is_active);
    expect(hers).toHaveLength(1);
    expect(hers[0].id).toBe('list-hers');
    expect(hers[0].class_id).toBe('cls-1');
    expect(mockDb._tables.students.find((s) => s.id === 'st-1').list_id).toBe('list-hers');
  });

  it('a class that already has a class teacher hands over: the previous holder keeps the assignment, loses the role and the mirror', async () => {
    const res = await ClassService.handOverClass({
      classId: 'cls-2', schoolId: SCHOOL, teacherUserId: TEACHER, actorUserId: COACH,
    });
    expect(res.error).toBeUndefined();
    expect(res.previousClassTeacherUserId).toBe(PREV);
    const prev = mockDb._tables.class_teachers.find((r) => r.id === 'ct-2');
    expect(prev.is_active).toBe(true);
    expect(prev.is_class_teacher).toBe(false);
    expect(mockDb._tables.student_lists.find((l) => l.id === 'list-prev').is_active).toBe(false);
    expect(mockDb._tables.students.find((s) => s.id === 'st-3').list_id).not.toBe('list-prev');
  });

  it('is scoped: a class at another school is refused, and so is a leader as class teacher', async () => {
    const wrong = await ClassService.handOverClass({
      classId: 'cls-x', schoolId: SCHOOL, teacherUserId: TEACHER, actorUserId: COACH,
    });
    expect(wrong.error).toBe('wrong_school');
    expect(mockDb._tables.class_teachers.some((r) => r.class_id === 'cls-x')).toBe(false);

    const leader = await ClassService.handOverClass({
      classId: 'cls-1', schoolId: SCHOOL, teacherUserId: COACH, actorUserId: COACH,
    });
    expect(leader.error).toBe('not_a_teacher');
  });

  it('carries the acting user into the one RPC call, for the ledger', async () => {
    await ClassService.handOverClass({
      classId: 'cls-1', schoolId: SCHOOL, teacherUserId: TEACHER, actorUserId: COACH,
    });
    const calls = mockDb._rpcCalls.filter((c) => c.name === 'roster_hand_over_class');
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_actor).toBe(COACH);
    expect(calls[0].args.p_school_id).toBe(SCHOOL);
  });

  it('refuses without an actor — a write nobody can be held to is not written', async () => {
    const res = await ClassService.handOverClass({ classId: 'cls-1', schoolId: SCHOOL, teacherUserId: TEACHER });
    expect(res.error).toBe('missing_actor');
    expect(mockDb._rpcCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// B. THE SCREENS — status mark, the picker, the save
// ---------------------------------------------------------------------------

describe('/roster endpoint — the class-teacher picker on the saved-roster view', () => {
  let endpoint;
  let mockHandOver;

  function boot(extra = {}) {
    jest.resetModules();
    jest.doMock('../../bot/shared/services/classes/class.service', () => ({
      importRoster: jest.fn(),
      applyRosterEdits: jest.fn(),
      handOverClass: (...a) => mockHandOver(...a),
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

  beforeEach(() => {
    mockDb = seed();
    mockHandOver = jest.fn().mockResolvedValue({
      classId: 'cls-1', teacherUserId: TEACHER, repointed: 2, retiredMirrors: 1, listAdopted: false,
      previousClassTeacherUserId: null, label: 'Grade 3 - B',
    });
  });

  it('(a) SCHOOL_STATUS marks the class that has no class teacher, in the text and in the option', async () => {
    boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL', { school_id: SCHOOL });
    expect(res.screen).toBe('SCHOOL_STATUS');
    expect(res.data.coverage_text).toMatch(/Grade 3-B — 2 children — no class teacher/);
    expect(res.data.coverage_text).not.toMatch(/Grade 1-A — 1 child — no class teacher/);
    const open1 = res.data.actions.find((a) => a.id === 'open:cls-1');
    const open2 = res.data.actions.find((a) => a.id === 'open:cls-2');
    expect(open1.title).toMatch(/^⚠ /);
    expect(open2.title).not.toMatch(/^⚠ /);
    for (const a of res.data.actions) expect([...a.title].length).toBeLessThanOrEqual(30);
  });

  it('(b) the saved-roster view says who the class teacher is, and offers the picker', async () => {
    boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    expect(res.screen).toBe('ROSTER_VIEW');
    expect(res.data.note).toMatch(/No class teacher yet/);
    expect(res.data.actions.map((a) => a.id)).toEqual(expect.arrayContaining(['edit', 'teacher']));
    for (const a of res.data.actions) expect([...a.title].length).toBeLessThanOrEqual(30);

    const named = await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-2' });
    expect(named.data.note).toMatch(/Class teacher: Previous Teacher/);
  });

  it('a class id from another school is refused on open — the payload is not containment', async () => {
    boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-x' });
    expect(res.screen).not.toBe('ROSTER_VIEW');
    expect(JSON.stringify(res)).toMatch(/not at this school/i);
  });

  it('choosing "Set the class teacher" opens the picker with the school\'s registered teachers and a leave-as-is escape', async () => {
    boot();
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    const res = await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'teacher' });
    expect(res.screen).toBe('CLASS_TEACHER');
    expect(res.data.heading).toMatch(/Grade 3-B/);
    const ids = res.data.teachers.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([TEACHER, PREV, 'none']));
    expect(ids).not.toContain(COACH);
    expect(ids[ids.length - 1]).toBe('none');
    for (const t of res.data.teachers) expect([...t.title].length).toBeLessThanOrEqual(30);
  });

  // bd-3e0v5: on real phones a payload key named `action` never arrives (the Flow envelope
  // owns it — prod logged screenDataKeys: [] for every ROSTER_VIEW submit), so the choice
  // travels as `next_step`. These drive the endpoint with exactly what the Flow now posts.
  it('bd-3e0v5: next_step=teacher (the key the published Flow posts) opens the class-teacher picker', async () => {
    boot();
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    const res = await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { next_step: 'teacher' });
    expect(res.screen).toBe('CLASS_TEACHER');
    expect(res.data.teachers.map((t) => t.id)).toEqual(expect.arrayContaining([TEACHER, 'none']));
  });

  it('bd-3e0v5: next_step=details opens the class-details form', async () => {
    boot();
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    const res = await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { next_step: 'details' });
    expect(res.screen).toBe('CLASS_DETAILS');
  });

  it('bd-3e0v5: next_step=edit, and a submit whose data arrived empty, both open the editor', async () => {
    boot();
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    expect((await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { next_step: 'edit' })).screen).toBe('ROSTER_EDIT');
    boot();
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    expect((await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', {})).screen).toBe('ROSTER_EDIT');
  });

  it('the old published Flow still opens the editor — a ROSTER_VIEW submit with action=edit (or none) is unchanged', async () => {
    boot();
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    const res = await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'edit' });
    expect(res.screen).toBe('ROSTER_EDIT');
  });

  it('saving the picker hands the class over through ONE service call carrying class, school, teacher and the acting coach', async () => {
    boot();
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'teacher' });
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_TEACHER', { teacher_user_id: TEACHER });
    expect(mockHandOver).toHaveBeenCalledTimes(1);
    expect(mockHandOver.mock.calls[0][0]).toEqual({
      classId: 'cls-1', schoolId: SCHOOL, teacherUserId: TEACHER, actorUserId: COACH,
    });
    expect(res.screen).toBe('SAVED');
    expect(res.data.roster_action).toBe('teacher_set');
    expect(res.data.body).toMatch(/Sana Teacher/);
    expect(res.data.body).toMatch(/attendance/);
    // Gender-neutral by rule: never "she"/"her"/"he"/"his" for the teacher.
    expect(res.data.body).not.toMatch(/\b(she|her|he|his)\b/i);
  });

  it('"Not listed — leave as is" writes nothing and says so', async () => {
    boot();
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'teacher' });
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_TEACHER', { teacher_user_id: 'none' });
    expect(mockHandOver).not.toHaveBeenCalled();
    expect(res.screen).toBe('SAVED');
    expect(res.data.roster_action).toBe('unchanged');
  });

  it('a refused hand-over is a readable screen, not the generic error', async () => {
    mockHandOver.mockResolvedValue({ error: 'wrong_school' });
    boot();
    await endpoint.handleRosterDataExchange('u1', 'SCHOOL_STATUS', { next_action: 'open:cls-1' });
    await endpoint.handleRosterDataExchange('u1', 'ROSTER_VIEW', { action: 'teacher' });
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_TEACHER', { teacher_user_id: TEACHER });
    expect(res.data.error).toBeUndefined();
    expect(JSON.stringify(res)).toMatch(/Nothing was changed/);
  });

  it('the picker needs an open class — a stale session is told to start again', async () => {
    boot();
    const res = await endpoint.handleRosterDataExchange('u1', 'CLASS_TEACHER', { teacher_user_id: TEACHER });
    expect(mockHandOver).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).toMatch(/expired/);
  });
});

// ---------------------------------------------------------------------------
// C. THE ASSET — what Meta renders
// ---------------------------------------------------------------------------

describe('roster Flow asset — the CLASS_TEACHER screen', () => {
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

  it('ROSTER_VIEW carries a data-bound next_step group (never `action`, bd-3e0v5) and routes to CLASS_TEACHER', () => {
    const group = fields('ROSTER_VIEW').find((f) => f.name === 'next_step');
    expect(group).toBeTruthy();
    expect(group.type).toBe('RadioButtonsGroup');
    expect(group.required).toBe(true);
    expect(group['data-source']).toBe('${data.actions}');
    const footer = fields('ROSTER_VIEW').find((f) => f.type === 'Footer');
    expect(footer['on-click-action'].payload.next_step).toBe('${form.next_step}');
    expect(FLOW.routing_model.ROSTER_VIEW).toEqual(expect.arrayContaining(['ROSTER_EDIT', 'CLASS_TEACHER']));
    expect(FLOW.routing_model.CLASS_TEACHER).toEqual(['SAVED']);
  });

  it('CLASS_TEACHER: a required Dropdown of teachers, a caption, one Save — within the caps', () => {
    const s = screen('CLASS_TEACHER');
    expect(s).toBeTruthy();
    const dd = fields('CLASS_TEACHER').find((f) => f.name === 'teacher_user_id');
    expect(dd.type).toBe('Dropdown');
    expect(dd.required).toBe(true);
    expect([...dd.label].length).toBeLessThanOrEqual(20);
    const footer = fields('CLASS_TEACHER').find((f) => f.type === 'Footer');
    expect([...footer.label].length).toBeLessThanOrEqual(35);
    expect(footer['on-click-action'].payload).toEqual({ screen: 'CLASS_TEACHER', teacher_user_id: '${form.teacher_user_id}' });
    for (const key of ['heading', 'current', 'teachers', 'help']) expect(s.data[key]).toBeDefined();
  });

  it('the routing model stays acyclic', () => {
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
});
