/**
 * The scorer's timed quick-sums window reads the ONE setting (bd-s1oo0.12): the bank's
 * maths.quick_sums_seconds, or the sandbox-only CHILD_TEST_QUICK_SUMS_SECONDS. The story stays 60 s.
 * Network boundary mocked: the LLM HTTP call (scoring/llm.chatJSON).
 */
const mockChat = jest.fn();
jest.mock('../../../bot/shared/services/child-test/scoring/llm', () => ({ chatJSON: (...a) => mockChat(...a), parseJson: JSON.parse }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const bank = require('../L5/fixtures/item-bank.fixture.json');
const T = require('../L5/fixtures/transcripts');
const { wordsFromTokens } = require('../../../bot/shared/services/child-test/scoring/text-norm');
const { findCueWindows } = require('../../../bot/shared/services/child-test/scoring/windows');
const { labelMissing } = require('../../../bot/shared/services/child-test/scoring/labeller');

const words = (script) => wordsFromTokens(T.tokensFrom(script));
const base = bank.grades['3'].forms.A;
const withQs = (s) => ({ ...base, maths: { ...base.maths, quick_sums_seconds: s } });
const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED }; delete process.env.CHILD_TEST_QUICK_SUMS_SECONDS; process.env.RAILWAY_ENVIRONMENT = 'sandbox'; });
afterAll(() => { process.env = SAVED; });

test('bank 30: the quick-sums window is 30 s from its cue', () => {
  const r = findCueWindows({ words: words(T.MATHS_BLOCK), block: 'maths', form: withQs(30), cue: bank.cue.maths, durationSec: 96 });
  expect(r.windows.quick_sums.end).toBeCloseTo(r.windows.quick_sums.start + 30, 1);
});

test('bank 60: 60 s, as before', () => {
  const r = findCueWindows({ words: words(T.MATHS_BLOCK), block: 'maths', form: withQs(60), cue: bank.cue.maths, durationSec: 96 });
  expect(r.windows.quick_sums.end).toBeCloseTo(r.windows.quick_sums.start + 60, 1);
});

test('sandbox override 30 wins over a bank of 60; outside sandbox it does not', () => {
  process.env.CHILD_TEST_QUICK_SUMS_SECONDS = '30';
  let r = findCueWindows({ words: words(T.MATHS_BLOCK), block: 'maths', form: withQs(60), cue: bank.cue.maths, durationSec: 96 });
  expect(r.windows.quick_sums.end).toBeCloseTo(r.windows.quick_sums.start + 30, 1);
  process.env.RAILWAY_ENVIRONMENT = 'production'; process.env.DEFAULT_REGION = 'niete';
  r = findCueWindows({ words: words(T.MATHS_BLOCK), block: 'maths', form: withQs(60), cue: bank.cue.maths, durationSec: 96 });
  expect(r.windows.quick_sums.end).toBeCloseTo(r.windows.quick_sums.start + 60, 1);
});

test('the story minute stays 60 s under the override', () => {
  process.env.CHILD_TEST_QUICK_SUMS_SECONDS = '30';
  const r = findCueWindows({ words: words(T.URDU_BLOCK), block: 'urdu', form: withQs(30), cue: bank.cue.urdu, durationSec: 112 });
  expect(r.windows.story.end).toBeCloseTo(r.windows.story.start + 60, 1);
});

test('a 30-s run cut at 30 s is not a timer problem', () => {
  const r = findCueWindows({ words: words(T.MATHS_BLOCK), block: 'maths', form: withQs(30), cue: bank.cue.maths, durationSec: 96 });
  expect(r.flags).not.toContain('timer_problem');
});

test('the labeller clamps a quick-sums window to the setting', async () => {
  mockChat.mockResolvedValueOnce({ json: { sections: { quick_sums: { start_s: 16, end_s: 80 } } }, cost: 0, seconds: 0 });
  const cut = { windows: {}, missing: ['quick_sums'] };
  await labelMissing({ block: 'maths', spec: withQs(30).maths, words: words(T.MATHS_BLOCK), cut, durationSec: 96, calls: [] });
  expect(cut.windows.quick_sums).toMatchObject({ start: 16, end: 46 });
});
