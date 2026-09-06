'use strict';
/**
 * A grade hint is a hint. When the digest has read the lesson and says it was
 * a 6–8 lesson (atomic models: Dalton, Thomson, Rutherford, Bohr), a grade-4
 * lesson plan the teacher happened to download that morning must not turn it
 * into a grade-4 quiz. Found on the first real seeded lesson (round 4, lane E).
 */
const { resolveGrade } = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');

describe('resolveGrade — a hint outside the digest grade band loses to the digest', () => {
  test('lesson-plan download hint outside the band → the digest band', () => {
    const r = resolveGrade({ user: {}, lpHint: { grade: '4' }, digest: { grade_band: '6-8' } });
    expect(r).toEqual({ grade: '6-8', source: 'digest_over_lp_download' });
  });
  test('lesson-plan download hint inside the band → the hint (it is more precise)', () => {
    const r = resolveGrade({ user: {}, lpHint: { grade: '7' }, digest: { grade_band: '6-8' } });
    expect(r).toEqual({ grade: '7', source: 'lp_download' });
  });
  test('profile grades_taught: the first grade inside the band wins; none inside → the band', () => {
    expect(resolveGrade({ user: { grades_taught: ['4', '7'] }, lpHint: null, digest: { grade_band: '6-8' } }))
      .toEqual({ grade: '7', source: 'profile' });
    expect(resolveGrade({ user: { grades_taught: ['3', '4'] }, lpHint: null, digest: { grade_band: '6-8' } }))
      .toEqual({ grade: '6-8', source: 'digest_over_profile' });
  });
  test('no digest band → the old precedence is untouched', () => {
    expect(resolveGrade({ user: { grades_taught: ['4'] }, lpHint: { grade: '5' }, digest: {} }))
      .toEqual({ grade: '4', source: 'profile' });
    expect(resolveGrade({ user: {}, lpHint: { grade: '5' }, digest: {} })).toEqual({ grade: '5', source: 'lp_download' });
    expect(resolveGrade({ user: {}, lpHint: null, digest: {} })).toEqual({ grade: null, source: 'none' });
  });
  test('a band the digest writes as a single grade or with spaces still parses', () => {
    expect(resolveGrade({ user: {}, lpHint: { grade: '4' }, digest: { grade_band: '6 - 8' } }).grade).toBe('6 - 8');
    expect(resolveGrade({ user: {}, lpHint: { grade: '4' }, digest: { grade_band: '9' } })).toEqual({ grade: '9', source: 'digest_over_lp_download' });
  });
});
