'use strict';
/**
 * /quiz lists the K-5 lesson plans a teacher TOOK — before any quiz exists —
 * and makes the quiz only when the teacher taps one, exactly as it does for a
 * recorded lesson. One quiz per lesson, whichever door asked (a /quiz tap, a
 * double tap, two replicas, the 15:00 offer).
 *
 * Production, 14 days to 24 Sep 2026: 54 teachers who typed "quiz" were told
 * "No lessons yet"; 21 of them had taken a K-5 lesson plan in the two weeks
 * before. The menu enumerated recordings and existing quizzes only.
 *
 * Driven through the real list service, the real provider registry, the real
 * lesson claim and the real 15:00 offer; the mocks stop at the network
 * boundary — an in-memory Supabase that REMEMBERS writes (a second tap must see
 * the first tap's quiz), a Redis map, WhatsApp and the queue.
 */

const { makeDb } = require('./helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));
const mockStore = new Map();
let mockSetNxFailsOpen = false;
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: { get: jest.fn(async () => null), set: jest.fn(), del: jest.fn() },
  isAvailable: () => true,
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return true; }),
  setNX: jest.fn(async (k, v) => {
    if (mockSetNxFailsOpen) return true;                 // Redis down: the store behaves as "claimed"
    if (mockStore.has(k)) return false;
    mockStore.set(k, v);
    return true;
  }),
  delete: jest.fn(async (k) => { mockStore.delete(k); return true; }),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm-1' }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockLogEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => {
  const actual = jest.requireActual('../../bot/shared/utils/structured-logger');
  return { ...actual, logEvent: (...a) => mockLogEvent(...a) };
});

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');
const Providers = require('../../bot/shared/services/quiz/quiz-lesson-providers');
const LpQuizOffer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

const T = 'u-teacher';
const OTHER = 'u-other';
const PHONE = '923001112222';
const USER = { id: T, preferred_language: 'en', phone_number: PHONE, role: 'teacher' };
const cp = (s) => [...String(s || '')].length;

