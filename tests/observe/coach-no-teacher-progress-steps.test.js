'use strict';
/**
 * A coach's observation is not narrated with the teacher's coaching progress steps.
 *
 * The transcription and analysis jobs are shared between a teacher's own coaching
 * session and a leader observation. Both jobs open with a progress line written for
 * the TEACHER ("🔄 Step 1/5: Transcribing your classroom audio…", "🔄 Step 2/5:
 * Analyzing your teaching…"), in the language on the session's user row — on a
 * bound observation, the OBSERVED TEACHER's. On an observation those lines go to
 * the coach, who has just been told "🎧 Got the recording … It will arrive here in
 * 2–5 minutes" and is next sent the photo question and then the pre-filled form.
 * Production, 24-30 Sep 2026: 449 step-1 and 440 step-2 texts on observations.
 *
 * Drives the real processors; only the network boundary is stubbed (Supabase, the
 * WhatsApp sender, media download). Each job is stopped right after its progress
 * step by the media download / prior-feedback read failing, which is all a test of
 * "was the step sent" needs.
 */
const { fromMock } = require('../quiz/helpers/supabase-chain');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

const COACH_PHONE = '923001110000';
let mockSession;
const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendSticker: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  downloadMedia: jest.fn().mockRejectedValue(new Error('stop here: media download')),
};

jest.mock('../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => {
  const { fromMock: fm } = require('../quiz/helpers/supabase-chain');
  return {
    from: (...a) => fm({
      coaching_sessions: () => ({ data: mockSession, error: null }),
      users: () => ({ data: mockSession && mockSession.users, error: null }),
    })(...a),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
});

const SESSION = (observationType, language) => ({
  id: 'cs-1',
  user_id: 'teacher-1',
  observer_user_id: observationType ? 'coach-1' : null,
  observation_type: observationType,
  status: 'pending',
  transcript_text: 'x',
  users: { phone_number: COACH_PHONE, name: 'T', preferred_language: language },
});

const sentTexts = () => mockWa.sendMessage.mock.calls.map(([, body]) => String(body));

beforeEach(() => {
  jest.clearAllMocks();
  mockWa.downloadMedia.mockRejectedValue(new Error('stop here: media download'));
});

describe('Step 1/5 (transcription start)', () => {
  const Transcription = () => require('../../bot/shared/services/coaching/transcription-processor.service');

  test.each(['en', 'ur'])('a leader observation does NOT get it (%s)', async (lang) => {
    mockSession = SESSION('leader_observation', lang);
    await Transcription().processTranscription('cs-1', { from: COACH_PHONE, audioId: 'a1' }).catch(() => {});
    expect(sentTexts()).not.toContain(getCoachingMessage('step1_transcribing', lang));
  });

  test.each(['en', 'ur'])('a teacher\'s own coaching session still does (%s)', async (lang) => {
    mockSession = SESSION(null, lang);
    await Transcription().processTranscription('cs-1', { from: COACH_PHONE, audioId: 'a1' }).catch(() => {});
    expect(sentTexts()).toContain(getCoachingMessage('step1_transcribing', lang));
  });
});

describe('Step 2/5 (analysis start)', () => {
  const Analysis = () => require('../../bot/shared/services/coaching/analysis-processor.service');

  test.each(['en', 'ur'])('a leader observation does NOT get it (%s)', async (lang) => {
    mockSession = SESSION('leader_observation', lang);
    await Analysis().processAnalysis('cs-1', { from: COACH_PHONE }).catch(() => {});
    expect(sentTexts()).not.toContain(getCoachingMessage('step2_analyzing', lang));
  });

  test.each(['en', 'ur'])('a teacher\'s own coaching session still does (%s)', async (lang) => {
    mockSession = SESSION(null, lang);
    await Analysis().processAnalysis('cs-1', { from: COACH_PHONE }).catch(() => {});
    expect(sentTexts()).toContain(getCoachingMessage('step2_analyzing', lang));
  });
});

// Keep the helper import honest: the chain stub is what answers every read above.
test('the Supabase stub is the chain helper', () => { expect(typeof fromMock).toBe('function'); });
