'use strict';
/**
 * bd-gzfdu9 — hook A in report-generator.service.js.
 * (1) Flag off: the report pipeline's every WhatsApp call, DB call, DB write and log line is identical to the
 *     pipeline with the engine stubbed out (today's code) — and nothing touches the video tables or the LLM.
 * (2) Flag on: the engine is started once with the session, the analysis, the ONE next step and the card, and
 *     it is NOT awaited before the report: a recommendation that never finishes cannot delay or block it.
 * Harness: tests/coaching/bd-v0toag.1.5-one-next-step.test.js.
 */
jest.mock('../../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendImage: jest.fn(async () => true), sendImageFromUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true), sendDocument: jest.fn(async () => true),
}));
const mockLog = jest.fn();
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-vr' }));
jest.mock('../../../bot/shared/storage/r2', () => ({
  uploadReportImage: jest.fn(async () => 'https://r2.example/report.png'), uploadReportPDF: jest.fn(async () => 'https://r2.example/report.pdf'),
  uploadImageWithRetry: jest.fn(async () => 'https://r2.example/card.png'), uploadVoiceDebrief: jest.fn(async () => 'https://r2.example/voice.mp3'),
}));
jest.mock('../../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({
  generateCommitmentCard: jest.fn(async (analysis, cs, lang, opts) => ({
    _source: 'llm', commitment: 'c', action: 'Ask two why questions', language: 'ur', indicator: opts.target ? opts.target.indicator : undefined,
  })),
}));
jest.mock('../../../bot/shared/config/coaching-card.config', () => ({ getCoachingCardCopy: jest.fn(() => ({ commitPrompt: 'Will you try this?', commitButtons: { yes: 'Yes', later: 'Later', no: 'No' }, cardFooter: 'Human Coach' })) }));
jest.mock('../../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadPriorAction: jest.fn(async () => null), loadTrendData: jest.fn(async () => []), loadRecentSectionBModes: jest.fn(async () => []) }));
jest.mock('../../../bot/shared/services/coaching/ab-v10-switch', () => ({ v10Enabled: jest.fn(async () => false) }));
jest.mock('../../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn(async () => null) }));
jest.mock('../../../bot/shared/services/coaching/report-link-send', () => ({ sendReportLinkIfNew: jest.fn(async () => false) }));

const mockDb = [];
const ok = (id, name, score) => ({ id, name, score, applicable: true, evidence: `Quote: "${id}"`, evidence_summary: `${id} summary`, timestamp: '[01:00]' });
const ANALYSIS = {
  framework: 'fico',
  domains: {
    lesson_plan_fidelity: { indicators: [ok('B1', 'Objectives', 2), ok('B2', 'Lesson Structure', 0)] },
    high_leverage_practices: { indicators: [ok('C1', 'Quality Questioning', 1), ok('C3', 'Effective Feedback', 1)] },
  },
  focus_area: { domain: 'lesson_plan_fidelity', indicator: 'B2', title: 'Structure', try_this_tomorrow: 'Say "now we move to…" between steps' },
};
const mockSessionRow = {
  id: 'sess-1', user_id: 'user-1', status: 'analysis_complete', created_at: '2026-10-20T00:00:00Z',
  conversation_state: { questions: [] }, analysis_data: ANALYSIS, transcript_language: 'ur',
  diarization_data: { segments: [{ start_ms: 60000, label: 'Teacher', text: 'Now open your books' }] },
  users: { phone_number: '10000000000', name: 'Teacher B', region: 'ICT', preferred_language: 'ur' },
};
jest.mock('../../../bot/shared/config/supabase', () => {
  const makeChain = (table) => {
    const rec = [table];
    mockDb.push(rec);
    const chain = {};
    ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in', 'gte', 'upsert', 'update', 'insert'].forEach((m) => {
      chain[m] = jest.fn((...args) => { rec.push([m, JSON.stringify(args)]); return chain; });
    });
    chain.single = jest.fn(async () => { rec.push(['single']); return { data: mockSessionRow, error: null }; });
    chain.maybeSingle = jest.fn(async () => { rec.push(['maybeSingle']); return { data: null, error: null }; });
    chain.then = (resolve) => resolve({ data: null, error: null });
    return chain;
  };
  return { from: jest.fn((t) => makeChain(t)) };
});

