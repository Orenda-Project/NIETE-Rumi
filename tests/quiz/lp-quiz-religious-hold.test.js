'use strict';
/**
 * Islamiyat lessons are held out of machine-written LESSON-PLAN quizzes until the fluent-Urdu
 * religious review clears the subject — the same hold the recorded-lesson quiz keeps with its
 * subject allow-list, and the 6-12 plans with `is_religious`. With no env change on any tier.
 *
 * Every door into an lp_v8 quiz is driven here through its REAL chain:
 *   - the 15:00 offer: the cohort build, the send, and a tap on a class of an offer that was
 *     already out (built before the hold existed);
 *   - the /quiz lesson provider (list, get, start — the Flow uses the same three);
 *   - "make it again" on a failed quiz.
 * Only the network boundary is stubbed: Supabase (a stateful in-memory table set, so what one
 * service writes is what the next reads), WhatsApp, the SQS queue and Redis — plus the two log
 * sinks, so the reason a lesson was held can be read back.
 *
 * One teacher took a Grade 5 Maths lesson and a Grade 5 Islamiyat lesson the same morning;
 * another took only an Islamiyat lesson. Both lessons have a slide script, so nothing but the
 * subject keeps the Islamiyat one out. The Maths lesson is offered, listed and made exactly as
 * before; the Islamiyat lesson never is, and every place that holds it says
 * `religious_review_pending` — its own reason, never a shared fallback.
 */

const { createMemorySupabase } = require('./helpers/memory-supabase');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
  sendVideoFromUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue('m-1'),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');
const Provider = require('../../bot/shared/services/quiz/lp-v8-lesson-provider');
const TranscriptQuizOffer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');
const QuizSources = require('../../bot/shared/services/quiz/quiz-sources');

const NUDGE_DATE = '2026-09-22';                     // Tuesday
const SEND_AT = pktTime.atPkt(NUDGE_DATE, 15, 0);
const TOOK_AT = pktTime.atPkt(NUDGE_DATE, 9, 30).toISOString();
const SINCE = '2026-09-01T00:00:00Z';                // /quiz window, pinned so the suite never ages out
const REASON = 'religious_review_pending';

const T1 = '11111111-1111-4111-8111-111111111111';   // Maths + Islamiyat
const T2 = '22222222-2222-4222-8222-222222222222';   // Islamiyat only
const PHONE = { [T1]: '923001112222', [T2]: '923003334444' };

// Real catalogue lessons (bot/data/lp_catalog.json).
const MATH = 'grade_5_math_ch2_seg1';
const ISL = 'grade_5_islamiat_ch4_seg1';
const ISL_2 = 'grade_5_islamiat_ch2_seg1';

const D_MATH = 'aaaaaaaa-0000-4000-8000-000000000001';
const D_ISL = 'aaaaaaaa-0000-4000-8000-000000000002';
const D_ISL_T2 = 'aaaaaaaa-0000-4000-8000-000000000003';

function download(id, userId, lessonId, subject, assetId) {
  return {
    id, user_id: userId, lesson_id: lessonId, asset_id: assetId,
    version_stamp: 'v8.2026-09-01', content_hash: `hash-${assetId}`,
    grade: 5, subject, chapter_number: 2, segment_index: 1, status: 'sent', created_at: TOOK_AT,
  };
}

function teacher(id) {
  return {
    id, role: 'teacher', is_test_user: false, deleted_at: null, school_id: null, region: null,
    phone_number: PHONE[id], preferred_language: 'en',
    last_message_at: pktTime.atPkt(NUDGE_DATE, 10, 0).toISOString(),
  };
}

const DOWNLOADS = [
  download(D_MATH, T1, MATH, 'math', 'asset-math'),
  download(D_ISL, T1, ISL, 'islamiat', 'asset-isl'),
  download(D_ISL_T2, T2, ISL_2, 'islamiat', 'asset-isl-2'),
];

let db;
function install(over = {}) {
  db = createMemorySupabase({
    niete_lp_downloads: DOWNLOADS,
    niete_lp_assets: DOWNLOADS.map((d) => ({ id: d.asset_id, asset_kind: 'lesson' })),
    // Every lesson has a slide script for the exact version served: the SOURCE check passes for
    // all three, so only the subject can keep a lesson out.
    niete_lp_asset_sources: DOWNLOADS.map((d) => ({
      lesson_id: d.lesson_id, version_stamp: d.version_stamp, content_hash: d.content_hash,
    })),
    niete_lp_opens: [],
    users: [teacher(T1), teacher(T2)],
    schools: [],
    coaching_sessions: [],
    quizzes: [],
    teacher_nudges: [],
    ...over,
  }, {
    defaults: { teacher_nudges: { status: 'pending', sent_at: null, choice: null, quiz_id: null } },
    now: () => SEND_AT,
  });
  supabase.from.mockImplementation(db.from);
  return db;
}

