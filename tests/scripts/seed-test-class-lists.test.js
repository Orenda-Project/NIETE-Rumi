/**
 * The test-school class-list seed: the planner only, no database.
 *
 * A coach's Learning assessment (EGRA/EGMA) and a teacher's class list read classes + class_teachers +
 * class_enrollments + students for the current session. The seed plans those rows for a TEST school
 * (is_probable_test) and its CLI writes them through ClassService.importRoster, the writer a coach's /roster save uses.
 */
const plan = require('../../scripts/child-test/test-class-lists');

const SESSION = '2026-2027';
const school = (over = {}) => ({ id: 'sch-1', name: 'Demo School (synthetic)', emis: 'SCDEMO-0001', is_probable_test: true, ...over });
const teacher = (id, name, over = {}) => ({ id, name, role: 'teacher', phone_number: '999281000000', grades_taught: null, deleted_at: null, ...over });

describe('target guard', () => {
  test('refuses the production projects', () => {
    expect(() => plan.assertTarget({ SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co' })).toThrow(/production/i);
    expect(() => plan.assertTarget({ SUPABASE_URL: 'https://jlpenspfdcwxkopaidys.supabase.co' })).toThrow(/production/i);
  });
  test('refuses any other project (staging included) unless it is the sandbox or a local database', () => {
    expect(() => plan.assertTarget({ SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' })).toThrow(/sandbox/i);
    expect(() => plan.assertTarget({})).toThrow(/SUPABASE_URL/);
  });
  test('allows the sandbox and a local stack', () => {
    expect(plan.assertTarget({ SUPABASE_URL: 'https://olvritwoqujtjvwfulbh.supabase.co' }).ref).toBe('olvritwoqujtjvwfulbh');
    expect(plan.assertTarget({ SUPABASE_URL: 'http://127.0.0.1:54321' }).ref).toBe('local');
  });
});

describe('who may be a class teacher', () => {
  test('a number that can reach a real Pakistani mobile is never linked', () => {
    expect(plan.isRealPhone('923001112223')).toBe(true);
    expect(plan.isRealPhone('923451112223')).toBe(true);
    expect(plan.isRealPhone('923551112223')).toBe(true);
    expect(plan.isRealPhone('923990000101')).toBe(false); // 0399 is not allocated
    expect(plan.isRealPhone('929998000101')).toBe(false);
    expect(plan.isRealPhone('999281000101')).toBe(false);
    expect(plan.isRealPhone(null)).toBe(false);
  });
});

describe('planSchool', () => {
  const thirteen = Array.from({ length: 13 }, (_, i) => teacher(`t-${String(i + 1).padStart(4, '0')}`, `Teacher ${String.fromCharCode(65 + i)} Demo`));

  test('refuses a school that is not a test school', () => {
    expect(() => plan.planSchool({ school: school({ is_probable_test: false }), teachers: [], classes: [], sessionCode: SESSION }))
      .toThrow(/not a test school/i);
  });

  test('every grade 1-5 gets a class list of 20-35 children, rolls 1..N, invented names, no phone', () => {
    const p = plan.planSchool({ school: school(), teachers: thirteen.slice(0, 5), classes: [], sessionCode: SESSION });
    expect([...new Set(p.classes.map((c) => c.grade))].sort()).toEqual([1, 2, 3, 4, 5]);
    for (const c of p.classes) {
      expect(c.gradeCode).toBe(`grade_${c.grade}`);
      expect(c.shiftCode).toBe('morning');
      expect(c.students.length).toBeGreaterThanOrEqual(20);
      expect(c.students.length).toBeLessThanOrEqual(35);
      expect(c.students.map((s) => s.roll_number)).toEqual(c.students.map((_, i) => i + 1));
      const names = c.students.map((s) => s.student_name);
      expect(new Set(names).size).toBe(names.length); // no namesakes in one class
      for (const s of c.students) {
        expect(s.student_name).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)? Testwala$/);
        expect(s.father_name).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)? Testwala$/);
        expect(s).not.toHaveProperty('parent_phone');
        expect(['girl', 'boy']).toContain(s.gender);
      }
      expect(c.runId).toBe(`seed-test-class-lists:SCDEMO-0001:${c.gradeCode}:${c.section}:${SESSION}`);
    }
  });

  test('the sizes vary from class to class', () => {
    const p = plan.planSchool({ school: school(), teachers: thirteen, classes: [], sessionCode: SESSION });
    expect(new Set(p.classes.map((c) => c.students.length)).size).toBeGreaterThan(3);
  });

  test('one class teacher per class from the school\'s teachers; enough teachers open a second section', () => {
    const p = plan.planSchool({ school: school(), teachers: thirteen, classes: [], sessionCode: SESSION });
    expect(p.classes.map((c) => `${c.grade}${c.section}`)).toEqual(['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', '5A', '5B']);
    const ids = p.classes.map((c) => c.classTeacher && c.classTeacher.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(10);
    expect(p.unassignedTeachers).toHaveLength(3);
  });

  test('a teacher on a real number, or not a teacher, is left out even at a test school', () => {
    const real = teacher('t-real', 'Staff Test', { phone_number: '923270000000', grades_taught: '["grade_1","grade_2"]' });
    const head = teacher('t-head', 'Head Demo', { role: 'principal' });
    const p = plan.planSchool({ school: school(), teachers: [real, head, ...thirteen.slice(0, 2)], classes: [], sessionCode: SESSION });
    const linked = p.classes.map((c) => c.classTeacher && c.classTeacher.id);
    expect(linked).not.toContain('t-real');
    expect(linked).not.toContain('t-head');
    expect(p.skippedTeachers).toEqual([{ id: 't-real', name: 'Staff Test', reason: 'real_phone' }]);
  });

  test('a teacher\'s own grades are honoured; a second teacher of a grade opens section B; a 6-12 grade they teach is added', () => {
    const fln = [
      teacher('t-g1', 'FLN QA Teacher EN G1', { grades_taught: '["grade_1"]' }),
      teacher('t-g2a', 'FLN QA Teacher OFF G2', { grades_taught: '["grade_2"]' }),
      teacher('t-g2b', 'FLN QA Teacher UR G2', { grades_taught: '["grade_2"]' }),
      teacher('t-g3', 'FLN QA Teacher EN G3', { grades_taught: '["grade_3"]' }),
      teacher('t-g7', 'FLN QA Teacher EN G7', { grades_taught: ['grade_7'] }),
    ];
    const existing = [{ id: 'cls-3a', grade_code: 'grade_3', section: 'A', shift_code: 'morning', session_code: SESSION, is_active: true, enrolled: 0, classTeacherId: 't-g3' }];
    const p = plan.planSchool({ school: school({ emis: 'FLNQA-0001', name: 'FLN QA School (synthetic)' }), teachers: fln, classes: existing, sessionCode: SESSION });
    const by = Object.fromEntries(p.classes.map((c) => [`${c.grade}${c.section}`, c]));
    expect(Object.keys(by).sort()).toEqual(['1A', '2A', '2B', '3A', '4A', '5A', '7A']);
    expect(by['1A'].classTeacher.id).toBe('t-g1');
    expect(by['2A'].classTeacher.id).toBe('t-g2a');
    expect(by['2B'].classTeacher.id).toBe('t-g2b');
    expect(by['3A']).toMatchObject({ existingClassId: 'cls-3a', classTeacher: { id: 't-g3' } });
    expect(by['3A'].students.length).toBeGreaterThanOrEqual(20); // an existing EMPTY class is filled
    expect(by['7A'].classTeacher.id).toBe('t-g7');
    expect(by['4A'].classTeacher).toBeNull(); // nobody teaches grade 4 here: imported by the coach, as a /roster photo is
  });

  test('a class that already has children is left exactly as it is', () => {
    const existing = [{ id: 'cls-1a', grade_code: 'grade_1', section: 'A', shift_code: 'morning', session_code: SESSION, is_active: true, enrolled: 12, classTeacherId: null }];
    const p = plan.planSchool({ school: school(), teachers: thirteen.slice(0, 5), classes: existing, sessionCode: SESSION });
    const c1 = p.classes.find((c) => c.existingClassId === 'cls-1a');
    expect(c1.students).toBeNull();
    expect(c1.skip).toBe('has_children');
    expect(c1.classTeacher).toBeNull();
  });

  test('a girls\' school gets girls only; another school a mix of girls and boys', () => {
    const girls = plan.planSchool({ school: school({ name: 'IMSG I-10/1', emis: '8801' }), teachers: thirteen.slice(0, 5), classes: [], sessionCode: SESSION });
    expect(girls.gender).toBe('girls');
    expect(girls.classes.flatMap((c) => c.students).every((s) => s.gender === 'girl')).toBe(true);
    const mixed = plan.planSchool({ school: school(), teachers: thirteen.slice(0, 5), classes: [], sessionCode: SESSION });
    const g = mixed.classes.flatMap((c) => c.students).map((s) => s.gender);
    expect(g.filter((x) => x === 'girl').length).toBeGreaterThan(g.length * 0.3);
    expect(g.filter((x) => x === 'boy').length).toBeGreaterThan(g.length * 0.3);
    expect(plan.schoolGender('IMSB G-9/4')).toBe('boys');
    expect(plan.schoolGender('Model School for Girls')).toBe('girls');
  });

  test('the same school plans the same lists every run, whatever order its teachers come in', () => {
    const a = plan.planSchool({ school: school(), teachers: thirteen, classes: [], sessionCode: SESSION });
    const b = plan.planSchool({ school: school(), teachers: [...thirteen].reverse(), classes: [], sessionCode: SESSION });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
