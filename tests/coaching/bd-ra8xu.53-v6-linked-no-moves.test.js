'use strict';
/**
 * bd-ra8xu.53 — a FICO17 v6 visit linked to our own lesson that has no fidelity move list says "could not be
 * measured", never "No lesson plan was provided".
 *
 * Rifat's 13 Nov visit, once its v9 lesson id is read (bd-ra8xu.53-v9-lesson-id.test.js), links
 * gb_g4_urdu_ch2_seg3. No GB lesson has a row in niete_lp_fidelity_moves (0 of 1,000+ on prod, 14 Nov), and a
 * corpus link stores no text to extract one from, so computeLpFidelity found no moves and answered lp_absent: the
 * report would tell her no lesson plan was provided while her plan sits linked. On a FICO17 v6-stamped visit (the
 * coach switch) that case is now fidelity_unavailable (every reader already shows it as "could not be measured" and
 * keeps it out of the total). Every other visit keeps lp_absent exactly as before.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn((patch) => { if (patch && patch.analysis_data) { global.__PERSISTED = patch.analysis_data; global.__PATCH = patch; } return builder; }),
    eq: jest.fn(() => builder), not: jest.fn(() => builder), in: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' }, region: null }, error: null })),
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
    reason: 'deployment_default',
  })),
}));
jest.mock('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator', () => ({
  isFidelityEnabled: jest.fn(() => true),
  resolveFidelitySources: jest.fn(() => ({ corpusKey: { lesson_id: 'gb_g4_urdu_ch2_seg3' }, uploadedText: null, meta: {} })),
  computeLpFidelity: jest.fn(() => Promise.resolve(null)),
  fidelityPatch: jest.fn(() => ({})),
  isPhotoEvidenceOn: jest.fn(() => false),
}));
jest.mock('../../bot/shared/services/coaching/fico-rubric-switch', () => ({
  dcRubric: jest.fn(() => Promise.resolve(global.__DC)),
  coachRubric: jest.fn(() => Promise.resolve('current')),
  regionOfUser: jest.fn(() => Promise.resolve(null)),
  isAnySet: jest.fn(() => Promise.resolve(global.__DC !== 'v3' && global.__DC !== undefined)),
}));

const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');

// Timed, two halves, so the transcript gate passes and D2 can be counted.
const TRANSCRIPT = [
  '[00:10] Teacher (ur): Ali, what is half of ten?', '[00:15] Student (ur): Five.',
  '[05:00] Teacher (ur): Good. Tell your partner why.', '[05:10] Student (ur): Because two fives make ten.',
  '[15:00] Teacher (ur): Now page twenty.', '[20:00] Student (ur): I agree.', '[30:00] Student (ur): Done.',
].join('\n');

function v3Analysis() {
  const domains = {};
  for (const [key, def] of Object.entries(fico.getScoringConstants().domains)) {
    domains[key] = { indicators: def.indicators.map((i) => ({ id: i.id, score: 2 })) };
  }
  return {
    ...fico.computeScores({ framework: 'fico', domains }),
    topic: 'Halves', subject: 'maths', has_lesson_plan: false,
    focus_area: { indicator: 'C3', title: 'a V3 code: must never reach a v6 report' },
    executive_summary: 'V3 summary',
  };
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
const shadow = require('../../bot/shared/services/coaching/frameworks/fico17-v6/shadow');

const Orchestrator = jest.requireActual('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');
const noMoves = { resolveMoveList: async () => null, extractUploadedLp: async () => null };
const LINKED = { corpusKey: { lesson_id: 'gb_g4_urdu_ch2_seg3' }, transcript: '[00:01] Teacher (ur): Salaam.' };

describe('the real fidelity engine: a linked lesson with no move list', () => {
  test('on a FICO17 v6 visit: fidelity_unavailable, naming the lesson', async () => {
    const out = await Orchestrator.computeLpFidelity({ ...LINKED, distinguishUnscorable: true }, noMoves);
    expect(out).toMatchObject({ status: 'fidelity_unavailable', reason: 'no_move_list', lesson_id: 'gb_g4_urdu_ch2_seg3' });
  });
  test('anywhere else: lp_absent, as before', async () => {
    expect(await Orchestrator.computeLpFidelity(LINKED, noMoves)).toEqual({ status: 'lp_absent' });
  });
  test('no linked lesson at all stays lp_absent even on a v6 visit', async () => {
    const out = await Orchestrator.computeLpFidelity({ transcript: LINKED.transcript, distinguishUnscorable: true }, noMoves);
    expect(out).toEqual({ status: 'lp_absent' });
  });
});

const fidelity = require('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');

const SID = 'e4000296';
function session(extra) {
  return {
    id: SID, user_id: 'u-rifat', audio_duration_seconds: 743,
    transcript_text: TRANSCRIPT, transcript_language: 'ur', classroom_photos: [],
    users: { phone_number: '92300', name: 'A B', region: null },
    ...extra,
  };
}

describe('the real analysis step asks for it on a FICO17 v6 visit only', () => {
  beforeEach(() => { jest.clearAllMocks(); global.__DC = 'v3'; });

  test('a coach visit stamped FICO17 v6', async () => {
    global.__SESSION = session({ observation_type: 'leader_observation', observer_user_id: 'u-rifat', framework: 'fico17_v6' });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(fidelity.computeLpFidelity).toHaveBeenCalledTimes(1);
    expect(fidelity.computeLpFidelity.mock.calls[0][0]).toMatchObject({ distinguishUnscorable: true });
  });

  test('an unstamped visit (V3) is asked exactly as before', async () => {
    global.__SESSION = session({ observation_type: 'leader_observation', observer_user_id: 'u-other', framework: null });
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
    expect(fidelity.computeLpFidelity).toHaveBeenCalledTimes(1);
    expect(fidelity.computeLpFidelity.mock.calls[0][0].distinguishUnscorable).toBe(false);
  });
});
