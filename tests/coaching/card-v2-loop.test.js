/**
 * Commitment card v2 — with the loop on, the card knows the target, the
 * attempt and the angle, never repeats the last framing, returns ONE move as
 * a structured action_spec. RED FIRST.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
const mockOpenAI = { chat: { completions: { create: jest.fn() } } };
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: mockOpenAI }));

const { generateCommitmentCard, buildPrompt } = require('../../bot/shared/services/coaching/coaching-card/commitment-card.service');
const { countBarFor } = require('../../bot/shared/services/coaching/uptake-loop.service');

const ok = (id, name, score) => ({ id, name, score, applicable: true, evidence: 'Quote: "…"' });
const na = (id, name) => ({ id, name, score: null, applicable: false });
const analysis = (focus = 'C3') => ({
  framework: 'fico', strengths: [{ title: 'Warm tone' }], growth_opportunities: [{ area: 'Feedback', observation: 'bare praise' }],
  domains: {
    high_leverage_practices: { indicators: [ok('C1', 'Quality Questioning', 2), ok('C3', 'Effective Feedback', 1)] },
    student_engagement: { indicators: [ok('D2', 'Student Reasoning in Responses', 1)] },
    teacher_subject_knowledge: { indicators: [ok('F1', 'Content Accuracy', 2), na('F4', 'Mathematical Discourse & Reasoning')] },
  },
  focus_area: { domain: focus === 'C3' ? 'high_leverage_practices' : 'student_engagement', indicator: focus, title: 'Next-step feedback', try_this_tomorrow: 'After every wrong answer, say one sentence that names the next step.' },
});
const PRIOR = { target: { indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback' }, action: 'After every wrong answer, say one sentence that names the next step.', action_spec: { count_target: countBarFor('C3') }, attempt: 1, angle: 'tell', session_id: 'p1' };
const loop = (state = {}, status = 'partial') => ({ prior: PRIOR, status, state: { target: PRIOR.target, attempt: 2, angle: 'cue', achieved_streak: 0, target_status: 'open', reason: 'next_angle', ...state } });
const Q = { questions: [{ question_number: '1', answer: 'I want the children to know what to fix, not just that it was wrong.' }] };
const reply = (payload) => ({ choices: [{ message: { content: JSON.stringify(payload) } }] });
const GOOD = { commitment: 'You want each child to know what to fix.', action: 'Next class, when the first wrong answer comes in the number-line task, ask "which step did you skip?" and wait for the fix.', lesson_label: 'Maths', highlights: ['number-line'], action_spec: { cue: 'the first wrong answer in the number-line task', move: 'ask which step was skipped and wait', count_target: countBarFor('C3'), model_line: 'Which step did you skip? Show me.' } };

beforeEach(() => mockOpenAI.chat.completions.create.mockReset());

describe('the prompt carries the loop', () => {
  test('attempt, angle instruction, the prior action verbatim, the COUNT bar and the action_spec contract', () => {
    const p = buildPrompt('en', analysis(), Q.questions[0], null, loop());
    expect(p).toMatch(/ATTEMPT 2/);
    expect(p).toMatch(/ANGLE "cue"/);
    expect(p).toContain(PRIOR.action);
    expect(p).toContain('specific_feedback_moves');
    expect(p).toContain('"action_spec"');
    expect(p).toContain('THE TARGET');
    expect(p).toContain('C3');
  });
  test('the ladder wording differs by angle, and hand_over uses the smallest unit plus the coach line', () => {
    const tell = buildPrompt('en', analysis(), Q.questions[0], null, loop({ attempt: 1, angle: 'tell' }));
    const show = buildPrompt('en', analysis(), Q.questions[0], null, loop({ attempt: 3, angle: 'show' }));
    const ho = buildPrompt('en', analysis(), Q.questions[0], null, loop({ attempt: 5, angle: 'hand_over', hand_over: true }));
    expect(tell).not.toBe(show);
    expect(show).toMatch(/one sentence to say/i);
    expect(ho).toMatch(/smallest countable unit/i);
    expect(ho).toMatch(/coach/i);
  });
  test('a bridge lesson (target not applicable today) coaches THIS lesson\'s indicator and says the target returns', () => {
    const l = loop({ bridge: true, target: { indicator: 'F4', domain: 'teacher_subject_knowledge', name: 'Mathematical Discourse & Reasoning' }, reason: 'target_not_applicable_today' });
    const p = buildPrompt('en', analysis('C3'), Q.questions[0], null, { ...l, prior: { ...PRIOR, target: l.state.target } });
    expect(p).toMatch(/BRIDGE/);
    expect(p).toContain('Mathematical Discourse');
    expect(p).toMatch(/THE TARGET[^\n]*C3/);
  });
});

describe('the LLM path with the loop', () => {
  test('executed: the target is the loop target; action_spec is kept; count_target is the bar', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(reply(GOOD));
    const out = await generateCommitmentCard(analysis('D2'), Q, 'en', { teacherName: 'Sana', loop: loop() });
    expect(mockOpenAI.chat.completions.create.mock.calls[0][0].messages[0].content).toMatch(/ATTEMPT 2/);
    expect(out.indicator).toBe('C3');
    expect(out.action_spec.cue).toBe(GOOD.action_spec.cue);
    expect(out.action_spec.count_target).toEqual(countBarFor('C3'));
    expect(out._source).toBe('llm');
  });
  test('a missing or mismatched count_target is replaced by the bar', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(reply({ ...GOOD, action_spec: { cue: 'c', move: 'm', count_target: { questions: 9 } } }));
    const out = await generateCommitmentCard(analysis(), Q, 'en', { teacherName: 'Sana', loop: loop() });
    expect(out.action_spec.count_target).toEqual(countBarFor('C3'));
  });
  test('a draft too close to the prior action is regenerated exactly once with a REWRITE instruction', async () => {
    const same = { ...GOOD, action: PRIOR.action };
    mockOpenAI.chat.completions.create.mockResolvedValueOnce(reply(same)).mockResolvedValueOnce(reply(GOOD));
    const out = await generateCommitmentCard(analysis(), Q, 'en', { teacherName: 'Sana', loop: loop() });
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(mockOpenAI.chat.completions.create.mock.calls[1][0].messages[0].content).toMatch(/REWRITE/);
    expect(out.action).toBe(GOOD.action);
    expect(out._similar_to_prior).toBeUndefined();
  });
  test('still similar after the rewrite → keep it, flag it, never a third call', async () => {
    const same = { ...GOOD, action: PRIOR.action };
    mockOpenAI.chat.completions.create.mockResolvedValue(reply(same));
    const out = await generateCommitmentCard(analysis(), Q, 'en', { teacherName: 'Sana', loop: loop() });
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(out._similar_to_prior).toBe(true);
  });
  test('three moves in one → regenerated once, the shorter draft is kept', async () => {
    const many = { ...GOOD, action: '1. Ask an open question. 2. Wait five seconds. 3. Name the next step after every wrong answer, then move on.' };
    mockOpenAI.chat.completions.create.mockResolvedValueOnce(reply(many)).mockResolvedValueOnce(reply(GOOD));
    const out = await generateCommitmentCard(analysis(), Q, 'en', { teacherName: 'Sana', loop: loop() });
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(out.action).toBe(GOOD.action);
  });
  test('without a loop the prompt and the card are exactly as before (no attempt, no action_spec demand)', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(reply(GOOD));
    const out = await generateCommitmentCard(analysis(), Q, 'en', { teacherName: 'Sana' });
    const p = mockOpenAI.chat.completions.create.mock.calls[0][0].messages[0].content;
    expect(p).not.toMatch(/ATTEMPT/);
    expect(p).not.toContain('"action_spec"');
    expect(out.action_spec).toBeUndefined();
  });
});

describe('the fallback path with the loop', () => {
  test('no reflective answer: the scorer\'s move when it is about the target, shaped into action_spec', async () => {
    const out = await generateCommitmentCard(analysis('C3'), { questions: [] }, 'en', { teacherName: 'Sana', loop: loop() });
    expect(out._source).toBe('focus_area');
    expect(out.action).toContain('next step');
    expect(out.action_spec.count_target).toEqual(countBarFor('C3'));
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
  });
  test('the scorer\'s move is about ANOTHER indicator: the rubric\'s own rung-2 ask for the target, localised for Urdu once', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(reply({ commitment: 'موثر feedback', action: 'تین specific feedback moves اور ایک اگلا قدم' }));
    const out = await generateCommitmentCard(analysis('D2'), { questions: [] }, 'ur', { teacherName: 'Sana', loop: loop() });
    expect(out._source).toBe('rubric');
    expect(out.indicator).toBe('C3');
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(/[؀-ۿ]/.test(out.action)).toBe(true);
    expect(out.action_spec.count_target).toEqual(countBarFor('C3'));
  });
});
