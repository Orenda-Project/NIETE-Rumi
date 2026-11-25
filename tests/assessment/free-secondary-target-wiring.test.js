/**
 * bd-5jmnfj.38.43 (q304) — a Grade 6-10 build-your-own paper is planned, written and checked toward FDE's
 * thinking-level mix for its grade and subject, and keeps the panel's 30/30/20/10/10 where FDE gave none.
 *   1. Levels.plan / levelIssues take the split; a split with no Create never asks for a Create part.
 *   2. The writer's rules state the split and its source; a cell with no target keeps today's sentence.
 *   3. generateExam logs the target beside the finished paper's own split.
 * Fictional fixture data only.
 */
const mockCreate = jest.fn();
const mockLog = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const Svc = require('../../bot/shared/services/assessment/free-secondary.service');
const Levels = require('../../bot/shared/services/assessment/free-secondary-levels');
const Rules = require('../../bot/shared/services/assessment/free-secondary-rules');
const { fdeTarget } = require('../../bot/shared/services/assessment/free-secondary-target');

const TYPES = [
  { id: 'mcq', count: 7, category: 'objective', name: 'Multiple Choice Questions' },
  { id: 'srq', count: 7, category: 'subjective', name: 'Short Answers' },
  { id: 'erq', count: 2, category: 'subjective', name: 'Extended Answers' },
];
const share = (split) => Object.fromEntries(Object.entries(split).map(([b, v]) => [b, Math.round(v * 100)]));

describe('the level plan follows the split it is given', () => {
  it('G6 Maths (10/60/30): no Analyze/Evaluate or Create planned, within 5 points', () => {
    const levels = fdeTarget(6, 'maths').levels;
    const units = Levels.plan(TYPES, true, levels);
    expect(units.some((u) => ['Analyze', 'Evaluate', 'Create'].includes(u.level))).toBe(false);
    const got = share(Levels.splitOf(units, levels));
    expect(Math.abs(got.R - 10)).toBeLessThanOrEqual(5);
    expect(Math.abs(got.U - 60)).toBeLessThanOrEqual(5);
    expect(Math.abs(got.A - 30)).toBeLessThanOrEqual(5);
  });

  it('G7 History (50/20/10/10/10): Remember carries half the marks', () => {
    const levels = fdeTarget(7, 'history').levels;
    const got = share(Levels.splitOf(Levels.plan(TYPES, true, levels), levels));
    expect(Math.abs(got.R - 50)).toBeLessThanOrEqual(5);
  });

  it('with no split given, the plan is today\'s 30/30/20/10/10', () => {
    expect(Levels.plan(TYPES, true)).toEqual(Levels.plan(TYPES, true, Levels.PANEL));
  });
});

describe('levelIssues reads the paper against the split', () => {
  const item = (blooms, marks = 3) => ({ question: 'q', answer: 'a', marks, blooms });
  const paper = { unseen: { subjective: { 'Short Answers': [item('Understand'), item('Understand'), item('Understand'), item('Remember', 1), item('Apply')] } } };

  it('G6 Maths: an Understand-heavy paper with no Create is close enough; no Create is demanded', () => {
    expect(Levels.levelIssues(paper, fdeTarget(6, 'maths').levels)).toEqual([]);
  });

  it('the panel split still demands Create and names 30/30/20/10/10', () => {
    const issues = Levels.levelIssues(paper);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].text).toMatch(/30\/30\/20\/10\/10/);
  });

  it('an Analyze tag counts as Apply on a three-level split', () => {
    const p = { unseen: { subjective: { S: [item('Remember', 1), item('Understand', 6), item('Analyze', 3)] } } };
    expect(share(Levels.paperSplit(p, fdeTarget(6, 'maths').levels))).toEqual({ R: 10, U: 60, A: 30 });
  });
});

describe('the writer is told the split', () => {
  it('G6 Maths names FDE\'s split and its source, not 30/30/20/10/10', () => {
    const block = Rules.withRules('BASE', 'SAFETY', 6, null, { split: fdeTarget(6, 'maths') });
    expect(block).toMatch(/aim for about 10% Remember, 60% Understand and 30% Apply/);
    expect(block).toMatch(/FDE Assessment Scheme 2023-24/);
    expect(block).not.toMatch(/30% Remember, 30% Understand/);
    expect(block).not.toMatch(/Create can be one small item/);
  });

  it('no split: the sentence is today\'s, byte for byte', () => {
    expect(Rules.withRules('BASE', 'SAFETY', 6, null, {})).toContain(
      'Of the paper\'s marks, aim for about 30% Remember, 30% Understand, 20% Apply, 10% Analyze or Evaluate and 10% Create. Create can be one small item or one part');
  });
});

describe('generateExam', () => {
  const reply = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  const ARGS = { pageContent: '=== Page 2 ===\nA fictional page.', pageReference: '2', contentSource: 'unseen', questionCount: 16, includeAnswerKey: true, questionTypes: TYPES };
  const PAPER = { unseen: { objective: { 'Multiple Choice Questions': [
    { question: 'Which is 2+2?', options: ['a) 3', 'b) 5', 'c) 6', 'd) 4'], answer: 'd) 4', marks: 1, lines: 0, blooms: 'Remember' }] } } };
  beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); mockCreate.mockResolvedValue(reply({ items: [] })); mockCreate.mockResolvedValueOnce(reply(PAPER)); });
  const mixLog = () => mockLog.mock.calls.find(([msg]) => msg === '[assessment] thinking mix (grades 6-12 free)');

  it('G6 Maths: the writer sees FDE\'s split and the log carries target and paper split', async () => {
    await Svc.generateExam({ ...ARGS, grade: 6, subject: 'maths' }).catch(() => {});
    expect(mockCreate.mock.calls[0][0].messages[0].content).toMatch(/10% Remember, 60% Understand and 30% Apply/);
    const call = mixLog();
    expect(call).toBeDefined();
    expect(call[1]).toMatchObject({ grade: 6, subject: 'maths', fde: true, target: { R: 10, U: 60, A: 30 } });
    expect(call[1].paper).toBeDefined();
  });

  it('G6 Zarai Taleem (no FDE split): today\'s split, logged as not FDE', async () => {
    await Svc.generateExam({ ...ARGS, grade: 6, subject: 'zarai_taleem' }).catch(() => {});
    expect(mockCreate.mock.calls[0][0].messages[0].content).toMatch(/30% Remember, 30% Understand, 20% Apply/);
    const call = mixLog();
    if (call) expect(call[1]).toMatchObject({ fde: false, target: Levels.PANEL });
  });
});
