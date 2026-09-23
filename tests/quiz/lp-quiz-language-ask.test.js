'use strict';
/**
 * The LP-born quiz asks which language the quiz is written in — the same ask,
 * the same buttons and the same rule as the quiz born from a recording.
 *
 * Before this, "Make the quiz" on the 15:00 offer inserted the lp_v8 row as
 * `generating` with no language and queued the author at once. The generate
 * step then fell back to the subject rule — every maths and science quiz in
 * Urdu, every English quiz in English — and the teacher was never asked
 * (a Grade 4 maths quiz was written in Urdu on sandbox with no ask).
 *
 * Now a yes (or a class picked from the list) on any subject except Urdu and
 * Islamiyat keeps the row `offered` with `meta.step='awaiting_language'` and
 * sends the transcript quiz's own ask (`tq_lang_<code>_<quizId>`). The tap on
 * that ask is handled by the transcript quiz's own language handler, which
 * for an lp_v8 row queues `quiz_generate` exactly as the offer does and says
 * "making it now" in the offer's own words.
 *
 * Driven end to end through the real offer and the real language handler:
 * only Supabase, WhatsApp and the queue are stubbed. The quizzes table is
 * STATEFUL here — the row the offer inserts is the row the language tap reads
 * and flips — because the whole bug is in what one step leaves for the next.
 */

const { randomUUID } = require('crypto');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-09-22';
const T1 = '11111111-1111-4111-8111-111111111111';
const NID = '33333333-3333-4333-8333-333333333333';
const PHONE = '923001112222';
// The form the webhook's tq_lang_ branch and the handler's own regex accept.
const LANGUAGE_BUTTON_RX = /^tq_lang_(ur|en)_[0-9a-fA-F-]{36}$/;

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue('m-1'),
}));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn() }));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  hasSeenIntroVideo: jest.fn().mockResolvedValue(true),
  markVideoShown: jest.fn().mockResolvedValue(undefined),
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
const LpOffer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');
const TqOffer = require('../../bot/shared/services/quiz/transcript-quiz-offer.service');

/**
 * A tiny stateful PostgREST: filters are collected, and the write (or read)
 * happens when the chain is awaited — so an update's `.eq('status','offered')`
 * guard really decides whether the row flips, and a second flip really finds
 * nothing. Ids are uuids, as `quizzes.id` is, because the language button's
 * id embeds the quiz id and is only routed when it is one.
 */
function makeDb(tables) {
  const writes = [];
  const from = jest.fn((table) => {
    const rows = tables[table] || (tables[table] = []);
    const preds = [];
    let op = 'select';
    let payload = null;
    const matching = () => rows.filter((r) => preds.every((p) => p(r)));
    const run = () => {
      if (op === 'insert') {
        const made = { id: randomUUID(), ...payload };
        rows.push(made);
        writes.push({ table, op, row: made });
        return [made];
      }
      if (op === 'update') {
        const hit = matching();
        hit.forEach((r) => Object.assign(r, payload));
        writes.push({ table, op, patch: payload, ids: hit.map((r) => r.id) });
        return hit.map((r) => ({ ...r }));
      }
      if (op === 'delete') {
        const hit = matching();
        hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
        writes.push({ table, op, ids: hit.map((r) => r.id) });
        return [];
      }
      return matching().map((r) => ({ ...r }));
    };
    const chain = {
      select: () => chain,
      eq: (f, v) => { preds.push((r) => r[f] === v); return chain; },
      insert: (row) => { op = 'insert'; payload = row; return chain; },
      update: (patch) => { op = 'update'; payload = patch; return chain; },
      delete: () => { op = 'delete'; return chain; },
      single: async () => ({ data: run()[0] || null, error: null }),
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      then: (resolve, reject) => {
        try { resolve({ data: run(), error: null }); } catch (err) { reject(err); }
      },
    };
    return chain;
  });
  return { from, writes, tables };
}

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
const maths = (over = {}) => ({ key: 'g4_math', grade: 4, subject: 'math', lessons: [lesson()], ...over });
const science = () => maths({
  key: 'g5_general_science', grade: 5, subject: 'general_science',
  lessons: [lesson({ lesson_id: 'grade_5_general_science_ch3_seg2', content_hash: 'hash-sci', topic: 'Food Chains' })],
});
const english = () => maths({
  key: 'g3_english', grade: 3, subject: 'english',
  lessons: [lesson({ lesson_id: 'grade_3_english_ch1_seg1', topic: 'Nouns' })],
});
const urdu = () => maths({
  key: 'g4_urdu', grade: 4, subject: 'urdu',
  lessons: [lesson({ lesson_id: 'grade_4_urdu_ch1_seg1', topic: 'Pyasa Kawwa' })],
});

