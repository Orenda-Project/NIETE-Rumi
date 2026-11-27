'use strict';
/**
 * The practice door's arm (A/B test ict-quiz-practice-door): the switch, who is eligible, the phone-group key and the
 * draw. Pure: no database, no clock. Invented ids only.
 */
const Arm = require('../../../shared/services/quiz/test-practice/arm');

const KID = '11111111-1111-4111-8111-111111111111';
const KID2 = '22222222-2222-4222-8222-222222222222';

describe('parseFlag', () => {
  test.each([[null], [undefined], [false], ['true'], [0], [{}], [{ on: 'yes' }], [[]]])('%p is off', (v) => {
    expect(Arm.parseFlag(v).on).toBe(false);
  });
  test('true is on with nobody forced', () => {
    const f = Arm.parseFlag(true);
    expect(f.on).toBe(true);
    expect(f.forceB.size).toBe(0);
  });
  test('{on:true, force_b} forces only valid child ids', () => {
    const f = Arm.parseFlag({ on: true, force_b: [KID, 'not-an-id', 7] });
    expect(f.on).toBe(true);
    expect([...f.forceB]).toEqual([KID]);
  });
  test('a concluded switch {winner} is on and passed through to assignArm', () => {
    const v = { winner: 'b', test_id: 'ict-quiz-practice-door' };
    const f = Arm.parseFlag(v);
    expect(f.on).toBe(true);
    expect(f.switch).toBe(v);
  });
});

const session = (o = {}) => ({ id: 's1', student_id: KID, user_id: null, invited_by_student_id: null, quiz_id: 'q1', ...o });
const quiz = (o = {}) => ({ id: 'q1', teacher_id: 't1', grade: '3', subject: 'English', quiz_source: 'lp_v8',
  meta: { lessons: [{ lesson_id: 'L1' }], digest: { slos: [{ id: 'S1' }] } }, ...o });

describe('eligible', () => {
  test('a child finishing a G1-5 English LP quiz from a teacher link is eligible', () => {
    expect(Arm.eligible(session(), quiz())).toBe(true);
  });
  test.each([
    ['no session', null, quiz()],
    ['no child', session({ student_id: null }), quiz()],
    ["the teacher's own session", session({ user_id: 'u1' }), quiz()],
    ['a friend invited the child', session({ invited_by_student_id: KID2 }), quiz()],
    ['no quiz', session(), null],
    ['no teacher', session(), quiz({ teacher_id: null })],
    ['grade 6', session(), quiz({ grade: '6' })],
    ['grade missing', session(), quiz({ grade: null })],
    ['maths', session(), quiz({ subject: 'Mathematics' })],
    ['not a lesson-plan quiz', session(), quiz({ quiz_source: 'transcript' })],
    ['a practice round', session(), quiz({ meta: { kind: 'practice', lessons: [{}], digest: { slos: [{}] } } })],
    ['no digest', session(), quiz({ meta: { lessons: [{}] } })],
  ])('%s is not eligible', (_n, s, q) => {
    expect(Arm.eligible(s, q)).toBe(false);
  });
  test('a child who invited themself (own share) stays eligible', () => {
    expect(Arm.eligible(session({ invited_by_student_id: KID }), quiz())).toBe(true);
  });
  test.each([['1'], ['5'], [4], ['Grade 2']])('grade %p counts', (g) => {
    expect(Arm.eligible(session(), quiz({ grade: g }))).toBe(true);
  });
});

describe('groupKeyOf', () => {
  test('the active binding gives a hashed phone-group key, never the raw tomb', () => {
    const g = Arm.groupKeyOf([{ phone_tomb: 'abc123' }], KID);
    expect(g.fallback).toBe(false);
    expect(g.key).toMatch(/^pg:[0-9a-f]{32}$/);
    expect(g.key).not.toContain('abc123');
  });
  test('two children on one phone share the key', () => {
    expect(Arm.groupKeyOf([{ phone_tomb: 'abc123' }], KID).key).toBe(Arm.groupKeyOf([{ phone_tomb: 'abc123' }], KID2).key);
  });
  test('several bindings pick one deterministically', () => {
    const a = Arm.groupKeyOf([{ phone_tomb: 'zz' }, { phone_tomb: 'aa' }], KID).key;
    const b = Arm.groupKeyOf([{ phone_tomb: 'aa' }, { phone_tomb: 'zz' }], KID).key;
    expect(a).toBe(b);
  });
  test('no binding falls back to the child id and says so', () => {
    expect(Arm.groupKeyOf([], KID)).toEqual({ key: `st:${KID}`, fallback: true });
    expect(Arm.groupKeyOf(null, KID)).toEqual({ key: `st:${KID}`, fallback: true });
  });
});

describe('drawArm', () => {
  const assign = jest.fn(() => 'a');
  beforeEach(() => assign.mockClear());
  test('a forced child gets b without a draw', () => {
    expect(Arm.drawArm({ flag: Arm.parseFlag({ on: true, force_b: [KID] }), studentId: KID, groupKey: 'pg:x', assign })).toBe('b');
    expect(assign).not.toHaveBeenCalled();
  });
  test('anyone else is drawn by assignArm on the phone group with the card\'s salt and shares', () => {
    const flag = Arm.parseFlag(true);
    expect(Arm.drawArm({ flag, studentId: KID, groupKey: 'pg:x', assign })).toBe('a');
    expect(assign).toHaveBeenCalledWith({
      flagKey: 'ab_quiz_practice_door', unitId: 'pg:x', salt: 'ict-quiz-practice-door:2026-11:v1',
      sharesBp: { a: 5000, b: 5000 }, controlArm: 'a', switch: true,
    });
  });
  test('an arm outside a/b reads as control', () => {
    expect(Arm.drawArm({ flag: Arm.parseFlag(true), studentId: KID, groupKey: 'pg:x', assign: () => 'zz' })).toBe('a');
  });
  test('with the real assignArm and no registry entry, everyone gets control (G1)', () => {
    const AB = require('../../../shared/services/ab-assign.service');
    const out = Arm.drawArm({ flag: Arm.parseFlag(true), studentId: KID, groupKey: 'pg:x',
      assign: (t) => AB.assignArm(t, { log: () => {} }) });
    expect(out).toBe('a');
  });
});
