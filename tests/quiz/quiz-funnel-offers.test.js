'use strict';
/**
 * The quiz funnel, the teacher's side: offer_made → offer_answered → accepted,
 * for every channel a quiz is born on — the offer after a coaching report, the
 * afternoon lesson-plan offer, /quiz, and "make it again".
 *
 * What prod could not answer before (14 days to 24 Sep 2026): "how many offers
 * were accepted, per stream?" `transcript_quiz.accepted` carried no stream; an
 * Urdu or Islamiyat yes to the lesson-plan offer logged no accepted at all; /quiz
 * logged `list_generate` instead; and the lesson-plan offer's own event had no
 * quiz id. Each channel now writes the same `quiz_funnel.accepted` at the moment
 * the quiz is committed and queued, and `meta.accepted_at` on the row.
 *
 * Mocked: supabase (a filtering stub for the lesson-plan offer, a canned one for
 * the rest), WhatsApp, the queue, the transcript digest (the offer's input, not
 * its subject), feature-intro, the logger, and the nudge store at its contract.
 */
const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('m-1') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(false),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
  introShownCount: jest.fn().mockResolvedValue(9),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { installFrom } = require('./helpers/supabase-chain');
const TqOffer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
const LpOffer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');

const T1 = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const QID = '33333333-3333-4333-8333-333333333333';
const NID = '44444444-4444-4444-8444-444444444444';
const PHONE = '923001112222';
const NUDGE_DATE = '2026-09-22';
const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);

const funnel = (stage) => logEvent.mock.calls.filter((c) => c[0] === `quiz_funnel.${stage}`).map((c) => c[1]);
const isoTime = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

beforeEach(() => {
  jest.clearAllMocks();
  WhatsAppService.sendMessage.mockResolvedValue(true);
  WhatsAppService.sendInteractiveButtons.mockResolvedValue(true);
  WhatsAppService.sendInteractiveMessage.mockResolvedValue(true);
  SQS.queueJob.mockResolvedValue('m-1');
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT = '15';
  process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '0';
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
  delete process.env.LP_QUIZ_OFFER_SECTORS;
});
afterEach(() => {
  ['TRANSCRIPT_QUIZ_ENABLED', 'LP_QUIZ_OFFER_ENABLED', 'LP_QUIZ_OFFER_SEND_HOUR_PKT', 'LP_QUIZ_OFFER_SEND_MINUTE_PKT',
    'LP_QUIZ_OFFER_CUTOFF_HOUR_PKT'].forEach((k) => delete process.env[k]);
});

// ── the offer after a coaching report ───────────────────────────────────────

const SESSION = {
  id: SID, user_id: T1, status: 'completed', observation_type: null,
  transcript_text: 'x'.repeat(3000), transcript_language: 'ur', created_at: '2026-09-05T05:00:00Z',
  analysis_data: { topic: 'Fractions', subject: 'Maths' },
  users: { phone_number: PHONE, preferred_language: 'ur', name: 'R', grades_taught: ['4'] },
};
const GOOD_DIGEST = {
  digest: {
    topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5', language_of_instruction: 'ur', confidence: 0.9,
    slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }, { id: 'S2', statement: 'b', taught_level: 'understand' }],
  },
  grade: '4', gradeSource: 'profile', lpHint: null, model: 'm', costUsd: 0.001,
};
const TEACHER = { data: [{ id: T1, phone_number: PHONE, preferred_language: 'en' }] };

