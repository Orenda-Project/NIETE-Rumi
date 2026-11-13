/**
 * bd-pw1ccr.38 — a G1-5 topic paper is checked once after writing: a skipped skill or a copied worked
 * example re-asks the paper once, and the better of the two papers is kept.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const { logToFile } = require('../../../bot/shared/utils/logger');
const { writeTopicExam } = require('../../../bot/shared/services/assessment/topics/topic-exam');

const SLOS = [{ code: 'A', description: 'Count objects' }, { code: 'B', description: 'Match numerals' }];
const PAGES = 'Example: 24 + 15 = 39';
const out = (qs) => ({ examJson: { unseen: { objective: { MCQs: qs } } }, questionCount: qs.length });
const ARGS = { grade: 2, subject: 'maths', pageContent: PAGES, slos: SLOS };

test('a clean first paper is kept, one call', async () => {
  const gen = jest.fn(async () => out([{ question: 'q1', slo: 'A' }, { question: 'q2', slo: 'B' }]));
  const got = await writeTopicExam(ARGS, gen);
  expect(gen).toHaveBeenCalledTimes(1);
  expect(got.questionCount).toBe(2);
});

test('a skipped skill re-asks once with that skill named, and the fuller paper is kept', async () => {
  const gen = jest.fn()
    .mockResolvedValueOnce(out([{ question: 'q1', slo: 'A' }]))
    .mockResolvedValueOnce(out([{ question: 'q1', slo: 'A' }, { question: 'q2', slo: 'B' }]));
  const got = await writeTopicExam(ARGS, gen);
  expect(gen).toHaveBeenCalledTimes(2);
  expect(gen.mock.calls[1][0].slos[1].description).toMatch(/at least one question/);
  expect(got.questionCount).toBe(2);
  expect(logToFile).toHaveBeenCalledWith('[assessment] topic paper re-asked', expect.objectContaining({ uncovered: ['B'] }));
});

test('a worse second paper loses to the first', async () => {
  const gen = jest.fn()
    .mockResolvedValueOnce(out([{ question: 'q1', slo: 'A' }]))
    .mockResolvedValueOnce(out([{ question: 'Add 24 and 15.', slo: 'C' }]));
  const got = await writeTopicExam(ARGS, gen);
  expect(got.examJson.unseen.objective.MCQs[0].question).toBe('q1');
});

test('the re-ask failing keeps the first paper', async () => {
  const gen = jest.fn()
    .mockResolvedValueOnce(out([{ question: 'Add 24 and 15.', slo: 'A' }]))
    .mockRejectedValueOnce(new Error('boom'));
  const got = await writeTopicExam(ARGS, gen);
  expect(got.examJson.unseen.objective.MCQs[0].question).toBe('Add 24 and 15.');
});

test('no skills (not a topic paper) → straight through', async () => {
  const gen = jest.fn(async () => out([{ question: 'Add 24 and 15.' }]));
  await writeTopicExam({ ...ARGS, slos: null }, gen);
  expect(gen).toHaveBeenCalledTimes(1);
});
