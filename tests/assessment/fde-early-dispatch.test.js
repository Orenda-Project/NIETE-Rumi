/**
 * A Grade 1-2 pattern job goes to the early writer (bd-5jmnfj.4.1), with the
 * service's helpers passed in, and is written once: the level-split re-ask is
 * Grade 5's (its note steers Grade 5's prompt), so an early paper is never
 * written a second time for it.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/fde-early-writer', () => ({ writeEarlyPaper: jest.fn() }));

const { writeEarlyPaper } = require('../../bot/shared/services/assessment/fde-early-writer');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const missedSplit = () => ({
  examJson: { _layout: { blueprint: {
    problems: [{ code: 'LEVEL' }],
    levels: Object.fromEntries(['Remember', 'Understand', 'Apply'].map((b) => [b, { pct: 50, target: 30, marks: 5 }])),
    sections: [],
  } } },
  tokenData: { model: 'm' },
  elapsedMs: 1,
});

beforeEach(() => writeEarlyPaper.mockReset().mockResolvedValue(missedSplit()));

test('a Grade 1 paper is written by the early writer with the real subject pattern and the service helpers', async () => {
  await Gen.generatePatternExam({ grade: 1, subject: 'Maths', pattern: 'fde_g1_2026', requestId: 'r1' });
  expect(writeEarlyPaper).toHaveBeenCalledTimes(1);
  const [args, d] = writeEarlyPaper.mock.calls[0];
  expect(args).toEqual(expect.objectContaining({ grade: 1, pattern: 'fde_g1_2026', requestId: 'r1' }));
  expect(args.P.key).toBe('maths');
  ['loadPatternContent', 'writeSection', 'sectionMessages', 'mergeSections', 'topUp', 'fail', 'buildPatternUserPrompt'].forEach((k) => expect(typeof d[k]).toBe('function'));
  expect(d.family).toBe('eng');
});

test('an Urdu-medium Grade 2 paper is written on the Urdu model family', async () => {
  await Gen.generatePatternExam({ grade: 2, subject: 'Urdu', pattern: 'fde_g2_2026' });
  expect(writeEarlyPaper.mock.calls[0][1].family).toBe('urdu');
});

test('an early paper that misses its level split is not written a second time', async () => {
  await Gen.generatePatternExam({ grade: 1, subject: 'English', pattern: 'fde_g1_2026', splitRetry: true });
  expect(writeEarlyPaper).toHaveBeenCalledTimes(1);
});

test('a grade the pattern does not cover is refused before anything is written', async () => {
  await expect(Gen.generatePatternExam({ grade: 3, subject: 'Maths', pattern: 'fde_g1_2026' })).rejects.toMatchObject({ code: 'PATTERN_INELIGIBLE' });
  expect(writeEarlyPaper).not.toHaveBeenCalled();
});
