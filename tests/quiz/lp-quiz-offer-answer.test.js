'use strict';
/**
 * R8 lane B · 5.3 — what a tap on the 15:00 offer does.
 *
 * Yes (or a class picked from the list) makes exactly ONE lp_v8 quiz, however
 * many times it is tapped and however many replicas handle the taps: each tap
 * inserts a quizzes row, and only the tap whose conditional
 * `teacher_nudges.quiz_id IS NULL` update wins may queue `quiz_generate`. The
 * loser removes its own row and tells the teacher the quiz is already coming.
 *
 * The quiz row is asserted field by field against PLAN_R8 §2.3, because lane D's
 * generate step reads it: `quiz_source='lp_v8'`, no coaching session, no lesson
 * plan row, `meta.lessons[]` carrying the served version keys of the download.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-09-22';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const NID = '33333333-3333-4333-8333-333333333333';
const PHONE = '923001112222';

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

let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQSQueueService = require('../../bot/shared/services/queue/sqs-queue.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);
const SENT_AT = pkt(NUDGE_DATE, 15, 0);
const TAP_AT = pkt(NUDGE_DATE, 15, 20);

const lesson = (over = {}) => ({
  lesson_id: 'grade_4_math_ch2_seg1',
  asset_id: 'asset-1',
  version_stamp: 'v8.2026-09-01',
  content_hash: 'hash-served-aaa',
  delivered_at: pkt(NUDGE_DATE, 9, 30).toISOString(),
  topic: 'Fractions on a Number Line',
  ...over,
});
const klass = (over = {}) => ({ key: 'g4_math', grade: 4, subject: 'math', lessons: [lesson()], ...over });

function sentRow(over = {}) {
  return {
    id: NID,
    user_id: T1,
    kind: 'lp_quiz_offer',
    nudge_date: NUDGE_DATE,
    status: 'sent',
    scheduled_at: SENT_AT.toISOString(),
    sent_at: SENT_AT.toISOString(),
    choice: null,
    quiz_id: null,
    context: { classes: [klass()], shape: 'one', class_count: 1 },
    ...over,
  };
}

const USER = { id: T1, phone_number: PHONE, preferred_language: 'en' };

let db;
beforeEach(() => {
  jest.clearAllMocks();
  WhatsAppService.sendMessage.mockResolvedValue(true);
  SQSQueueService.queueJob.mockResolvedValue('m-1');
  db = makeSupabase({ quizzes: [] });
  supabase.from.mockImplementation(db.from);
});

const quizInserts = () => db.writes.filter((w) => w.table === 'quizzes' && w.op === 'insert');
const sentText = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
const ux = (key, language = 'en') => resolveUx(key, { language });

describe('Make the quiz — one lp_v8 quiz, queued once', () => {
  test('yes makes the quiz row PLAN_R8 §2.3 names, queues quiz_generate and says it is coming', async () => {
    mockStore = makeStore([sentRow()]);
    const handled = await Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT });

    expect(handled).toBe(true);
    expect(quizInserts()).toHaveLength(1);
    const quiz = quizInserts()[0].row;
    expect(quiz).toEqual(expect.objectContaining({
      teacher_id: T1,
      quiz_source: 'lp_v8',
      coaching_session_id: null,
      lesson_plan_id: null,
      status: 'generating',
      topic: 'Fractions on a Number Line',
      grade: '4',
      subject: 'math',
    }));
    expect(quiz.meta).toEqual(expect.objectContaining({
      source: 'lp_offer',
      nudge_id: NID,
      lesson_date: NUDGE_DATE,
      class: { grade: 4, subject: 'math' },
    }));
    expect(quiz.meta.lessons).toEqual([{
      lesson_id: 'grade_4_math_ch2_seg1',
      asset_id: 'asset-1',
      version_stamp: 'v8.2026-09-01',
      content_hash: 'hash-served-aaa',
      delivered_at: pkt(NUDGE_DATE, 9, 30).toISOString(),
    }]);

    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(1);
    expect(SQSQueueService.queueJob).toHaveBeenCalledWith(quiz.id, 'quiz_generate',
      { quizId: quiz.id, phone: PHONE, source: 'lp_offer' }, expect.anything());
    expect(sentText()).toEqual([ux('lpQuizMaking')]);

    const row = mockStore.rows[0];
    expect(row.choice).toBe('yes');
    expect(row.quiz_id).toBe(quiz.id);
  });

  test('a second tap after the first says "already on it" and queues nothing', async () => {
    mockStore = makeStore([sentRow()]);
    await Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT });
    await Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT });

    expect(quizInserts()).toHaveLength(1);
    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(1);
    expect(sentText()).toEqual([ux('lpQuizMaking'), ux('tqAlreadyMaking')]);
  });

  test('two taps racing each other queue once, and the loser removes its own quiz row', async () => {
    mockStore = makeStore([sentRow()]);
    await Promise.all([
      Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT }),
      Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT }),
    ]);

    expect(quizInserts()).toHaveLength(2);
    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(1);
    expect(db.writes.filter((w) => w.table === 'quizzes' && w.op === 'delete')).toHaveLength(1);
    expect(sentText().sort()).toEqual([ux('lpQuizMaking'), ux('tqAlreadyMaking')].sort());
    const queuedId = SQSQueueService.queueJob.mock.calls[0][0];
    expect(mockStore.rows[0].quiz_id).toBe(queuedId);
  });

  test('a class picked from the list makes the quiz from THAT class and records class:<key>', async () => {
    const science = klass({
      key: 'g5_general_science', grade: 5, subject: 'general_science',
      lessons: [lesson({ lesson_id: 'grade_5_general_science_ch3_seg2', content_hash: 'hash-sci', topic: 'Food Chains' })],
    });
    mockStore = makeStore([sentRow({ context: { classes: [klass(), science], shape: 'list' } })]);
    const handled = await Offer.handleListPick(`lpquiz_pick_${NID}_g5_general_science`, PHONE, USER, { now: TAP_AT });

    expect(handled).toBe(true);
    const quiz = quizInserts()[0].row;
    expect(quiz.subject).toBe('general_science');
    expect(quiz.grade).toBe('5');
    expect(quiz.meta.lessons[0].content_hash).toBe('hash-sci');
    expect(mockStore.rows[0].choice).toBe('class:g5_general_science');
    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(1);
  });

  test('a pick for a class that is not on this offer makes nothing', async () => {
    mockStore = makeStore([sentRow({ context: { classes: [klass(), klass({ key: 'g5_urdu' })], shape: 'list' } })]);
    await Offer.handleListPick(`lpquiz_pick_${NID}_g3_english`, PHONE, USER, { now: TAP_AT });
    expect(quizInserts()).toHaveLength(0);
    expect(SQSQueueService.queueJob).not.toHaveBeenCalled();
    expect(sentText()).toEqual([ux('lpQuizExpired')]);
  });

  test('an Urdu teacher is answered in Urdu', async () => {
    mockStore = makeStore([sentRow()]);
    await Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, { ...USER, preferred_language: 'ur' }, { now: TAP_AT });
    expect(sentText()).toEqual([ux('lpQuizMaking', 'ur')]);
  });

  test('a queue failure marks the quiz failed and says so — never "making it now"', async () => {
    mockStore = makeStore([sentRow()]);
    SQSQueueService.queueJob.mockRejectedValue(new Error('SQS down'));
    await Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT });

    const failed = db.writes.find((w) => w.table === 'quizzes' && w.op === 'update');
    expect(failed.patch).toEqual(expect.objectContaining({ status: 'failed' }));
    expect(failed.patch.meta.error).toBe('queue_failed');
    expect(sentText()).toEqual([ux('lpQuizCouldNotStart')]);
  });
});

describe('No thanks / Not today — remembered, nothing made', () => {
  test('no records the choice and makes nothing', async () => {
    mockStore = makeStore([sentRow()]);
    expect(await Offer.handleButton(`lpquiz_no_${NID}`, PHONE, USER, { now: TAP_AT })).toBe(true);
    expect(mockStore.rows[0].choice).toBe('no');
    expect(quizInserts()).toHaveLength(0);
    expect(SQSQueueService.queueJob).not.toHaveBeenCalled();
    expect(sentText()).toEqual([ux('lpQuizDeclined')]);
  });

  test('the list\'s Not today row is the same answer', async () => {
    mockStore = makeStore([sentRow({ context: { classes: [klass(), klass({ key: 'g5_urdu' })], shape: 'list' } })]);
    expect(await Offer.handleListPick(`lpquiz_none_${NID}`, PHONE, USER, { now: TAP_AT })).toBe(true);
    expect(mockStore.rows[0].choice).toBe('no');
    expect(sentText()).toEqual([ux('lpQuizDeclined')]);
  });

  test('no after yes does not undo the quiz that is already coming', async () => {
    mockStore = makeStore([sentRow()]);
    await Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT });
    await Offer.handleButton(`lpquiz_no_${NID}`, PHONE, USER, { now: TAP_AT });
    expect(mockStore.rows[0].choice).toBe('yes');
    expect(sentText()[1]).toBe(ux('tqAlreadyMaking'));
  });
});

describe('a tap that can no longer be answered', () => {
  test('more than 24 hours after the offer: expired, nothing recorded or made', async () => {
    mockStore = makeStore([sentRow()]);
    const late = new Date(SENT_AT.getTime() + 25 * 60 * 60 * 1000);
    await Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: late });
    expect(mockStore.recordAnswer).not.toHaveBeenCalled();
    expect(quizInserts()).toHaveLength(0);
    expect(sentText()).toEqual([ux('lpQuizExpired')]);
  });

  test('a row that was never sent (skipped) is not answerable', async () => {
    mockStore = makeStore([sentRow({ status: 'skipped', sent_at: null })]);
    await Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT });
    expect(quizInserts()).toHaveLength(0);
    expect(sentText()).toEqual([ux('lpQuizExpired')]);
  });

  test('an unknown nudge id is expired, not an error', async () => {
    mockStore = makeStore([]);
    expect(await Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, USER, { now: TAP_AT })).toBe(true);
    expect(sentText()).toEqual([ux('lpQuizExpired')]);
  });

  test('a tap from a different teacher than the one offered makes nothing', async () => {
    mockStore = makeStore([sentRow()]);
    await Offer.handleButton(`lpquiz_yes_${NID}`, PHONE, { ...USER, id: T2 }, { now: TAP_AT });
    expect(quizInserts()).toHaveLength(0);
    expect(mockStore.recordAnswer).not.toHaveBeenCalled();
  });

  test('ids that are not this offer\'s are left for other handlers', async () => {
    mockStore = makeStore([sentRow()]);
    for (const id of [`tq_yes_${NID}`, `lpask_yes_${NID}`, 'lpquiz_maybe_x', '']) {
      expect(await Offer.handleButton(id, PHONE, USER, { now: TAP_AT })).toBe(false);
    }
    for (const id of [`tq_pick_${NID}`, `lpquiz_yes_${NID}`, '']) {
      expect(await Offer.handleListPick(id, PHONE, USER, { now: TAP_AT })).toBe(false);
    }
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
});