/** Every word WhatsApp was asked to send, as one string. */
const sentText = () => JSON.stringify([
  WhatsAppService.sendMessage.mock.calls,
  WhatsAppService.sendInteractiveButtons.mock.calls,
  WhatsAppService.sendInteractiveMessage.mock.calls,
  WhatsAppService.sendVideoWithButtons.mock.calls,
  WhatsAppService.sendVideoFromUrl.mock.calls,
]);
const ISLAMIYAT_RX = /islam|اسلامیات/i;

const heldEvents = () => logEvent.mock.calls.filter(([, payload]) => payload && payload.reason === REASON);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT = '15';
  process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '0';
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
  delete process.env.LP_QUIZ_OFFER_SECTORS;
  delete process.env.LP_QUIZ_OFFER_INTRO_VIDEO;
  delete process.env.LP_QUIZ_OFFER_INTRO_VIDEO_EN;
  delete process.env.LP_QUIZ_OFFER_INTRO_VIDEO_UR;
  delete process.env.QUIZ_MENU_LESSON_ROWS;            // its default: on
});

describe('the 15:00 offer: Maths is offered, Islamiyat is not', () => {
  test('the cohort keeps the Maths class, drops the Islamiyat one, and skips an Islamiyat-only teacher with its own reason', async () => {
    install();
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: SEND_AT });

    const t1 = db.tables.teacher_nudges.find((r) => r.user_id === T1);
    const t2 = db.tables.teacher_nudges.find((r) => r.user_id === T2);

    expect(t1.status).toBe('pending');
    expect(t1.context.classes.map((c) => c.key)).toEqual(['g5_math']);
    expect(t1.context.classes[0].lessons.map((l) => l.lesson_id)).toEqual([MATH]);

    expect(t2.status).toBe('skipped');
    expect(t2.context.skip_reason).toBe(REASON);
    expect(res).toEqual(expect.objectContaining({ inserted: 1, skipped: { [REASON]: 1 } }));

    // The held lessons are counted under their own reason, not folded into no_lesson.
    expect(heldEvents().map(([name]) => name)).toContain('lp_quiz.lesson_held');
  });

  test('the offer that goes out names the Maths lesson and nothing Islamiyat', async () => {
    install();
    await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: SEND_AT });
    const row = db.tables.teacher_nudges.find((r) => r.user_id === T1);

    const out = await Offer.send(row, { now: SEND_AT });

    expect(out.sent).toBe(true);
    expect(out.context.class_count).toBe(1);
    expect(sentText()).toMatch(/mental maths/i);
    expect(sentText()).not.toMatch(ISLAMIYAT_RX);
  });
});

describe('a tap on an Islamiyat class of an offer that was already out', () => {
  const NUDGE = '33333333-3333-4333-8333-333333333333';
  // The classes as a build without the hold wrote them, and as they reached the teacher.
  const classes = [
    { key: 'g5_islamiat', grade: 5, subject: 'islamiat', lessons: [{ lesson_id: ISL, asset_id: 'asset-isl', version_stamp: 'v8.2026-09-01', content_hash: 'hash-asset-isl', delivered_at: TOOK_AT, topic: null }] },
    { key: 'g5_math', grade: 5, subject: 'math', lessons: [{ lesson_id: MATH, asset_id: 'asset-math', version_stamp: 'v8.2026-09-01', content_hash: 'hash-asset-math', delivered_at: TOOK_AT, topic: 'Add 6-digit numbers: mental maths & counting on' }] },
  ];
  const sentRow = () => ({
    id: NUDGE, user_id: T1, kind: 'lp_quiz_offer', nudge_date: NUDGE_DATE, status: 'sent',
    scheduled_at: SEND_AT.toISOString(), sent_at: SEND_AT.toISOString(), choice: null, quiz_id: null,
    context: { classes },
  });
  const at = new Date(SEND_AT.getTime() + 10 * 60000);

  test('makes no quiz, queues nothing, and answers that this lesson plan cannot be made into a quiz', async () => {
    install({ teacher_nudges: [sentRow()] });

    const handled = await Offer.handleListPick(`lpquiz_pick_${NUDGE}_g5_islamiat`, PHONE[T1], teacher(T1), { now: at });

    expect(handled).toBe(true);
    expect(db.tables.quizzes).toHaveLength(0);
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(
      PHONE[T1], resolveUx('tqLpLessonUnavailable', { language: 'en' }));
    // Still open: the teacher can pick the Maths class from the same list.
    expect(db.tables.teacher_nudges[0].quiz_id).toBeNull();
    expect(heldEvents().map(([name]) => name)).toContain('lp_quiz.lesson_held');
  });

  test('the Maths class on the same offer is made exactly as before', async () => {
    install({ teacher_nudges: [sentRow()] });

    await Offer.handleListPick(`lpquiz_pick_${NUDGE}_g5_math`, PHONE[T1], teacher(T1), { now: at });

    expect(db.tables.quizzes).toHaveLength(1);
    expect(db.tables.quizzes[0]).toEqual(expect.objectContaining({
      quiz_source: 'lp_v8', subject: 'math', status: 'offered',
    }));
    expect(db.tables.teacher_nudges[0].quiz_id).toBe(db.tables.quizzes[0].id);
    // Maths asks the quiz language first, as it always has.
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(heldEvents()).toHaveLength(0);
  });
});

