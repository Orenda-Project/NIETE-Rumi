/**
 * bd-zrdvmi.50.7 (q182) — a Grade 1-5 build-your-own paper is written toward FDE's thinking-level mix.
 *
 *   1. buildUserPrompt carries targetLine(grade, subject) for a grade/subject FDE gave a table for,
 *      and nothing for one it did not (G6+, a subject with no table), so those prompts stay byte-identical.
 *   2. generateExam logs the FDE target next to the mix the finished paper actually has.
 */
const mockCreate = jest.fn();
const mockLog = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const { targetLine } = require('../../bot/shared/services/assessment/fde-level-target');

const PAGE = '=== Page 4 ===\nWe add numbers.';
const TYPES = [{ id: 'MCQs', count: 2, category: 'objective' }, { id: 'Short Questions', count: 1, category: 'subjective' }];
const ARGS = { pageContent: PAGE, pageReference: '4', contentSource: 'unseen', questionCount: 3, questionTypes: TYPES };

describe('buildUserPrompt carries the FDE thinking-level target', () => {
  it('G5 Maths: the target line sits in the GENERATE list', () => {
    const p = Gen.buildUserPrompt({ ...ARGS, grade: 5, subject: 'maths' });
    const line = targetLine(5, 'maths');
    expect(line).toContain('Remember 10%');
    const generate = p.split('**GENERATE THE FOLLOWING:**')[1].split('**IMPORTANT NOTES:**')[0];
    expect(generate).toContain(line);
  });

  it('takes the bot\'s own subject spelling (eng, sst, genk)', () => {
    expect(Gen.buildUserPrompt({ ...ARGS, grade: 3, subject: 'english' })).toContain(targetLine(3, 'english'));
    expect(Gen.buildUserPrompt({ ...ARGS, grade: 4, subject: 'sst' })).toContain(targetLine(4, 'social_studies'));
  });

  it('G7 and a G5 subject with no FDE table get no target line', () => {
    expect(Gen.buildUserPrompt({ ...ARGS, grade: 7, subject: 'maths' })).not.toContain('Thinking levels');
    expect(Gen.buildUserPrompt({ ...ARGS, grade: 5, subject: 'general_knowledge' })).not.toContain('Thinking levels');
  });
});

describe('generateExam logs target and paper mix', () => {
  const reply = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }], usage: {} });
  const PAPER = { unseen: {
    objective: { MCQs: [{ question: 'a', marks: 1, answer: 'x', blooms: 'Remember' }, { question: 'b', marks: 1, answer: 'y', blooms: 'Understand' }] },
    subjective: { 'Short Questions': [{ question: 'c', marks: 2, answer: 'z', blooms: 'Apply' }] },
  } };

  beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); mockCreate.mockResolvedValue(reply(PAPER)); });
  const mixLog = () => mockLog.mock.calls.find(([msg]) => msg === '[assessment] thinking mix');

  it('G5 Maths: logs the FDE target and the paper\'s own mix', async () => {
    await Gen.generateExam({ ...ARGS, grade: 5, subject: 'maths' });
    const call = mixLog();
    expect(call).toBeDefined();
    expect(call[1].target).toMatchObject({ Remember: 10, Understand: 50, Apply: 40 });
    expect(call[1].paper).toMatchObject({ marks: 4 });
  });

  it('G7: no target, no mix line', async () => {
    await Gen.generateExam({ ...ARGS, grade: 7, subject: 'maths' });
    expect(mixLog()).toBeUndefined();
  });
});
