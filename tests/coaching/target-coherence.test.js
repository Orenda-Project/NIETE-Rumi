/**
 * ONE target per report. The narrative's horizon, the commitment card and the
 * hero's green box must all name the SAME indicator — the scorer's focus_area,
 * validated against the analysis (exists, applicable).
 *
 * RED FIRST. Three independent selectors chose the growth area (horizon = the
 * lowest-scoring DOMAIN; card = growth_opportunities[0] or the weakest row;
 * focus_area = the scorer's lowest applicable indicator with quotable evidence),
 * so one report named three different areas. And the scorer's own concrete
 * `try_this_tomorrow` reached nobody: 51% of self-serve teachers got the rule
 * template ("dedicate 5 minutes to X") because they never answered the
 * reflective question, the rest got an LLM card that never saw the target.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const mockOpenAI = { chat: { completions: { create: jest.fn() } } };
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: mockOpenAI }));

const NA = (id, name) => ({ id, name, score: null, applicable: false, evidence: 'Not applicable' });
const ok = (id, name, score) => ({ id, name, score, applicable: true, evidence: 'Quote: "…"' });

/** The staging Urdu-grammar session shape (FICO v4, 0–2): scorer chose C3. */
function urduLesson(overrides = {}) {
  return {
    framework: 'fico',
    topic: 'واحد جمع',
    domains: {
      lesson_plan_fidelity: { domain_score: 6, domain_max: 14, indicators: [ok('B1', 'Instructional Clarity & Learning Objectives', 2), ok('B2', 'Lesson Structure & Sequence', 1), ok('B4', 'Activation of Prior Knowledge', 0)] },
      high_leverage_practices: { domain_score: 6, domain_max: 8, indicators: [ok('C1', 'Quality Questioning (Bloom\'s Aligned)', 2), ok('C2', 'Responsive Re-explanation & Adaptive Teaching', 1), ok('C3', 'Effective Feedback', 1), ok('C4', 'Student Agency & Voice', 2)] },
      student_engagement: { domain_score: 3, domain_max: 4, indicators: [ok('D1', 'Diversity of Conceptual Expression', 1), ok('D2', 'Student Reasoning in Responses', 2)] },
      teacher_subject_knowledge: { domain_score: 8, domain_max: 12, indicators: [ok('F1', 'Content Accuracy', 2), ok('F2', 'Use of Academic Language', 1), NA('F4', 'Mathematical Discourse & Reasoning'), NA('F5', 'Problem-Solving & Productive Struggle'), ok('F8', 'Explicit Phonics / Decoding', 1), ok('F9', 'Comprehension Strategy Instruction', 2)] },
    },
    scores: { overall_marks: 23, overall_max_marks: 38, overall_percentage: 60.5 },
    strengths: [{ title: 'Clear objectives' }],
    growth_opportunities: [{ area: 'Prior knowledge', observation: 'no recall', strategies: ['ask two named concepts'] }],
    focus_area: {
      domain: 'high_leverage_practices', indicator: 'C3', title: 'Feedback جو اگلا قدم بتائے',
      rationale: 'Feedback stayed at shabash and galat; nothing told a child what to do next.',
      try_this_tomorrow: 'ہر غلط جواب کے بعد ایک جملہ کہیں: "اب یہ کریں…" — اگلا قدم بتائیں۔',
    },
    ...overrides,
  };
}

describe('resolveTarget — the ONE validated target', () => {
  const { resolveTarget } = require('../../bot/shared/services/coaching/target-resolver');

  test('returns the scorer\'s focus_area indicator with its rung, move and COUNT unit', () => {
    const t = resolveTarget(urduLesson());
    expect(t).toMatchObject({ indicator: 'C3', domain: 'high_leverage_practices', rung: 1, name: 'Effective Feedback' });
    expect(t.try).toContain('اگلا قدم');
    expect(typeof t.count).toBe('string');
    expect(t.levels && t.levels[2]).toMatch(/THREE OR MORE/);
  });

  test('null when the focus_area indicator is flagged not applicable in THIS analysis', () => {
    const a = urduLesson({ focus_area: { domain: 'teacher_subject_knowledge', indicator: 'F4', try_this_tomorrow: 'x' } });
    expect(resolveTarget(a)).toBeNull();
  });

  test('null when the id is unknown to the analysis, and null with no focus_area / no domains', () => {
    expect(resolveTarget(urduLesson({ focus_area: { indicator: 'Z9', try_this_tomorrow: 'x' } }))).toBeNull();
    expect(resolveTarget(urduLesson({ focus_area: undefined }))).toBeNull();
    expect(resolveTarget({ framework: 'fico', focus_area: { indicator: 'C3' } })).toBeNull();
    expect(resolveTarget(null)).toBeNull();
  });
});

