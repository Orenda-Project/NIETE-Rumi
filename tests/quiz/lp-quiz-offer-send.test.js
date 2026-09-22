'use strict';
/**
 * R8 lane B · 5.2 — what the teacher actually receives at 15:00, and the
 * re-checks that stop it arriving when the day has moved on.
 *
 * The cohort is built at the send hour but the send is claimed and delivered
 * per row, so the facts can change in between: the teacher can be coached,
 * can accept the morning's coaching ask, and their 24-hour window can close. Every one
 * of those is re-checked HERE, against the same pure `preChecks` the build
 * used — §5.2.
 *
 * Three shapes, one rule each: one lesson names the lesson; several lessons in
 * one class name the class; more than one class becomes a list to pick from.
 * The list is where WhatsApp's own limits bite (10 rows, 24-code-point titles,
 * 72-code-point descriptions), so those are measured, in code points, against
 * every grade and subject the K-5 corpus can produce.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-09-22';          // Tuesday
const T1 = '11111111-1111-4111-8111-111111111111';

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue('m-1'),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

// Lane N's store is mocked at its contract (PLAN R8 §2.2) with an in-memory
// table that carries the UNIQUE; pkt-time is the real module.
let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

const cp = (s) => [...String(s || '')].length;
const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);
const SEND_AT = pkt(NUDGE_DATE, 15, 0);

function lesson(over = {}) {
  return {
    lesson_id: 'grade_4_math_ch2_seg1',
    asset_id: 'asset-1',
    version_stamp: 'v8.2026-09-01',
    content_hash: 'hash-aaa',
    delivered_at: pkt(NUDGE_DATE, 9, 30).toISOString(),
    topic: 'Fractions on a Number Line',
    ...over,
  };
}

function klass(over = {}) {
  return { key: 'g4_math', grade: 4, subject: 'math', lessons: [lesson()], ...over };
}

function nudgeRow(over = {}) {
  return {
    id: 'nudge-1',
    user_id: T1,
    kind: 'lp_quiz_offer',
    nudge_date: NUDGE_DATE,
    status: 'sending',
    scheduled_at: SEND_AT.toISOString(),
    sent_at: null,
    choice: null,
    quiz_id: null,
    context: { classes: [klass()] },
    ...over,
  };
}

function teacher(over = {}) {
  return {
    id: T1,
    role: 'teacher',
    is_test_user: false,
    deleted_at: null,
    school_id: 'school-1',
    region: 'Sihala',
    phone_number: '923001112222',
    preferred_language: 'en',
    last_message_at: pkt(NUDGE_DATE, 12, 0).toISOString(),
    ...over,
  };
}

function world(over = {}) {
  return {
    users: [teacher()],
    coaching_sessions: [],
    quizzes: [],
    teacher_nudges: [],
    ...over,
  };
}

let db;
function install(tables) {
  db = makeSupabase(tables);
  supabase.from.mockImplementation(db.from);
  return db;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = makeStore();
  WhatsAppService.sendInteractiveButtons.mockResolvedValue(true);
  WhatsAppService.sendInteractiveMessage.mockResolvedValue(true);
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT = '15';
  process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '0';
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
  delete process.env.LP_QUIZ_OFFER_SECTORS;
});

afterEach(() => {
  delete process.env.LP_QUIZ_OFFER_ENABLED;
  delete process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT;
  delete process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT;
  delete process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
});

const buttonsSent = () => WhatsAppService.sendInteractiveButtons.mock.calls[0][1];
const listSent = () => WhatsAppService.sendInteractiveMessage.mock.calls[0][1];
const listRows = () => listSent().action.sections.flatMap((s) => s.rows);

// ── shape 1: one lesson ──────────────────────────────────────────────────────

describe('one lesson — the offer names the lesson', () => {
  test('two buttons whose ids carry the nudge id', async () => {
    install(world());
    const res = await Offer.send(nudgeRow(), { now: SEND_AT });

    expect(res).toMatchObject({ sent: true });
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [to, payload] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe('923001112222');
    expect(payload.body).toContain('Fractions on a Number Line');
    expect(payload.buttons.map((b) => b.id)).toEqual(['lpquiz_yes_nudge-1', 'lpquiz_no_nudge-1']);
    expect(payload.buttons.map((b) => b.title)).toEqual(['Make the quiz', 'No thanks']);
  });

  test('the copy says PLANNED, never TAUGHT — there is no recording in this path', async () => {
    install(world());
    await Offer.send(nudgeRow(), { now: SEND_AT });
    expect(buttonsSent().body).toMatch(/planned/i);
    expect(buttonsSent().body).not.toMatch(/taught|recording|recorded/i);
  });

  test('an Urdu teacher is offered in Urdu', async () => {
    install(world({ users: [teacher({ preferred_language: 'ur' })] }));
    await Offer.send(nudgeRow(), { now: SEND_AT });
    expect(buttonsSent().body).toBe(UX_STRINGS.lpQuizOfferOne.ur.replace('{topic}', 'Fractions on a Number Line'));
    expect(buttonsSent().buttons[0].title).toBe(UX_STRINGS.lpQuizYes.ur);
  });

  test('a lesson whose topic is unknown still gets a readable offer', async () => {
    install(world());
    const row = nudgeRow({ context: { classes: [klass({ lessons: [lesson({ topic: null })] })] } });
    await Offer.send(row, { now: SEND_AT });
    expect(buttonsSent().body).toMatch(/\S/);
    expect(buttonsSent().body).not.toMatch(/[{}]|null|undefined/);
  });

  test('the outcome carries the shape for the sweeper to record, and the shape is logged', async () => {
    install(world());
    const res = await Offer.send(nudgeRow(), { now: SEND_AT });
    // The sweeper marks the row from this outcome; the handler never marks it
    // itself, or the row would be written twice.
    expect(res.context).toEqual(expect.objectContaining({ shape: 'one', class_count: 1 }));
    // `context.classes` is the lesson list the answer reads; the outcome is
    // MERGED into it by markSent, so a count under that name would erase it.
    expect(res.context).not.toHaveProperty('classes');
    expect(mockStore.markSent).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('lp_quiz.offer_sent',
      expect.objectContaining({ shape: 'one', classes: 1 }));
  });
});

// ── shape 2: several lessons, one class ──────────────────────────────────────

describe('several lessons in one class — the offer names the class', () => {
  test('grade, subject and the lesson count', async () => {
    install(world());
    const row = nudgeRow({
      context: { classes: [klass({ lessons: [lesson(), lesson({ lesson_id: 'grade_4_math_ch2_seg2', topic: 'Equivalent Fractions' })] })] },
    });
    await Offer.send(row, { now: SEND_AT });

    const body = buttonsSent().body;
    expect(body).toContain('Grade 4');
    expect(body).toContain('Mathematics');
    expect(body).toContain('2');
    expect(logEvent).toHaveBeenCalledWith('lp_quiz.offer_sent',
      expect.objectContaining({ shape: 'class', classes: 1 }));
  });
});

// ── shape 3: more than one class ─────────────────────────────────────────────

describe('more than one class — a list to pick from', () => {
  const twoClasses = () => nudgeRow({
    context: {
      classes: [
        klass(),
        klass({
          key: 'g5_urdu',
          grade: 5,
          subject: 'urdu',
          lessons: [lesson({ lesson_id: 'grade_5_urdu_ch1_seg1', topic: 'واحد اور جمع' })],
        }),
      ],
    },
  });

  test('one row per class, plus a Not today row last', async () => {
    install(world());
    await Offer.send(twoClasses(), { now: SEND_AT });

    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    const rows = listRows();
    expect(rows.map((r) => r.id)).toEqual([
      'lpquiz_pick_nudge-1_g4_math',
      'lpquiz_pick_nudge-1_g5_urdu',
      'lpquiz_none_nudge-1',
    ]);
    expect(rows[0].title).toBe('Grade 4 · Mathematics');
    expect(rows[0].description).toContain('Fractions on a Number Line');
    expect(rows[2].title).toBe('Not today');
    expect(logEvent).toHaveBeenCalledWith('lp_quiz.offer_sent',
      expect.objectContaining({ shape: 'list', classes: 2 }));
  });

  test('every row fits WhatsApp measured in code points', async () => {
    install(world());
    await Offer.send(twoClasses(), { now: SEND_AT });
    const list = listSent();
    expect(listRows().length).toBeLessThanOrEqual(10);
    expect(cp(list.action.button)).toBeLessThanOrEqual(20);
    for (const row of listRows()) {
      expect(cp(row.title)).toBeGreaterThan(0);
      expect(cp(row.title)).toBeLessThanOrEqual(24);
      expect(cp(row.description || '')).toBeLessThanOrEqual(72);
      expect(cp(row.id)).toBeLessThanOrEqual(200);
    }
  });

  test('a long topic is cut to the description cap rather than rejected by Meta', async () => {
    install(world());
    const row = nudgeRow({
      context: {
        classes: [
          klass({ lessons: [lesson({ topic: 'A'.repeat(200) })] }),
          klass({ key: 'g5_urdu', grade: 5, subject: 'urdu' }),
        ],
      },
    });
    await Offer.send(row, { now: SEND_AT });
    for (const r of listRows()) expect(cp(r.description || '')).toBeLessThanOrEqual(72);
  });

  test('the title fits for every grade and subject the K-5 corpus can produce, in both languages', () => {
    const grades = [1, 2, 3, 4, 5];
    const subjects = ['english', 'math', 'urdu', 'general_science', 'general knowledge', 'social studies', 'islamiat'];
    for (const language of LANGUAGE_OFFER) {
      for (const grade of grades) {
        for (const subject of subjects) {
          const title = Offer.rowTitle({ grade, subject }, language);
          expect(cp(title)).toBeGreaterThan(0);
          expect(cp(title)).toBeLessThanOrEqual(24);
        }
      }
    }
  });

  test('more than nine classes: nine rows, the rest recorded and named in the footer', async () => {
    install(world());
    const many = Array.from({ length: 12 }, (_, i) => klass({
      key: `g${(i % 5) + 1}_sub${i}`,
      grade: (i % 5) + 1,
      subject: `sub${i}`,
      lessons: [lesson({ lesson_id: `lesson-${i}`, topic: `Topic ${i}` })],
    }));
    const res = await Offer.send(nudgeRow({ context: { classes: many } }), { now: SEND_AT });

    const rows = listRows();
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.id.startsWith('lpquiz_pick_'))).toHaveLength(9);
    expect(rows[9].id).toBe('lpquiz_none_nudge-1');
    expect(listSent().footer).toContain('3');
    expect(res.context.dropped_classes).toEqual(['g5_sub9', 'g1_sub10', 'g2_sub11']);
  });

  test('nine classes exactly needs no footer and drops nothing', async () => {
    install(world());
    const nine = Array.from({ length: 9 }, (_, i) => klass({
      key: `g${(i % 5) + 1}_sub${i}`, grade: (i % 5) + 1, subject: `sub${i}`,
      lessons: [lesson({ lesson_id: `lesson-${i}`, topic: `Topic ${i}` })],
    }));
    await Offer.send(nudgeRow({ context: { classes: nine } }), { now: SEND_AT });
    expect(listRows()).toHaveLength(10);
    expect(listSent().footer).toBeUndefined();
  });
});

// ── the re-checks ────────────────────────────────────────────────────────────

describe('send-time re-checks — the day may have moved on since 15:00', () => {
  test('a teacher who has not written in 24 hours is out of the free-form window (D3)', async () => {
    install(world({ users: [teacher({ last_message_at: pkt('2026-09-21', 8, 0).toISOString() })] }));
    const res = await Offer.send(nudgeRow(), { now: SEND_AT });
    expect(res).toEqual({ skipped: 'window_closed' });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('a teacher coached since the build is not also offered', async () => {
    install(world({
      coaching_sessions: [{ id: 'cs-1', user_id: T1, created_at: pkt(NUDGE_DATE, 14, 50).toISOString() }],
    }));
    const res = await Offer.send(nudgeRow(), { now: SEND_AT });
    expect(res).toEqual({ skipped: 'coached_today' });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('a teacher who already has a quiz today is not offered another', async () => {
    install(world({
      quizzes: [{ id: 'q-1', teacher_id: T1, created_at: pkt(NUDGE_DATE, 11, 0).toISOString() }],
    }));
    expect(await Offer.send(nudgeRow(), { now: SEND_AT })).toEqual({ skipped: 'offered_today' });
  });

  test('a teacher who said yes to the coaching ask gets the coaching-born offer instead (D5)', async () => {
    mockStore = makeStore([{
      id: 'nudge-a', user_id: T1, kind: 'coaching_after_lp', nudge_date: NUDGE_DATE,
      status: 'sent', choice: 'yes',
    }]);
    install(world());
    expect(await Offer.send(nudgeRow(), { now: SEND_AT })).toEqual({ skipped: 'coaching_yes_today' });
  });

  test('a second lp_quiz_offer row already sent today never sends twice', async () => {
    mockStore = makeStore([{
      id: 'nudge-0', user_id: T1, kind: 'lp_quiz_offer', nudge_date: NUDGE_DATE, status: 'sent',
    }]);
    install(world());
    expect(await Offer.send(nudgeRow(), { now: SEND_AT })).toEqual({ skipped: 'sent_today' });
  });

  test('a row whose classes vanished is a no_lesson skip, not an empty message', async () => {
    install(world());
    const res = await Offer.send(nudgeRow({ context: { classes: [] } }), { now: SEND_AT });
    expect(res).toEqual({ skipped: 'no_lesson' });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('the flag pulled between the build and the send stops the send', async () => {
    delete process.env.LP_QUIZ_OFFER_ENABLED;
    install(world());
    expect(await Offer.send(nudgeRow(), { now: SEND_AT })).toEqual({ skipped: 'disabled' });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('a teacher whose record is gone is a failure the sweeper can retry, not a silent success', async () => {
    install(world({ users: [] }));
    await expect(Offer.send(nudgeRow(), { now: SEND_AT })).rejects.toThrow(/user/i);
  });

  test('a deleted teacher is a failure, not an offer — filtered in code, never named to PostgREST', async () => {
    install(world({ users: [teacher({ deleted_at: '2026-09-01T00:00:00Z' })] }));
    await expect(Offer.send(nudgeRow(), { now: SEND_AT })).rejects.toThrow(/user/i);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('a WhatsApp refusal is raised, never marked sent', async () => {
    install(world());
    WhatsAppService.sendInteractiveButtons.mockResolvedValue(false);
    await expect(Offer.send(nudgeRow(), { now: SEND_AT })).rejects.toThrow();
    expect(mockStore.markSent).not.toHaveBeenCalled();
  });
});

// ── the topic the build stamps on each lesson ────────────────────────────────

describe('the catalog topic is resolved once, at build time', () => {
  test('a real K-5 lesson id carries its topic into the offer context', () => {
    const [grouped] = Offer.groupLessons([{
      user_id: T1, lesson_id: 'grade_1_english_ch1_seg1', asset_id: 'a-1',
      version_stamp: 'v', content_hash: 'h', grade: 1, subject: 'english',
      created_at: pkt(NUDGE_DATE, 9, 0).toISOString(),
    }]);
    expect(grouped.classes[0].lessons[0].topic).toBe('All About Me: Key Words');
  });

  test('a lesson id the catalog has never heard of carries no topic, and does not throw', () => {
    const [grouped] = Offer.groupLessons([{
      user_id: T1, lesson_id: 'not_a_real_lesson', asset_id: 'a-1',
      version_stamp: 'v', content_hash: 'h', grade: 1, subject: 'english',
      created_at: pkt(NUDGE_DATE, 9, 0).toISOString(),
    }]);
    expect(grouped.classes[0].lessons[0].topic).toBeNull();
  });
});

// ── through the real sweeper ─────────────────────────────────────────────────

describe('registered with the sweeper — the claimed row is sent and marked once', () => {
  const Sweeper = require('../../bot/shared/services/nudges/teacher-nudges.sweeper');

  beforeEach(() => { process.env.TEACHER_NUDGES_ENABLED = 'true'; });
  afterEach(() => { delete process.env.TEACHER_NUDGES_ENABLED; });

  test('a due pending row is claimed, offered, and marked sent with its shape', async () => {
    mockStore = makeStore([nudgeRow({ status: 'pending' })]);
    install(world());
    const counts = await Sweeper.runSweep({ now: SEND_AT });

    expect(counts).toMatchObject({ claimed: 1, sent: 1, skipped: 0, failed: 0 });
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    expect(mockStore.markSent).toHaveBeenCalledTimes(1);
    expect(mockStore.rows[0].status).toBe('sent');
    expect(mockStore.rows[0].context.shape).toBe('one');
  });

  test('a send-time re-check is recorded once, as a skip with its reason', async () => {
    mockStore = makeStore([nudgeRow({ status: 'pending' })]);
    install(world({ users: [teacher({ last_message_at: pkt('2026-09-21', 8, 0).toISOString() })] }));
    const counts = await Sweeper.runSweep({ now: SEND_AT });

    expect(counts).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(mockStore.markSkipped).toHaveBeenCalledTimes(1);
    expect(mockStore.rows[0].context.skip_reason).toBe('window_closed');
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });
});
