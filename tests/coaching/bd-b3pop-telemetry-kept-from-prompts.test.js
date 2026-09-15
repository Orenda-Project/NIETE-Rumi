'use strict';
/**
 * bd-b3pop (architecture review M1) — what the grading and the photo reader leave on an analysis never reaches the
 * teacher's voice note or the coach's debrief guide, both of which serialise the whole analysis into their prompts: a
 * run's percentage beside the card's, the spread, a photo reading or an excluded upload would all be quotable.
 */
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true), sendAudioFromUrl: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadVoiceDebrief: jest.fn(), uploadReportImage: jest.fn(), uploadReportPDF: jest.fn() }));
jest.mock('../../bot/shared/services/audio.service', () => ({ generateSpeechForLanguage: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({ determineOutputLanguage: jest.fn().mockResolvedValue('en') }));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = { update: jest.fn(() => chain), select: jest.fn(() => chain), eq: jest.fn(() => chain), single: jest.fn(() => Promise.resolve({ data: null, error: null })), then: (resolve) => resolve({ data: null, error: null }) };
  return { from: jest.fn(() => chain) };
});

const ReportGeneratorService = require('../../bot/shared/services/coaching/report-generator.service');
const { buildGuidePrompt } = require('../../bot/shared/services/observe/observe-debrief-guide');

const ANALYSIS = {
  framework: 'fico',
  domains: { lesson_plan_fidelity: { domain_score: 7, domain_max: 14 } },
  photo_vision: 'v2',
  photo_reads: [{ n: 1, status: 'read', kind: 'board' }, { n: 2, status: 'excluded', kind: 'not_a_classroom_photo' }],
  photo_evidence: [{ n: 1, kind: 'board', visible_text: 'Ali [number]' }],
  lp_fidelity: {
    status: 'ok', fidelity_pct: 75, band: 'partial',
    runs: [{ pct: 50, model: 'm' }, { pct: 75, model: 'm' }, { pct: 100, model: 'm' }], runs_requested: 3, spread: 50,
    recording: { stamps: 2, transcript_short_of_audio: true }, photo_citations: { photos: 1, moves_cited: 1 }, missing_verdicts: 0, cause: null,
    moves: [{ move_id: 'm1', verdict: 'partial', evidence: '[photo 1] board', photo_guard: 'uncorroborated', verdict_before_guard: 'executed' }],
  },
};
const HIDDEN = ['"runs"', '"runs_requested"', '"spread"', '"recording"', '"photo_citations"', '"missing_verdicts"', 'photo_reads', 'photo_evidence', 'photo_vision', 'photo_guard', 'verdict_before_guard', 'not_a_classroom_photo'];

test('the voice projection drops the telemetry and keeps the measured figure the card shows', () => {
  const { analysis } = ReportGeneratorService._projectAnalysisForVoice(ANALYSIS);
  const json = JSON.stringify(analysis);
  for (const k of HIDDEN) expect(json).not.toContain(k);
  expect(analysis.lp_fidelity).toMatchObject({ status: 'ok', fidelity_pct: 75, band: 'partial' });
  expect(analysis.lp_fidelity.moves[0]).toEqual({ move_id: 'm1', verdict: 'partial', evidence: '[photo 1] board' });
  expect(ANALYSIS.lp_fidelity.runs).toHaveLength(3);
});

test('an analysis with nothing to hide passes through as the same object', () => {
  const plain = { framework: 'fico', lp_fidelity: { status: 'ok', fidelity_pct: 40, moves: [] } };
  expect(ReportGeneratorService._projectAnalysisForVoice(plain).analysis).toBe(plain);
});

test("the coach's debrief guide prompt carries none of it", () => {
  const prompt = buildGuidePrompt(ANALYSIS, { language: 'en' });
  for (const k of HIDDEN) expect(prompt).not.toContain(k);
});