/** A timestamp `days` ago at `hourPkt` o'clock Pakistan time. */
function pkt(days, hourPkt) {
  const d = new Date(Date.now() - days * 86400000);
  const ymd = new Date(d.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  return new Date(`${ymd}T${String(hourPkt).padStart(2, '0')}:00:00+05:00`).toISOString();
}

const asset = (id, lessonId, kind = 'lesson') => ({
  id, lesson_id: lessonId, asset_kind: kind, version_stamp: `v8-${id}`, content_hash: `h-${id}`, is_current: true,
});
const source = (a) => ({
  asset_id: a.id, lesson_id: a.lesson_id, version_stamp: a.version_stamp, content_hash: a.content_hash,
  slide_script: { meta: { topic: 'x' } }, verified: 'backfill:link',
});
const download = (id, a, createdAt, extra = {}) => ({
  id, user_id: T, lesson_id: a.lesson_id, asset_id: a.id, version_stamp: a.version_stamp, content_hash: a.content_hash,
  status: 'sent', grade: Number(a.lesson_id.split('_')[1]), subject: a.lesson_id.split('_').slice(2, -2).join('_'),
  created_at: createdAt, ...extra,
});

const A_MATH = asset('a-math', 'grade_4_math_ch1_seg1');
const A_URDU = asset('a-urdu', 'grade_4_urdu_ch2_seg3');
const A_ENG = asset('a-eng', 'grade_4_english_ch3_seg1');
const A_SCI = asset('a-sci', 'grade_5_general_science_ch1_seg1');
const A_ASSESS = asset('a-assess', 'grade_4_math_ch1_seg995');
const A_KEY = asset('a-key', 'grade_3_math_ch2_seg1', 'answer_key');

function seed({ coveredEnglish = false, sessions = [] } = {}) {
  const quizzes = coveredEnglish ? [{
    id: 'q-eng', teacher_id: T, quiz_source: 'lp_v8', status: 'sent', topic: 'Vocabulary', subject: 'english',
    language: 'en', coaching_session_id: null, created_at: pkt(3, 16),
    meta: { lessons: [{ lesson_id: A_ENG.lesson_id, content_hash: A_ENG.content_hash }], lesson_date: pkt(3, 12).slice(0, 10) },
  }] : [];
  return {
    users: [{ id: T, phone_number: PHONE, preferred_language: 'en', role: 'teacher' }],
    niete_lp_assets: [A_MATH, A_URDU, A_ENG, A_SCI, A_ASSESS, A_KEY],
    // A_SCI has a source row for ANOTHER version: its served PDF cannot be quizzed.
    niete_lp_asset_sources: [source(A_MATH), source(A_URDU), source(A_ENG), source(A_ASSESS),
      { ...source(A_SCI), content_hash: 'h-some-other-render' }],
    niete_lp_downloads: [
      download('d-math', A_MATH, pkt(2, 9)),
      download('d-math-old', A_MATH, pkt(6, 9)),                  // the same lesson taken again: one row
      download('d-urdu', A_URDU, pkt(1, 15)),                     // after 14:00 → the next school day
      download('d-eng', A_ENG, pkt(3, 10)),                       // covered by q-eng when coveredEnglish
      download('d-sci', A_SCI, pkt(1, 9)),                        // no source for the served version
      download('d-assess', A_ASSESS, pkt(1, 10)),                 // an assessment day
      download('d-key', A_KEY, pkt(1, 11)),                       // an answer key
      download('d-failed', A_MATH, pkt(0, 8), { status: 'failed' }),
      download('d-old', A_URDU, pkt(45, 9), { id: 'd-old' }),     // outside the 30-day window
      download('d-other', A_MATH, pkt(1, 9), { user_id: OTHER }),
    ],
    coaching_sessions: sessions,
    quizzes,
    quiz_sessions: [],
    teacher_nudges: [],
  };
}

const session = (id, createdAt) => ({
  id, user_id: T, status: 'completed', observation_type: null, created_at: createdAt,
  transcript_text: 'x'.repeat(4000), analysis_data: { topic: `Recorded ${id}`, subject: 'science' },
});

/** An lp_v8 quiz made for the Urdu lesson two days ago (before the lesson's offer day began). */
const coveringQuiz = () => ({
  id: 'q-made-earlier', teacher_id: T, quiz_source: 'lp_v8', status: 'sent', created_at: pkt(2, 8),
  meta: { lessons: [{ lesson_id: A_URDU.lesson_id }] },
});
const nudgeRow = (nudgeDate) => mockDb.tables.teacher_nudges.find((n) => n.user_id === T && n.nudge_date === nudgeDate);

const listRows = () => WhatsAppService.sendInteractiveMessage.mock.calls.slice(-1)[0][1].action.sections[0].rows;
const quizRows = () => mockDb.tables.quizzes.filter((q) => q.quiz_source === 'lp_v8');

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockSetNxFailsOpen = false;
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_ENABLED = '1';
  mockDb = makeDb(seed());
});

describe('the provider registry', () => {
  test('PROVIDERS carries a transcript and an lp_v8 provider, each {source, labelKey, list, start}', () => {
    const bySource = Object.fromEntries(Providers.PROVIDERS.map((p) => [p.source, p]));
    expect(Object.keys(bySource)).toEqual(expect.arrayContaining(['transcript', 'lp_v8']));
    for (const p of Providers.PROVIDERS) {
      expect(typeof p.list).toBe('function');
      expect(typeof p.start).toBe('function');
      for (const language of ['en', 'ur']) {
        const label = resolveUx(p.labelKey, { language });
        expect(label).toBeTruthy();
        expect(cp(label)).toBeLessThanOrEqual(20);
      }
    }
    expect(resolveUx(bySource.lp_v8.labelKey, { language: 'en' })).toBe('From lesson plan');
    expect(resolveUx(bySource.transcript.labelKey, { language: 'en' })).toBe('From transcript');
  });
});