describe('the coaching offer (transcript stream)', () => {
  test('an offer that reaches the teacher is offer_made {delivered:true}, with the quiz id', async () => {
    Digest.run.mockResolvedValue(GOOD_DIGEST);
    installFrom(supabase.from, ({ coaching_sessions: { data: [SESSION] }, quizzes: { data: [{ id: QID }] } }));
    await TqOffer.processOffer(SID, {});
    expect(funnel('offer_made')).toEqual([{
      quiz_id: QID, teacher_id: T1, source: 'transcript', channel: 'coaching_offer', delivered: true,
    }]);
  });

  test('an offer WhatsApp refused is still counted, as delivered:false', async () => {
    Digest.run.mockResolvedValue(GOOD_DIGEST);
    WhatsAppService.sendInteractiveButtons.mockResolvedValue(false);
    installFrom(supabase.from, ({ coaching_sessions: { data: [SESSION] }, quizzes: { data: [{ id: QID }] } }));
    await TqOffer.processOffer(SID, {});
    expect(funnel('offer_made')[0]).toEqual(expect.objectContaining({ quiz_id: QID, delivered: false }));
  });

  test('no → offer_answered {choice:no}; nothing is accepted', async () => {
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] }
        : { data: [{ id: QID, teacher_id: T1, status: 'offered', language: 'ur', meta: { source: 'self' } }] }),
      users: TEACHER,
    }));
    await TqOffer.handleOfferButton(`tq_no_${QID}`, PHONE);
    expect(funnel('offer_answered')).toEqual([{ quiz_id: QID, teacher_id: T1, source: 'transcript', channel: 'coaching_offer', choice: 'no' }]);
    expect(funnel('accepted')).toEqual([]);
  });

  test('yes on an Urdu lesson → offer_answered {yes} and accepted, once, however many taps', async () => {
    let flips = 0;
    installFrom(supabase.from, ({
      quizzes: (calls) => {
        if (calls.some((c) => c[0] === 'update')) { flips += 1; return flips === 1 ? { data: [{ id: QID }] } : { data: [] }; }
        return { data: [{ id: QID, teacher_id: T1, status: 'offered', language: 'ur', subject: 'urdu', topic: 't', meta: { source: 'self' } }] };
      },
      users: TEACHER,
    }));
    await TqOffer.handleOfferButton(`tq_yes_${QID}`, PHONE);
    await TqOffer.handleOfferButton(`tq_yes_${QID}`, PHONE);
    expect(funnel('offer_answered').map((e) => e.choice)).toEqual(['yes', 'yes']);
    expect(funnel('accepted')).toEqual([{ quiz_id: QID, teacher_id: T1, source: 'transcript', channel: 'coaching_offer' }]);
  });

  test('yes on a maths lesson asks the language first — accepted waits for the answer', async () => {
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] }
        : { data: [{ id: QID, teacher_id: T1, status: 'offered', language: 'ur', subject: 'maths', topic: 't', meta: { source: 'self' } }] }),
      users: TEACHER,
    }));
    await TqOffer.handleOfferButton(`tq_yes_${QID}`, PHONE);
    expect(funnel('offer_answered').map((e) => e.choice)).toEqual(['yes']);
    expect(funnel('accepted')).toEqual([]);

    await TqOffer.handleLanguageButton(`tq_lang_en_${QID}`, PHONE, { preferred_language: 'en' });
    expect(funnel('accepted')).toEqual([{ quiz_id: QID, teacher_id: T1, source: 'transcript', channel: 'coaching_offer' }]);
  });
});

// ── the afternoon lesson-plan offer ─────────────────────────────────────────

const lesson = (over = {}) => ({
  lesson_id: 'grade_4_urdu_ch2_seg1', asset_id: 'asset-1', version_stamp: 'v8.2026-09-01', content_hash: 'hash-a',
  delivered_at: pkt(NUDGE_DATE, 9, 30).toISOString(), topic: 'Pyasa Kawwa', ...over,
});
const klass = (over = {}) => ({ key: 'g4_urdu', grade: 4, subject: 'urdu', lessons: [lesson()], ...over });
const nudge = (over = {}) => ({
  id: NID, user_id: T1, kind: 'lp_quiz_offer', nudge_date: NUDGE_DATE, status: 'sent',
  scheduled_at: pkt(NUDGE_DATE, 15).toISOString(), sent_at: pkt(NUDGE_DATE, 15).toISOString(),
  choice: null, quiz_id: null, context: { classes: [klass()] }, ...over,
});
const USER = { id: T1, phone_number: PHONE, preferred_language: 'en' };
const teacherRow = {
  id: T1, role: 'teacher', is_test_user: false, deleted_at: null, school_id: 'school-1', region: 'r',
  phone_number: PHONE, preferred_language: 'en', last_message_at: pkt(NUDGE_DATE, 12).toISOString(),
};
let db;
const install = (tables) => { db = makeSupabase(tables); supabase.from.mockImplementation(db.from); return db; };
const TAP_AT = pkt(NUDGE_DATE, 15, 20);

