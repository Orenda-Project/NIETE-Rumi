/**
 * bd-snkn32.48 — a 6–12 Science teacher's own plan carries the Urdu name beside each new English key word (the shelf
 * reviewer's 9B, "Bilingual Concept Glossary"). One line in her instruction, Science only; a counter for the forks the
 * model still leaves without Urdu.
 */

const { isScience, missingGlosses, SCIENCE_GLOSS_LINE } = require('../../bot/shared/services/lp612-own-gloss');
const { parseOwnAnswers, buildOwnInstruction } = require('../../bot/shared/services/lp612-own-instruction');

const answers = { size: '51_70', resources: ['textbook'], level: 'mixed', way: 'inquiry' };

describe('isScience', () => {
  test.each([
    [{ subject: 'Physics' }], [{ subject: 'chemistry' }], [{ subject: 'Biology' }], [{ subject: 'General Science' }],
    [{ segmentId: 'grade_9_physics.c02.p037-038' }], [{ segmentId: 'grade_8_science.c02.p010-013' }],
    [{ segmentId: 'grade_6_general_science.c01.p001-002' }],
  ])('%j is Science', (ctx) => expect(isScience(ctx)).toBe(true));
  test.each([
    [{ subject: 'History' }], [{ segmentId: 'grade_8_mathematics.c06.p097-099' }], [{ segmentId: 'grade_11_urdu.p3c02' }],
    [{}], [null],
  ])('%j is not', (ctx) => expect(isScience(ctx)).toBe(false));
});

describe('the instruction', () => {
  const sci = { grade: 9, segmentId: 'grade_9_physics.c02.p037-038' };
  const his = { grade: 7, segmentId: 'grade_7_history.c03.p046-047' };
  const parsed = (ctx) => {
    const p = parseOwnAnswers(answers, ctx);
    if (!p.ok) throw new Error(p.error);
    return p.answers;
  };

  test('a Science plan is told to gloss every key word in Urdu script, in brackets', () => {
    const text = buildOwnInstruction(parsed(sci), sci);
    expect(text).toContain(SCIENCE_GLOSS_LINE);
    expect(SCIENCE_GLOSS_LINE).toMatch(/keyword/i);
    expect(SCIENCE_GLOSS_LINE).toMatch(/Urdu script/);
    expect(SCIENCE_GLOSS_LINE).toMatch(/آزادانہ گراوٹ/);
  });

  test('any other subject is not', () => {
    expect(buildOwnInstruction(parsed(his), his)).not.toContain(SCIENCE_GLOSS_LINE);
  });
});

describe('missingGlosses', () => {
  const doc = (items) => ({ sections: [{ id: 'introduction', blocks: [{ type: 'keywords', items }] }] });

  test('names the key words with no Urdu script in word or meaning', () => {
    expect(missingGlosses(doc([
      { word: 'free fall (آزادانہ گراوٹ)', meaning: 'falling under gravity alone' },
      { word: 'velocity', meaning: 'speed in a direction (رفتار بمع سمت)' },
      { word: 'mass', meaning: 'amount of matter' },
    ]))).toEqual(['mass']);
  });

  test('nothing to report for a plan with no key words or no sections list', () => {
    expect(missingGlosses(doc([]))).toEqual([]);
    expect(missingGlosses({ sections: { warmup: 'x' } })).toEqual([]);
    expect(missingGlosses(null)).toEqual([]);
  });
});
