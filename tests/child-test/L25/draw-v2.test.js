/**
 * L25 (bd-s1oo0.46.1, CONTRACT §19, R1 §7): the draw names each child the way the school does — full
 * name, the roster's class label, the class teacher — never by roll; it draws from one shift; and under
 * CHILD_TEST_FORM_POLICY=term every child in a cycle reads the cycle's card set.
 * Only the Supabase client is replaced (in-memory tables); the draw and store run for real.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');
const { buildRosterV2, alpha } = require('./helpers/roster-v2');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const draw = require('../../../bot/shared/services/child-test/draw');

const NOW = new Date('2026-10-05T06:00:00Z');
const Q1 = new Date('2027-01-12T06:00:00Z');
const Q2 = new Date('2027-04-12T06:00:00Z');
const days = (n) => new Date(NOW.getTime() + n * 86400000);
const T = () => mockFake.__tables;
const setup = (opts) => { mockFake = createFakeSupabase(buildRosterV2(opts), { unique: CHILD_TEST_UNIQUE }); return mockFake; };
const list = (visit, extra = {}) => draw.todaysList({ coachUserId: 'coach-1', schoolId: 'school-1', visitId: visit, observedGrade: 3, now: NOW, ...extra });
const all = (r) => [...r.children, ...r.alternates];
const SAIMA = { id: 'u-saima', name: 'Saima Bibi', flagged: true };
const TARIQ = { id: 'u-tariq', name: 'Tariq Mehmood' };

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, CHILD_TEST_DRAW_SECRET: 'test-secret' };
  delete process.env.CHILD_TEST_FORM_POLICY;
  delete process.env.CHILD_TEST_TERM_SET_BASE;
});
afterAll(() => { process.env = SAVED; });

async function testAll(r, at = NOW) {
  for (const [i, k] of r.children.entries()) {
    const m = await draw.markOutcome({ drawId: k.drawId, outcome: 'present', now: new Date(at.getTime() + i * 60000) });
    expect(m.ok).toBe(true);
  }
}

describe('per-child class fields (CONTRACT §19)', () => {
  test('two sections: grade, section, shift, the roster label, the class teacher, and classes[] in collection order', async () => {
    setup({ classes: [
      { id: 'g3a', grade: 3, section: 'A', size: 20, teachers: [SAIMA, { id: 'u-sub', name: 'Sub Teacher' }] },
      { id: 'g3b', grade: 3, section: 'B', size: 20, teachers: [TARIQ] },
    ] });
    const r = await list('visit-1');
    expect(r.ok).toBe(true);
    for (const k of all(r)) {
      const a = k.classId === 'g3a';
      expect(k).toMatchObject({
        grade: 3, section: a ? 'A' : 'B', shift: 'morning',
        classLabel: a ? 'Grade 3 - A' : 'Grade 3 - B', classLabelUr: a ? 'جماعت سوم - A' : 'جماعت سوم - B', classShort: a ? '3-A' : '3-B',
        teacherName: a ? 'Saima Bibi' : 'Tariq Mehmood', teacherUserId: a ? 'u-saima' : 'u-tariq',
        fatherName: null, namesakes: 1,
      });
    }
    expect(r.classes.map((c) => c.classId)).toEqual(['g3a', 'g3b']);
    expect(r.classes[0]).toMatchObject({ classLabel: 'Grade 3 - A', classShort: '3-A', teacherName: 'Saima Bibi', teacherUserId: 'u-saima' });
    // Each room's drawIds are its own children, in list order, and together they are the main list.
    expect(r.classes.flatMap((c) => c.drawIds)).toEqual(r.children.map((k) => k.drawId));
    for (const c of r.classes) expect(r.children.filter((k) => k.classId === c.classId).map((k) => k.drawId)).toEqual(c.drawIds);
  });

  test('the list is grouped by classroom (section order) and the child numbers follow that order', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 20 }, { id: 'g3b', grade: 3, section: 'B', size: 20 }] });
    const r = await list('visit-1');
    const rooms = r.children.map((k) => k.section);
    expect(rooms).toEqual([...rooms].sort());
    expect(r.children.map((k) => k.childNo)).toEqual([1, 2, 3, 4, 5]);
    expect(r.alternates.map((k) => k.childNo)).toEqual([6, 7]);
  });

  test('a list first sent before this change keeps its numbers (no renumbering, L20)', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 20 }, { id: 'g3b', grade: 3, section: 'B', size: 20 }] });
    await list('visit-1');
    for (const d of T().child_test_draws) for (const h of d.history || []) delete h.list_order;
    const before = await list('visit-1');
    const nos = new Map(before.children.map((k) => [k.drawId, k.childNo]));
    expect([...nos.values()].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(before.children.map((k) => k.childNo)).toEqual([1, 2, 3, 4, 5]);
  });

  test('a single unsectioned class is just "Grade 3"; an unsectioned class beside lettered ones says so', async () => {
    setup({ classes: [{ id: 'g3', grade: 3, section: null, size: 20, teachers: [SAIMA] }] });
    const one = await list('visit-1');
    expect(all(one).every((k) => k.classLabel === 'Grade 3' && k.classLabelUr === 'جماعت سوم' && k.classShort === '3' && k.section === null)).toBe(true);

    setup({ classes: [{ id: 'g3', grade: 3, section: null, size: 20 }, { id: 'g3b', grade: 3, section: 'B', size: 20 }] });
    const two = await list('visit-1');
    const bare = all(two).filter((k) => k.classId === 'g3');
    expect(bare.length).toBeGreaterThan(0);
    for (const k of bare) {
      expect(k.classLabel).toBe('Grade 3 (no section)');
      expect(k.classLabelUr).toBe('جماعت سوم (سیکشن نہیں)');
    }
  });

  test('no roll is carried on the list or written to new draw rows', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 20 }] });
    const r = await list('visit-1');
    for (const k of all(r)) expect(k).not.toHaveProperty('rollNumber');
    expect(T().child_test_draws.length).toBeGreaterThan(0);
    for (const d of T().child_test_draws) expect(d.roll_number == null).toBe(true);
  });
});

describe('the class teacher (mirrors context.classTeachersOf)', () => {
  const teacherOf = async (teachers) => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 10, teachers }] });
    const r = await list('visit-1');
    return { name: r.children[0].teacherName, id: r.children[0].teacherUserId, room: r.classes[0] };
  };
  test('the flagged class teacher wins over another reachable teacher', async () => {
    expect(await teacherOf([{ id: 'u1', name: 'Other One' }, { id: 'u2', name: 'Flagged Two', flagged: true }])).toMatchObject({ name: 'Flagged Two', id: 'u2' });
  });
  test('no flag: the only reachable teacher', async () => {
    expect(await teacherOf([{ id: 'u1', name: 'Only One' }, { id: 'u2', name: 'No Phone', phone: null }, { id: 'u3', name: 'Gone', deleted: true }]))
      .toMatchObject({ name: 'Only One', id: 'u1' });
  });
  test('no flag and two reachable, an ended link, an empty name, or no link: no teacher (ask the head teacher)', async () => {
    for (const teachers of [
      [{ id: 'u1', name: 'One' }, { id: 'u2', name: 'Two' }],
      [{ id: 'u1', name: 'Ended', flagged: true, endedOn: '2026-09-01' }],
      [{ id: 'u1', name: '   ', flagged: true }],
      [],
    ]) {
      const t = await teacherOf(teachers);
      expect(t).toMatchObject({ name: null, id: null });
      expect(t.room).toMatchObject({ teacherName: null, teacherUserId: null });
    }
  });
});

describe('same-name children are counted against the class roster, not the list (R1 §7.4)', () => {
  test('a namesake who is not on the list still counts; the father tells them apart only when the fathers differ', async () => {
    const names = [];
    for (let i = 0; i < 10; i++) {
      const pair = Math.floor(i / 2);
      // pairs 0-1: fathers differ · 2: one has no father · 3: same father · 4: unique spelling variants
      const father = pair === 0 ? `Father ${alpha(i)}` : pair === 1 ? (i % 2 ? 'Raza Khan' : null) : pair === 2 ? 'Same Father' : null;
      const name = pair === 3 ? (i % 2 ? 'ALI  hassan.' : 'Ali Hassan') : `Kid ${alpha(pair)}`;
      names.push({ name, father });
    }
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 10, names }] });
    const r = await list('visit-1');
    for (const k of all(r)) {
      const i = Number(k.studentId.slice(-2)) - 1;
      const pair = Math.floor(i / 2);
      expect(k.namesakes).toBe(2);
      expect(k.fatherTellsApart).toBe(pair === 0);
      if (pair === 0) expect(k.fatherName).toBe(`Father ${alpha(i)}`);
    }
  });
});

describe('shift: one shift per list (R1 §7.5)', () => {
  test('mixed morning A + evening A: every child comes from the morning class', async () => {
    setup({ classes: [
      { id: 'g3a-m', grade: 3, section: 'A', shift: 'morning', size: 3 },
      { id: 'g3a-e', grade: 3, section: 'A', shift: 'evening', size: 25 },
    ] });
    const r = await list('visit-1');
    expect(all(r).length).toBe(3);
    expect(all(r).every((k) => k.classId === 'g3a-m' && k.shift === 'morning')).toBe(true);
    expect(T().child_test_draws.some((d) => d.class_id === 'g3a-e')).toBe(false);
    // Later visits never reach into the evening class either, even once morning is used up.
    await testAll(r);
    const r2 = await list('visit-2');
    expect(r2.ok).toBe(false);
  });
  test('a grade with only evening classes is drawn from them, labelled "(evening)"', async () => {
    setup({ classes: [{ id: 'g3a-e', grade: 3, section: 'A', shift: 'evening', size: 20 }, { id: 'g5a', grade: 5, section: 'A', size: 20 }] });
    const r = await list('visit-1');
    expect(r.grade).toBe(3);
    for (const k of all(r)) {
      expect(k).toMatchObject({ classId: 'g3a-e', shift: 'evening', classLabel: 'Grade 3 - A (evening)', classLabelUr: 'جماعت سوم - A (شام)' });
    }
  });
});

describe('form policy term (default): one card set per cycle (CONTRACT §19)', () => {
  test('every child in Q4 2026 reads set A; in Q1 2027 set B; the base can be flipped', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 30 }] });
    const r = await list('visit-1');
    expect(r.formPolicy).toBe('term');
    expect(all(r).every((k) => k.form === 'A')).toBe(true);
    const q1 = await list('visit-2', { now: Q1 });
    expect(all(q1).every((k) => k.form === 'B')).toBe(true);

    process.env.CHILD_TEST_TERM_SET_BASE = 'B';
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 30 }] });
    const flipped = await list('visit-1');
    expect(all(flipped).every((k) => k.form === 'B')).toBe(true);
  });

  test('no returning child inside the cycle they were tested in, even after 42 days', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 30 }] });
    await testAll(await list('visit-1'));
    const r = await list('visit-2', { now: days(50) });
    expect(r.children).toHaveLength(5);
    expect(r.children.every((k) => k.role === 'new' && k.form === 'A')).toBe(true);
  });

  test('next cycle: the earliest-tested child returns and reads the new set (B), never the set they read', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 30 }] });
    const first = await list('visit-1');
    await testAll(first);
    const q1 = await list('visit-2', { now: Q1 });
    const ret = q1.children.filter((k) => k.role === 'returning');
    expect(ret).toHaveLength(1);
    expect(ret[0]).toMatchObject({ studentId: first.children[0].studentId, form: 'B' });
    expect(T().child_test_draws.find((d) => d.id === ret[0].drawId)).toMatchObject({ sample_role: 'returning', form: 'B' });
    await testAll(q1, Q1);
    // Q2 is set A again: a child who read A in Q4 is not drawn back; a child who read only B (Q1) is.
    const q2 = await list('visit-3', { now: Q2 });
    const ret2 = q2.children.filter((k) => k.role === 'returning');
    expect(ret2).toHaveLength(1);
    const q1New = q1.children.filter((k) => k.role === 'new').map((k) => k.studentId);
    expect(q1New).toContain(ret2[0].studentId);
    expect(ret2[0].form).toBe('A');
  });

  test('a child with an inseparable same-name classmate is never drawn as returning (R1 §7.4 A)', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 30 }] });
    const first = await list('visit-1');
    await testAll(first);
    // The earliest-tested child now shares a name with a classmate who is not on any list, and no father tells them apart.
    const target = first.children[0].studentId;
    const name = T().students.find((s) => s.id === target).student_name;
    const other = T().students.find((s) => s.id !== target && !all(first).some((k) => k.studentId === s.id));
    other.student_name = name;
    const q1 = await list('visit-2', { now: Q1 });
    const ret = q1.children.find((k) => k.role === 'returning');
    expect(ret.studentId).not.toBe(target);
    expect(ret.studentId).toBe(first.children[1].studentId);
  });

  test('a child flagged as a namesake when listed stays out of the retest even after the classmate leaves', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 30 }] });
    // Every child shares a name with one classmate at the first visit.
    for (const s of T().students) s.student_name = `Kid ${alpha(Math.floor((Number(s.id.slice(-2)) - 1) / 2))}`;
    const first = await list('visit-1');
    expect(first.children.every((k) => k.namesakes >= 2)).toBe(true);
    const listed = T().child_test_draws.filter((d) => first.children.some((k) => k.drawId === d.id));
    for (const d of listed) expect(d.history.find((h) => h.event === 'listed').namesake).toBe(true);
    await testAll(first);
    for (const s of T().students) s.student_name = `Unique ${alpha(Number(s.id.slice(-2)))}`;
    const q1 = await list('visit-2', { now: Q1 });
    expect(q1.children.filter((k) => k.role === 'returning')).toHaveLength(0);
    expect(q1.children).toHaveLength(5);
  });
});

describe('grouping: the returning child sits in their own room (R1 §7.2a)', () => {
  test('two rooms, returning child from room A: the list runs A…A, B…B and the numbers follow it', async () => {
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 30 }, { id: 'g3b', grade: 3, section: 'B', size: 30 }] });
    const first = await list('visit-1');
    await testAll(first);
    const q1 = await list('visit-2', { now: Q1 });
    const ret = q1.children.find((k) => k.role === 'returning');
    expect(ret).toBeTruthy();
    const rooms = q1.children.map((k) => k.classId);
    expect(rooms).toEqual([...rooms].sort());                      // contiguous, A before B
    const lastOfRoom = rooms.lastIndexOf(ret.classId);
    expect(q1.children[lastOfRoom].drawId).toBe(ret.drawId);         // returning child closes its own room
    expect(q1.children.map((k) => k.childNo)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('form policy returning_b keeps the v1 rule', () => {
  test('new children read A; after 42 days in the same cycle the earliest-tested child returns on Form B', async () => {
    process.env.CHILD_TEST_FORM_POLICY = 'returning_b';
    setup({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 30 }] });
    const first = await list('visit-1');
    expect(first.formPolicy).toBe('returning_b');
    expect(all(first).every((k) => k.form === 'A')).toBe(true);
    await testAll(first);
    const r = await list('visit-2', { now: days(43) });
    const ret = r.children.filter((k) => k.role === 'returning');
    expect(ret).toHaveLength(1);
    expect(ret[0]).toMatchObject({ studentId: first.children[0].studentId, form: 'B' });
  });
});
