'use strict';
/**
 * bd-mg9c7.7 — the offer. One quizzes row per coaching session, one ask at a
 * time, once per teacher, flag-gated, and the yes/no buttons flip state
 * exactly once however many times they are tapped.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({
  run: jest.fn(),
}));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(false),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const FeatureIntro = require('../../bot/shared/services/feature-intro.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { installFrom } = require('./helpers/supabase-chain');
const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');

const SID = '11111111-1111-4111-8111-111111111111';
const QID = '22222222-2222-4222-8222-222222222222';
const UID = 'u-1';

const SESSION = {
  id: SID, user_id: UID, status: 'completed', observation_type: null,
  transcript_text: 'x'.repeat(3000), transcript_language: 'ur', created_at: '2026-09-05T05:00:00Z',
  analysis_data: { topic: 'Fractions', subject: 'Maths' },
  users: { phone_number: '923001234567', preferred_language: 'ur', first_name: 'Rifat', grades_taught: ['4'] },
};
const GOOD_DIGEST = {
  digest: {
    topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5',
    language_of_instruction: 'ur', confidence: 0.9,
    slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }, { id: 'S2', statement: 'b', taught_level: 'understand' }],
  },
  grade: '4', gradeSource: 'profile', lpHint: null, model: 'm', costUsd: 0.001,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  delete process.env.TRANSCRIPT_QUIZ_OFFER_MODE;
  delete process.env.TRANSCRIPT_QUIZ_SUBJECTS;
  delete process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO;
  FeatureIntro.hasSeenIntroVideo.mockResolvedValue(false);
});

describe('scheduleOffer', () => {
  test('enqueues a quiz_offer 240 s later and reports scheduled', async () => {
    const ok = await Offer.scheduleOffer({
      coachingSessionId: SID, userId: UID, phone: '923001234567', language: 'ur', transcriptChars: 3000,
    });
    expect(ok).toBe(true);
    expect(SQS.queueJob).toHaveBeenCalledWith(SID, 'quiz_offer', expect.objectContaining({ coachingSessionId: SID }),
      expect.objectContaining({ delaySeconds: 240 }));
  });

  test('does nothing when the flag is unset', async () => {
    delete process.env.TRANSCRIPT_QUIZ_ENABLED;
    expect(await Offer.scheduleOffer({ coachingSessionId: SID, userId: UID, phone: 'p', transcriptChars: 3000 })).toBe(false);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('skips a thin transcript and logs why', async () => {
    expect(await Offer.scheduleOffer({ coachingSessionId: SID, userId: UID, phone: 'p', transcriptChars: 900 })).toBe(false);
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.skipped', expect.objectContaining({ reason: 'transcript_too_short' }));
  });

  test('once mode: a teacher who has already been offered is not offered again', async () => {
    FeatureIntro.hasSeenIntroVideo.mockResolvedValue(true);
    expect(await Offer.scheduleOffer({ coachingSessionId: SID, userId: UID, phone: 'p', transcriptChars: 3000 })).toBe(false);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('every mode: offered again', async () => {
    process.env.TRANSCRIPT_QUIZ_OFFER_MODE = 'every';
    FeatureIntro.hasSeenIntroVideo.mockResolvedValue(true);
    expect(await Offer.scheduleOffer({ coachingSessionId: SID, userId: UID, phone: 'p', transcriptChars: 3000 })).toBe(true);
  });
});

describe('processOffer (worker)', () => {
  test('claims the row, digests, stores offered, sends buttons with the video the first time, marks the teacher offered', async () => {
    Digest.run.mockResolvedValue(GOOD_DIGEST);
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO = 'feature_videos/quiz_intro.mp4';
    installFrom(supabase.from, ({
      coaching_sessions: { data: [SESSION] },
      quizzes: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: [{ id: QID }] } : { data: [{ id: QID }] }),
    }));
    const r = await Offer.processOffer(SID, {});
    expect(r.ok).toBe(true);
    // The insert carries the unique anchor and the claim status.
    const inserts = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'insert');
    expect(inserts[0][1]).toEqual(expect.objectContaining({
      quiz_source: 'transcript', coaching_session_id: SID, teacher_id: UID, status: 'generating',
    }));
    // Then flips to offered with the digest and the resolved grade in meta.
    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');
    const offered = updates.find((u) => u[1].status === 'offered');
    expect(offered[1].language).toBe('ur');
    expect(offered[1].meta.grade).toBe('4');
    expect(offered[1].meta.digest.slos).toHaveLength(2);
    expect(WhatsAppService.sendVideoWithButtons).toHaveBeenCalledTimes(1);
    const [, , body, buttons] = WhatsAppService.sendVideoWithButtons.mock.calls[0];
    expect(body).toMatch(/کسریں/);
    expect(buttons.map((b) => b.id)).toEqual([`tq_yes_${QID}`, `tq_no_${QID}`]);
    expect(FeatureIntro.markVideoShown).toHaveBeenCalledWith(UID, 'transcript_quiz');
  });

  test('a teacher who has seen the video gets plain buttons', async () => {
    Digest.run.mockResolvedValue(GOOD_DIGEST);
    process.env.TRANSCRIPT_QUIZ_INTRO_VIDEO = 'feature_videos/quiz_intro.mp4';
    process.env.TRANSCRIPT_QUIZ_OFFER_MODE = 'every';
    FeatureIntro.hasSeenIntroVideo.mockResolvedValue(true);
    installFrom(supabase.from, ({ coaching_sessions: { data: [SESSION] }, quizzes: { data: [{ id: QID }] } }));
    await Offer.processOffer(SID, {});
    expect(WhatsAppService.sendVideoWithButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });

  test('is a no-op when another job already claimed the session (unique index 23505)', async () => {
    installFrom(supabase.from, ({
      coaching_sessions: { data: [SESSION] },
      quizzes: { data: null, error: { code: '23505', message: 'dup' } },
    }));
    const r = await Offer.processOffer(SID, {});
    expect(r.skipped).toBe('already_claimed');
    expect(Digest.run).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('a low-confidence digest marks the row skipped and sends nothing', async () => {
    Digest.run.mockResolvedValue({ ...GOOD_DIGEST, digest: { ...GOOD_DIGEST.digest, confidence: 0.3 } });
    installFrom(supabase.from, ({ coaching_sessions: { data: [SESSION] }, quizzes: { data: [{ id: QID }] } }));
    const r = await Offer.processOffer(SID, {});
    expect(r.skipped).toBe('low_confidence');
    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');
    expect(updates.some((u) => u[1].status === 'skipped')).toBe(true);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('a subject outside the allowlist is skipped', async () => {
    process.env.TRANSCRIPT_QUIZ_SUBJECTS = 'maths,science';
    Digest.run.mockResolvedValue({ ...GOOD_DIGEST, digest: { ...GOOD_DIGEST.digest, subject: 'islamiat' } });
    installFrom(supabase.from, ({ coaching_sessions: { data: [SESSION] }, quizzes: { data: [{ id: QID }] } }));
    const r = await Offer.processOffer(SID, {});
    expect(r.skipped).toBe('subject_not_allowed');
  });

  test('never runs for an /observe session', async () => {
    installFrom(supabase.from, ({
      coaching_sessions: { data: [{ ...SESSION, observation_type: 'leader_observation' }] },
    }));
    const r = await Offer.processOffer(SID, {});
    expect(r.skipped).toBe('not_self_coaching');
  });

  test('the offer names the SUBJECT and the topic as the class heard it', async () => {
    Digest.run.mockResolvedValue(GOOD_DIGEST);
    installFrom(supabase.from, ({ coaching_sessions: { data: [SESSION] }, quizzes: { data: [{ id: QID }] } }));
    await Offer.processOffer(SID, {});
    const body = WhatsAppService.sendInteractiveButtons.mock.calls[0][1].body;
    expect(body).toMatch(/ریاضی/);        // subject, in the teacher's language
    expect(body).toMatch(/کسریں/);        // the topic as taught, in the quiz language
    expect(body).not.toMatch(/Fractions/); // no English gloss: both languages are Urdu here
  });

  test('an English-reading teacher whose quiz is Urdu gets the subject in English and the topic glossed', async () => {
    Digest.run.mockResolvedValue(GOOD_DIGEST);
    installFrom(supabase.from, ({
      coaching_sessions: { data: [{ ...SESSION, users: { ...SESSION.users, preferred_language: 'en' } }] },
      quizzes: { data: [{ id: QID }] },
    }));
    await Offer.processOffer(SID, {});
    const body = WhatsAppService.sendInteractiveButtons.mock.calls[0][1].body;
    expect(body).toMatch(/Mathematics lesson/);
    expect(body).toMatch(/کسریں/);
    expect(body).toMatch(/Fractions/);
  });
});

describe('handleOfferButton', () => {
  const TEACHER = { data: [{ id: UID, phone_number: '923001234567', preferred_language: 'ur' }] };

  test('tq_yes flips offered→generating exactly once and enqueues quiz_generate', async () => {
    let flips = 0;
    installFrom(supabase.from, ({
      quizzes: (calls) => {
        if (calls.some((c) => c[0] === 'update')) {
          flips += 1;
          return flips === 1 ? { data: [{ id: QID }] } : { data: [] };   // second tap: no row matched
        }
        return { data: [{ id: QID, teacher_id: UID, status: 'offered', language: 'ur', topic: 'کسریں' }] };
      },
      users: TEACHER,
    }));
    expect(await Offer.handleOfferButton(`tq_yes_${QID}`, '923001234567')).toBe(true);
    expect(await Offer.handleOfferButton(`tq_yes_${QID}`, '923001234567')).toBe(true);
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
    expect(SQS.queueJob).toHaveBeenCalledWith(QID, 'quiz_generate', expect.any(Object), expect.any(Object));
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);   // "making it" then "already on it"
  });

  test('tq_no marks declined and sends the decline copy in the teacher language', async () => {
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] }
        : { data: [{ id: QID, teacher_id: UID, status: 'offered', language: 'ur' }] }),
      users: TEACHER,
    }));
    expect(await Offer.handleOfferButton(`tq_no_${QID}`, '923001234567')).toBe(true);
    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');
    expect(updates[0][1].status).toBe('declined');
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/\/quiz/);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/[؀-ۿ]/);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('ignores buttons that are not ours', async () => {
    expect(await Offer.handleOfferButton('vq_offer_yes', 'p')).toBe(false);
    expect(await Offer.handleOfferButton('quiz_yes_send_x', 'p')).toBe(false);
  });
});
