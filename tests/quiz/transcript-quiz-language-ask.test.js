'use strict';
/**
 * The teacher chooses the quiz language.
 *
 * Round 1 decided it from the subject alone, so a maths lesson taught in Urdu
 * could be quizzed in Urdu with no say from the teacher who knows her class.
 * Now "yes" (and a /quiz pick) asks first, and generation waits for the answer.
 * The ask is skipped where it is not a real choice: an Urdu-grammar or an
 * Islamiyat lesson is quizzed in Urdu.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(true),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const { installFrom } = require('./helpers/supabase-chain');
const Offer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');

const QID = '22222222-2222-4222-8222-222222222222';
const PHONE = '923001234567';
const UID = 'u-1';
const USER = { id: UID, preferred_language: 'ur' };
const DIGEST = { topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', slos: [] };

const cp = (s) => [...String(s)].length;

function quizRow(over = {}) {
  return {
    id: QID, teacher_id: UID, status: 'offered', language: 'ur', subject: 'maths',
    topic: 'کسریں', coaching_session_id: 'cs-1', meta: { digest: DIGEST }, ...over,
  };
}

/** quizzes answers a read with `row`; an update answers with `updated` rows. */
function wireQuiz(row, { updated = [{ id: QID }], extra = {} } = {}) {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update' || c[0] === 'insert')
      ? { data: updated } : { data: row ? [row] : [] }),
    users: { data: [{ id: UID, phone_number: PHONE, preferred_language: 'ur' }] },
    ...extra,
  });
}

beforeEach(() => { jest.clearAllMocks(); process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; });

describe('yes → the language ask', () => {
  test('asks before generating, offering the subject-rule language first', async () => {
    wireQuiz(quizRow());
    expect(await Offer.handleOfferButton(`tq_yes_${QID}`, PHONE)).toBe(true);

    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [, payload] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(payload.buttons.map((b) => b.id)).toEqual([`tq_lang_ur_${QID}`, `tq_lang_en_${QID}`]);
    expect(payload.buttons.map((b) => b.title)).toEqual(['اردو', 'English']);
    payload.buttons.forEach((b) => expect(cp(b.title)).toBeLessThanOrEqual(20));
    expect(payload.body).toMatch(/[؀-ۿ]/);

    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');
    expect(updates[0][1].meta.awaiting_language).toBe(true);
    expect(updates[0][1].status).toBeUndefined();     // still 'offered' until she answers
  });

  test('an English-rule subject lists English first', async () => {
    wireQuiz(quizRow({ subject: 'english', language: 'en' }));
    await Offer.handleOfferButton(`tq_yes_${QID}`, PHONE);
    const [, payload] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(payload.buttons.map((b) => b.id)).toEqual([`tq_lang_en_${QID}`, `tq_lang_ur_${QID}`]);
  });

  test.each(['urdu', 'islamiat'])('%s is never asked — it goes straight to generating in Urdu', async (subject) => {
    wireQuiz(quizRow({ subject, language: 'ur' }));
    await Offer.handleOfferButton(`tq_yes_${QID}`, PHONE);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(SQS.queueJob).toHaveBeenCalledWith(QID, 'quiz_generate', expect.any(Object), expect.any(Object));
    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');
    expect(updates[0][1].status).toBe('generating');
    expect(updates[0][1].language).toBe('ur');
  });

  test('a quiz that is no longer offered says so instead of asking twice', async () => {
    wireQuiz(quizRow({ status: 'sent' }), { updated: [] });
    await Offer.handleOfferButton(`tq_yes_${QID}`, PHONE);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });
});

