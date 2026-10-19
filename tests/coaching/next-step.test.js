/**
 * bd-v0toag.1.5 — ONE next step per report: the selector (pure) and the stored-focus write.
 *
 * The live 7 Oct report named three: the horizon said "Structured Peer Discussion", the try box
 * named B6 (prioritized_action._source 'fallback'), and the session stored focus_area C1, which
 * nothing drew. The scorer's focus_area did not resolve, so the horizon went unpinned, the card
 * picked the weakest row on its own, and the stored focus stayed as the scorer wrote it.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
const mockOpenAI = { chat: { completions: { create: jest.fn(async () => { throw new Error('no LLM in this test'); }) } } };
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: mockOpenAI }));

const { selectNextStep, focusPatch, cardTarget } = require('../../bot/shared/services/coaching/next-step');
const { persistNextStepFocus } = require('../../bot/shared/services/coaching/next-step-store');

const ok = (id, name, score) => ({ id, name, score, applicable: true, evidence: 'Quote: "…"' });
const NA = (id, name) => ({ id, name, score: null, applicable: false, evidence: 'Not applicable' });

/** The live report's shape: scorer chose C1, but C1 did not resolve in this analysis; B6 is the weakest row. */
function liveLesson(overrides = {}) {
  return {
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: [ok('B1', 'Instructional Clarity & Learning Objectives', 2), ok('B6', 'Differentiation / Catering to Learning Levels', 0)] },
      high_leverage_practices: { indicators: [NA('C1', 'Quality Questioning (Bloom\'s Aligned)'), ok('C3', 'Effective Feedback', 1)] },
      student_engagement: { indicators: [ok('D1', 'Diversity of Conceptual Expression', 1)] },
    },
    focus_area: { domain: 'high_leverage_practices', indicator: 'C1', title: 'کھلے سوالات کی مشق', rationale: 'r', try_this_tomorrow: 'سبق سے ایک open-ended سوال تیار کیا جائے اور 5 سیکنڈ انتظار کیا جائے' },
    ...overrides,
  };
}

