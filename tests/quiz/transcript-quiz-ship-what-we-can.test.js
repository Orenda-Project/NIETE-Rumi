'use strict';
/**
 * A quiz is never lost for a fault that belongs to ONE question when the rest
 * of the set is good.
 *
 * The operator's question, 2026-09-07: "even if it is all recall it should have
 * been non-blocking and we could have fixed it later? I dont understand why we
 * lead the thing to failure."
 *
 * He is right. We author 8 questions and the floor is 6, so up to two can be
 * dropped and the teacher still gets a quiz. The drop path existed but refused
 * on an ALLOW-LIST of codes — it dropped a question complaining of FIGURE_,
 * PEDAGOGY_ or RELIGIOUS_, and treated every other per-question complaint as a
 * reason to throw the WHOLE quiz away. `q5: duplicate options` on one question
 * therefore cost a teacher all eight (production, quiz f5d625e9, 13:2x PKT),
 * and the same allow-list shape had already cost three teachers their quiz that
 * morning in the repair path (#758).
 *
 * The policy this suite pins: repair first, then drop what could not be
 * repaired, and only fail when fewer than MIN_QUESTIONS survive or the set is
 * broken as a whole.
 */
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service.js');
const { MIN_QUESTIONS } = require('../../bot/shared/services/quiz/transcript-quiz-validator.js');

const DIGEST = {
  subject: 'urdu', grade_band: '3-5', topic: 'اسم',
  slos: [
    { id: 'S1', statement: 'اسم کی پہچان', taught_level: 'recall' },
    { id: 'S2', statement: 'اسم اور فعل کا فرق', taught_level: 'understand' },
  ],
};
const CTX = { language: 'ur', subject: 'urdu', digest: DIGEST, quizId: 'q-1' };
const q = (i, over = {}) => ({
  slo_id: i % 2 ? 'S2' : 'S1', level: i % 2 ? 'understand' : 'recall',
  question: `یہ سوال نمبر ${i} ہے، بتائیں کون سا لفظ اسم ہے؟`,
  options: [`الف${i}`, `ب${i}`, `ج${i}`], correct_index: 0,
  explanation: 'اسم کسی چیز کا نام ہوتا ہے۔',
  selected_because: 'سبق سے لیا گیا',
  distractor_misconceptions: { 1: 'فعل سمجھنا', 2: 'صفت سمجھنا' },
  option_feedback: { correct: 'بالکل ٹھیک', wrong: { 1: 'یہ فعل ہے', 2: 'یہ صفت ہے' } },
  ...over,
});
const eight = () => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => q(i));

describe('the floor is what decides, not the code of the complaint', () => {
  test('MIN_QUESTIONS leaves room to drop two of eight', () => {
    expect(MIN_QUESTIONS).toBeLessThanOrEqual(6);
    expect(8 - MIN_QUESTIONS).toBeGreaterThanOrEqual(2);
  });

  test('ONE question with duplicate options is dropped and seven ship — the production case', () => {
    const qs = eight();
    qs[5].options = ['ایک', 'ایک', 'دو'];
    const out = Gen.salvageWithoutBadFigures(qs, ['q5: duplicate options'], CTX);
    expect(out).not.toBeNull();
    expect(out.dropped).toEqual([5]);
    expect(out.questions).toHaveLength(7);
  });

  test('any per-question complaint is droppable, whatever its code', () => {
    [['q2: stem >200 code points', 2], ['q3: empty option', 3], ['q6: 2 options', 6], ['q1: unknown slo_id S9', 1]].forEach(([err, idx]) => {
      const out = Gen.salvageWithoutBadFigures(eight(), [err], CTX);
      expect(out).not.toBeNull();
      expect(out.dropped).toEqual([idx]);
      expect(out.questions).toHaveLength(7);
    });
  });

  test('two bad questions still ship six; three would go under the floor, so that fails honestly', () => {
    const two = Gen.salvageWithoutBadFigures(eight(), ['q1: duplicate options', 'q4: empty option'], CTX);
    expect(two.questions).toHaveLength(6);
    const three = Gen.salvageWithoutBadFigures(eight(), ['q1: duplicate options', 'q4: empty option', 'q6: 2 options'], CTX);
    expect(three.refused).toMatch(/under the floor of 6/);
  });

  test('a complaint about the SET as a whole is not something dropping a question fixes', () => {
    expect(Gen.salvageWithoutBadFigures(eight(), ['SLOs uncovered: S2'], CTX).refused).toMatch(/about the set/);
    expect(Gen.salvageWithoutBadFigures(eight(), ['q1: duplicate options', 'urdu script ratio 0.40 < 0.6'], CTX).refused).toMatch(/about the set/);
  });

  test('the soft set-level rules ride along with a drop instead of blocking it', () => {
    const out = Gen.salvageWithoutBadFigures(eight(), ['q5: duplicate options', 'PEDAGOGY_LEVEL_MIX — only 2 of 8 …'], CTX);
    expect(out).not.toBeNull();
    expect(out.questions).toHaveLength(7);
  });

  test('what survives is fully re-validated — a drop never ships a broken remainder', () => {
    const qs = eight();
    qs[5].options = ['ایک', 'ایک', 'دو'];
    qs[2].question = '';                       // a second, unreported fault
    expect(Gen.salvageWithoutBadFigures(qs, ['q5: duplicate options'], CTX).refused).toMatch(/did not validate/);
  });
});

describe('the gender rules never cost a teacher the quiz (operator, 2026-09-07)', () => {
  // "Gendered reference is just messed up, could we remove it entirely, or at
  // the very least not make these gates blocking? i.e quiz still needs to be
  // delivered." Kept as a complaint and a counter; removed as a cause of death.
  test('a gendered-teacher fault on two questions is dropped, not fatal', () => {
    const out = Gen.salvageWithoutBadFigures(eight(), [
      'q5: PEDAGOGY_GENDERED_TEACHER — options refers to the teacher with a gendered word ("she")',
      'q7: PEDAGOGY_GENDERED_TEACHER — question refers to the teacher with a gendered word ("her")',
    ], CTX);
    expect(out).not.toBeNull();
    expect(out.questions).toHaveLength(6);
  });
  test('the Urdu child-address fault is soft too', () => {
    expect(Gen.SOFT_FAULT.test('feminine-stem address')).toBe(true);
    expect(Gen.SOFT_FAULT.test('q3: PEDAGOGY_GENDERED_CHILD — "سکتی ہیں" guesses the child\'s gender')).toBe(true);
  });
  test('a quiz whose ONLY remaining faults are gender ships whole — nothing is dropped', () => {
    ['PEDAGOGY_GENDERED_TEACHER — "lesson_summary" refers to the teacher', 'q2: PEDAGOGY_GENDERED_TEACHER — explanation refers to the teacher'].forEach((e) => {
      expect(Gen.SOFT_FAULT.test(e)).toBe(true);
    });
  });
  test('a real breakage is still not soft', () => {
    ['q1: duplicate options', 'q4: empty stem', 'SLOs uncovered: S2'].forEach((e) => {
      expect(Gen.SOFT_FAULT.test(e)).toBe(false);
    });
  });
});