describe('lp_v8 provider — list()', () => {
  test('only the teacher\'s own recent K-5 lessons whose served version resolves, one row per lesson, newest first', async () => {
    const items = await Providers.providerFor('lp_v8').list(T, { limit: 20 });
    expect(items.map((i) => i.lessonRef)).toEqual(['d-urdu', 'd-math', 'd-eng']);
    const urdu = items[0];
    expect(urdu).toEqual(expect.objectContaining({
      source: 'lp_v8', lessonId: A_URDU.lesson_id, grade: 4, subject: 'urdu',
    }));
    // D2: taken after 14:00 → dated the next school day, as the 15:00 offer would.
    expect(urdu.date.slice(0, 10)).toBe(LpQuizOffer.cohortRuleDate(pkt(1, 15)));
    // The catalog's own name for the lesson — the name on the PDF.
    expect(items[1].topic).toBe('Place value & reading 5-digit numbers');
    expect(mockLogEvent).toHaveBeenCalledWith('quiz_menu.lesson_listed', expect.objectContaining({
      userId: T, source: 'lp_v8', listed: 3,
    }));
  });

  test('a lesson that already has a quiz is not listed as a lesson (its quiz row stands for it)', async () => {
    mockDb = makeDb(seed({ coveredEnglish: true }));
    const items = await Providers.providerFor('lp_v8').list(T, { limit: 20 });
    expect(items.map((i) => i.lessonRef)).toEqual(['d-urdu', 'd-math']);
  });

  test('the source store missing (V1.5.2 not applied, as on production today) lists NO lesson and names that state', async () => {
    mockDb = makeDb(seed(), { failTables: ['niete_lp_asset_sources'] });
    const items = await Providers.providerFor('lp_v8').list(T, { limit: 20 });
    expect(items).toEqual([]);
    expect(mockLogEvent).toHaveBeenCalledWith('quiz_menu.lesson_list_failed', expect.objectContaining({
      userId: T, source: 'lp_v8', reason: 'source_store_missing',
    }));
  });

  test('…and the recordings are still listed around it', async () => {
    mockDb = makeDb(seed({ sessions: [session('s-1', pkt(1, 9))] }), { failTables: ['niete_lp_asset_sources'] });
    await List.showList(USER, PHONE, 'en', 1);
    expect(listRows().map((r) => r.id)).toEqual(['tq_pick_s-1']);
  });

  test('any other read failure lists no lesson and is logged as an error with its own reason', async () => {
    mockDb = makeDb(seed(), { failTables: { niete_lp_assets: { message: 'canceling statement due to statement timeout', code: '57014' } } });
    const Logger = require('../../bot/shared/utils/logger');
    const items = await Providers.providerFor('lp_v8').list(T, { limit: 20 });
    expect(items).toEqual([]);
    expect(mockLogEvent).toHaveBeenCalledWith('quiz_menu.lesson_list_failed', expect.objectContaining({
      userId: T, source: 'lp_v8', reason: 'read_failed',
    }));
    expect(Logger.logToFile).toHaveBeenCalledWith(expect.stringContaining('could not be listed'), expect.any(Object), 'error');
  });
});

describe('/quiz list message — recordings and lesson plans, labelled', () => {
  test('two recordings + lesson plans: one list, newest first, every row says where it came from', async () => {
    mockDb = makeDb(seed({ sessions: [session('s-new', pkt(0, 9)), session('s-old', pkt(4, 9))] }));
    await List.showList(USER, PHONE, 'en', 1);
    const rows = listRows();
    // ONE sort by the lesson's date: a recording by when it was made, a lesson
    // plan by the school day it is for (D2), whichever day of the week this runs.
    const lessonDay = (at) => `${LpQuizOffer.cohortRuleDate(at)}T12:00:00+05:00`;
    const expected = [
      ['tq_pick_s-new', pkt(0, 9)], ['tq_pick_s-old', pkt(4, 9)],
      ['tq_pick_lsn_lp_v8_d-urdu', lessonDay(pkt(1, 15))], ['tq_pick_lsn_lp_v8_d-math', lessonDay(pkt(2, 9))],
      ['tq_pick_lsn_lp_v8_d-eng', lessonDay(pkt(3, 10))],
    ].sort((a, b) => new Date(b[1]) - new Date(a[1])).map(([id]) => id);
    expect(rows.map((r) => r.id)).toEqual(expected);
    const lp = resolveUx('tqRowFromLessonPlan', { language: 'en' });
    const tr = resolveUx('tqRowFromTranscript', { language: 'en' });
    rows.forEach((r) => {
      const label = r.id.startsWith('tq_pick_lsn_lp_v8_') ? lp : tr;
      expect(r.description.startsWith(`${label} · `)).toBe(true);
    });
    // The status rides after the topic when the three fit (this maths topic does).
    const math = rows.find((r) => r.id === 'tq_pick_lsn_lp_v8_d-math');
    expect(math.description).toBe(`${lp} · Place value & reading 5-digit numbers · ${resolveUx('tqRowNoQuiz', { language: 'en' })}`);
    rows.forEach((r) => { expect(cp(r.title)).toBeLessThanOrEqual(24); expect(cp(r.description)).toBeLessThanOrEqual(72); });
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalledWith(PHONE, resolveUx('tqListEmpty', { language: 'en' }));
  });

  test('only lesson plans: the list, never "no lessons yet"', async () => {
    await List.showList(USER, PHONE, 'en', 1);
    expect(listRows()).toHaveLength(3);
    expect(await List.hasEligibleLessons(T)).toBe(true);
  });

  test('Urdu rows carry the Urdu label', async () => {
    await List.showList({ ...USER, preferred_language: 'ur' }, PHONE, 'ur', 1);
    const label = resolveUx('tqRowFromLessonPlan', { language: 'ur' });
    listRows().forEach((r) => expect(r.description.startsWith(`${label} · `)).toBe(true));
  });
});

