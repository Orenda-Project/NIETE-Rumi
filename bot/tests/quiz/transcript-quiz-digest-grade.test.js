/**
 * bd-e1qvrf — the class quiz must use the teacher's saved grade.
 *
 * users.grades_taught is a VARCHAR column: the database hands it back as TEXT,
 * '["grade_5"]', never as an array. resolveGrade checked Array.isArray, so the
 * saved grade was always skipped and every quiz fell through to the lesson-plan
 * download or the model's own guess. Level words ('PRIMARY, MIDDLE') name no
 * grade and must still fall through.
 *
 * Real: resolveGrade. Mocked: the database client only (the module requires it).
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => ({}) }));

const { resolveGrade } = require('../../shared/services/quiz/transcript-quiz-digest.service');

describe('resolveGrade reads the saved grade as the database returns it', () => {
  test('JSON text from the VARCHAR column is the teacher profile', () => {
    expect(resolveGrade({ user: { grades_taught: '["grade_5"]' } }))
      .toEqual({ grade: '5', source: 'profile' });
  });

  test('the first saved grade wins when no band is known', () => {
    expect(resolveGrade({ user: { grades_taught: '["grade_3","grade_4"]' }, lpHint: { grade: '7' } }))
      .toEqual({ grade: '3', source: 'profile' });
  });

  test('a saved grade inside the lesson band is used', () => {
    expect(resolveGrade({ user: { grades_taught: '["grade_2","grade_7"]' }, digest: { grade_band: '6-8' } }))
      .toEqual({ grade: '7', source: 'profile' });
  });

  test('a saved grade outside the lesson band gives way to the band', () => {
    expect(resolveGrade({ user: { grades_taught: '["grade_2"]' }, digest: { grade_band: '6-8' } }))
      .toEqual({ grade: '6-8', source: 'digest_over_profile' });
  });

  test('an array (older rows, tests) still works', () => {
    expect(resolveGrade({ user: { grades_taught: ['grade_4'] } }))
      .toEqual({ grade: '4', source: 'profile' });
  });

  test('level words name no grade: fall through to the lesson-plan download', () => {
    expect(resolveGrade({ user: { grades_taught: 'PRIMARY, MIDDLE' }, lpHint: { grade: '4' } }))
      .toEqual({ grade: '4', source: 'lp_download' });
  });

  test('empty or missing saved grade: fall through to the digest', () => {
    expect(resolveGrade({ user: { grades_taught: '[]' }, digest: { grade_band: '3' } }))
      .toEqual({ grade: '3', source: 'digest' });
    expect(resolveGrade({ user: null }))
      .toEqual({ grade: null, source: 'none' });
  });
});
