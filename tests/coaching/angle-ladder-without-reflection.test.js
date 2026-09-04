/**
 * The angle ladder must work on the NO-REFLECTION path — the path 51% of
 * teachers take. RED FIRST.
 *
 * Live on staging 2026-09-04 (user 4fe32eb6, target C4): attempts 1 `tell`,
 * 2 `cue` and 3 `show` all took fallbackCard(), which returns the rubric's
 * rung-2 sentence for the indicator — angle-blind and identical every time.
 * Overlap 1→2 was 0.59 and 2→3 was 1.00, both above the shipped tooSimilar
 * guard, because the guard lives inside the LLM branch that `if (!q3) return`
 * skips. Only attempt 4 differed, and only because she answered the reflection
 * that once.
 *
 * The reflection gates the COMMITMENT half of the card ("what she values"),
 * never the ACTION half. With a loop target we phrase the ask through the LLM
 * with its angle and the prior-action do-not-reuse block whether or not she
 * reflected; rubricAsk stays as the last resort when that call fails.
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
const ANALYSIS = {
  framework: 'fico',
  strengths: [{ title: 'Warm questions' }],
  growth_opportunities: [{ area: 'Student agency', observation: 'no choices offered' }],
  domains: {
    high_leverage_practices: { indicators: [ok('C1', 'Quality Questioning', 2), ok('C4', 'Student Agency & Voice', 0)] },
    student_engagement: { indicators: [ok('D2', 'Student Reasoning in Responses', 1)] },
  },
  focus_area: { domain: 'lesson_plan_fidelity', indicator: 'B1', try_this_tomorrow: 'state the objective' },
};
const TARGET = { indicator: 'C4', domain: 'high_leverage_practices', name: 'Student Agency & Voice' };
const PRIOR_ASK = 'اگلی کلاس میں کم از کم ایک موقع دیں جہاں کوئی طالب علم خود فیصلہ کرے کہ وہ مسئلہ کیسے حل کرے۔';
const loopAt = (attempt, angle) => ({
  prior: { target: TARGET, action: PRIOR_ASK, action_spec: { count_target: countBarFor('C4') }, attempt: attempt - 1, angle: 'tell', session_id: 'p1' },
  status: 'not_seen',
  state: { target: TARGET, attempt, angle, achieved_streak: 0, target_status: 'open' },
});
const NO_REFLECTION = { questions: [{ question_number: '1', question: 'q', answer: null }] };
const reply = (p) => ({ choices: [{ message: { content: JSON.stringify(p) } }] });
const GOOD = {
  commitment: 'You want every child to pick their own way in.',
  action: 'Next class, when the first pair finishes the fraction strips, ask one of them to choose how to show the answer.',
  lesson_label: 'Fractions', highlights: ['fraction strips'],
  action_spec: { cue: 'when the first pair finishes the fraction strips', move: 'let one child choose how to show it', count_target: countBarFor('C4'), model_line: 'How do you want to show us — draw it or say it?' },
};

beforeEach(() => mockOpenAI.chat.completions.create.mockReset());

describe('no reflection + a loop target', () => {
  test('the LLM phrases the ask, with the attempt, the angle and the prior action', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(reply(GOOD));
    const out = await generateCommitmentCard(ANALYSIS, NO_REFLECTION, 'en', { teacherName: 'Sana', loop: loopAt(3, 'show') });
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
    const prompt = mockOpenAI.chat.completions.create.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/ATTEMPT 3/);
    expect(prompt).toMatch(/ANGLE "show"/);
    expect(prompt).toContain(PRIOR_ASK);
    expect(out._source).toBe('llm');
    expect(out.action).toBe(GOOD.action);
  });

  test('the ask carries a real cue and model line — both were always empty on the old path', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(reply(GOOD));
    const out = await generateCommitmentCard(ANALYSIS, NO_REFLECTION, 'en', { teacherName: 'Sana', loop: loopAt(2, 'cue') });
    expect(out.action_spec.cue).toBe(GOOD.action_spec.cue);
    expect(out.action_spec.model_line).toBe(GOOD.action_spec.model_line);
    expect(out.action_spec.count_target).toEqual(countBarFor('C4'));
  });

  test('the sameness guard runs here too: a draft echoing the prior ask is regenerated once', async () => {
    mockOpenAI.chat.completions.create
      .mockResolvedValueOnce(reply({ ...GOOD, action: PRIOR_ASK }))
      .mockResolvedValueOnce(reply(GOOD));
    const out = await generateCommitmentCard(ANALYSIS, NO_REFLECTION, 'en', { teacherName: 'Sana', loop: loopAt(2, 'cue') });
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(mockOpenAI.chat.completions.create.mock.calls[1][0].messages[0].content).toMatch(/REWRITE/);
    expect(out.action).toBe(GOOD.action);
  });

  test('consecutive angles produce materially different prompts (the live 1.00-overlap regression)', () => {
    const seen = ['tell', 'cue', 'show', 'shrink'].map((angle, i) =>
      buildPrompt('ur', ANALYSIS, null, TARGET, loopAt(i + 1, angle)));
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(new Set(seen).size).toBe(4);
  });

  test('the prompt must not claim a reflective answer that does not exist', () => {
    const p = buildPrompt('en', ANALYSIS, null, TARGET, loopAt(2, 'cue'));
    expect(p).not.toMatch(/Her Q3 answer/);
    expect(p).not.toMatch(/undefined|null/);
    // the commitment half still has a source: the target, not an imagined quote
    expect(p).toMatch(/commitment/);
  });

  test('the LLM failing still yields the rubric ask — the last resort is intact', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValue(new Error('boom'));
    const out = await generateCommitmentCard(ANALYSIS, NO_REFLECTION, 'en', { teacherName: 'Sana', loop: loopAt(2, 'cue') });
    expect(out._source).toBe('rubric');
    expect(out.indicator).toBe('C4');
    expect(out.action_spec.count_target).toEqual(countBarFor('C4'));
  });
});

describe('the non-loop path is untouched', () => {
  test('no reflection and no loop → the old fallback, no card LLM call', async () => {
    const out = await generateCommitmentCard(ANALYSIS, NO_REFLECTION, 'en', { teacherName: 'Sana' });
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
    expect(['focus_area', 'fallback']).toContain(out._source);
  });

  test('a reflected session still uses her answer', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(reply(GOOD));
    const cs = { questions: [{ question_number: '1', question: 'q', answer: 'I want them to choose their own method.' }] };
    await generateCommitmentCard(ANALYSIS, cs, 'en', { teacherName: 'Sana', loop: loopAt(2, 'cue') });
    const prompt = mockOpenAI.chat.completions.create.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('I want them to choose their own method.');
  });
});