describe('the labelled row description (72 code points)', () => {
  const { composeLabelledDescription: compose } = require('../../bot/shared/services/quiz/transcript-quiz-rows');
  const long = 'Chapter Vocabulary (Memory Lane + Word Wizardry) and a great deal more besides';

  test('label, topic and status when they fit', () => {
    expect(compose({ label: 'From lesson plan', topic: 'Fractions', status: 'No quiz yet' }, 72, { language: 'en' }))
      .toBe('From lesson plan · Fractions · No quiz yet');
  });
  test('the status gives before the topic (the list\'s standing rule)', () => {
    const out = compose({ label: 'From lesson plan', topic: 'Chapter Vocabulary (Memory Lane + Word Wizardry)', status: 'No quiz yet' }, 72, { language: 'en' });
    expect(out).toBe('From lesson plan · Chapter Vocabulary (Memory Lane + Word Wizardry)');
  });
  test('the topic is word-cut only when the label and the topic alone overflow — the label always survives', () => {
    for (const language of ['en', 'ur']) {
      const label = resolveUx('tqRowFromLessonPlan', { language });
      const out = compose({ label, topic: long, status: 'x' }, 72, { language });
      expect(out.startsWith(`${label} · `)).toBe(true);
      expect(cp(out)).toBeLessThanOrEqual(72);
      expect(out).toMatch(/…/);
    }
  });
});

describe('a tap makes the quiz — and only then', () => {
  test('nothing is generated by listing: no quiz row, no job', async () => {
    await List.showList(USER, PHONE, 'en', 1);
    expect(quizRows()).toHaveLength(0);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('a maths lesson: the quiz row the 15:00 offer would write, waiting for the language answer', async () => {
    await List.handleListPick('tq_pick_lsn_lp_v8_d-math', PHONE, USER);
    const [q] = quizRows();
    expect(q).toEqual(expect.objectContaining({
      teacher_id: T, quiz_source: 'lp_v8', coaching_session_id: null, status: 'offered', subject: 'math', grade: '4',
      topic: 'Place value & reading 5-digit numbers',
    }));
    expect(q.meta).toEqual(expect.objectContaining({
      awaiting_language: true, source: 'list',
      lessons: [expect.objectContaining({
        lesson_id: A_MATH.lesson_id, asset_id: A_MATH.id, version_stamp: A_MATH.version_stamp, content_hash: A_MATH.content_hash,
      })],
      class: { grade: 4, subject: 'math' },
      lesson_date: LpQuizOffer.cohortRuleDate(pkt(2, 9)),
    }));
    // The same ask the offer and the recording use: tq_lang_<code>_<quizId>.
    const buttons = WhatsAppService.sendInteractiveButtons.mock.calls[0][1].buttons.map((b) => b.id);
    expect(buttons).toEqual(expect.arrayContaining([`tq_lang_en_${q.id}`, `tq_lang_ur_${q.id}`]));
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith('quiz_menu.lesson_picked', expect.objectContaining({
      userId: T, source: 'lp_v8', quizId: q.id, outcome: 'asked',
    }));
  });

  test('an Urdu lesson (no language choice): generating at once, one quiz_generate job, "making it now"', async () => {
    await List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER);
    const [q] = quizRows();
    expect(q.status).toBe('generating');
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
    expect(SQS.queueJob).toHaveBeenCalledWith(q.id, 'quiz_generate', expect.objectContaining({ quizId: q.id }), expect.anything());
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('lpQuizMaking', { language: 'en' }));
    // The funnel's one "accepted" for a quiz born in the menu (ids only).
    expect(mockLogEvent).toHaveBeenCalledWith('quiz_funnel.accepted', expect.objectContaining({
      quiz_id: q.id, source: 'lp_v8', channel: 'quiz_menu',
    }));
  });

  test('after the tap the lesson is its QUIZ row in /quiz, not a second lesson row', async () => {
    await List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER);
    const [q] = quizRows();
    await List.showList(USER, PHONE, 'en', 1);
    const ids = listRows().map((r) => r.id);
    expect(ids).toContain(`tq_pick_lp_${q.id}`);
    expect(ids).not.toContain('tq_pick_lsn_lp_v8_d-urdu');
  });

  test('a lesson whose source does not resolve is never made (a stale row)', async () => {
    await List.handleListPick('tq_pick_lsn_lp_v8_d-sci', PHONE, USER);
    expect(quizRows()).toHaveLength(0);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('tqLpLessonUnavailable', { language: 'en' }));
  });

  test('another teacher\'s lesson is never made', async () => {
    await List.handleListPick('tq_pick_lsn_lp_v8_d-other', PHONE, USER);
    expect(quizRows()).toHaveLength(0);
  });
});

