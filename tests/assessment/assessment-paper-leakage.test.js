/**
 * bd-firpy.5 — teacher-facing text the G1-5 writer puts INTO a question.
 *
 * eg.ict.math.system (pinned, so not edited) asks for each question's Bloom's level "in
 * brackets at the end of the question statement" and for "(Based on the chapter/concept: …)",
 * and its Fill in the Blanks / Sequences lines are recipes the model pastes in as the question.
 * The regular generateExam path had no pass to take them off, so they printed on the child's
 * paper. Port of the main bot's bd-firpy.3 (cea1c1ffb). The level stays in the `blooms` field.
 */
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });

const BASE = {
  grade: 2, subject: 'Math', pageContent: '=== Page 4 ===\nAddition', pageReference: '4',
  contentSource: 'unseen',
  questionTypes: [{ id: 'MCQs', count: 2, category: 'objective' }, { id: 'Fill in the blanks', count: 1, category: 'objective' }],
};

beforeEach(() => mockCreate.mockReset());

describe('regular paper: teacher-facing text never reaches the child', () => {
  it('drops the Bloom label, the (Based on …) tag and the pasted recipe; keeps real brackets', async () => {
    mockCreate.mockResolvedValue(reply({ unseen: { objective: {
      MCQs: [
        { question: 'What is the sum of 45 and 28? (Remembering)', marks: 1, blooms: 'Remember' },
        { question: 'Which line is longer? (longer / shorter) (Based on the chapter/concept: Measurement) (Understand)', marks: 1, blooms: 'Understand' },
      ],
      'Fill in the blanks': [
        { question: 'Develop original, 5 + 3 = ___ based on the concepts and examples in the mathematics textbook without copying them directly with 2 options.', marks: 1 },
      ],
    } } }));
    const out = await Gen.generateExam(BASE);
    const o = out.examJson.unseen.objective;
    expect(o.MCQs[0].question).toBe('What is the sum of 45 and 28?');
    expect(o.MCQs[1].question).toBe('Which line is longer? (longer / shorter)');
    expect(o.MCQs[1].blooms).toBe('Understand');
    expect(o['Fill in the blanks'][0].question).toBe('5 + 3 = ___.');
  });

  it('leaves a clean question byte for byte', () => {
    expect(require('../../bot/shared/services/assessment/paper-sanitize').sanitizeQuestionText('Read:\n  the  cat sat. (Options: cat, hat)')).toBe('Read:\n  the  cat sat. (Options: cat, hat)');
  });
});