describe('/quiz: the lesson provider lists, opens and makes Maths, never Islamiyat', () => {
  test('list shows the Maths lesson only; an Islamiyat-only teacher sees none', async () => {
    install();

    const mine = await Provider.list(T1, { since: SINCE });
    const theirs = await Provider.list(T2, { since: SINCE });

    expect(mine.map((i) => i.lessonId)).toEqual([MATH]);
    expect(theirs).toEqual([]);
    expect(heldEvents().map(([name]) => name)).toContain('quiz_menu.lesson_held');
  });

  test('get and start refuse an Islamiyat lesson tapped from a list drawn before the hold', async () => {
    install();

    expect(await Provider.get(T1, D_ISL)).toBeNull();
    const out = await Provider.start(teacher(T1), D_ISL, { phone: PHONE[T1] });

    expect(out.outcome).toBe('unavailable');
    expect(db.tables.quizzes).toHaveLength(0);
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(
      PHONE[T1], resolveUx('tqLpLessonUnavailable', { language: 'en' }));
  });

  test('start on the Maths lesson still makes its quiz', async () => {
    install();

    const out = await Provider.start(teacher(T1), D_MATH, { phone: PHONE[T1] });

    expect(out.outcome).toBe('asked');
    expect(db.tables.quizzes).toHaveLength(1);
    expect(db.tables.quizzes[0]).toEqual(expect.objectContaining({ quiz_source: 'lp_v8', subject: 'math' }));
  });
});

describe('"make it again" on a failed lesson-plan quiz', () => {
  function failed(id, subject, lessonId) {
    return {
      id, teacher_id: T1, quiz_source: 'lp_v8', status: 'failed', subject, grade: '5', topic: 'Lesson',
      created_at: TOOK_AT,
      meta: {
        error: 'model_failed', source: 'list', remakes: 0,
        lessons: [{ lesson_id: lessonId, asset_id: 'a', version_stamp: 'v8.2026-09-01', content_hash: 'h', delivered_at: TOOK_AT }],
        class: { grade: 5, subject },
      },
    };
  }
  const Q_ISL = 'bbbbbbbb-0000-4000-8000-000000000001';
  const Q_MATH = 'bbbbbbbb-0000-4000-8000-000000000002';

  test('an Islamiyat quiz that failed before the hold is not offered again and is not re-queued', async () => {
    const quiz = failed(Q_ISL, 'islamiat', ISL);
    install({ quizzes: [quiz] });

    expect(QuizSources.lpRemakeableQuiz(quiz)).toBe(false);
    const remade = await TranscriptQuizOffer.remakeLpQuiz({ quiz, phone: PHONE[T1], teacherLang: 'en', source: 'list' });

    expect(remade).toBe(false);
    expect(db.tables.quizzes[0].status).toBe('failed');
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.remake_refused', expect.objectContaining({ reason: REASON }));
  });

  test('a failed Maths quiz is made again exactly as before', async () => {
    const quiz = failed(Q_MATH, 'math', MATH);
    install({ quizzes: [quiz] });

    expect(QuizSources.lpRemakeableQuiz(quiz)).toBe(true);
    const remade = await TranscriptQuizOffer.remakeLpQuiz({ quiz, phone: PHONE[T1], teacherLang: 'en', source: 'list' });

    expect(remade).toBe(true);
    expect(db.tables.quizzes[0].status).toBe('generating');
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
  });
});

