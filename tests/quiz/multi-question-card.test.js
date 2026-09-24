'use strict';
/**
 * The question card for a "select all that apply" question (PLAN_R5 D4):
 * two or three options are correct and the child answers via a Flow
 * CheckboxGroup, not by tapping one letter. `renderQuestionCardHtml` takes a
 * new optional `answerMode` ('single' default | 'multi'). On 'multi' the card
 * gains a cue line under the stem and its foot line stops claiming "Tap A, B
 * or C" (false on a multi question) in favour of a form-pointing instruction.
 * Both strings come from the ux-strings catalog (language protocol, root
 * rule 20), never hardcoded here. Lane C, TQ-R5.
 */
const crypto = require('crypto');
const Card = require('../../bot/shared/services/quiz/transcript-quiz-card');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Captured from the UNMODIFIED transcript-quiz-card.js (round 5, before this
// lane's change) for these exact inputs with answerMode omitted — the
// guarantee that every existing single-answer card is byte-for-byte untouched.
// Re-captured once, when an equation written in prose ("2 + 2") began to be
// typeset as one maths expression (quiz-math spanEquations): the only
// differences from the round-5 capture are that expression and the maths
// stylesheet it brings with it. Still the single-answer output, unchanged by
// answerMode. The Urdu capture was taken once more when the Urdu stem and
// option line-heights moved from 2 / 1.9 to the shared Nastaliq pitch (2.4)
// so wrapped Urdu lines stop touching, and an Urdu option row's vertical
// padding went 20px -> 12px to give the height back; those are the whole diff.
const BASELINE_SINGLE_EN_SHA256 = '70ccaf6d56066cd7db75c35d259d627f2fc9e984e1fd7b92983a3e0ba8fde7c5';
const BASELINE_SINGLE_UR_SHA256 = 'f2236a0ba7a1c8f5b71554c50d28490b116a64ce96ed135c69b9d0d671bfa2fd';

const SINGLE_EN_DATA = { stem: 'What is 2 + 2?', options: ['3', '4', '5'], displayOrder: [0, 1, 2], language: 'en', questionNumber: 1, total: 5 };
const SINGLE_UR_DATA = { stem: 'کیا؟', options: ['ا', 'ب', 'ج'], displayOrder: [0, 1, 2], language: 'ur', questionNumber: 1, total: 5 };

describe('renderQuestionCardHtml — answerMode "single" is untouched', () => {
  test('omitted answerMode, en: byte-identical to the pre-existing output', () => {
    const html = Card.renderQuestionCardHtml(SINGLE_EN_DATA);
    expect(sha256(html)).toBe(BASELINE_SINGLE_EN_SHA256);
  });
  test('explicit answerMode:"single", ur: byte-identical to the pre-existing output', () => {
    const html = Card.renderQuestionCardHtml({ ...SINGLE_UR_DATA, answerMode: 'single' });
    expect(sha256(html)).toBe(BASELINE_SINGLE_UR_SHA256);
  });
});

describe('renderQuestionCardHtml — answerMode "multi"', () => {
  test('en, 4 options: cue + multi foot present, four lettered rows, old foot gone', () => {
    const html = Card.renderQuestionCardHtml({
      stem: 'Which of these are prime numbers?',
      options: ['2', '4', '7', '9'],
      displayOrder: [0, 1, 2, 3],
      language: 'en',
      questionNumber: 2,
      total: 5,
      answerMode: 'multi',
    });
    expect(html).toContain(resolveUx('vqMultiSelectAll', { language: 'en' }));
    expect(html).toContain(resolveUx('vqMultiCardFoot', { language: 'en' }));
    expect(html).not.toContain('Tap A, B or C below');
    const letters = [...html.matchAll(/data-letter="([ABCD])"/g)].map((m) => m[1]);
    expect(letters).toEqual(['A', 'B', 'C', 'D']);
  });

  test('ur: Urdu cue + Urdu foot present, dir="rtl", no Latin instruction leaks in', () => {
    const html = Card.renderQuestionCardHtml({
      stem: 'کون سے اشکال مثلث ہیں؟',
      options: ['مربع', 'مثلث', 'دائرہ'],
      displayOrder: [0, 1, 2],
      language: 'ur',
      questionNumber: 2,
      total: 5,
      answerMode: 'multi',
    });
    expect(html).toMatch(/dir="rtl"/);
    expect(html).toContain(resolveUx('vqMultiSelectAll', { language: 'ur' }));
    expect(html).toContain(resolveUx('vqMultiCardFoot', { language: 'ur' }));
    expect(html).not.toContain('Tap A, B or C below');
    expect(html).not.toContain('نیچے A، B یا C دبائیں'); // the single-answer ur foot
  });

  test('three options + multi: three rows, still the multi cue and foot', () => {
    const html = Card.renderQuestionCardHtml({
      stem: 'Which are even?',
      options: ['2', '3', '4'],
      displayOrder: [0, 1, 2],
      language: 'en',
      questionNumber: 1,
      total: 3,
      answerMode: 'multi',
    });
    const letters = [...html.matchAll(/data-letter="([ABCD])"/g)].map((m) => m[1]);
    expect(letters).toEqual(['A', 'B', 'C']);
    expect(html).toContain(resolveUx('vqMultiSelectAll', { language: 'en' }));
    expect(html).toContain(resolveUx('vqMultiCardFoot', { language: 'en' }));
  });
});
