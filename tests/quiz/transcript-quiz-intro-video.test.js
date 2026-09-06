'use strict';
/**
 * The intro film rides the first N offers, chosen by the teacher's own
 * language, gated by a showing COUNT
 * (not by `alreadyOffered`, which is true for any prior offer row and would
 * make a second showing impossible even under TRANSCRIPT_QUIZ_OFFER_MODE=every).
 *
 * Every case is driven through Offer.processOffer(...) — a pure-helper test
 * does not satisfy red-first here.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(false),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
  introShownCount: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const FeatureIntro = require('../../bot/shared/services/feature-intro.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { installFrom } = require('./helpers/supabase-chain');
const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');

const SID = '33333333-3333-4333-8333-333333333333';
const QID = '44444444-4444-4444-8444-444444444444';
const UID = 'u-v';

function session(overrides = {}) {
  return {
    id: SID, user_id: UID, status: 'completed', observation_type: null,
    transcript_text: 'x'.repeat(3000), transcript_language: 'ur', created_at: '2026-09-06T05:00:00Z',
    analysis_data: { topic: 'Fractions', subject: 'Maths' },
    users: { phone_number: '923001234567', preferred_language: 'ur', first_name: 'Zara', grades_taught: ['4'] },
    ...overrides,
  };
}

const GOOD_DIGEST = {
  digest: {
    topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5',
    language_of_instruction: 'ur', confidence: 0.9,
    slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }, { id: 'S2', statement: 'b', taught_level: 'understand' }],
  },
  grade: '4', gradeSource: 'profile', lpHint: null, model: 'm', costUsd: 0.001,
};

function installSession(overrides = {}) {
  installFrom(supabase.from, ({
    coaching_sessions: { data: [session(overrides)] },
    quizzes: { data: [{ id: QID }] },
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  delete process.env.TRANSCRIPT_QUIZ_OFFER_MODE;
  delete process.env.TRANSCRIPT_QUIZ_SUBJECTS;
  delete process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO;
  delete process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_UR;
  delete process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_EN;
  delete process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_SHOWS;
  Digest.run.mockResolvedValue(GOOD_DIGEST);
  WhatsAppService.sendVideoWithButtons.mockResolvedValue(true);
  FeatureIntro.hasSeenIntroVideo.mockResolvedValue(false);
  FeatureIntro.introShownCount.mockResolvedValue(0);
});

describe('the intro film rides the first N offers (D7)', () => {
  test('1. preferred_language ur -> the _UR key is the video argument', async () => {
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_UR = 'ur.mp4';
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_EN = 'en.mp4';
    installSession();
    await Offer.processOffer(SID, {});
    expect(WhatsAppService.sendVideoWithButtons.mock.calls[0][1]).toBe('ur.mp4');
  });

  test('2. preferred_language en -> the _EN key', async () => {
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_UR = 'ur.mp4';
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_EN = 'en.mp4';
    installSession({ users: { phone_number: '923001234567', preferred_language: 'en', grades_taught: ['4'] } });
    await Offer.processOffer(SID, {});
    expect(WhatsAppService.sendVideoWithButtons.mock.calls[0][1]).toBe('en.mp4');
  });

  test('3. only the shared TRANSCRIPT_QUIZ_INTRO_VIDEO set -> both languages get it', async () => {
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO = 'shared.mp4';
    installSession();
    await Offer.processOffer(SID, {});
    expect(WhatsAppService.sendVideoWithButtons.mock.calls[0][1]).toBe('shared.mp4');

    jest.clearAllMocks();
    FeatureIntro.introShownCount.mockResolvedValue(0);
    installSession({ users: { phone_number: '923001234567', preferred_language: 'en', grades_taught: ['4'] } });
    await Offer.processOffer(SID, {});
    expect(WhatsAppService.sendVideoWithButtons.mock.calls[0][1]).toBe('shared.mp4');
  });

  test('4. _UR unset, _EN + shared set -> an Urdu teacher gets the shared fallback, not the EN film', async () => {
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_EN = 'en.mp4';
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO = 'shared.mp4';
    installSession();
    await Offer.processOffer(SID, {});
    expect(WhatsAppService.sendVideoWithButtons.mock.calls[0][1]).toBe('shared.mp4');
  });

  test('5. count 0 -> video; count 1 -> video; count 2 -> plain buttons only, _SHOWS unset (default is 2)', async () => {
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO = 'shared.mp4';
    for (const count of [0, 1]) {
      jest.clearAllMocks();
      FeatureIntro.introShownCount.mockResolvedValue(count);
      installSession();
      // eslint-disable-next-line no-await-in-loop
      await Offer.processOffer(SID, {});
      expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);
    }
    jest.clearAllMocks();
    FeatureIntro.introShownCount.mockResolvedValue(2);
    installSession();
    await Offer.processOffer(SID, {});
    expect(WhatsAppService.sendVideoWithButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });

  test('6. _SHOWS=3 -> count 2 still gets the video; _SHOWS=0 -> count 0 gets plain buttons', async () => {
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO = 'shared.mp4';
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_SHOWS = '3';
    FeatureIntro.introShownCount.mockResolvedValue(2);
    installSession();
    await Offer.processOffer(SID, {});
    expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO_SHOWS = '0';
    FeatureIntro.introShownCount.mockResolvedValue(0);
    installSession();
    await Offer.processOffer(SID, {});
    expect(WhatsAppService.sendVideoWithButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });

  test('7. the video send failing falls back to plain buttons, incrementIntroCount:false, withVideo:false', async () => {
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO = 'shared.mp4';
    WhatsAppService.sendVideoWithButtons.mockResolvedValueOnce(false);
    installSession();
    const r = await Offer.processOffer(SID, {});
    expect(r.ok).toBe(true);
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(FeatureIntro.markVideoShown).toHaveBeenCalledWith(UID, 'transcript_quiz', { incrementIntroCount: false });
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.offered', expect.objectContaining({ withVideo: false }));
  });

  test('8. a successful video send: incrementIntroCount:true, withVideo:true, shownCount is the pre-offer count', async () => {
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO = 'shared.mp4';
    FeatureIntro.introShownCount.mockResolvedValue(1);
    installSession();
    await Offer.processOffer(SID, {});
    expect(FeatureIntro.markVideoShown).toHaveBeenCalledWith(UID, 'transcript_quiz', { incrementIntroCount: true });
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.offered', expect.objectContaining({ withVideo: true, shownCount: 1 }));
  });

  test('9. every mode + a teacher already offered before still gets the offer AND the film while count < N', async () => {
    process.env.TRANSCRIPT_QUIZ_OFFER_MODE = 'every';
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO = 'shared.mp4';
    FeatureIntro.hasSeenIntroVideo.mockResolvedValue(true);
    FeatureIntro.introShownCount.mockResolvedValue(0);
    installSession();
    const r = await Offer.processOffer(SID, {});
    expect(r.ok).toBe(true);
    expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);
  });
});