describe('which lessons are held', () => {
  // Required here, not at the top: before the hold existed this module did not, and the suites
  // above must still RUN against that code and fail on behaviour, not on a missing file.
  const hold = () => require('../../bot/shared/services/quiz/lp-religious-hold');

  test.each([
    ['islamiat'], ['Islamiyat'], ['ISLAMIAT'], ['اسلامیات'], ['Islamic Studies'], ['islamiyaat'],
  ])('the subject %s is held', (subject) => {
    expect(hold().isHeldLesson({ subject, lesson_id: MATH })).toBe(true);
  });

  test.each([
    ['math'], ['maths'], ['english'], ['urdu'], ['general_science'], ['social_studies'],
    ['general_knowledge'], ['general_knowledge_ur'], ['social_studies_ur'],
  ])('the subject %s is not held', (subject) => {
    expect(hold().isHeldLesson({ subject, lesson_id: MATH })).toBe(false);
  });

  test('a row with no subject is judged by its catalogue book', () => {
    expect(hold().isHeldLesson({ subject: null, lesson_id: ISL })).toBe(true);
    expect(hold().isHeldLesson({ subject: '', lesson_id: MATH })).toBe(false);
    expect(hold().isHeldLesson({ subject: null, lesson_id: 'not_in_the_catalogue' })).toBe(false);
  });

  test('the reason is the one the nudge store accepts', () => {
    const Store = jest.requireActual('../../bot/shared/services/nudges/teacher-nudges.store');
    expect(hold().HELD_REASON).toBe(REASON);
    expect(Store.SKIP_REASONS).toContain(REASON);
    expect(Offer.SKIP_REASONS_USED).toContain(REASON);
  });
});

describe('Urdu chapters 1–3 (Hamd, Naat, the Prophet\'s life) are held like Islamiyat', () => {
  // Every K-5 Urdu book opens with them (bot/data/lp_catalog.json grade_1_urdu .. grade_5_urdu, chapters 1-3).
  const hold = () => require('../../bot/shared/services/quiz/lp-religious-hold');
  const URDU_NAAT = 'grade_5_urdu_ch2_seg1';
  const URDU_HAMD = 'grade_5_urdu_ch1_seg1';
  const URDU_STORY = 'grade_5_urdu_ch4_seg1';
  const T3 = '33333333-3333-4333-8333-000000000003';   // Naat + a story lesson
  const T4 = '44444444-4444-4444-8444-000000000004';   // Hamd only
  const URDU = [
    download('aaaaaaaa-0000-4000-8000-000000000011', T3, URDU_NAAT, 'urdu', 'asset-naat'),
    download('aaaaaaaa-0000-4000-8000-000000000012', T3, URDU_STORY, 'urdu', 'asset-story'),
    download('aaaaaaaa-0000-4000-8000-000000000013', T4, URDU_HAMD, 'urdu', 'asset-hamd'),
  ];

  test('the cohort offers the story lesson, never the Naat, and skips a Hamd-only teacher with the hold\'s reason', async () => {
    PHONE[T3] = '923005556666';
    PHONE[T4] = '923007778888';
    install({
      niete_lp_downloads: URDU,
      niete_lp_assets: URDU.map((d) => ({ id: d.asset_id, asset_kind: 'lesson' })),
      niete_lp_asset_sources: URDU.map((d) => ({
        lesson_id: d.lesson_id, version_stamp: d.version_stamp, content_hash: d.content_hash,
      })),
      users: [teacher(T3), teacher(T4)],
    });
    await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: SEND_AT });

    const t3 = db.tables.teacher_nudges.find((r) => r.user_id === T3);
    const t4 = db.tables.teacher_nudges.find((r) => r.user_id === T4);
    expect(t3.status).toBe('pending');
    expect(t3.context.classes.flatMap((c) => c.lessons.map((l) => l.lesson_id))).toEqual([URDU_STORY]);
    expect(t4.status).toBe('skipped');
    expect(t4.context.skip_reason).toBe(REASON);
  });

  test.each([
    'grade_1_urdu_ch1_seg1', 'grade_1_urdu_ch3_seg1', 'grade_2_urdu_ch2_seg1', 'grade_3_urdu_ch2_seg1',
    'grade_4_urdu_ch3_seg1', 'grade_5_urdu_ch1_seg1', 'grade_5_urdu_ch3_seg1',
  ])('%s is held', (lessonId) => {
    expect(hold().isHeldLesson({ subject: 'urdu', lesson_id: lessonId })).toBe(true);
  });

  test.each([
    'grade_5_urdu_ch4_seg1', 'grade_1_urdu_ch4_seg1', 'grade_5_urdu_ch10_seg1', 'grade_5_urdu_ch13_seg1',
  ])('%s is not held', (lessonId) => {
    expect(hold().isHeldLesson({ subject: 'urdu', lesson_id: lessonId })).toBe(false);
  });
});