describe('handleLanguageButton', () => {
  test('stores the chosen language, flips offered→generating once, and enqueues', async () => {
    let flips = 0;
    installFrom(supabase.from, {
      quizzes: (calls) => {
        if (calls.some((c) => c[0] === 'update')) {
          flips += 1;
          return flips === 1 ? { data: [{ id: QID }] } : { data: [] };
        }
        return { data: [quizRow({ meta: { digest: DIGEST, awaiting_language: true } })] };
      },
      users: { data: [{ id: UID, phone_number: PHONE, preferred_language: 'ur' }] },
    });

    expect(await Offer.handleLanguageButton(`tq_lang_en_${QID}`, PHONE, USER)).toBe(true);
    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');
    expect(updates[0][1]).toEqual(expect.objectContaining({ status: 'generating', language: 'en' }));
    expect(updates[0][1].meta.awaiting_language).toBe(false);
    expect(SQS.queueJob).toHaveBeenCalledWith(QID, 'quiz_generate', expect.any(Object), expect.any(Object));

    // A second tap changes nothing and never enqueues twice.
    expect(await Offer.handleLanguageButton(`tq_lang_ur_${QID}`, PHONE, USER)).toBe(true);
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
  });

  test('an Urdu choice stores ur', async () => {
    wireQuiz(quizRow());
    await Offer.handleLanguageButton(`tq_lang_ur_${QID}`, PHONE, USER);
    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');
    expect(updates[0][1].language).toBe('ur');
  });

  test('a quiz that has gone away tells her the offer expired', async () => {
    wireQuiz(null);
    expect(await Offer.handleLanguageButton(`tq_lang_ur_${QID}`, PHONE, USER)).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('ignores buttons that are not ours', async () => {
    expect(await Offer.handleLanguageButton(`tq_yes_${QID}`, PHONE, USER)).toBe(false);
    expect(await Offer.handleLanguageButton('vq_offer_yes', PHONE, USER)).toBe(false);
    expect(await Offer.handleLanguageButton('tq_lang_fr_' + QID, PHONE, USER)).toBe(false);
  });
});

describe('/quiz pick → the language ask', () => {
  const SESSION = {
    id: 'sess-1', user_id: UID, created_at: '2026-09-05T05:00:00Z',
    transcript_text: 'x'.repeat(3000), transcript_language: 'ur',
    analysis_data: { topic: 'Fractions', subject: 'Maths' },
  };

  test('a lesson with no quiz yet is claimed as offered and awaiting her answer — nothing is generated', async () => {
    installFrom(supabase.from, {
      coaching_sessions: { data: [SESSION] },
      quizzes: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: [{ id: QID }] } : { data: [] }),
      users: { data: [USER] },
    });
    expect(await List.handleListPick('tq_pick_sess-1', PHONE, USER)).toBe(true);
    expect(SQS.queueJob).not.toHaveBeenCalled();
    const inserts = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'insert');
    expect(inserts[0][1].status).toBe('offered');
    expect(inserts[0][1].meta.awaiting_language).toBe(true);
    const [, payload] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(payload.buttons.map((b) => b.id)).toEqual([`tq_lang_ur_${QID}`, `tq_lang_en_${QID}`]);
  });

  test('a declined lesson picked again asks the language rather than regenerating silently', async () => {
    installFrom(supabase.from, {
      coaching_sessions: { data: [SESSION] },
      quizzes: (calls) => (calls.some((c) => c[0] === 'update')
        ? { data: [{ id: QID }] }
        : { data: [quizRow({ status: 'declined' })] }),
      users: { data: [USER] },
    });
    expect(await List.handleListPick('tq_pick_sess-1', PHONE, USER)).toBe(true);
    expect(SQS.queueJob).not.toHaveBeenCalled();
    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update');
    expect(updates[0][1].status).toBe('offered');
    expect(updates[0][1].meta.awaiting_language).toBe(true);
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  });

  test('an Urdu lesson picked from the list still skips the ask', async () => {
    installFrom(supabase.from, {
      coaching_sessions: { data: [{ ...SESSION, analysis_data: { topic: 'Singular and plural', subject: 'Urdu' } }] },
      quizzes: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: [{ id: QID }] } : { data: [] }),
      users: { data: [USER] },
    });
    await List.handleListPick('tq_pick_sess-1', PHONE, USER);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(SQS.queueJob).toHaveBeenCalledWith(QID, 'quiz_generate', expect.any(Object), expect.any(Object));
  });
});