function sentRow(classes) {
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
    context: { classes, shape: classes.length > 1 ? 'list' : 'one', class_count: classes.length },
  };
}

const userFor = (preferredLanguage = 'en') => ({ id: T1, phone_number: PHONE, preferred_language: preferredLanguage });

let db;
function install({ classes, language = 'en' }) {
  mockStore = makeStore([sentRow(classes)]);
  db = makeDb({ quizzes: [], users: [userFor(language)] });
  supabase.from.mockImplementation(db.from);
}

beforeEach(() => {
  jest.clearAllMocks();
  WhatsAppService.sendMessage.mockResolvedValue(true);
  WhatsAppService.sendInteractiveButtons.mockResolvedValue(true);
  SQSQueueService.queueJob.mockResolvedValue('m-1');
});

const quizzes = () => db.tables.quizzes;
const sentText = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
const asks = () => WhatsAppService.sendInteractiveButtons.mock.calls;
const ux = (key, language = 'en') => resolveUx(key, { language });
/** The id of the button for `code` on the one ask that was sent. */
const langButton = (code) => asks()[0][1].buttons.find((b) => b.id.startsWith(`tq_lang_${code}_`)).id;

describe('Make the quiz on a maths lesson asks which language the quiz is written in', () => {
  test('yes keeps the quiz offered, claims the offer and sends the ask — nothing is queued yet', async () => {
    install({ classes: [maths()] });
    expect(await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, userFor(), { now: TAP_AT })).toBe(true);

    expect(quizzes()).toHaveLength(1);
    const quiz = quizzes()[0];
    expect(quiz).toEqual(expect.objectContaining({
      teacher_id: T1,
      quiz_source: 'lp_v8',
      coaching_session_id: null,
      lesson_plan_id: null,
      status: 'offered',
      topic: 'Fractions on a Number Line',
      grade: '4',
      subject: 'math',
    }));
    expect(quiz.language == null).toBe(true);        // decided by the teacher, not written yet
    expect(quiz.meta).toEqual(expect.objectContaining({
      step: 'awaiting_language',
      awaiting_language: true,
      source: 'lp_offer',
      nudge_id: NID,
      lesson_date: NUDGE_DATE,
      class: { grade: 4, subject: 'math' },
    }));
    expect(typeof quiz.meta.claimed_at).toBe('string');
    expect(quiz.meta.lessons).toEqual([expect.objectContaining({
      lesson_id: 'grade_4_math_ch2_seg1', version_stamp: 'v8.2026-09-01', content_hash: 'hash-served-aaa',
    })]);

    // The offer is spent on THIS quiz: the double-tap guard is the nudge row's quiz_id.
    expect(mockStore.rows[0].quiz_id).toBe(quiz.id);
    expect(mockStore.rows[0].choice).toBe('yes');

    expect(SQSQueueService.queueJob).not.toHaveBeenCalled();
    expect(asks()).toHaveLength(1);
    const [to, ask] = asks()[0];
    expect(to).toBe(PHONE);
    expect(ask.body).toBe(ux('tqAskLanguage'));
    // Maths: the subject rule (Urdu) is the first, easy tap.
    expect(ask.buttons.map((b) => b.id)).toEqual([`tq_lang_ur_${quiz.id}`, `tq_lang_en_${quiz.id}`]);
    ask.buttons.forEach((b) => expect(b.id).toMatch(LANGUAGE_BUTTON_RX));
    expect(sentText()).toEqual([]);                  // no "making it now" before the answer
  });

  test('the tap on English queues the lp_v8 quiz the way the offer does, in English, then says it is coming', async () => {
    install({ classes: [maths()] });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, userFor(), { now: TAP_AT });
    const quizId = quizzes()[0].id;

    expect(await TqOffer.handleLanguageButton(langButton('en'), PHONE, userFor())).toBe(true);

    const quiz = quizzes()[0];
    expect(quiz.status).toBe('generating');
    expect(quiz.language).toBe('en');
    expect(quiz.topic).toBe('Fractions on a Number Line');       // no digest yet: the catalog topic stays
    expect(quiz.meta).toEqual(expect.objectContaining({
      awaiting_language: false, language_choice: 'en', source: 'lp_offer', nudge_id: NID, lesson_date: NUDGE_DATE,
    }));
    expect(quiz.meta.lessons).toHaveLength(1);

    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(1);
    expect(SQSQueueService.queueJob).toHaveBeenCalledWith(quizId, 'quiz_generate',
      { quizId, phone: PHONE, source: 'lp_offer' }, { delaySeconds: 0 });
    expect(sentText()).toEqual([ux('lpQuizMaking')]);
  });

  test('an Urdu-reading teacher is asked in Urdu and told "making it now" in Urdu; the tap on Urdu writes ur', async () => {
    install({ classes: [maths()], language: 'ur' });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, userFor('ur'), { now: TAP_AT });
    expect(asks()[0][1].body).toBe(ux('tqAskLanguage', 'ur'));

    await TqOffer.handleLanguageButton(langButton('ur'), PHONE, userFor('ur'));
    expect(quizzes()[0].language).toBe('ur');
    expect(sentText()).toEqual([ux('lpQuizMaking', 'ur')]);
  });

  test('a second tap on the ask queues nothing more', async () => {
    install({ classes: [maths()] });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, userFor(), { now: TAP_AT });
    await TqOffer.handleLanguageButton(langButton('en'), PHONE, userFor());
    await TqOffer.handleLanguageButton(langButton('ur'), PHONE, userFor());

    expect(SQSQueueService.queueJob).toHaveBeenCalledTimes(1);
    expect(quizzes()[0].language).toBe('en');
    expect(sentText()).toEqual([ux('lpQuizMaking'), ux('tqAlreadyMaking')]);
  });

  test('a second yes while the ask is open makes no second quiz and queues nothing', async () => {
    install({ classes: [maths()] });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, userFor(), { now: TAP_AT });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, userFor(), { now: TAP_AT });

    expect(quizzes()).toHaveLength(1);
    expect(asks()).toHaveLength(1);
    expect(SQSQueueService.queueJob).not.toHaveBeenCalled();
    expect(sentText()).toEqual([ux('tqAlreadyMaking')]);
  });

  test('a class picked from the list is asked too — science', async () => {
    install({ classes: [maths(), science()] });
    expect(await LpOffer.handleListPick(`lpquiz_pick_${NID}_g5_general_science`, PHONE, userFor(), { now: TAP_AT })).toBe(true);

    const quiz = quizzes()[0];
    expect(quiz.subject).toBe('general_science');
    expect(quiz.status).toBe('offered');
    expect(quiz.meta.step).toBe('awaiting_language');
    expect(mockStore.rows[0].choice).toBe('class:g5_general_science');
    expect(SQSQueueService.queueJob).not.toHaveBeenCalled();
    expect(asks()[0][1].buttons.map((b) => b.id)).toEqual([`tq_lang_ur_${quiz.id}`, `tq_lang_en_${quiz.id}`]);
  });

  test('an English lesson is asked, with English as the first tap', async () => {
    install({ classes: [english()] });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, userFor(), { now: TAP_AT });
    const quizId = quizzes()[0].id;
    expect(SQSQueueService.queueJob).not.toHaveBeenCalled();
    expect(asks()[0][1].buttons.map((b) => b.id)).toEqual([`tq_lang_en_${quizId}`, `tq_lang_ur_${quizId}`]);
  });

  test('a queue failure after the tap marks the quiz failed and says so — never "making it now"', async () => {
    install({ classes: [maths()] });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, userFor(), { now: TAP_AT });
    SQSQueueService.queueJob.mockRejectedValue(new Error('SQS down'));
    await TqOffer.handleLanguageButton(langButton('en'), PHONE, userFor());

    expect(quizzes()[0].status).toBe('failed');
    expect(quizzes()[0].meta.error).toBe('queue_failed');
    expect(sentText()).toEqual([ux('lpQuizCouldNotStart')]);
  });
});

describe('Urdu and Islamiyat lessons are not asked', () => {
  test.each([
    ['urdu', urdu()],
    ['islamiyat', maths({ key: 'g3_islamiyat', grade: 3, subject: 'islamiyat' })],
  ])('%s: yes makes the quiz at once in the rule language', async (_name, cls) => {
    install({ classes: [cls] });
    await LpOffer.handleButton(`lpquiz_yes_${NID}`, PHONE, userFor(), { now: TAP_AT });

    const quiz = quizzes()[0];
    expect(quiz.status).toBe('generating');
    expect(quiz.meta.step).toBe('digest');
    expect(quiz.meta.awaiting_language).toBeUndefined();
    expect(asks()).toHaveLength(0);
    expect(SQSQueueService.queueJob).toHaveBeenCalledWith(quiz.id, 'quiz_generate',
      { quizId: quiz.id, phone: PHONE, source: 'lp_offer' }, { delaySeconds: 0 });
    expect(sentText()).toEqual([ux('lpQuizMaking')]);
  });
});
