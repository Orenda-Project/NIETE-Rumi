/**
 * bd-qcrlya: Islamiat papers offer no true/false, at any grade (Amena, 7 Nov 2026).
 *
 * The type stays in the catalogue so a paper made before keeps its category and its print;
 * it is only no longer offered, nor picked for a teacher who does not choose types.
 */

const QuestionTypes = require('../../bot/shared/services/assessment/question-types');

const ids = (list) => list.map((t) => t.id);
const TF = /true.?false/i;

describe('Islamiat offers no true/false', () => {
  it.each([1, 2, 3, 4, 5])('grade %i: not offered, not in the default mix', (g) => {
    expect(ids(QuestionTypes.forSubject('islamiat', g)).filter((id) => TF.test(id))).toEqual([]);
    expect(ids(QuestionTypes.defaultMix('islamiat', g, 10)).filter((id) => TF.test(id))).toEqual([]);
  });

  it.each([6, 7, 8])('grade %i: True/False with correction is not offered', (g) => {
    const offered = ids(QuestionTypes.forSubject('islamiat', g));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.filter((id) => TF.test(id))).toEqual([]);
  });

  it('a paper made before still reads True/False as objective', () => {
    expect(QuestionTypes.categoryOf('True/False', 'islamiat', 4)).toBe('objective');
  });

  it('every other subject keeps True/False', () => {
    for (const s of ['maths', 'science', 'social_studies', 'general_knowledge', 'english']) {
      expect(ids(QuestionTypes.forSubject(s, 4))).toContain('True/False');
    }
  });
});
