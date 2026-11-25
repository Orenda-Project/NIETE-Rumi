'use strict';
/**
 * bd-0q8b4x — attaching word help to an English lesson quiz's rows: off by
 * default, book words first, made words only after the key checker says yes.
 */
jest.mock('../../config/supabase', () => ({}), { virtual: true });
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const S = require('../../shared/services/quiz/quiz-word-help.service');

const slideScript = { hook: { keyWords: [{ term: 'harvest', urdu: 'فصل کاٹنا' }] }, iDo: { keyFact: 'Farmers harvest wheat in April.' } };
const rows = () => [
  { question_text: 'When do farmers harvest wheat?', option_a: 'April', option_b: 'June', option_c: 'May', media: null },
  { question_text: 'What is a seed?', option_a: 'a small part of a plant', option_b: 'a stone', option_c: 'a cloud' },
];

function deps({ on = true, made, verdicts, checkThrows = false } = {}) {
  return {
    flag: async () => ({ on, lot: false }),
    complete: jest.fn(async ({ label }) => {
      if (label === 'quiz.word_help.propose') {
        return { json: made || { items: [{ index: 0, words: [{ en: 'wheat', ur: 'گندم' }] }, { index: 1, words: [{ en: 'seed', ur: 'بیج' }] }] }, costUsd: 0.001 };
      }
      if (checkThrows) throw new Error('provider down');
      return { json: verdicts, costUsd: 0.001 };
    }),
  };
}

test('switch off: rows untouched and no call made', async () => {
  const d = deps({ on: false });
  const out = await S.maybeAttach(rows(), { language: 'en', slideScript, quizId: 'q1' }, d);
  expect(out.rows).toEqual(rows());
  expect(out.record).toBeNull();
  expect(d.complete).not.toHaveBeenCalled();
});

test('an Urdu quiz never gets word help', async () => {
  const d = deps();
  const out = await S.maybeAttach(rows(), { language: 'ur', slideScript, quizId: 'q1' }, d);
  expect(out.record).toBeNull();
  expect(d.complete).not.toHaveBeenCalled();
});

test('book words first; made words kept only where the key checker says they are right', async () => {
  const verdicts = { words: [
    { index: 0, en: 'harvest', ok: true },
    { index: 0, en: 'wheat', ok: true },
    { index: 1, en: 'seed', ok: false },
  ] };
  const out = await S.maybeAttach(rows(), { language: 'en', slideScript, quizId: 'q1' }, deps({ verdicts }));
  expect(out.rows[0].media.word_help).toEqual([
    { en: 'harvest', ur: 'فصل کاٹنا', from: 'book' },
    { en: 'wheat', ur: 'گندم', from: 'made' },
  ]);
  expect(out.rows[1].media).toBeUndefined();
  expect(out.record).toMatchObject({ status: 'checked', book: 1, made: 2, kept: 2, rejected: 1 });
});

test('a word the checker skipped is dropped', async () => {
  const out = await S.maybeAttach(rows(), { language: 'en', slideScript, quizId: 'q1' }, deps({ verdicts: { words: [] } }));
  expect(out.rows[0].media).toBeNull();
  expect(out.record.kept).toBe(0);
});

test('checker down: only the book\'s own words ride, never a made one', async () => {
  const out = await S.maybeAttach(rows(), { language: 'en', slideScript, quizId: 'q1' }, deps({ checkThrows: true }));
  expect(out.rows[0].media.word_help).toEqual([{ en: 'harvest', ur: 'فصل کاٹنا', from: 'book' }]);
  expect(out.rows[1].media).toBeUndefined();
  expect(out.record.status).toBe('check_error');
});
