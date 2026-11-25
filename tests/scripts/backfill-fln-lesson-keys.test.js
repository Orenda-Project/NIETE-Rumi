'use strict';
/**
 * bd-chz35n.26 — the backfill plan for past rows (pure; no database). An FLN open is keyed only when every bundle
 * version that was live gives the plan the SAME certain key; a past quiz only when its teacher opened exactly one
 * keyed FLN plan of the quiz's subject in the lp-hint window — the same rule the live quiz path uses.
 */
const B = require('../../scripts/backfill-fln-lesson-keys');

const row = (o) => ({ lp_id: 10152, subject: 'rh-ur', grade: 1, level: 1, strand: 'daily', chapter_no: 1,
  chapter_title_en: 'Letters of the alphabet and their sounds', pos: 2, shelf: 'core', ...o });
const bundle = (rows) => ({ placement: rows });
const UR = 'fln1:rh-ur:daily:u1:l2:letter_sounds:p10152';

describe('keyResolver', () => {
  test('same certain key in every bundle → the key; moved, uncertain or unknown → a reason', () => {
    const r = B.keyResolver([bundle([row()]), bundle([row()])]);
    expect(r('10152')).toEqual({ key: UR });
    expect(B.keyResolver([bundle([row()]), bundle([row({ pos: 5 })])])('10152')).toEqual({ reason: 'moved' });
    expect(B.keyResolver([bundle([row({ grade: 1 }), row({ grade: 2, pos: 9 })])])('10152')).toEqual({ reason: 'uncertain' });
    expect(r('424242')).toEqual({ reason: 'unknown' });
    expect(B.keyResolver([bundle([row()]), bundle([])])('10152')).toEqual({ reason: 'moved' });
  });
});

describe('planOpens', () => {
  test('keys only unkeyed fln rows it can resolve, and counts every outcome', () => {
    const resolve = B.keyResolver([bundle([row(), row({ lp_id: 7, chapter_title_en: 'X', grade: 1 }), row({ lp_id: 7, grade: 2, pos: 3 })])]);
    const out = B.planOpens([
      { id: 'a', plan_kind: 'fln', plan_ref: '10152', lesson_key: null },
      { id: 'b', plan_kind: 'fln', plan_ref: '10152', lesson_key: UR },
      { id: 'c', plan_kind: 'fln', plan_ref: '7', lesson_key: null },
      { id: 'd', plan_kind: 'fln', plan_ref: '99', lesson_key: null },
      { id: 'e', plan_kind: 'k5', plan_ref: 'grade_1_urdu_ch1_seg1', lesson_key: null },
    ], resolve);
    expect(out.updates).toEqual([{ id: 'a', lesson_key: UR }]);
    expect(out.counts).toEqual({ fln_rows: 4, already_keyed: 1, to_key: 1, uncertain: 1, moved: 0, unknown: 1 });
  });
});

describe('planOpens with a known switch to the current bundle', () => {
  test('after the switch (plus margin) the current bundle alone decides; before it, every bundle must agree', () => {
    const v1 = bundle([row({ pos: 5 })]);
    const v2 = bundle([row()]);
    const both = B.keyResolver([v1, v2]);
    const current = B.keyResolver([v2]);
    const out = B.planOpens([
      { id: 'early', plan_kind: 'fln', plan_ref: '10152', lesson_key: null, opened_at: '2026-10-19T10:00:00.000Z' },
      { id: 'late', plan_kind: 'fln', plan_ref: '10152', lesson_key: null, opened_at: '2026-10-21T10:00:00.000Z' },
    ], both, { currentFrom: '2026-10-20T17:16:02.000Z', resolveCurrent: current });
    expect(out.updates).toEqual([{ id: 'late', lesson_key: UR }]);
    expect(out.counts).toMatchObject({ to_key: 1, moved: 1 });
  });
});

describe('planQuizzes', () => {
  const opens = [
    { user_id: 'u1', lesson_key: UR, opened_at: '2026-11-10T05:00:00.000Z' },
    { user_id: 'u2', lesson_key: UR, opened_at: '2026-11-10T05:00:00.000Z' },
    { user_id: 'u2', lesson_key: 'fln1:rh-ur:daily:u1:l3:letter_sounds:p10157', opened_at: '2026-11-10T06:00:00.000Z' },
  ];
  const quiz = (o) => ({ id: 'q', teacher_id: 'u1', subject: 'urdu', session_at: '2026-11-10T08:00:00.000Z', meta: {}, ...o });
  test('one plan → fln_lesson; two plans, other subject, no session time or already set → skipped and counted', () => {
    const out = B.planQuizzes([
      quiz({ id: 'q1' }),
      quiz({ id: 'q2', teacher_id: 'u2' }),
      quiz({ id: 'q3', subject: 'maths' }),
      quiz({ id: 'q4', session_at: null }),
      quiz({ id: 'q5', meta: { fln_lesson: { key: UR } } }),
      quiz({ id: 'q6', session_at: '2026-11-12T08:00:00.000Z' }),
    ], opens);
    expect(out.updates).toHaveLength(1);
    expect(out.updates[0]).toMatchObject({ id: 'q1', fln_lesson: { key: UR, skill: 'letter_sounds', match: 'only_plan_in_window' } });
    expect(out.counts).toEqual({ quizzes: 6, already_set: 1, to_set: 1, ambiguous: 1, no_plan: 2, no_time: 1 });
  });
});
