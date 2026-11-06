'use strict';
/**
 * bd-rj6w0n.14.16.2 — a GB Grades 1-5 ask whose segment row is not at hand still records its grade and
 * subject: the segment ids carry the curriculum prefix (nbf_snc_grade_2_urdu.c07.s05), which the 6-12
 * regexes did not match, so the lifecycle row went out with grade/subject null.
 */
jest.mock('../../bot/shared/services/lesson-plan-lifecycle.service', () => {
  const actual = jest.requireActual('../../bot/shared/services/lesson-plan-lifecycle.service');
  return { ...actual, recordOutcome: jest.fn(async () => 'row-1') };
});

const Lifecycle = require('../../bot/shared/services/lesson-plan-lifecycle.service');
const { recordAsk } = require('../../bot/shared/services/lp612-lifecycle.service');

describe('lp612 lifecycle — ids by curriculum', () => {
  beforeEach(() => Lifecycle.recordOutcome.mockClear());

  test.each([
    ['nbf_snc_grade_2_urdu.c07.s05', 2, 'urdu'],
    ['nbf_snc_grade_5_general_knowledge.c01.s01', 5, 'general_knowledge'],
    ['grade_8_social_studies.c03.p010-012', 8, 'social_studies'],
  ])('%s → grade %i, subject %s', async (segmentId, grade, subject) => {
    await recordAsk({ segmentId, status: 'delivered' });
    const arg = Lifecycle.recordOutcome.mock.calls[0][0];
    expect(arg.grade).toBe(grade);
    expect(arg.subject).toBe(subject);
  });

  test('an id of no known shape still gives null, not a guess', async () => {
    await recordAsk({ segmentId: 'gb_g2_urdu.c07.s005', status: 'delivered' });
    const arg = Lifecycle.recordOutcome.mock.calls[0][0];
    expect(arg.grade).toBeNull();
    expect(arg.subject).toBeNull();
  });
});
