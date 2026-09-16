/**
 * bd-2369 — FICO observe prefill + edit-merge on the 1-4 scale.
 *
 * Two correctness pins that only matter now that the 37-indicator FICO form is
 * real (bd-2369):
 *
 *  1. SUMMARY, not truncation. The editable form's evidence field must show the
 *     ≤500-char `evidence_summary` (the whole gist) when present, falling back to
 *     the full `evidence`. The full evidence still reaches the teacher's report.
 *
 *  2. FICO is a 1-4 scale, NOT 0-3. The prefill + edit-merge were written for
 *     MEWAKA/HOTS (0-3) and clamped scores to Math.min(3, …). On a FICO form that
 *     silently turned every "4 · Highly Effective" the machine scored — OR the
 *     observer picked — into a 3. This pins that a 4 survives both directions.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

// Chainable supabase stub. select().eq().single() reads; update().eq() captures.
const mockStore = { session: null, freshRow: null, captured: null };
jest.mock('../../shared/config/supabase', () => ({
  from: () => ({
    select: (sel) => ({
      eq: () => ({
        single: () => Promise.resolve({
          data: sel && sel.includes('users') ? mockStore.session : mockStore.freshRow,
          error: null,
        }),
      }),
    }),
    update: (payload) => {
      mockStore.captured = payload;
      const tail = {
        eq: () => tail,
        not: () => tail,
        select: () => Promise.resolve({ data: [{ id: 'sess-1' }], error: null }),
        then: (ok, bad) => Promise.resolve({ data: [{ id: 'sess-1' }], error: null }).then(ok, bad),
      };
      return tail;
    },
  }),
}));

const draft = require('../../shared/services/observe/observe-draft.service.js');

const LONG_EVIDENCE = 'The teacher asked a genuine why-question and three students built on each other. '.repeat(12); // >600 chars
const SUMMARY = 'Open why-question; 3 students built on each other. Quote: "kyun aisa hota hai?"';

describe('bd-2369 — buildScreenPrefill (FICO 1-4, summary-first)', () => {
  const analysis = {
    domains: {
      lesson_plan_fidelity: {
        indicators: [
          { id: 'B1', score: 4, evidence: LONG_EVIDENCE, evidence_summary: SUMMARY, improvement: 'Push wait-time' },
          { id: 'B2', score: 2, evidence: 'Only a partial recap.', improvement: '' }, // no summary → falls back
        ],
      },
    },
  };

  test('shows the ≤500-char evidence_summary on the form when present', () => {
    const data = draft.buildScreenPrefill(analysis, 'lesson_plan_fidelity');
    expect(data.e_B1).toBe(SUMMARY);
    expect(data.e_B1.length).toBeLessThanOrEqual(600);
  });

  test('falls back to full evidence when no summary exists', () => {
    const data = draft.buildScreenPrefill(analysis, 'lesson_plan_fidelity');
    expect(data.e_B2).toBe('Only a partial recap.');
  });

  test('a machine score of 4 is preserved (never clamped to 3)', () => {
    const data = draft.buildScreenPrefill(analysis, 'lesson_plan_fidelity');
    expect(data.s_B1).toBe('4');
    expect(data.s_B2).toBe('2');
  });
});

describe('bd-2369 — applyObserverEdits preserves an observer 4 on the 1-4 scale', () => {
  beforeEach(() => {
    const seed = {
      domains: {
        lesson_plan_fidelity: {
          indicators: [{ id: 'B1', score: 3, evidence: 'x', evidence_sw: 'x', improvement_sw: '' }],
        },
      },
    };
    mockStore.session = {
      id: 's1',
      autofill_analysis_data: JSON.parse(JSON.stringify(seed)),
      analysis_data: JSON.parse(JSON.stringify(seed)),
    };
    mockStore.freshRow = { analysis_data: JSON.parse(JSON.stringify(seed)) };
    mockStore.captured = null;
  });

  test("observer picks '4 · Highly Effective' → persisted score is 4, not 3", async () => {
    await draft.applyObserverEdits('s1', { r_B1: '4' });
    const saved = mockStore.captured.analysis_data.domains.lesson_plan_fidelity.indicators[0];
    expect(saved.score).toBe(4);
  });
});
