/**
 * bd-5jmnfj.38.43 (q304) — FDE's thinking-level mix for a Grade 6-10 build-your-own paper.
 * Grades 6-8: FDE Assessment Scheme 2023-24, Grades IV-VIII (doc 5, FDE Assessment Framework Prep-VIII).
 * Grades 9-10: the FBISE split the G6-12 registry marks verified. Anything else: no target (null), so the
 * paper keeps the panel's 30/30/20/10/10 and its prompt does not change.
 */
const T = require('../../bot/shared/services/assessment/free-secondary-target');
const SubjectConfig = require('../../bot/shared/services/assessment/subject-config');

describe('fdeTarget', () => {
  test.each([
    [6, 'maths', { R: 10, U: 60, A: 30 }],
    [7, 'history', { R: 50, U: 20, A: 10, AE: 10, C: 10 }],
    [8, 'islamiat', { R: 40, U: 30, A: 20, AE: 10 }],
    [8, 'maths', { R: 10, U: 60, A: 30 }],
    [6, 'general_science', { R: 30, U: 30, A: 20, AE: 10, C: 10 }],
    [8, 'urdu', { R: 30, U: 30, A: 20, AE: 10, C: 10 }],
    [9, 'physics', { R: 30, U: 50, A: 20 }],
    [10, 'maths', { R: 20, U: 50, A: 30 }],
    ['7', 'english', { R: 30, U: 30, A: 20, AE: 10, C: 10 }],
  ])('grade %p %s', (grade, subject, levels) => {
    expect(T.fdeTarget(grade, subject).levels).toEqual(levels);
  });

  test('says where each split comes from', () => {
    expect(T.fdeTarget(6, 'maths').source).toMatch(/FDE Assessment Scheme 2023-24/);
    expect(T.fdeTarget(9, 'physics').source).toMatch(/FBISE/);
  });

  test.each([
    [6, 'zarai_taleem'], [9, 'islamiat'], [10, 'urdu'], [11, 'physics'], [12, 'maths'], [5, 'maths'], [null, 'maths'], [7, ''],
  ])('no target where no FDE/board split is sourced: grade %p %p', (grade, subject) => {
    expect(T.fdeTarget(grade, subject)).toBeNull();
  });

  test('every split sums to 100', () => {
    for (const row of SubjectConfig.rows()) {
      const t = T.fdeTarget(row.grade, row.code);
      if (t) expect([row.grade, row.code, Object.values(t.levels).reduce((n, x) => n + x, 0)]).toEqual([row.grade, row.code, 100]);
    }
  });
});

test('G6-8: where the registry holds a sourced per-subject split, it agrees with the FDE Scheme', () => {
  const sourced = new Set(['verified', 'partial', 'derived']);
  const rows = SubjectConfig.rows().filter((r) => r.grade <= 8 && r.status === 'core' && r.tos_default
    && sourced.has(r.tos_default.status));
  expect(rows.length).toBeGreaterThan(15);
  for (const r of rows) {
    const reg = Object.fromEntries(Object.entries(r.tos_default.levels).filter(([, v]) => v > 0));
    expect([r.grade, r.code, T.fdeTarget(r.grade, r.code).levels]).toEqual([r.grade, r.code, reg]);
  }
});

describe('splitText', () => {
  test('a five-level split names Create', () => {
    expect(T.splitText(T.fdeTarget(7, 'history').levels))
      .toBe('50% Remember, 20% Understand, 10% Apply, 10% Analyze or Evaluate and 10% Create');
  });
  test('a three-level split folds the higher levels into Apply', () => {
    expect(T.splitText(T.fdeTarget(6, 'maths').levels))
      .toBe('10% Remember, 60% Understand and 30% Apply (Apply here includes Analyze, Evaluate and Create)');
  });
  test('no Create level folds Create into Analyze or Evaluate', () => {
    expect(T.splitText(T.fdeTarget(8, 'islamiat').levels))
      .toBe('40% Remember, 30% Understand, 20% Apply and 10% Analyze or Evaluate (Create counts as Analyze or Evaluate here)');
  });
});
