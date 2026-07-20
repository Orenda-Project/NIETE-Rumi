/**
 * bd-2138 — the /observe fork inside the SHARED coaching pipeline.
 *
 * BUG (2026-07-20, Riffat/NIETE ICT prod): the observe/ stack was ported to
 * NIETE but the three fork points that live INSIDE the shared coaching
 * pipeline were not. A leader's /observe recording was therefore transcribed
 * and then handed to the TEACHER pipeline: she got the encouraging message
 * ("your 0-minute recording"), the classroom-photo ask, the lesson-plan gate,
 * and finally a 16-second generic reflective voice note — instead of the
 * editable pre-filled FICO form.
 *
 * The fork is derived from the session ROW (observation_type), never the queue
 * payload, so a retry or a re-claim can never lose observe-ness.
 */

jest.mock('../../shared/config/supabase');
jest.mock('../../shared/services/whatsapp.service');
// Factory (not automock) — the real module builds an OpenAI/OpenRouter client at
// require time, which needs credentials the test must never depend on.
jest.mock('../../shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: jest.fn(),
  extractReflectiveCorpus: jest.fn(),
}));
jest.mock('../../shared/services/coaching/coaching-session.service');
jest.mock('../../shared/services/coaching/report-generator.service');
jest.mock('../../shared/services/coaching/reflective-conversation.service');
jest.mock('../../shared/services/observe/observe-draft.service');
jest.mock('../../shared/services/coaching/frameworks/framework-selector');
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const GPT5MiniService = require('../../shared/services/gpt5-mini.service');
const CoachingSessionService = require('../../shared/services/coaching/coaching-session.service');
const ReportGeneratorService = require('../../shared/services/coaching/report-generator.service');
const ReflectiveConversationService = require('../../shared/services/coaching/reflective-conversation.service');
const ObserveDraft = require('../../shared/services/observe/observe-draft.service');
const { selectFrameworkWithReason } = require('../../shared/services/coaching/frameworks/framework-selector');

const AnalysisProcessor = require('../../shared/services/coaching/analysis-processor.service');

const SESSION_ID = 'sess-observe-1';

/** Chainable supabase stub: .from().select().eq().single() and .from().update().eq() */
function stubSupabase(sessionRow) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    update: jest.fn(() => chain),
    single: jest.fn(async () => ({ data: sessionRow, error: null })),
    then: undefined,
  };
  supabase.from = jest.fn(() => chain);
  return chain;
}

function sessionRow(overrides = {}) {
  return {
    id: SESSION_ID,
    user_id: 'observer-uuid',
    transcript_text: 'Good morning class, today we are learning fractions.',
    transcript_language: 'en',
    audio_duration_seconds: 1200,
    users: { phone_number: '923001234567', first_name: 'Riffat', last_name: 'A' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  CoachingSessionService.updateStatus = jest.fn().mockResolvedValue(true);
  ReportGeneratorService.fetchAndCompressPriorFeedback = jest
    .fn()
    .mockResolvedValue({ sessionCount: 0, compressed: false, formattedText: null });
  WhatsAppService.sendMessage = jest.fn().mockResolvedValue(true);
  WhatsAppService.sendAudio = jest.fn().mockResolvedValue(true);

  selectFrameworkWithReason.mockResolvedValue({
    framework: { name: 'FICO' },
    frameworkKey: 'fico',
    reason: 'deployment_default',
  });

  GPT5MiniService.analyzePedagogy = jest.fn().mockResolvedValue({
    analysis: { domains: {} },
    usage: { cost: 0.01, input_tokens: 1, output_tokens: 1, cached_tokens: 0 },
  });
  GPT5MiniService.extractReflectiveCorpus = jest.fn().mockResolvedValue(null);

  ObserveDraft.onAnalysisReady = jest.fn().mockResolvedValue(true);
  ReflectiveConversationService.conductReflectiveConversation = jest.fn().mockResolvedValue(true);
});

describe('bd-2138 — analysis forks to the FICO draft for a leader observation', () => {
  test('leader observation → sends the editable draft flow, NEVER the reflective conversation', async () => {
    stubSupabase(sessionRow({ observation_type: 'leader_observation', observer_user_id: 'observer-uuid' }));

    await AnalysisProcessor.processAnalysis(SESSION_ID, { from: '923001234567' });

    // The whole point: the observer gets the pre-filled FICO form.
    expect(ObserveDraft.onAnalysisReady).toHaveBeenCalledWith(SESSION_ID, '923001234567');

    // ...and is never dropped into the teacher's reflective voice-note loop,
    // which is exactly what Riffat received on 2026-07-20.
    expect(ReflectiveConversationService.conductReflectiveConversation).not.toHaveBeenCalled();
  });

  test('a normal teacher session is untouched — still runs the reflective conversation', async () => {
    stubSupabase(sessionRow({ observation_type: null }));

    await AnalysisProcessor.processAnalysis(SESSION_ID, { from: '923001234567' });

    expect(ReflectiveConversationService.conductReflectiveConversation).toHaveBeenCalled();
    expect(ObserveDraft.onAnalysisReady).not.toHaveBeenCalled();
  });

  test('observe-ness comes from the ROW, not the payload (retry-safe)', async () => {
    stubSupabase(sessionRow({ observation_type: 'leader_observation' }));

    // Payload says nothing about observe — the row alone must decide.
    await AnalysisProcessor.processAnalysis(SESSION_ID, {});

    expect(ObserveDraft.onAnalysisReady).toHaveBeenCalled();
    expect(ReflectiveConversationService.conductReflectiveConversation).not.toHaveBeenCalled();
  });
});
