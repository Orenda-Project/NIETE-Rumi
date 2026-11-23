'use strict';
/**
 * bd-ra8xu.60 — Observation Notes across the analysis step of a v6 /observe visit.
 *
 * Notes are usually typed WHILE Rumi listens (the 2-5 minutes after the recording), so they are on the row before the
 * analysis lands. The analysis write replaces analysis_data whole; like live_moves, the notes, the review-opened stamp
 * and the informed scoring are carried over from the fresh read just before it. Then the analysis-ready step starts
 * the informed scoring for a v6 visit (stored only), never for a V3 visit.
 * Harness: tests/coaching/fico17-v6-shadow.test.js (the real processAnalysis → onAnalysisReady chain).
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn((patch) => { if (patch && patch.analysis_data) global.__PERSISTED = patch.analysis_data; return builder; }),
    eq: jest.fn(() => builder), not: jest.fn(() => builder), in: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' }, region: 'Sihala' }, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve()), sendSticker: jest.fn(() => Promise.resolve()),
  sendFlow: jest.fn(() => Promise.resolve(true)), sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)), setState: jest.fn(() => Promise.resolve(true)), clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-language', () => ({ languageFor: jest.fn(async () => 'en') }));
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
    reason: 'region_default',
  })),
}));
jest.mock('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator', () => ({
  isFidelityEnabled: jest.fn(() => false),
  resolveFidelitySources: jest.fn(() => ({ corpusKey: null, uploadedText: null, meta: {} })),
  computeLpFidelity: jest.fn(() => Promise.resolve(null)),
  fidelityPatch: jest.fn(() => ({})),
  isPhotoEvidenceOn: jest.fn(() => false),
}));
jest.mock('../../bot/shared/services/coaching/fico-rubric-switch', () => ({
  dcRubric: jest.fn(() => Promise.resolve(global.__DC)),
  coachRubric: jest.fn(() => Promise.resolve('current')),
  regionOfUser: jest.fn(() => Promise.resolve('Sihala')),
  // No switch value at all (the default) is the only time isAnySet is false.
  isAnySet: jest.fn(() => Promise.resolve(global.__DC !== 'v3' && global.__DC !== undefined)),
}));

const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');

const TRANSCRIPT = '[00:10] Teacher (ur): Ali, what is half of ten?\n[00:15] Student (ur): Five.\n[30:00] Student (ur): I agree.';

function v3Analysis() {
  const domains = {};
  for (const [key, def] of Object.entries(fico.getScoringConstants().domains)) {
    domains[key] = { indicators: def.indicators.map((i) => ({ id: i.id, score: 2 })) };
  }
  return fico.computeScores({ framework: 'fico', domains });
}

function v6Reply() {
  const levels = {};
  for (const c of v6.DC_CODES) levels[c] = { result: 3, because: 'seen', evidence: [{ time: '00:15', quote: 'Five.' }] };
  const combined_evidence = {};
  for (const c of ['C3', 'C5', 'C7', 'D3', 'D4']) combined_evidence[c] = { result: null, items: [] };
  return { levels, combined_evidence };
}

const mockAnalyze = jest.fn((transcript, metadata, lp, framework) => {
  if (framework && framework.name === 'fico17_v6') {
    if (global.__V6_FAIL) return Promise.reject(new Error('v6 provider down'));
    return Promise.resolve({
      analysis: { ...framework.computeScores(v6Reply(), false, transcript), framework: 'fico17_v6' },
      usage: { input_tokens: 5, output_tokens: 5, cached_tokens: 0, cost: 0.01 },
    });
  }
  return Promise.resolve({ analysis: { ...v3Analysis(), framework: 'fico' }, usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 } });
});
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: (...args) => mockAnalyze(...args),
  extractReflectiveCorpus: jest.fn(() => Promise.resolve(null)),
}));


const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');
const Notes = require('../../bot/shared/services/observe/observation-notes');

const NOTES = [{ id: 'n1', text: 'Board work: 5 children solved sums', rec_time: null, source: 'whatsapp', typed_before_review: true, batch: 'wa:1' }];
const SID = 'sess-notes';
let informedSpy;

beforeEach(() => {
  jest.clearAllMocks();
  global.__PERSISTED = undefined;
  global.__V6_FAIL = false;
  global.__DC = 'v3';
  informedSpy = jest.spyOn(Notes, 'runInformedSoon').mockImplementation(() => Promise.resolve({ ran: false, why: 'test' }));
  global.__SESSION = {
    id: SID, user_id: 'u1', observer_user_id: 'co-1', observation_type: 'leader_observation', framework: 'fico17_v6',
    status: 'transcription_complete', transcript_text: TRANSCRIPT, transcript_language: 'ur', classroom_photos: [],
    users: { phone_number: '92300', name: 'A B' },
    analysis_data: { observation_notes: NOTES, observation_notes_review_opened_at: null },
  };
});
afterEach(() => informedSpy.mockRestore());

test('notes typed while Rumi listened survive the analysis write', async () => {
  await AnalysisProcessor.processAnalysis(SID, { from: '92300' }).catch(() => {});
  expect(global.__PERSISTED).toBeTruthy();
  expect(global.__PERSISTED.framework).toBe('fico17_v6');
  expect(global.__PERSISTED.observation_notes).toEqual(NOTES);
  // A null key is not invented.
  expect(Object.keys(global.__PERSISTED)).not.toContain('observation_notes_review_opened_at');
});

test('a row with no notes is written exactly as before (no notes keys)', async () => {
  global.__SESSION.analysis_data = null;
  await AnalysisProcessor.processAnalysis(SID, { from: '92300' }).catch(() => {});
  for (const k of Notes.CARRY_KEYS) expect(Object.keys(global.__PERSISTED)).not.toContain(k);
});

test('the analysis-ready step of a v6 visit starts the informed scoring', async () => {
  await AnalysisProcessor.processAnalysis(SID, { from: '92300' }).catch(() => {});
  expect(informedSpy).toHaveBeenCalledWith(SID);
});

test('a V3 visit never starts it', async () => {
  global.__SESSION.framework = null;
  await AnalysisProcessor.processAnalysis(SID, { from: '92300' }).catch(() => {});
  expect(informedSpy).not.toHaveBeenCalled();
});