describe('one quiz per lesson', () => {
  test('a double tap makes one quiz and queues one job', async () => {
    await List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER);
    await List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER);
    expect(quizRows()).toHaveLength(1);
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
  });

  test('two replicas at the same instant make one quiz', async () => {
    await Promise.all([
      List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER),
      List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER),
    ]);
    expect(quizRows()).toHaveLength(1);
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
  });

  test('…and still one when Redis is down (the lock fails open; the re-read decides)', async () => {
    mockSetNxFailsOpen = true;
    await Promise.all([
      List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER),
      List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER),
    ]);
    expect(quizRows()).toHaveLength(1);
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
  });

  test('the 15:00 offer tapped for a lesson /quiz already made a quiz for makes no second quiz', async () => {
    await List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER);
    const [made] = quizRows();
    const nudgeId = 'aaaaaaaa-1111-4111-8111-111111111111';
    mockDb.tables.teacher_nudges.push({
      id: nudgeId, user_id: T, kind: 'lp_quiz_offer', status: 'sent', nudge_date: made.meta.lesson_date,
      sent_at: new Date().toISOString(), scheduled_at: new Date().toISOString(), quiz_id: null, choice: null,
      context: { classes: [{ key: 'g4_urdu', grade: 4, subject: 'urdu', lessons: [made.meta.lessons[0]] }] },
    });
    SQS.queueJob.mockClear();
    await LpQuizOffer.handleButton(`lpquiz_yes_${nudgeId}`, PHONE, USER);
    expect(quizRows()).toHaveLength(1);
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('lpQuizAlreadyHave', { language: 'en' }));
  });

  test('a quiz the 15:00 offer made covers its lessons: /quiz lists it once, and a stale lesson tap makes nothing', async () => {
    const nudgeId = 'bbbbbbbb-2222-4222-8222-222222222222';
    const lesson = {
      lesson_id: A_URDU.lesson_id, asset_id: A_URDU.id, version_stamp: A_URDU.version_stamp,
      content_hash: A_URDU.content_hash, delivered_at: pkt(1, 15),
    };
    mockDb.tables.teacher_nudges.push({
      id: nudgeId, user_id: T, kind: 'lp_quiz_offer', status: 'sent', nudge_date: LpQuizOffer.cohortRuleDate(pkt(1, 15)),
      sent_at: new Date().toISOString(), scheduled_at: new Date().toISOString(), quiz_id: null, choice: null,
      context: { classes: [{ key: 'g4_urdu', grade: 4, subject: 'urdu', lessons: [lesson] }] },
    });
    await LpQuizOffer.handleButton(`lpquiz_yes_${nudgeId}`, PHONE, USER);
    expect(quizRows()).toHaveLength(1);
    await List.showList(USER, PHONE, 'en', 1);
    expect(listRows().map((r) => r.id)).not.toContain('tq_pick_lsn_lp_v8_d-urdu');
    SQS.queueJob.mockClear();
    await List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER);
    expect(quizRows()).toHaveLength(1);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('the 15:00 cohort drops a lesson that already has a quiz', async () => {
    // The Urdu lesson (taken after 14:00) counts for the next school day. Its quiz was made from
    // /quiz before that day began, so the day's own "offered today" check cannot be what stops it.
    mockDb.tables.quizzes.push(coveringQuiz());
    const nudgeDate = LpQuizOffer.cohortRuleDate(pkt(1, 15));
    await LpQuizOffer.buildCohort({ nudgeDate, now: new Date() });
    const row = nudgeRow(nudgeDate);
    // The teacher's only lesson for the day is covered: counted, and not offered.
    expect(row.status).toBe('skipped');
    expect(row.context.skip_reason).toBe('no_lesson');
  });
});