describe('commitment card — the scorer\'s own move is the fallback of record', () => {
  const { generateCommitmentCard, buildPrompt } = require('../../bot/shared/services/coaching/coaching-card/commitment-card.service');

  beforeEach(() => mockOpenAI.chat.completions.create.mockReset());

  test('no reflective answer + focus_area present → try_this_tomorrow, _source focus_area, no template, no LLM call', async () => {
    const out = await generateCommitmentCard(urduLesson(), { questions: [] }, 'ur', { teacherName: 'Qurat' });
    expect(out._source).toBe('focus_area');
    expect(out.indicator).toBe('C3');
    expect(out.action).toContain('اگلا قدم');
    expect(out.action).not.toMatch(/5 minutes|dedicating/);
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
  });

  test('the try is in the wrong script for the report language → localised once, never the template', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ commitment: 'اگلا قدم', action: 'ہر غلط جواب کے بعد اگلا قدم بتائیں' }) } }],
    });
    const a = urduLesson({ focus_area: { domain: 'high_leverage_practices', indicator: 'C3', title: 'Next-step feedback', try_this_tomorrow: 'After every wrong answer, say one sentence that names the next step.' } });
    const out = await generateCommitmentCard(a, { questions: [] }, 'ur', { teacherName: 'Qurat' });
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(out._source).toBe('focus_area');
    expect(out.action).toContain('اگلا قدم');
  });

  test('localisation failure keeps the scorer\'s text rather than dropping to the template', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValue(new Error('boom'));
    const a = urduLesson({ focus_area: { domain: 'high_leverage_practices', indicator: 'C3', title: 'Next-step feedback', try_this_tomorrow: 'After every wrong answer, say one sentence that names the next step.' } });
    const out = await generateCommitmentCard(a, { questions: [] }, 'ur', { teacherName: 'Qurat' });
    expect(out._source).toBe('focus_area');
    expect(out.action).toContain('next step');
  });

  test('no focus_area at all → the rule template still stands (nothing lost)', async () => {
    const out = await generateCommitmentCard(urduLesson({ focus_area: undefined }), { questions: [] }, 'en', { teacherName: 'Qurat' });
    expect(out._source).toBe('fallback');
  });

  test('the LLM prompt is pinned to THE TARGET when a reflective answer exists', () => {
    const { resolveTarget } = require('../../bot/shared/services/coaching/target-resolver');
    const a = urduLesson();
    const p = buildPrompt('ur', a, { question: 'q', answer: 'میں بچوں کو اگلا قدم بتاؤں گی' }, resolveTarget(a));
    expect(p).toContain('THE TARGET');
    expect(p).toContain('C3');
    expect(p).toContain('Effective Feedback');
  });

  test('the LLM path receives the target (executed, not just defined)', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ commitment: 'c', action: 'a', lesson_label: 'l', highlights: [] }) } }],
    });
    await generateCommitmentCard(urduLesson(), { questions: [{ question_number: '1', answer: 'A meaningful reflective answer.' }] }, 'en', { teacherName: 'Qurat' });
    const sent = mockOpenAI.chat.completions.create.mock.calls[0][0].messages[0].content;
    expect(sent).toContain('THE TARGET');
    expect(sent).toContain('C3');
  });
});

describe('narrative horizon = the target', () => {
  const { buildPrompt } = require('../../bot/shared/services/coaching/report-v2/narrative.service');
  const { resolveTarget } = require('../../bot/shared/services/coaching/target-resolver');

  test('with a target the horizon instruction names the indicator, not the lowest domain', () => {
    const a = urduLesson();
    const p = buildPrompt(a, { transcript: 't', trend: [], language: 'en', teacherName: 'Qurat', target: resolveTarget(a) });
    expect(p).toContain('Effective Feedback');
    expect(p).toContain('MANDATORY horizon focus');
    expect(p).not.toContain('LOWEST-SCORING domain');
  });

  test('without a target the previous behaviour stands', () => {
    const p = buildPrompt(urduLesson(), { transcript: 't', trend: [], language: 'en', teacherName: 'Qurat' });
    expect(p).toContain('LOWEST-SCORING domain');
  });
});

describe('hero report — the service hands the target to the narrative', () => {
  jest.mock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn(async () => []) }));
  jest.mock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
  jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn(async () => Buffer.from('png')) }));
  const mockNarrative = jest.fn(async () => ({ affirmation: 'x', moments: [] }));
  jest.mock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
    generateReportNarrative: (...a) => mockNarrative(...a),
    fixCodeswitch: (s) => s,
  }));

  test('generateHeroReport resolves the target from the analysis and passes it to the narrative pass', async () => {
    const { generateHeroReport } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    await generateHeroReport({ id: 's1', user_id: 'u1', transcript_text: 't', created_at: '2026-09-03' }, urduLesson(), { teacherName: 'Qurat', language: 'en', brand: 'niete' });
    const opts = mockNarrative.mock.calls[0][1];
    expect(opts.target && opts.target.indicator).toBe('C3');
  });
});

describe('report-generator hands the same target to the hero renderer', () => {
  const SRC = require('fs').readFileSync(require.resolve('../../bot/shared/services/coaching/report-generator.service'), 'utf8');
  test('generatePDFReport puts resolveTarget(analysis) on _heroInput.opts', () => {
    const body = SRC.slice(SRC.indexOf('static async generatePDFReport'));
    expect(body).toMatch(/target:[^\n]*resolveTarget\(analysisForTransformer\)/);
  });
});
