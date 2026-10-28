'use strict';
/**
 * bd-v0toag.126 — the quiz offer is refused (131047) when the teacher's 24 h window is closed.
 *
 * When her window is closed the coaching report goes as the `share_dc_report_v1` template (bd-v0toag.106), but the
 * quiz offer queued after it still went free-form: video/buttons that Meta refuses with 131047 (46 of the 139
 * post-27 Oct 131047s). The fix: processOffer checks the window before it claims the row. Closed → nothing is
 * claimed, digested or sent, and the teacher stays eligible for the offer on a later report (or /quiz).
 */
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/quiz-delivery.service', () => ({ _hasOpenMessageWindow: jest.fn() }));
jest.mock('../../shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(false),
  introShownCount: jest.fn().mockResolvedValue(5),
  markVideoShown: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../shared/services/quiz/quiz-funnel', () => ({ emit: jest.fn(), channelOf: jest.fn(() => 'offer') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const QuizDelivery = require('../../shared/services/quiz/quiz-delivery.service');
const FeatureIntro = require('../../shared/services/feature-intro.service');
const Digest = require('../../shared/services/quiz/transcript-quiz-digest.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const Offer = require('../../shared/services/quiz/transcript-quiz-offer.service');

const SESSION = {
  id: 'cs-1', user_id: 'u-1', status: 'completed', observation_type: null,
  transcript_text: 'x'.repeat(2000), transcript_language: 'ur', analysis_data: {}, created_at: '2026-10-27T08:00:00Z',
  users: { id: 'u-1', name: 'T', phone_number: '920000000000', preferred_language: 'ur' },
};

let inserts;
beforeEach(() => {
  jest.clearAllMocks();
  inserts = [];
  supabase.from.mockImplementation(() => {
    const chain = {
      select: () => chain, eq: () => chain,
      maybeSingle: async () => ({ data: SESSION, error: null }),
      insert: (row) => { inserts.push(row); return chain; },
      single: async () => ({ data: { id: 'q-1' }, error: null }),
      update: () => chain,
      then: (res) => res({ data: null, error: null }),
    };
    return chain;
  });
  Digest.run.mockResolvedValue({
    digest: { confidence: 0.9, slos: ['a', 'b'], language_of_instruction: 'ur', subject: 'urdu' },
    grade: 3, model: 'm', costUsd: 0,
  });
});

test('window closed → no claim, no digest, no send, logs window_closed', async () => {
  QuizDelivery._hasOpenMessageWindow.mockResolvedValue(false);
  const out = await Offer.processOffer('cs-1', { phone: '920000000000' });
  expect(out).toEqual({ skipped: 'window_closed' });
  expect(QuizDelivery._hasOpenMessageWindow).toHaveBeenCalledWith('920000000000');
  expect(inserts).toHaveLength(0);
  expect(Digest.run).not.toHaveBeenCalled();
  expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  expect(WhatsAppService.sendVideoWithButtons).not.toHaveBeenCalled();
  expect(FeatureIntro.markVideoShown).not.toHaveBeenCalled();
  expect(logEvent).toHaveBeenCalledWith('transcript_quiz.skipped', { coachingSessionId: 'cs-1', reason: 'window_closed' });
});

test('window closed, no phone in the payload → checks the teacher\'s own number', async () => {
  QuizDelivery._hasOpenMessageWindow.mockResolvedValue(false);
  await Offer.processOffer('cs-1', { early: true });
  expect(QuizDelivery._hasOpenMessageWindow).toHaveBeenCalledWith('920000000000');
  expect(inserts).toHaveLength(0);
});

test('window open → claims and sends the offer as before', async () => {
  QuizDelivery._hasOpenMessageWindow.mockResolvedValue(true);
  await Offer.processOffer('cs-1', { phone: '920000000000' });
  expect(inserts).toHaveLength(1);
  expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  expect(FeatureIntro.markVideoShown).toHaveBeenCalledTimes(1);
});
