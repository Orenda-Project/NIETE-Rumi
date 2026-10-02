'use strict';
const bank = require('./fixtures/item-bank.fixture.json');
const T = require('./fixtures/transcripts');
const { wordsFromTokens } = require('../../../bot/shared/services/child-test/scoring/text-norm');
const { findCueWindows, wordsIn } = require('../../../bot/shared/services/child-test/scoring/windows');
const { scoreNumbers, scoreQuickSums, spokenAnswer } = require('../../../bot/shared/services/child-test/scoring/maths-spoken');

const form = bank.grades['3'].forms.A;
const words = wordsFromTokens(T.tokensFrom(T.MATHS_BLOCK));
const cut = findCueWindows({ words, block: 'maths', form, cue: bank.cue.maths, durationSec: 96 });

describe('child-test spoken maths', () => {
  test('numbers: aligned in order; a different number is wrong with what was heard', () => {
    const child = wordsIn(words, cut.windows.numbers, { excludeSpeaker: cut.coachSpeaker });
    const r = scoreNumbers(child, form.maths.numbers);
    expect(r.map((x) => x.verdict)).toEqual(['correct', 'correct', 'wrong', 'correct']);
    expect(r[2]).toMatchObject({ id: 'm3A-n3', heard: '9' });
    expect(r[0].confidence).toBeGreaterThan(r[2].confidence);
  });

  test('numbers: stop rule — after 4 wrong in a row the rest are none', () => {
    const items = [1, 2, 3, 4, 5, 6].map((v, i) => ({ id: `n${i}`, value: v }));
    const heard = wordsFromTokens(T.tokensFrom([[2, 1, '9 9 9 9 5 6']]));
    const r = scoreNumbers(heard, items);
    expect(r.map((x) => x.verdict)).toEqual(['wrong', 'wrong', 'wrong', 'wrong', 'none', 'none']);
  });

  test('quick sums: skips the operands the child reads aloud, counts correct answers in the minute', () => {
    const child = wordsIn(words, cut.windows.quick_sums, { excludeSpeaker: cut.coachSpeaker });
    const r = scoreQuickSums(child, form.maths.quick_sums, cut.windows.quick_sums);
    expect(r).toMatchObject({ correct: 3, attempted: 4 });
    expect(r.seconds).toBeCloseTo(60, 0);
    expect(r.items.map((x) => x.verdict)).toEqual(['correct', 'correct', 'wrong', 'correct']);
  });

  test('spoken word-problem answer: the last number the child says', () => {
    const child = wordsIn(words, cut.windows.word_problem, { excludeSpeaker: cut.coachSpeaker });
    expect(spokenAnswer(child)).toBe(9);
  });
});

describe('child-test spoken maths — STT writes the sum as one token', () => {
  test('"1+4؟ 5" is the operands then the answer', () => {
    const items = [{ id: 'a', prompt: '1 + 4', answer: 5 }, { id: 'b', prompt: '2 + 2', answer: 4 }];
    const heard = wordsFromTokens(T.tokensFrom([[2, 1, '1+4؟ 5۔ 2+2؟ 4۔']]));
    expect(scoreQuickSums(heard, items, { start: 0, end: 60 })).toMatchObject({ correct: 2, attempted: 2 });
  });
});
