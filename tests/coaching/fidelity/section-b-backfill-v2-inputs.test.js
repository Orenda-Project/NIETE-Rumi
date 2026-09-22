'use strict';
/**
 * bd-b3pop.9 — the Section B backfill re-grades a re-transcribed observation with the recording's audio length and the
 * photo evidence the analysis already stored, once — the same inputs the late-LP recompute gives the grader.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { backfillSession } = require('../../../bot/shared/services/coaching/fidelity/section-b-backfill.service');

test('the re-grade receives audio_duration_seconds, the stored photo evidence and one run', async () => {
  const session = {
    id: 'cs-9', status: 'completed', audio_url: 'r2://a.ogg', audio_duration_seconds: 1800, observation_type: 'coach',
    lesson_plan_structured: { _fidelity_ref: { lesson_id: 'g3_u_ch1_seg1', version_stamp: 'v8' } }, lesson_plan_text: null,
    transcript_text: 'a flat transcript with no stamps',
    analysis_data: {
      framework: 'fico', domains: {}, lp_fidelity: { status: 'ok', fidelity_pct: null },
      photo_evidence: [{ n: 2, kind: 'board', visible_text: 'y' }],
    },
  };
  const seen = [];
  await backfillSession('cs-9', {
    loadSession: async () => session,
    downloadAudio: async () => ({ path: '/nonexistent/a.ogg' }),
    transcribe: async () => ({ transcript: '[00:10] a\n\n[01:00] b', diarization: [] }),
    computeLpFidelity: async (input) => { seen.push(input); return { status: 'ok', fidelity_pct: 55, moves: [], meta: {} }; },
    applyLpFidelity: (a) => a,
    persist: async () => ({ ok: true }),
    probeDuration: async () => 1800,
    log: () => {},
    now: () => new Date('2026-09-15T00:00:00Z'),
    dryRun: true,
  });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ transcript: '[00:10] a\n\n[01:00] b', audioDurationSeconds: 1800, photoEvidence: [{ n: 2, kind: 'board', visible_text: 'y' }], runs: 1 });
});
