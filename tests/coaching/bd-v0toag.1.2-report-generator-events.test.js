'use strict';
/**
 * bd-v0toag.1.2 / .1.3 wiring — generateReport emits coaching.report.generated (voice-note seconds + report
 * text length) once the report is rendered, and coaching.report.sent only after WhatsApp took it.
 */
const mockLogEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  ...jest.requireActual('../../bot/shared/utils/structured-logger'), logEvent: (...a) => mockLogEvent(...a),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendImage: jest.fn(async () => true), sendImageFromUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true), sendDocument: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-ul' }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadReportImage: jest.fn(async () => 'https://r2.example/report.png'), uploadReportPDF: jest.fn(async () => 'https://r2.example/report.pdf'),
  uploadImageWithRetry: jest.fn(async () => 'https://r2.example/card.png'), uploadVoiceDebrief: jest.fn(async () => 'https://r2.example/voice.mp3'),
}));
const mockCard = jest.fn(async () => ({ _source: 'llm', commitment: 'c', action: 'Next class, when a child answers wrongly, name the next step.', language: 'ur', indicator: 'C3' }));
jest.mock('../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({ generateCommitmentCard: (...a) => mockCard(...a) }));
jest.mock('../../bot/shared/config/coaching-card.config', () => ({ getCoachingCardCopy: jest.fn(() => ({ commitPrompt: 'Will you try this?', commitButtons: { yes: 'Yes', later: 'Later', no: 'No' }, cardFooter: 'Human Coach' })) }));
const mockLoadPrior = jest.fn(async () => null);
jest.mock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadPriorAction: (...a) => mockLoadPrior(...a), loadTrendData: jest.fn(async () => []), loadRecentSectionBModes: jest.fn(async () => []) }));

const updates = [];
const ok = (id, score) => ({ id, name: id, score, applicable: true });
const ANALYSIS = {
  framework: 'fico',
  domains: {
    lesson_plan_fidelity: { indicators: [ok('B1', 2)] },
    high_leverage_practices: { indicators: [ok('C1', 2), ok('C3', 1)] },
    student_engagement: { indicators: [ok('D2', 2)] },
    teacher_subject_knowledge: { indicators: [ok('F1', 2)] },
  },
  focus_area: { domain: 'high_leverage_practices', indicator: 'C3', try_this_tomorrow: 'ہر غلط جواب کے بعد اگلا قدم بتائیں' },
  uptake: { count: { specific_feedback_moves: 2, next_step_feedback: 0 }, evidence: 'Quote: "…"', moment: 'minute 12' },
};
const mockSessionRow = {
  id: 'sess-1', user_id: '0b9c3f1e-1111-4222-8333-444444444444', audio_duration_seconds: 1799.6, status: 'analysis_complete', created_at: '2026-09-03T00:00:00Z',
  conversation_state: { questions: [] }, analysis_data: ANALYSIS, transcript_language: 'ur',
  users: { phone_number: '10000000000', name: 'Sana N', region: 'ICT', preferred_language: 'ur' },
};
jest.mock('../../bot/shared/config/supabase', () => {
  const makeChain = () => {
    const chain = {};
    ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    chain.single = jest.fn(async () => ({ data: mockSessionRow, error: null }));
    chain.maybeSingle = jest.fn(async () => ({ data: mockSessionRow, error: null }));
    chain.update = jest.fn((payload) => { updates.push(payload); return chain; });
    chain.then = (resolve) => resolve({ data: null, error: null });
    return chain;
  };
  return { from: jest.fn(() => makeChain()) };
});

const RG = require('../../bot/shared/services/coaching/report-generator.service');
const UID = '0b9c3f1e-1111-4222-8333-444444444444';
const events = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeEach(() => {
  updates.length = 0; jest.clearAllMocks(); mockLogEvent.mockClear();
  jest.spyOn(RG, 'enhanceAnalysisWithReflections').mockResolvedValue(JSON.parse(JSON.stringify(ANALYSIS)));
  jest.spyOn(RG, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'سبق اچھا تھا', narrative: { headline: 'abcd' } });
  jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue(true);
  jest.spyOn(RG, 'sendPDFReport').mockResolvedValue(true);
  jest.spyOn(RG, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

test('image report: generated carries the voice-note duration and the caption length, then sent', async () => {
  await RG.generateReport('sess-1', { from: '10000000000' });
  expect(events('coaching.report.generated')).toEqual([{
    userId: UID, sessionId: 'sess-1', format: 'image', audioDurationSec: 1800, reportChars: 12, narrativeChars: 4,
  }]);
  expect(events('coaching.report.sent')).toEqual([{ userId: UID, sessionId: 'sess-1', format: 'image' }]);
});

test('a duplicate hero send (already delivered) is not logged as sent again', async () => {
  RG.sendHeroImageReport.mockResolvedValue(false);
  await RG.generateReport('sess-1', { from: '10000000000' });
  expect(events('coaching.report.generated')).toHaveLength(1);
  expect(events('coaching.report.sent')).toEqual([]);
});

test('PDF report: generated with null text lengths, then sent as pdf', async () => {
  RG.generatePDFReport.mockResolvedValue(Buffer.from('%PDF'));
  await RG.generateReport('sess-1', { from: '10000000000' });
  expect(events('coaching.report.generated')[0]).toMatchObject({ format: 'pdf', audioDurationSec: 1800, reportChars: null });
  expect(events('coaching.report.sent')).toEqual([{ userId: UID, sessionId: 'sess-1', format: 'pdf' }]);
});