describe('the lesson-plan offer (lp stream)', () => {
  test('a sent offer is offer_made with the nudge id and the number of classes', async () => {
    mockStore = makeStore();
    install({ users: [teacherRow], coaching_sessions: [], quizzes: [], teacher_nudges: [] });
    await LpOffer.send(nudge({ status: 'sending', sent_at: null }), { now: pkt(NUDGE_DATE, 15) });
    expect(funnel('offer_made')).toEqual([{
      nudge_id: NID, teacher_id: T1, source: 'lp_v8', channel: 'lp_offer', n: 1, delivered: true,
    }]);
  });

  test('an offer WhatsApp refused is offer_made {delivered:false} before the sweeper marks it failed', async () => {
    mockStore = makeStore();
    WhatsAppService.sendInteractiveButtons.mockResolvedValue(false);
    install({ users: [teacherRow], coaching_sessions: [], quizzes: [], teacher_nudges: [] });
    await expect(LpOffer.send(nudge({ status: 'sending', sent_at: null }), { now: pkt(NUDGE_DATE, 15) })).rejects.toThrow();
    expect(funnel('offer_made')[0]).toEqual(expect.objectContaining({ nudge_id: NID, delivered: false }));
  });

  test('yes on an Urdu lesson → offer_answered {yes}, accepted with the new quiz id, and accepted_at on the row', async () => {
    mockStore = makeStore([nudge()]);
    install({ quizzes: [] });
    // The stub mints `quizzes-new-1`; a real insert returns a uuid, and the
    // funnel (rightly) refuses anything that is not an id.
    const stubFrom = db.from;
    supabase.from.mockImplementation((t) => {
      const c = stubFrom(t);
      if (t === 'quizzes') { const insert = c.insert; c.insert = (row) => insert({ id: QID, ...row }); }
      return c;
    });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT });

    const quiz = db.writes.find((w) => w.table === 'quizzes' && w.op === 'insert').row;
    expect(isoTime(quiz.meta.accepted_at)).toBe(true);
    expect(funnel('offer_answered')).toEqual([{ nudge_id: NID, teacher_id: T1, source: 'lp_v8', channel: 'lp_offer', choice: 'yes' }]);
    expect(funnel('accepted')).toEqual([{
      quiz_id: quiz.id, nudge_id: NID, teacher_id: T1, source: 'lp_v8', channel: 'lp_offer',
    }]);
  });

  test('yes on a maths lesson asks the language first: answered now, accepted when the language is chosen', async () => {
    mockStore = makeStore([nudge({ context: { classes: [klass({ key: 'g4_math', subject: 'math' })] } })]);
    install({ quizzes: [] });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT });
    expect(funnel('offer_answered').map((e) => e.choice)).toEqual(['yes']);
    expect(funnel('accepted')).toEqual([]);
    const quiz = db.writes.find((w) => w.table === 'quizzes' && w.op === 'insert').row;
    expect(quiz.meta.accepted_at).toBeUndefined();   // nothing is committed until the language is
  });

  test('no → offer_answered {no}', async () => {
    mockStore = makeStore([nudge()]);
    install({ quizzes: [] });
    await LpOffer.handleButton(`lpquiz_no_${NID}`, PHONE, USER, { now: TAP_AT });
    expect(funnel('offer_answered')).toEqual([{ nudge_id: NID, teacher_id: T1, source: 'lp_v8', channel: 'lp_offer', choice: 'no' }]);
  });

  test('a tap after the offer expired → offer_answered {expired}', async () => {
    mockStore = makeStore([nudge()]);
    install({ quizzes: [] });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: pkt('2026-09-24', 10) });
    expect(funnel('offer_answered')).toEqual([expect.objectContaining({ nudge_id: NID, source: 'lp_v8', choice: 'expired' })]);
    expect(funnel('accepted')).toEqual([]);
  });

  test('the language answered on an lp_v8 quiz is accepted on the lp stream, channel lp_offer', async () => {
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : {
        data: [{ id: QID, teacher_id: T1, status: 'offered', subject: 'math', quiz_source: 'lp_v8', topic: 't',
          meta: { source: 'lp_offer', nudge_id: NID, awaiting_language: true } }],
      }),
      users: TEACHER,
    }));
    await TqOffer.handleLanguageButton(`tq_lang_en_${QID}`, PHONE, USER);
    expect(funnel('accepted')).toEqual([{ quiz_id: QID, nudge_id: NID, teacher_id: T1, source: 'lp_v8', channel: 'lp_offer' }]);
  });

  test('a quiz the queue refused is generation_failed {queue_failed}, dated on the row', async () => {
    SQS.queueJob.mockRejectedValue(new Error('sqs down'));
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] }
        : { data: [{ meta: { source: 'lp_offer', nudge_id: NID } }] }),
    }));
    await TqOffer.queueLpQuiz({ quizId: QID, nudgeId: NID, phone: PHONE, language: 'en' });
    const failed = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1])
      .find((u) => u.status === 'failed');
    expect(isoTime(failed.meta.failed_at)).toBe(true);
    expect(funnel('generation_failed')).toEqual([{ quiz_id: QID, nudge_id: NID, source: 'lp_v8', channel: 'lp_offer', reason: 'queue_failed' }]);
  });

  test('"make it again" is accepted on channel remake, with accepted_at on the row', async () => {
    installFrom(supabase.from, ({ quizzes: { data: [{ id: QID }] } }));
    await TqOffer.remakeLpQuiz({
      quiz: {
        id: QID, teacher_id: T1, quiz_source: 'lp_v8', status: 'failed',
        meta: { source: 'lp_offer', nudge_id: NID, error: 'model_failed', lessons: [lesson()] },
      },
      phone: PHONE, teacherLang: 'en',
    });
    const patch = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1])[0];
    expect(isoTime(patch.meta.accepted_at)).toBe(true);
    expect(funnel('accepted')).toEqual([{ quiz_id: QID, nudge_id: NID, teacher_id: T1, source: 'lp_v8', channel: 'remake' }]);
  });
});

// ── /quiz ────────────────────────────────────────────────────────────────────

describe('/quiz (quiz_menu)', () => {
  test('queueing a lesson from /quiz is accepted on channel quiz_menu', async () => {
    await List.enqueueGenerate(QID, PHONE, 'en', 'flow');
    expect(funnel('accepted')).toEqual([{ quiz_id: QID, source: 'transcript', channel: 'quiz_menu' }]);
  });

  test('a /quiz claim dates the acceptance on the row — a new row and a remade one', async () => {
    installFrom(supabase.from, ({ quizzes: { data: [{ id: QID }] } }));
    await List.claimForGeneration({ userId: T1, sessionId: SID, session: { analysis_data: {} }, quiz: null, quizLanguage: 'en' });
    await List.claimForGeneration({
      userId: T1, sessionId: SID, quiz: { id: QID, status: 'failed', meta: { source: 'list' } }, quizLanguage: 'en',
    });
    const writes = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'insert' || c[0] === 'update').map((c) => c[1]);
    expect(writes).toHaveLength(2);
    writes.forEach((w) => expect(isoTime(w.meta.accepted_at)).toBe(true));
  });
});