const ENV = { ...process.env };
let RG;
let completeJson;
function load(engineStub) {
  jest.resetModules();
  mockDb.length = 0;
  mockLog.mockClear();
  if (engineStub) jest.doMock('../../../bot/shared/services/coaching/video-reco/engine', () => engineStub);
  else jest.dontMock('../../../bot/shared/services/coaching/video-reco/engine');
  RG = require('../../../bot/shared/services/coaching/report-generator.service');
  jest.spyOn(RG, 'enhanceAnalysisWithReflections').mockResolvedValue(JSON.parse(JSON.stringify(ANALYSIS)));
  jest.spyOn(RG, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
  jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue(true);
  jest.spyOn(RG, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
  completeJson = jest.spyOn(require('../../../bot/shared/services/gpt5-mini.service'), 'completeJson');
  return RG;
}
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g; // wall-clock stamps differ run to run
function trace() {
  const WA = require('../../../bot/shared/services/whatsapp.service');
  const wa = Object.fromEntries(Object.entries(WA).map(([k, f]) => [k, JSON.stringify(f.mock.calls)]));
  return {
    wa,
    hero: JSON.stringify(RG.sendHeroImageReport.mock.calls),
    pdf: JSON.stringify(RG.generatePDFReport.mock.calls.map((c) => c.slice(1))),
    db: JSON.stringify(mockDb).replace(ISO, '<ts>'),
    logs: JSON.stringify(mockLog.mock.calls.map((c) => [c[0], c[2]])).replace(ISO, '<ts>'),
  };
}
afterEach(() => { jest.restoreAllMocks(); process.env = { ...ENV }; });

test('flag off: byte-identical calls, writes, sends and logs to the pipeline without the engine; no video table, no LLM', async () => {
  delete process.env.VIDEO_RECO_ENABLED;
  load({ recommendForReport: () => Promise.resolve(null) });
  await RG.generateReport('sess-1', { from: '10000000000' });
  const before = trace();
  require('../../../bot/shared/services/whatsapp.service').sendMessage.mockClear();
  for (const f of Object.values(require('../../../bot/shared/services/whatsapp.service'))) f.mockClear();

  load(null);
  await RG.generateReport('sess-1', { from: '10000000000' });
  const after = trace();
  expect(after).toEqual(before);
  expect(after.db).not.toMatch(/video_recommendations|teacher_training_progress|video_reco_events/);
  expect(completeJson).not.toHaveBeenCalled();
});

describe('flag on (wiring)', () => {
  test('the engine is started once with the session, the analysis, the next step, the loop, the card and the retry flag', async () => {
    process.env.VIDEO_RECO_ENABLED = 'true';
    const recommendForReport = jest.fn(() => Promise.resolve(null));
    load({ recommendForReport });
    await RG.generateReport('sess-1', { from: '10000000000', attempt: 2 });
    expect(recommendForReport).toHaveBeenCalledTimes(1);
    const a = recommendForReport.mock.calls[0][0];
    expect(a.coachingSessionId).toBe('sess-1');
    expect(a.session.user_id).toBe('user-1');
    expect(a.analysis.framework).toBe('fico');
    expect(a.nextStep.target.indicator).toBe('B2');
    expect(a.card).toMatchObject({ action: 'Ask two why questions', indicator: 'B2' });
    expect(a.isRetry).toBe(true);
    expect('loop' in a).toBe(true);
  });

  test('a recommendation that never finishes does not delay or block the report', async () => {
    process.env.VIDEO_RECO_ENABLED = 'true';
    load({ recommendForReport: jest.fn(() => new Promise(() => {})) });
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(RG.generatePDFReport).toHaveBeenCalledTimes(1);
    expect(RG.sendHeroImageReport).toHaveBeenCalledTimes(1);
    expect(RG.generateAndSendVoiceDebrief).toHaveBeenCalledTimes(1);
  });
});
