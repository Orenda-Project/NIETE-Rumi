'use strict';
/**
 * bd-pw1ccr.11 — processAnalysis hands every finished recording to the topic-end nudge's recording trigger.
 *
 * The hook sits after the analysis_complete write and before the leader-observation fork, so it covers a WhatsApp
 * recording and a portal recording alike; the recording module itself turns a leader observation away (its own
 * test, tests/lp-v8/topic-end-nudge-recording.test.js). A nudge that throws never costs the teacher her report.
 * Same harness as bd-9h2mm-processor-marks-section-b: the real processAnalysis, network boundaries mocked.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder), not: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' } }, error: null })),
    then: (resolve) => resolve({ data: global.__ARMED === undefined ? null : global.__ARMED, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve()), sendSticker: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(() => Promise.resolve()), markAsFailed: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({
  fetchAndCompressPriorFeedback: jest.fn(() => Promise.resolve({ exists: false })),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({ getCoachingMessage: jest.fn(() => 'msg') }));
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({
  selectFrameworkWithReason: jest.fn(() => Promise.resolve({
    framework: require('../../bot/shared/services/coaching/frameworks/fico-framework'),
    frameworkKey: 'fico',
    reason: 'default',
  })),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(() => {
    const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
    return Promise.resolve({ analysis: fico.computeScores({ framework: 'fico', domains: {} }), usage: { cost: 0 } });
  }),
  extractReflectiveCorpus: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator', () => ({
  isFidelityEnabled: jest.fn(() => false),
  resolveFidelitySources: jest.fn(() => Promise.resolve({ ok: false })),
  computeLpFidelity: jest.fn(() => Promise.resolve(null)),
  fidelityPatch: jest.fn(() => ({})),
}));
jest.mock('../../bot/shared/services/nudges/topic-end-recording', () => ({
  onRecording: jest.fn(() => Promise.resolve({ scheduled: true })),
}));

const Recording = require('../../bot/shared/services/nudges/topic-end-recording');
const Reflective = require('../../bot/shared/services/coaching/reflective-conversation.service');
const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');

const SID = 'sess-rec';
beforeEach(() => {
  jest.clearAllMocks();
  global.__ARMED = undefined;
  global.__SESSION = {
    id: SID, user_id: 'u1', observation_type: null, created_at: '2026-11-02T06:00:00Z',
    transcript_text: 't', transcript_language: 'en', classroom_photos: [],
    lesson_plan_structured: { _fidelity_ref: { lesson_id: 'grade_1_english_ch4_seg5' } },
    users: { phone_number: '92300', name: 'A B' },
  };
});

test('a finished recording is handed to the recording trigger, with its session row', async () => {
  await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
  expect(Recording.onRecording).toHaveBeenCalledTimes(1);
  expect(Recording.onRecording.mock.calls[0][0].session).toEqual(expect.objectContaining({
    id: SID, user_id: 'u1', created_at: '2026-11-02T06:00:00Z',
  }));
});

test('a nudge that throws never costs her the reflection', async () => {
  Recording.onRecording.mockRejectedValueOnce(new Error('boom'));
  await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
  expect(Reflective.conductReflectiveConversation).toHaveBeenCalled();
});

test('a session that was cancelled mid-analysis is not handed over', async () => {
  global.__ARMED = [];
  await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
  expect(Recording.onRecording).not.toHaveBeenCalled();
});
