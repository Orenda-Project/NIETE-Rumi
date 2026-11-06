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
const SCHEME = { mark_bands: [{ marks: '3', descriptor: 'full' }, { marks: '1-2', descriptor: 'partial' }, { marks: '0', descriptor: 'none' }], accept: 'equal wording', reject: 'a bare yes' };
const short = (extra = {}) => ({ question: 'Why does ice float?', answer: 'Ice is less dense than water.', marks: 3, lines: 4, ...SCHEME, ...extra });
const POINTS = [{ point: 'less dense', marks: 2 }, { point: 'than water', marks: 1 }];
const NO_REVIEW = reply({ items: [] });
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

  it('marks an Urdu paper so its headings and instructions print in Urdu, and leaves a science paper alone', async () => {
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))));
    const urdu = await Svc.generateExam({ ...ARGS, grade: 8, subject: 'urdu' });
    expect(urdu.examJson._paperLang).toBe('ur');
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))));
    const science = await Svc.generateExam(ARGS);
    expect(science.examJson._paperLang).toBeUndefined();
  });

  it('keeps the requested 20 items for 7/7/6 (a7 ruling on A5e): MCQs as asked, extended answers become short, lighter marks', async () => {
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))));
    const out = await Svc.generateExam(ARGS);
    const counts = out.plan.questionTypes.map((t) => [t.id, t.count]);
    expect(counts).toEqual([['mcq', 7], ['srq', 12], ['erq', 1]]);
    const [system, user] = mockCreate.mock.calls[0][0].messages.map((m) => m.content);
    expect(user).toMatch(/\b23\b/);
    expect(system).toMatch(/Short answer 2 marks/);
  });

  it('logs a paper whose load runs over the band by more than 20%, and prints its real time', async () => {
    const { logToFile } = require('../../bot/shared/utils/logger');
    const long = short({ marking_points: POINTS, answer: Array(700).fill('word').join(' ') });
    mockCreate.mockResolvedValueOnce(reply(draft(long)));
    const out = await Svc.generateExam(ARGS);
    expect(out.examJson._timeMinutes).toBeGreaterThan(72);
    const done = logToFile.mock.calls.filter(([m]) => m === '[assessment] generated (grades 6-12 free)').pop()[1];
    expect(done).toMatchObject({ overBand: true });
  });

  it('prints an Urdu paper in one digit system, the Western digits of its chrome (G8 a6 Q1-2)', async () => {
    const d = draft(short({ marking_points: POINTS }));
    d.unseen.objective['Multiple Choice Questions'][0] = { question: 'وہ کس سن میں پیدا ہوئے؟', marks: 1, lines: 0,
      options: ['الف) ۱۹۲۶ء', 'ب) ۱۹۲۷ء', 'ج) ۱۹۲۸ء', 'د) ۱۹۲۹ء'], answer: 'ج) ۱۹۲۸ء' };
    mockCreate.mockResolvedValueOnce(reply(d));
    const out = await Svc.generateExam({ ...ARGS, grade: 8, subject: 'urdu' });
    const text = JSON.stringify(out.examJson);
    expect(text).not.toMatch(/[۰-۹٠-٩]/);
    expect(text).toContain('1928ء');
  });

  it('marks the paper so its answer key prints each item\'s thinking level', async () => {
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))));
    const out = await Svc.generateExam(ARGS);
    expect(out.examJson._levels).toBe(true);
  });

  it('puts number options in ascending order before the keys are spread (G8 Q9)', async () => {
    const d = draft(short({ marking_points: POINTS }));
    d.unseen.objective['Multiple Choice Questions'][0] = { question: 'How old was he?', marks: 1, lines: 0,
      options: ['a) 78 years', 'b) 88 years', 'c) 68 years', 'd) 98 years'], answer: 'b) 88 years' };
    mockCreate.mockResolvedValueOnce(reply(d));
    const out = await Svc.generateExam(ARGS);
    const q = out.examJson.unseen.objective['Multiple Choice Questions'][0];
    expect(q.options).toEqual(['a) 68 years', 'b) 78 years', 'c) 88 years', 'd) 98 years']);
    expect(q.answer).toBe('c) 88 years');
  });

  it('asks for 30% more MCQs and keeps the plan count, dropping the one that gives a short answer away', async () => {
    const gas = { question: 'Which gas do plants take in for photosynthesis?', marks: 1, lines: 0, answer: 'b',
      options: ['a) Oxygen gas', 'b) Carbon dioxide', 'c) Nitrogen gas', 'd) Water vapour'] };
    const d = { unseen: { objective: { 'Multiple Choice Questions': [mcq(), gas, mcq()] }, subjective: { 'Short Answers': [
      short({ question: 'Name the gas plants take in during photosynthesis.', answer: 'Carbon dioxide.', marking_points: POINTS })] } } };
    mockCreate.mockResolvedValueOnce(reply(d));
    const out = await Svc.generateExam({ ...ARGS, questionCount: 3, questionTypes: [
      { id: 'mcq', count: 2, category: 'objective', name: 'Multiple Choice Questions' },
      { id: 'srq', count: 1, category: 'subjective', name: 'Short Answers' }] });
    expect(mockCreate.mock.calls[0][0].messages[1].content).toMatch(/\b3\b/);
    const kept = out.examJson.unseen.objective['Multiple Choice Questions'];
    expect(kept).toHaveLength(2);
    expect(kept.some((q) => /photosynthesis/.test(q.question))).toBe(false);
    expect(out.issues).toEqual([]);
    expect(out.pooled).toBe(1);
  });

  it('makes the paper call and the distractor review for a clean draft, spreads its keys and prints its time', async () => {
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS })))).mockResolvedValueOnce(NO_REVIEW);
    const out = await Svc.generateExam(ARGS);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const keys = out.examJson.unseen.objective['Multiple Choice Questions'].map((q) => q.answer.slice(0, 1));
    expect(new Set(keys).size).toBe(3);
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
    expect(mockCreate).toHaveBeenCalledTimes(3);
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

  const keysOf = (out) => out.examJson.unseen.objective['Multiple Choice Questions'].map((q) => q.answer.slice(0, 1)).join('');

  it('spreads the keys from the paper\'s seed: the same seed gives the same letters', async () => {
    const seeds = ['paper-1', 'paper-1', 'paper-2', 'paper-3', 'paper-4', 'paper-5'];
    const runs = [];
    for (const keySeed of seeds) {
      mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS }))));
      runs.push(keysOf(await Svc.generateExam({ ...ARGS, keySeed })));
    }
    expect(runs[0]).toBe(runs[1]);
    expect(new Set(runs).size).toBeGreaterThan(1);
  });

  it('rewrites only the items a revision left with a leak, a long key or an absolute option', async () => {
    const longKey = () => draft(short({ marking_points: POINTS }));
    const withLong = () => { const d = longKey(); d.unseen.objective['Multiple Choice Questions'][0].options[3] = 'd) Salt that is stirred into warm water'; d.unseen.objective['Multiple Choice Questions'][0].answer = 'd'; return d; };
    mockCreate
      .mockResolvedValueOnce(reply(withLong()))
      .mockResolvedValueOnce(reply(withLong())).mockResolvedValueOnce(NO_REVIEW)
      .mockResolvedValueOnce(reply({ items: [{ n: 1, question: 'Which one dissolves in water?', options: OPTS, answer: 'd) Salt' }] }));
    const out = await Svc.generateExam({ ...ARGS, keySeed: 's' });
    expect(mockCreate).toHaveBeenCalledTimes(4);
    const ask = mockCreate.mock.calls[3][0].messages;
    expect(ask[ask.length - 1].content).toContain('Q1');
    expect(ask[ask.length - 1].content).not.toContain('Why does ice float?');
    expect(out.issues).toEqual([]);
    expect(out.rewritten).toEqual([1]);
  });

  it('runs a second targeted round when the first clears one item and flags remain', async () => {
    const LONG = ['a) Sand', 'b) Water', 'c) Wood', 'd) Salt that is stirred into warm water'];
    const twoLong = () => { const d = draft(short({ marking_points: POINTS })); const m = d.unseen.objective['Multiple Choice Questions'];
      [0, 1].forEach((i) => { m[i].options = LONG.slice(); m[i].answer = 'd'; }); return d; };
    const fixed = (n) => reply({ items: [{ n, question: 'Which one dissolves in water?', options: OPTS, answer: 'd) Salt' }] });
    mockCreate.mockResolvedValueOnce(reply(twoLong())).mockResolvedValueOnce(reply(twoLong())).mockResolvedValueOnce(NO_REVIEW)
      .mockResolvedValueOnce(fixed(1)).mockResolvedValueOnce(fixed(2));
    const out = await Svc.generateExam({ ...ARGS, keySeed: 's' });
    expect(mockCreate).toHaveBeenCalledTimes(5);
    expect(out.rewritten).toEqual([1, 2]);
    expect(out.issues).toEqual([]);
  });

  it('keeps the paper when the targeted rewrite does not leave fewer problems', async () => {
    const withLong = () => { const d = draft(short({ marking_points: POINTS })); d.unseen.objective['Multiple Choice Questions'][0].options[3] = 'd) Salt that is stirred into warm water'; d.unseen.objective['Multiple Choice Questions'][0].answer = 'd'; return d; };
    mockCreate
      .mockResolvedValueOnce(reply(withLong()))
      .mockResolvedValueOnce(reply(withLong())).mockResolvedValueOnce(NO_REVIEW)
      .mockResolvedValueOnce(reply({ items: [{ n: 1, question: 'Which?', options: ['a) Sand', 'b) Water', 'c) Wood', 'd) Salt that is stirred into warm water'], answer: 'd' }] }));
    const out = await Svc.generateExam({ ...ARGS, keySeed: 's' });
    expect(out.issues.map((i) => i.check)).toEqual(['longest-key']);
    expect(out.rewritten).toEqual([]);
  });

  it('compares families on the models the settings put in force: with writer and reviewers all on one family it reviews on its own job', async () => {
    const GEMINI = 'google/gemini-3.1-pro-preview';
    let Moved;
    jest.isolateModules(() => {
      jest.doMock('../../bot/shared/config/model-settings', () => ({
        ensureCurrent: async () => {},
        configForRequest: () => ({ perJob: { 'assessment.generate': GEMINI, 'assessment.review': GEMINI } }),
      }));
      Moved = require('../../bot/shared/services/assessment/free-secondary.service');
    });
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: POINTS })))).mockResolvedValueOnce(NO_REVIEW);
    await Moved.generateExam(ARGS);
    expect(mockCreate.mock.calls[1][0].job).toBe('assessment.generate');
    jest.dontMock('../../bot/shared/config/model-settings');
  });

  it('reviews the distractors in one small call and rewrites an MCQ with a distractor rated 1', async () => {
    const silly = () => { const d = draft(short({ marking_points: POINTS })); d.unseen.objective['Multiple Choice Questions'][0].options[2] = 'c) A banana'; return d; };
    mockCreate.mockResolvedValueOnce(reply(silly()))
      .mockResolvedValueOnce(reply({ items: [{ n: 1, distractors: [{ option: 'a', rating: 3 }, { option: 'b', rating: 2 }, { option: 'c', rating: 1, why: 'a fruit' }], longest_key: false }] }))
      .mockResolvedValueOnce(reply({ items: [{ n: 1, question: 'Which one dissolves in water?', options: OPTS, answer: 'd) Salt' }] }));
    const out = await Svc.generateExam({ ...ARGS, keySeed: 's' });
    expect(mockCreate).toHaveBeenCalledTimes(3);
    const review = mockCreate.mock.calls[1][0];
    // A registered job of another model family than the writer reviews it; the writer's model is the fallback.
    const paper = mockCreate.mock.calls[0][0];
    expect(review.job).not.toBe('assessment.generate');
    expect(review.model.split('/')[0]).not.toBe(paper.model.split('/')[0]);
    expect(review.fallbackModel).toBe(paper.model);
    expect(review.temperature).toBe(0);
    expect(review.max_tokens).toBeLessThanOrEqual(8000);
    expect(review.messages[review.messages.length - 1].content).toContain('c) A banana');
    expect(review.messages[review.messages.length - 1].content).not.toContain('Why does ice float?');
    const rewrite = mockCreate.mock.calls[2][0].messages;
    expect(rewrite[rewrite.length - 1].content).toContain('a fruit');
    expect(out.rewritten).toEqual([1]);
    expect(out.issues).toEqual([]);
    expect(out.examJson.unseen.objective['Multiple Choice Questions'][0].options).not.toContain('c) A banana');
  });

  it('makes no targeted call when only other problems remain, and strips instruction text from marking points', async () => {
    const pts = [{ point: 'less dense (do not repeat the question)', marks: 2 }, { point: 'than water', marks: 1 }];
    mockCreate.mockResolvedValueOnce(reply(draft(short({ marking_points: pts })))).mockResolvedValueOnce(NO_REVIEW);
    const out = await Svc.generateExam({ ...ARGS, keySeed: 's' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(out.examJson.unseen.subjective['Short Answers'][0].marking_points[0].point).toBe('less dense');
  });

  it('prints the parts of a scenario item the writer nested under it', async () => {
    const d = draft(short({ marking_points: POINTS }));
    d.unseen.subjective.Other = [{ question: 'A fictional plant wilts.', marks: 2, lines: 4,
      marking_points: [{ point: 'p', marks: 2 }], answer: 'It loses water.',
      questions: [{ question: 'a. Why does it wilt?', marks: 2, answer: 'It loses water.' }] }];
    mockCreate.mockResolvedValueOnce(reply(d));
    const out = await Svc.generateExam({ ...ARGS, keySeed: 's' });
    expect(out.examJson.unseen.subjective.Other[0].passage).toBe('A fictional plant wilts.');
  });
});

