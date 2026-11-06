/**
 * bd-5jmnfj.38.31 — the G6-12 free paper: the G1-5 free prompt with the grades 6-12 rules before its
 * safety policies, sized to its time, one revision when the draft breaks a rule, keys spread and the
 * time printed. Fictional fixture data only.
 */
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const PROMPTS = require('../../bot/shared/services/assessment/ict-prompts.json');
const Svc = require('../../bot/shared/services/assessment/free-secondary.service');

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });

const OPTS = ['a) Sand', 'b) Water', 'c) Wood', 'd) Salt'];
const mcq = () => ({ question: 'Which one dissolves in water?', options: OPTS.slice(), answer: 'd) Salt', marks: 1, lines: 0 });
const short = (extra = {}) => ({ question: 'Why does ice float?', answer: 'Ice is less dense than water.', marks: 3, lines: 4, ...extra });
const POINTS = [{ point: 'less dense', marks: 2 }, { point: 'than water', marks: 1 }];
const draft = (s) => ({ unseen: { objective: { 'Multiple Choice Questions': [mcq(), mcq(), mcq()] },
  subjective: { 'Short Answers': [s] } } });

const ARGS = {
  grade: 7, subject: 'general_science', pageContent: '=== Page 2 ===\nA fictional page about matter.',
  pageReference: '2-4', contentSource: 'unseen', questionCount: 20, includeAnswerKey: true,
  questionTypes: [
    { id: 'mcq', count: 7, category: 'objective', name: 'Multiple Choice Questions' },
    { id: 'srq', count: 7, category: 'subjective', name: 'Short Answers' },
    { id: 'erq', count: 6, category: 'subjective', name: 'Extended Answers' },
  ],
};

beforeEach(() => mockCreate.mockReset());

describe('free-secondary generateExam', () => {
  it('sends the science free prompt with the grade rules before the safety policies', async () => {
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))));
    await Svc.generateExam(ARGS);
    const system = mockCreate.mock.calls[0][0].messages[0].content;
    expect(system.startsWith(PROMPTS['eg.ict.science.system'])).toBe(true);
    const rules = system.indexOf('GRADES 6-12 RULES');
    expect(rules).toBeGreaterThan(0);
    expect(system.indexOf(PROMPTS['eg.safety.policies'])).toBeGreaterThan(rules);
  });

  it('sends an Urdu paper the Urdu free prompt on the Urdu model family', async () => {
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))));
    await Svc.generateExam({ ...ARGS, grade: 8, subject: 'urdu' });
    const system = mockCreate.mock.calls[0][0].messages[0].content;
    expect(system.startsWith(PROMPTS['eg.ict.urdu.system'])).toBe(true);
  });

  it('asks for the paper sized to its time: essays and short answers move onto MCQs', async () => {
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))));
    const out = await Svc.generateExam(ARGS);
    expect(out.plan.questionTypes.map((t) => [t.id, t.count])).toEqual([['mcq', 14], ['srq', 5], ['erq', 1]]);
    expect(mockCreate.mock.calls[0][0].messages[1].content).toContain('14');
  });

  it('makes one call for a clean draft, spreads its keys and prints its time', async () => {
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))));
    const out = await Svc.generateExam(ARGS);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const keys = out.examJson.unseen.objective['Multiple Choice Questions'].map((q) => q.answer.slice(0, 1));
    expect(keys).toEqual(['c', 'a', 'd']);
    expect(out.examJson._timeMinutes).toBeGreaterThanOrEqual(10);
    expect(out.examJson._timeMinutes % 5).toBe(0);
    expect(out.issues).toEqual([]);
    expect(out.questionCount).toBe(4);
  });

  it('sends a draft that breaks a rule back once with the fix list, and keeps the better paper', async () => {
    mockCreate
      .mockResolvedValueOnce(reply(draft(short())))
      .mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))));
    const out = await Svc.generateExam(ARGS);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const msgs = mockCreate.mock.calls[1][0].messages;
    expect(msgs[2].role).toBe('assistant');
    expect(msgs[3].content).toContain('Q4');
    expect(out.issues).toEqual([]);
    expect(out.revised).toBe(true);
  });

  it('keeps the first draft when the revision is worse or unreadable', async () => {
    mockCreate
      .mockResolvedValueOnce(reply(draft(short())))
      .mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }], usage: {} });
    const out = await Svc.generateExam(ARGS);
    expect(out.issues.map((i) => i.check)).toEqual(['marking-points']);
    expect(out.revised).toBe(false);
    expect(out.questionCount).toBe(4);
  });

  it('names the lesson in the rules and checks the paper asks about it', async () => {
    mockCreate
      .mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))))
      .mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS, question: 'Why does Edhi ice float?' }))));
    const out = await Svc.generateExam({ ...ARGS, chapterTitle: 'Edhi Foundation' });
    expect(mockCreate.mock.calls[0][0].messages[0].content).toContain('"Edhi Foundation"');
    expect(mockCreate.mock.calls[1][0].messages[3].content).toContain('Whole paper');
    expect(out.issues).toEqual([]);
  });

  it('fails with MODEL_UNAVAILABLE when the model call throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('down'));
    await expect(Svc.generateExam(ARGS)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });

  it('fails with NO_QUESTIONS on an empty tree', async () => {
    mockCreate.mockResolvedValueOnce(reply({ unseen: {} }));
    await expect(Svc.generateExam(ARGS)).rejects.toMatchObject({ code: 'NO_QUESTIONS' });
  });
});
