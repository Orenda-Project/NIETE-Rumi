'use strict';
/**
 * bd-b3pop.9 — a re-grade sees what the first grading saw: the late-LP recompute's own session loader selects the
 * recording's audio length, and the orchestrator receives it with the stored photo evidence — graded once, whatever
 * LP_FIDELITY_RUNS says (the recompute is awaited inside a webhook reply).
 */
const mockSelects = [];
jest.mock('../../../bot/shared/config/supabase', () => {
  const b = {
    select: (cols) => { mockSelects.push(cols); return b; },
    eq: () => b,
    maybeSingle: async () => ({ data: global.__RECOMPUTE_SESSION, error: null }),
  };
  return { from: () => b };
});
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { recomputeFidelityForSession } = require('../../../bot/shared/services/coaching/fidelity/fidelity-recompute.service');

test('the default loader selects audio_duration_seconds; it reaches the orchestrator with the stored photo evidence and one run', async () => {
  global.__RECOMPUTE_SESSION = {
    id: 'cs-1', status: 'awaiting_observer_review', transcript_text: '[00:10] t', audio_duration_seconds: 1234,
    lesson_plan_structured: { _fidelity_ref: { lesson_id: 'g3_u_ch1_seg1', version_stamp: 'v8' } }, lesson_plan_text: null,
    analysis_data: { framework: 'fico', domains: {}, photo_evidence: [{ n: 1, kind: 'board', visible_text: 'x' }] },
  };
  const seen = [];
  const res = await recomputeFidelityForSession('cs-1', {
    computeLpFidelity: async (input) => { seen.push(input); return { status: 'ok', fidelity_pct: 70, moves: [] }; },
    applyLpFidelity: (a) => a,
    persist: async () => ({ ok: true }),
    log: () => {},
  });
  expect(mockSelects[0]).toContain('audio_duration_seconds');
  expect(seen[0]).toMatchObject({ transcript: '[00:10] t', audioDurationSeconds: 1234, photoEvidence: [{ n: 1, kind: 'board', visible_text: 'x' }], runs: 1 });
  expect(res.recomputed).toBe(true);
});
