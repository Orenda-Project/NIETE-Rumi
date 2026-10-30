/**
 * v29 blocker c, G5 Urdu Q1 item 5 (bd-5jmnfj.4.58): «ہیروشیما» and «ناگاساکی» both true. The MCQ-truth, key-tell
 * and cross-ask detectors must reach the writer's re-ask, which reads fde-answer-repeats.
 */

const { paperGiveaways } = require('../../bot/shared/services/assessment/fde-g5-paper-giveaways');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const URDU = require('./fixtures/fde-v34-g5-urdu-v29.json');

describe('G5 language give-aways reach the re-ask', () => {
  test('the paper-wide list carries the Hiroshima/Nagasaki two-true item', () => {
    expect(paperGiveaways(URDU).some((f) => f.slot === 'urdu.A.Q1' && f.words.some((w) => /ہیروشیما/.test(w)))).toBe(true);
  });
  test('answerRepeats flags urdu.A.Q1 for it, without throwing', () => {
    expect(answerRepeats(URDU).some((f) => f.slot === 'urdu.A.Q1')).toBe(true);
  });
});
