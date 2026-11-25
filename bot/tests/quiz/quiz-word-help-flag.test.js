'use strict';
/** bd-0q8b4x — word help switches: only JSON true is on; a failed read is off. */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
const F = require('../../shared/services/quiz/quiz-word-help-flag');
const KC = require('../../shared/services/quiz/lp-quiz-key-check-words');
const W = require('../../shared/services/quiz/quiz-word-help');

const client = (rows, error = null) => ({ from: () => ({ select: () => ({ in: async () => ({ data: rows, error }) }) }) });

beforeEach(() => F.resetCache());

test('no rows: off', async () => {
  expect(await F.readFlag({ client: client([]) })).toEqual({ on: false, lot: false });
});
test('JSON true is on; the string "true" is off', async () => {
  expect(await F.readFlag({ client: client([{ key: 'quiz_word_help', value: true }, { key: 'quiz_word_help_lot', value: 'true' }]) }))
    .toEqual({ on: true, lot: false });
});
test('a failed read is off', async () => {
  expect(await F.readFlag({ client: client(null, { message: 'down' }) })).toEqual({ on: false, lot: false });
});

describe('the key checker on word meanings', () => {
  const rows = [{ question_text: 'When do farmers harvest wheat?', option_a: 'April', option_b: 'June', option_c: 'May' }];
  test('the prompt carries the lesson, the question and each meaning', () => {
    const p = KC.buildWordCheckPrompt({
      rows, words: [{ index: 0, en: 'harvest', ur: 'فصل کاٹنا' }], slideScript: { iDo: { keyFact: 'Farmers harvest wheat in April.' } }, rowText: W.rowText,
    });
    expect(p).toContain('Farmers harvest wheat in April.');
    expect(p).toContain('q0: When do farmers harvest wheat? | April | June | May');
    expect(p).toContain('"harvest" = «فصل کاٹنا»');
    expect(p).toContain('gives the answer away');
  });
  test('only ok:true is approved; no words array throws', () => {
    const ok = KC.parseWordVerdicts({ words: [{ index: 0, en: 'Harvest', ok: true }, { index: 0, en: 'wheat', ok: 'yes' }] });
    expect([...ok]).toEqual(['0|harvest']);
    expect(() => KC.parseWordVerdicts({})).toThrow(/no "words" array/);
  });
});