// ── kill switches (operator, 24 Sep): unset = on; 'false' / '0' / 'off' = the old behaviour, exactly ──

describe('kill switch QUIZ_MENU_LESSON_ROWS=false — /quiz and the 15:00 offer as before', () => {
  beforeEach(() => { process.env.QUIZ_MENU_LESSON_ROWS = 'false'; });
  afterEach(() => { delete process.env.QUIZ_MENU_LESSON_ROWS; });

  test('no lesson-plan row; a teacher with only lesson plans gets the old "No lessons yet" line', async () => {
    await List.showList(USER, PHONE, 'en', 1);
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('tqListEmpty', { language: 'en' }));
    expect(resolveUx('tqListEmpty', { language: 'en' })).toMatch(/^No lessons yet\. Record a lesson for coaching first/);
    expect(await List.hasEligibleLessons(T)).toBe(false);
  });

  test('a lesson-plan row from an older list makes nothing', async () => {
    await List.handleListPick('tq_pick_lsn_lp_v8_d-urdu', PHONE, USER);
    expect(quizRows()).toHaveLength(0);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('the 15:00 offer\'s tap inserts its own quiz with no lesson claim, as before', async () => {
    const lesson = {
      lesson_id: A_URDU.lesson_id, asset_id: A_URDU.id, version_stamp: A_URDU.version_stamp,
      content_hash: A_URDU.content_hash, delivered_at: pkt(1, 15),
    };
    mockDb.tables.quizzes.push({
      id: 'q-made', teacher_id: T, quiz_source: 'lp_v8', status: 'sent', created_at: new Date().toISOString(),
      meta: { lessons: [lesson] },
    });
    const nudgeId = 'cccccccc-3333-4333-8333-333333333333';
    mockDb.tables.teacher_nudges.push({
      id: nudgeId, user_id: T, kind: 'lp_quiz_offer', status: 'sent', nudge_date: LpQuizOffer.cohortRuleDate(pkt(1, 15)),
      sent_at: new Date().toISOString(), scheduled_at: new Date().toISOString(), quiz_id: null, choice: null,
      context: { classes: [{ key: 'g4_urdu', grade: 4, subject: 'urdu', lessons: [lesson] }] },
    });
    await LpQuizOffer.handleButton(`lpquiz_yes_${nudgeId}`, PHONE, USER);
    expect(quizRows()).toHaveLength(2);
    expect(mockStore.size).toBe(0);                     // no lesson lock was ever taken
  });

  test('the cohort is built without the covered-lesson filter, as before', async () => {
    mockDb.tables.quizzes.push(coveringQuiz());
    const nudgeDate = LpQuizOffer.cohortRuleDate(pkt(1, 15));
    await LpQuizOffer.buildCohort({ nudgeDate, now: new Date() });
    const row = nudgeRow(nudgeDate);
    expect(row.status || 'pending').toBe('pending');      // the column's DEFAULT: not skipped
    const lessons = row.context.classes.flatMap((c) => c.lessons.map((l) => l.lesson_id));
    expect(lessons).toContain(A_URDU.lesson_id);
  });
});

describe('kill switch QUIZ_MENU_SOURCE_LABELS=false — rows read as before', () => {
  beforeEach(() => { process.env.QUIZ_MENU_SOURCE_LABELS = '0'; });
  afterEach(() => { delete process.env.QUIZ_MENU_SOURCE_LABELS; });

  test('every row is `topic · status` with no label', async () => {
    mockDb = makeDb(seed({ sessions: [session('s-1', pkt(0, 9))] }));
    await List.showList(USER, PHONE, 'en', 1);
    const rows = listRows();
    const rec = rows.find((r) => r.id === 'tq_pick_s-1');
    expect(rec.description).toBe(`Recorded s-1 · ${resolveUx('tqRowNoQuiz', { language: 'en' })}`);
    rows.forEach((r) => {
      expect(r.description.startsWith(resolveUx('tqRowFromLessonPlan', { language: 'en' }))).toBe(false);
      expect(r.description.startsWith(resolveUx('tqRowFromTranscript', { language: 'en' }))).toBe(false);
    });
  });
});