describe('selectNextStep — one step, chosen once', () => {
  test('a valid focus_area is the step, not a fallback', () => {
    const a = liveLesson({ focus_area: { domain: 'high_leverage_practices', indicator: 'C3', try_this_tomorrow: 'ہر غلط جواب کے بعد اگلا قدم بتائیں۔' } });
    const s = selectNextStep(a, null);
    expect(s.fallback).toBe(false);
    expect(s.target).toMatchObject({ indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback' });
  });

  test('a focus_area that does not resolve falls back to the weakest row, resolved like any target, and says why', () => {
    const s = selectNextStep(liveLesson(), null);
    expect(s.fallback).toBe(true);
    expect(s.reason).toBe('focus_area_invalid');
    expect(s.scorerIndicator).toBe('C1');
    expect(s.target).toMatchObject({ indicator: 'B6', domain: 'lesson_plan_fidelity', name: 'Differentiation / Catering to Learning Levels', rung: 0 });
    // The scorer's move was for C1 — it must not ride along on B6.
    expect(s.target.try).toBe('');
  });

  test('no focus_area at all → reason no_focus_area, same weakest pick', () => {
    const s = selectNextStep(liveLesson({ focus_area: undefined }), null);
    expect(s).toMatchObject({ fallback: true, reason: 'no_focus_area', scorerIndicator: null });
    expect(s.target.indicator).toBe('B6');
  });

  test('nothing scorable (non-domain framework) → no target, as before', () => {
    const s = selectNextStep({ framework: 'hots', areas: { a: { indicators: [{ id: 'H1', name: 'x', score: 1 }] } } }, null);
    expect(s.target).toBeNull();
    expect(s.fallback).toBe(true);
  });

  test('a sticky loop target wins over the focus_area', () => {
    const a = liveLesson({ focus_area: { indicator: 'C3', try_this_tomorrow: 'ہر غلط جواب کے بعد اگلا قدم بتائیں۔' } });
    const s = selectNextStep(a, { state: { target: { indicator: 'D1' }, bridge: false } });
    expect(s).toMatchObject({ fallback: false, target: { indicator: 'D1' } });
  });

  test('a bridge lesson coaches this lesson\'s own focus — the horizon follows the card, not the open loop target', () => {
    const a = liveLesson({ focus_area: { indicator: 'C3', try_this_tomorrow: 'ہر غلط جواب کے بعد اگلا قدم بتائیں۔' } });
    const s = selectNextStep(a, { state: { target: { indicator: 'D1' }, bridge: true } });
    expect(s.target.indicator).toBe('C3');
  });

  test('cardTarget is the same function the commitment card exports', () => {
    const card = require('../../bot/shared/services/coaching/coaching-card/commitment-card.service');
    expect(card.cardTarget).toBe(cardTarget);
  });
});

describe('focusPatch — the stored focus is the step', () => {
  test('a different step rewrites focus_area and keeps the scorer\'s pick beside it', () => {
    const a = liveLesson();
    const p = focusPatch(a, selectNextStep(a, null).target);
    expect(p.focus_area).toMatchObject({ indicator: 'B6', domain: 'lesson_plan_fidelity', title: 'Differentiation / Catering to Learning Levels', selected_by: 'next_step' });
    expect(p.focus_area_scorer).toEqual(a.focus_area);
  });

  test('null when the step already is the stored focus, or has no indicator (phase / none)', () => {
    const a = liveLesson({ focus_area: { indicator: 'C3', try_this_tomorrow: 'ہر غلط جواب کے بعد اگلا قدم بتائیں۔' } });
    expect(focusPatch(a, selectNextStep(a, null).target)).toBeNull();
    expect(focusPatch(a, { kind: 'phase', name: 'Practice' })).toBeNull();
    expect(focusPatch(a, null)).toBeNull();
  });

  test('a second run keeps the FIRST scorer pick, never the already-rewritten one', () => {
    const a = liveLesson();
    const first = focusPatch(a, selectNextStep(a, null).target);
    const again = focusPatch({ ...a, ...first }, { indicator: 'C3', domain: 'high_leverage_practices', name: 'Effective Feedback', try: '', title: '', rationale: '' });
    expect(again.focus_area_scorer.indicator).toBe('C1');
  });
});

describe('persistNextStepFocus — read-merge-write, non-fatal', () => {
  function fakeSupabase(row, { failRead = false, failUpdate = false } = {}) {
    const writes = [];
    const from = () => {
      const q = {};
      q.select = () => q; q.eq = () => q;
      q.single = async () => (failRead ? { data: null, error: { message: 'down' } } : { data: row, error: null });
      q.update = (patch) => { writes.push(patch); return { eq: async () => ({ error: failUpdate ? { message: 'nope' } : null }) }; };
      return q;
    };
    return { from, writes };
  }

  test('merges the patch and keeps every other analysis_data key (voice script, narrative)', async () => {
    const sb = fakeSupabase({ analysis_data: { framework: 'fico', voice_debrief_script: 'v', focus_area: { indicator: 'C1' } } });
    const patch = { focus_area: { indicator: 'B6' }, focus_area_scorer: { indicator: 'C1' } };
    expect(await persistNextStepFocus('s1', patch, { supabase: sb, log: jest.fn() })).toBe(true);
    expect(sb.writes).toEqual([{ analysis_data: { framework: 'fico', voice_debrief_script: 'v', focus_area: { indicator: 'B6' }, focus_area_scorer: { indicator: 'C1' } } }]);
  });

  test('no patch → no write', async () => {
    const sb = fakeSupabase({ analysis_data: {} });
    expect(await persistNextStepFocus('s1', null, { supabase: sb, log: jest.fn() })).toBe(false);
    expect(sb.writes).toHaveLength(0);
  });

  test('a failed read or write is logged with the session id and does not throw', async () => {
    for (const opts of [{ failRead: true }, { failUpdate: true }]) {
      const log = jest.fn();
      const sb = fakeSupabase({ analysis_data: {} }, opts);
      expect(await persistNextStepFocus('s1', { focus_area: { indicator: 'B6' } }, { supabase: sb, log })).toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('[next-step]'), expect.objectContaining({ coachingSessionId: 's1' }), 'warn');
    }
  });
});

describe('commitment card — the rule-based card names the selected step', () => {
  const { generateCommitmentCard } = require('../../bot/shared/services/coaching/coaching-card/commitment-card.service');
  const { resolveIndicator } = require('../../bot/shared/services/coaching/target-resolver');

  test('a target with no usable move and no loop: the template is about THAT indicator, not the weakest row', async () => {
    const a = liveLesson({ focus_area: { domain: 'high_leverage_practices', indicator: 'C3', try_this_tomorrow: 'x' } });
    const out = await generateCommitmentCard(a, { questions: [] }, 'en', { teacherName: 'B' });
    expect(out._source).toBe('fallback');
    expect(out.indicator).toBe('Effective Feedback (C3)');
  });

  test('opts.target is used as given (the step the report already selected)', async () => {
    const a = liveLesson();
    const out = await generateCommitmentCard(a, { questions: [] }, 'en', { teacherName: 'B', target: resolveIndicator(a, 'C3') });
    expect(out.indicator).toBe('Effective Feedback (C3)');
  });

  test('the fallback-selected step and the rule-based card agree (the live B6 case)', async () => {
    const a = liveLesson();
    const out = await generateCommitmentCard(a, { questions: [] }, 'en', { teacherName: 'B', target: selectNextStep(a, null).target });
    expect(out.indicator).toBe('Differentiation / Catering to Learning Levels (B6)');
  });
});
