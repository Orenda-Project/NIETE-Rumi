/**
 * Turning a teacher's request and a chapter of textbook into exam questions.
 *
 * The prompts are the asset here — thirteen of them, carried over unchanged and
 * verified byte-identical to what the Python service serves. So most of what
 * matters is assembly: which prompt for which subject, in which order, with the
 * answer-key instruction appended or not. Get that wrong and the model still
 * answers, just worse, which is exactly the kind of failure a test has to catch
 * because a human reading the output will not.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const PROMPTS = require('../../bot/shared/services/assessment/ict-prompts.json');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const CONTENT = '=== Page 4 ===\nCHAPTER 1\nHello World!';

function reply(obj, usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }], usage };
}

// The smallest tree that is a real paper. Tests about call parameters or model
// routing still need one, because an empty tree is itself a failure case.
const ONE_QUESTION = { unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } };

const BASE = {
  grade: 1,
  subject: 'Eng',
  pageContent: CONTENT,
  pageReference: '4-14',
  contentSource: 'unseen',
  questionTypes: [{ id: 'MCQs', count: 5, category: 'objective' }],
};

beforeEach(() => mockCreate.mockReset());

describe('buildSystemPrompt', () => {
  it.each([
    ['Eng', 'eg.ict.eng.system', 'eg.format.exam'],
    ['Urdu', 'eg.ict.urdu.system', 'eg.format.urdu_exam'],
    ['Maths', 'eg.ict.math.system', 'eg.format.maths'],
    ['Science', 'eg.ict.science.system', 'eg.format.exam'],
    ['SST', 'eg.ict.sst.system', 'eg.format.urdu_exam'],
    ['GenK', 'eg.ict.genk.system', 'eg.format.urdu_exam'],
    ['Islamiat', 'eg.ict.islamiat.system', 'eg.format.restricted'],
  ])('%s takes %s with %s', (subject, systemKey, formatKey) => {
    const sys = Gen.buildSystemPrompt({ subject, includeAnswerKey: false });
    expect(sys.startsWith(PROMPTS[systemKey])).toBe(true);
    expect(sys).toContain(PROMPTS[formatKey]);
    expect(sys).toContain(PROMPTS['eg.task.ict_final']);
    expect(sys).toContain(PROMPTS['eg.safety.policies']);
  });

  it('assembles in the order the original used: system, task, format, answer-key, safety', () => {
    const sys = Gen.buildSystemPrompt({ subject: 'Maths', includeAnswerKey: false });
    const at = (k) => sys.indexOf(PROMPTS[k]);
    expect(at('eg.ict.math.system')).toBe(0);
    expect(at('eg.task.ict_final')).toBeGreaterThan(at('eg.ict.math.system'));
    expect(at('eg.format.maths')).toBeGreaterThan(at('eg.task.ict_final'));
    expect(sys.indexOf('ANSWER KEY DISABLED')).toBeGreaterThan(at('eg.format.maths'));
    expect(at('eg.safety.policies')).toBeGreaterThan(sys.indexOf('ANSWER KEY DISABLED'));
  });

  it('falls back to the English prompt for a subject with no prompt of its own', () => {
    const sys = Gen.buildSystemPrompt({ subject: 'Alchemy', includeAnswerKey: false });
    expect(sys.startsWith(PROMPTS['eg.ict.eng.system'])).toBe(true);
  });

  it('appends the answer-key instruction only when the key is off', () => {
    expect(Gen.buildSystemPrompt({ subject: 'Eng', includeAnswerKey: false }))
      .toContain('ANSWER KEY DISABLED');
    expect(Gen.buildSystemPrompt({ subject: 'Eng', includeAnswerKey: true }))
      .not.toContain('ANSWER KEY DISABLED');
  });

  it('accepts a canonical subject code as readily as the short one', () => {
    expect(Gen.buildSystemPrompt({ subject: 'english', includeAnswerKey: false }))
      .toBe(Gen.buildSystemPrompt({ subject: 'Eng', includeAnswerKey: false }));
    expect(Gen.buildSystemPrompt({ subject: 'general_knowledge', includeAnswerKey: false }))
      .toBe(Gen.buildSystemPrompt({ subject: 'GenK', includeAnswerKey: false }));
  });
});

describe('buildUserPrompt', () => {
  it('carries the grade, the page reference and the book text', () => {
    const p = Gen.buildUserPrompt(BASE);
    expect(p).toContain('**Grade:** 1');
    expect(p).toContain('**Page Reference:** 4-14');
    expect(p).toContain(CONTENT);
  });

  it('asks for each type by name and by count', () => {
    const p = Gen.buildUserPrompt({
      ...BASE,
      questionTypes: [
        { id: 'MCQs', count: 5, category: 'objective' },
        { id: 'Fill in the Blanks', count: 3, category: 'objective' },
        { id: 'Short Questions', count: 2, category: 'subjective' },
      ],
    });
    expect(p).toContain('5 MCQs');
    expect(p).toContain('3 Fill in the Blanks');
    expect(p).toContain('2 Short Questions');
    expect(p).toMatch(/EXACTLY that many/i);
  });

  it('separates objective from subjective, because the output tree does', () => {
    const p = Gen.buildUserPrompt({
      ...BASE,
      questionTypes: [
        { id: 'MCQs', count: 5, category: 'objective' },
        { id: 'Short Questions', count: 2, category: 'subjective' },
      ],
    });
    expect(p).toMatch(/Unseen Objective questions.*5 MCQs/);
    expect(p).toMatch(/Unseen Subjective questions.*2 Short Questions/);
  });

  it('asks for seen questions as extraction, not invention', () => {
    const p = Gen.buildUserPrompt({ ...BASE, contentSource: 'seen' });
    expect(p).toMatch(/Seen questions/);
    expect(p).toMatch(/directly from the textbook/i);
  });

  it('asks for both when she wanted a mix', () => {
    const p = Gen.buildUserPrompt({ ...BASE, contentSource: 'both' });
    expect(p).toMatch(/Unseen/);
    expect(p).toMatch(/Seen questions/);
  });
});

describe('generateExam', () => {
  it('calls the model in JSON mode at the original temperature', async () => {
    mockCreate.mockResolvedValue(reply(ONE_QUESTION));
    await Gen.generateExam(BASE);

    const params = mockCreate.mock.calls[0][0];
    expect(params.temperature).toBe(0.7);
    expect(params.response_format).toEqual({ type: 'json_object' });
    expect(params.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(params.messages[1].content).toContain(CONTENT);
  });

  it.each([['Urdu'], ['Islamiat'], ['GenK'], ['SST']])(
    'routes %s to the Urdu-language model slot', async (subject) => {
      mockCreate.mockResolvedValue(reply(ONE_QUESTION));
      await Gen.generateExam({ ...BASE, subject });
      expect(mockCreate.mock.calls[0][0].model).toBe(Gen.MODELS.urdu);
    },
  );

  it.each([['Eng'], ['Maths'], ['Science']])(
    'routes %s to the English model slot', async (subject) => {
      mockCreate.mockResolvedValue(reply(ONE_QUESTION));
      await Gen.generateExam({ ...BASE, subject });
      expect(mockCreate.mock.calls[0][0].model).toBe(Gen.MODELS.eng);
    },
  );

  it('returns the parsed tree and what the call cost', async () => {
    mockCreate.mockResolvedValue(reply({
      unseen: { objective: { MCQs: [{ question: 'Which is a living thing?', options: ['(a) Rock'], marks: 1 }] } },
    }));
    const out = await Gen.generateExam(BASE);
    expect(out.examJson.unseen.objective.MCQs).toHaveLength(1);
    expect(out.tokenData).toEqual({
      inputTokens: 100, outputTokens: 50, totalTokens: 150, model: Gen.MODELS.eng,
    });
    expect(out.questionCount).toBe(1);
  });

  it('counts questions across every branch of the tree, nesting included', async () => {
    mockCreate.mockResolvedValue(reply({
      seen: { objective: { MCQs: [{ question: 'a' }, { question: 'b' }] } },
      unseen: {
        objective: { 'True/False': [{ question: 'c' }] },
        subjective: { 'Long Question': { 'Essay Writing': [{ question: 'd' }, { question: 'e' }] } },
      },
    }));
    // A mixed request whose seen cap (5) is above the two seen questions here,
    // so nothing is trimmed and the count is the whole tree.
    const out = await Gen.generateExam({ ...BASE, contentSource: 'both', questionCount: 10 });
    expect(out.questionCount).toBe(5);
  });

  it('drops seen questions the model adds to an unseen-only paper', async () => {
    mockCreate.mockResolvedValue(reply({
      seen: { objective: { MCQs: [{ question: 'a' }, { question: 'b' }] } },
      unseen: { objective: { 'True/False': [{ question: 'c' }] } },
    }));
    const out = await Gen.generateExam(BASE);
    expect(out.questionCount).toBe(1);
    expect(out.trimmed).toEqual({ seen: 2 });
  });

  it('strips image keys — image generation is not part of this', async () => {
    mockCreate.mockResolvedValue(reply({
      unseen: {
        subjective: {
          'Short Questions': [{ question: 'q', image: 'a prompt, not a URL' }],
          'Long Question': { 'Essay Writing': [{ question: 'q2', image: 'another' }] },
        },
      },
    }));
    const out = await Gen.generateExam(BASE);
    expect(out.examJson.unseen.subjective['Short Questions'][0]).not.toHaveProperty('image');
    expect(out.examJson.unseen.subjective['Long Question']['Essay Writing'][0]).not.toHaveProperty('image');
  });

  it('recovers a fenced, comma-dropping reply rather than failing on it', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '```json\n{"unseen": {"objective": {"MCQs": [{"question": "q", "marks": 1\n"options": ["(a) x"]}]}}}\n```' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const out = await Gen.generateExam(BASE);
    expect(out.examJson.unseen.objective.MCQs[0].options).toEqual(['(a) x']);
  });

  it('refuses prose with a typed error instead of half a paper', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'I am unable to help with that.' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    await expect(Gen.generateExam(BASE)).rejects.toMatchObject({ code: 'BAD_JSON' });
  });

  it('refuses a well-formed reply that contains no questions at all', async () => {
    mockCreate.mockResolvedValue(reply({ unseen: { objective: {} } }));
    await expect(Gen.generateExam(BASE)).rejects.toMatchObject({ code: 'NO_QUESTIONS' });
  });

  it('calls a truncated reply truncated, not unreadable', async () => {
    // Met in practice: this model spends budget on reasoning before it writes,
    // so running out returns finish_reason 'length' with a null content. The
    // fix is fewer questions, which is a different answer from "try again".
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null }, finish_reason: 'length' }],
      usage: { prompt_tokens: 7, completion_tokens: 37, total_tokens: 44 },
    });
    await expect(Gen.generateExam(BASE)).rejects.toMatchObject({ code: 'TRUNCATED' });
  });

  it('surfaces a model outage as its own code, not as bad output', async () => {
    mockCreate.mockRejectedValue(new Error('502 upstream'));
    await expect(Gen.generateExam(BASE)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });
});

describe('the question limit governs the whole paper (bd-60015)', () => {
  const T = (id, count, category = 'objective') => ({ id, count, category });
  const MIX = [T('MCQs', 4), T('Fill in the Blanks', 3), T('True/False', 3)];

  it('splits a mixed paper half seen, half unseen', () => {
    const plan = Gen.planCounts({ contentSource: 'both', questionCount: 10, questionTypes: MIX });
    expect(plan.seenTarget).toBe(5);
    expect(plan.unseenTarget).toBe(5);
    expect(plan.questionTypes.reduce((s, t) => s + t.count, 0)).toBe(5);
    expect(plan.questionTypes.map((t) => t.id)).toEqual(['MCQs', 'Fill in the Blanks', 'True/False']);
  });

  it('gives an odd count the extra question to unseen — seen is at most half', () => {
    const plan = Gen.planCounts({ contentSource: 'both', questionCount: 15, questionTypes: MIX });
    expect(plan.seenTarget).toBe(7);
    expect(plan.unseenTarget).toBe(8);
    expect(plan.questionTypes.reduce((s, t) => s + t.count, 0)).toBe(8);
  });

  it('leaves an unseen-only paper exactly as asked', () => {
    const plan = Gen.planCounts({ contentSource: 'unseen', questionCount: 10, questionTypes: MIX });
    expect(plan.seenTarget).toBe(0);
    expect(plan.questionTypes).toEqual(MIX);
  });

  it('caps a seen-only paper at the count', () => {
    const plan = Gen.planCounts({ contentSource: 'seen', questionCount: 10, questionTypes: MIX });
    expect(plan.seenTarget).toBe(10);
    expect(plan.unseenTarget).toBe(0);
  });

  it('derives the count from the types when a job predates the field', () => {
    const plan = Gen.planCounts({ contentSource: 'both', questionTypes: MIX });
    expect(plan.seenTarget).toBe(5);
  });

  it('tells the model the seen cap, the unseen remainder and the total', () => {
    const p = Gen.buildUserPrompt({
      ...BASE, contentSource: 'both', questionCount: 10,
      questionTypes: [T('MCQs', 6), T('True/False', 4)],
    });
    expect(p).toMatch(/Seen questions[^\n]*\b5\b/);
    expect(p).toContain('3 MCQs');
    expect(p).toContain('2 True/False');
    expect(p).toMatch(/total[^\n]*\b10\b/i);
    expect(p).not.toMatch(/all objective and subjective questions directly from the textbook/i);
  });

  it('tells the model the paper carries no pictures', () => {
    expect(Gen.buildUserPrompt(BASE)).toMatch(/no pictures|without pictures|carries no (pictures|images)/i);
  });

  it('trims seen questions the model over-delivers, and says so', async () => {
    const q = (n) => ({ question: `s${n}`, marks: 1 });
    mockCreate.mockResolvedValue(reply({
      seen: { objective: { MCQs: [q(1), q(2), q(3), q(4), q(5), q(6)], 'True/False': [q(7), q(8)] } },
      unseen: { objective: { MCQs: [q(9), q(10), q(11), q(12), q(13)] } },
    }));
    const out = await Gen.generateExam({
      ...BASE, contentSource: 'both', questionCount: 10, questionTypes: [T('MCQs', 10)],
    });
    const seen = out.examJson.seen.objective;
    expect(seen.MCQs.length + seen['True/False'].length).toBe(5);
    expect(seen.MCQs.map((x) => x.question)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(out.questionCount).toBe(10);
    expect(out.trimmed).toEqual({ seen: 3 });
  });
});
