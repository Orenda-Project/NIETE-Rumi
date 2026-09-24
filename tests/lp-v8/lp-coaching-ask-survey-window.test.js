'use strict';
/**
 * One open question at a time: the coaching ask never lands while the teacher
 * owes the lesson-plan survey a typed answer.
 *
 * The LP survey arrives 30 s after the lesson. A 👎 asks "What didn't work?
 * (one line is enough)" and takes the teacher's NEXT plain text as the answer
 * for ten minutes (lp-feedback.service consumeReasonIfPending, read by the text
 * handler before any router). The coaching ask is booked ten minutes after the
 * lesson and goes out on the next sweep tick — squarely inside that window for
 * a teacher who tapped 👎 in the first minutes (the median 👎 on production
 * comes 1.1 minutes after the survey). A teacher who then TYPES "yes" or "جی"
 * to the ask has it saved as the lesson plan's failure reason and is told
 * "Got it, thanks — this helps us improve the plans."; nothing opens the
 * recording door.
 *
 * The sweeper now hands such a row back to `pending`, due when the window
 * closes, and sends it then. Driven end to end through the real survey button,
 * the real sweeper, the real store and the real coaching ask; only Supabase (a
 * stateful in-memory table set), the cache and WhatsApp are faked.
 */

const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase({}, { unique: { teacher_nudges: ['user_id', 'nudge_date', 'kind'] } });
const mockRedis = createMemoryRedis();

jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendVideoWithButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/feature-intro.service', () => ({
  introShownCount: jest.fn().mockResolvedValue(0),
  markVideoShown: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const LpFeedback = require('../../bot/shared/services/lp-feedback.service');
const Sweeper = require('../../bot/shared/services/nudges/teacher-nudges.sweeper');
// Loading the ask registers its kind with the sweeper, as the worker does.
require('../../bot/shared/services/nudges/lp-coaching-ask.service');

// The 15:00 offer is a second scheduled ask; its real module is not loaded here, so a
// stand-in handler proves the rule is the sweeper's, for every kind, not the ask's alone.
const offerHandler = jest.fn(async () => ({ sent: true, messageIds: [] }));
Sweeper.register('lp_quiz_offer', offerHandler);

const TEACHER = '11111111-1111-4111-8111-111111111111';
const LP = '33333333-3333-4333-8333-333333333333';
const ASK = '22222222-2222-4222-8222-222222222222';
const OFFER = '44444444-4444-4444-8444-444444444444';
const PHONE = '923001234567';

/** An instant given as a PKT wall-clock time on Tue 22 Sep 2026 (PKT = UTC+5). */
const pkt = (h, m = 0, s = 0) => new Date(Date.UTC(2026, 8, 22, h - 5, m, s));

const askRow = () => mockDb.rows('teacher_nudges').find((r) => r.id === ASK);
const asksSent = () => WhatsAppService.sendInteractiveButtons.mock.calls
  .filter(([, p]) => (p.buttons || []).some((b) => String(b.id).startsWith('lpask_')));

async function tick(at) {
  jest.setSystemTime(at);
  return Sweeper.runSweep({ now: new Date(at) });
}

async function tapsNotReally(at = pkt(8, 6)) {
  jest.setSystemTime(at);
  await LpFeedback.handleFeedbackButton(`lp_feedback_no_${LP}`, PHONE);
}

function seed({ offer = false } = {}) {
  const nudge = (id, kind, at) => ({
    id, user_id: TEACHER, kind, nudge_date: '2026-09-22', status: 'pending',
    scheduled_at: at.toISOString(), sent_at: null, answered_at: null, choice: null, quiz_id: null,
    context: { lesson_id: 'grade_4_math_ch5_seg3', delivered_at: pkt(8, 0).toISOString(), first_time: false },
    created_at: pkt(8, 0).toISOString(), updated_at: pkt(8, 0).toISOString(),
  });
  mockDb.reset({
    users: [{
      id: TEACHER, phone_number: PHONE, preferred_language: 'en', role: 'teacher',
      last_message_at: pkt(7, 58).toISOString(),
    }],
    lesson_plans: [{
      id: LP, user_id: TEACHER, topic: 'Comparing fractions', grade: '4', subject: 'math', type: 'lesson_plan',
      content: { lp_variant: 'niete_v8_segment', trigger_mode: 'after_pdf_only', grade: 4, subject: 'math' },
    }],
    lp_feedback: [],
    coaching_sessions: [],
    quizzes: [],
    teacher_nudges: [
      nudge(ASK, 'coaching_after_lp', pkt(8, 10)),
      ...(offer ? [nudge(OFFER, 'lp_quiz_offer', pkt(8, 10))] : []),
    ],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
  process.env.TEACHER_NUDGES_ENABLED = '1';
  process.env.LP_COACHING_ASK_ENABLED = '1';
  mockRedis.reset();
  seed();
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.TEACHER_NUDGES_ENABLED;
  delete process.env.LP_COACHING_ASK_ENABLED;
});

describe('a 👎 on the lesson-plan survey holds the coaching ask back until its question closes', () => {
  test('the ask due at 08:10 is not sent into the window a 08:06 👎 opened; it goes back to pending for 08:16', async () => {
    await tapsNotReally(pkt(8, 6));
    // The survey really asked its question and armed its capture.
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, expect.stringMatching(/What didn't work/));

    const tally = await tick(pkt(8, 10));

    expect(asksSent()).toHaveLength(0);
    expect(askRow().status).toBe('pending');
    expect(new Date(askRow().scheduled_at).getTime()).toBe(pkt(8, 16).getTime());
    expect(askRow().context).toEqual(expect.objectContaining({ deferred_for: 'lp_survey' }));
    expect(tally).toEqual(expect.objectContaining({ claimed: 1, sent: 0, deferred: 1 }));
    expect(logEvent).toHaveBeenCalledWith('teacher_nudges.deferred', expect.objectContaining({
      kind: 'coaching_after_lp', nudgeId: ASK, openQuestion: 'lp_survey',
    }));
  });

  test('once the window has closed the next tick sends the ask', async () => {
    await tapsNotReally(pkt(8, 6));
    await tick(pkt(8, 10));

    await tick(pkt(8, 12));                  // still inside the window: the row is not even due
    expect(asksSent()).toHaveLength(0);

    await tick(pkt(8, 16, 30));
    expect(asksSent()).toHaveLength(1);
    expect(askRow().status).toBe('sent');
  });

  test('the teacher\'s typed reply in the window is the survey\'s answer, and the ask comes after it', async () => {
    await tapsNotReally(pkt(8, 6));
    await tick(pkt(8, 10));

    jest.setSystemTime(pkt(8, 11));
    const consumed = await LpFeedback.consumeReasonIfPending(TEACHER, PHONE, 'the activities were too long');
    expect(consumed).toBe(true);
    expect(mockDb.rows('lp_feedback')[0].reason_text).toBe('the activities were too long');

    await tick(pkt(8, 16, 30));
    expect(asksSent()).toHaveLength(1);
  });

  test('with no survey question open the ask goes on its first due tick, as before', async () => {
    const tally = await tick(pkt(8, 10));
    expect(asksSent()).toHaveLength(1);
    expect(tally).toEqual(expect.objectContaining({ sent: 1, deferred: 0 }));
  });

  test('a 👍 opens no question and holds nothing back', async () => {
    jest.setSystemTime(pkt(8, 6));
    await LpFeedback.handleFeedbackButton(`lp_feedback_yes_${LP}`, PHONE);
    await tick(pkt(8, 10));
    expect(asksSent()).toHaveLength(1);
  });
});

describe('why the ask must wait: what the open window does to a typed answer', () => {
  test.each(['yes', 'جی'])('a typed "%s" inside the window is saved as the lesson plan\'s failure reason', async (typed) => {
    await tapsNotReally(pkt(8, 6));
    jest.setSystemTime(pkt(8, 11));
    WhatsAppService.sendMessage.mockClear();

    expect(await LpFeedback.consumeReasonIfPending(TEACHER, PHONE, typed)).toBe(true);

    expect(mockDb.rows('lp_feedback')[0].reason_text).toBe(typed);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, expect.stringMatching(/this helps us improve the plans|شکریہ/));
  });
});

describe('every survey that takes the next typed message counts, under its owner\'s own key', () => {
  test.each([
    ['lp612_survey', '../../bot/shared/services/lp612-feedback.service'],
    ['coaching_survey', '../../bot/shared/services/coaching/coaching-feedback.service'],
    ['video_survey', '../../bot/shared/services/student-video-feedback.service'],
    ['lp_survey', '../../bot/shared/services/lp-feedback.service'],
  ])('%s', async (kind, owner) => {
    const Owner = require(owner);
    // The sweeper's copy of the window is the owner's, key and length both.
    const { WINDOWS } = require('../../bot/shared/services/nudges/open-question');
    const w = WINDOWS.find((x) => x.kind === kind);
    expect(w.key(TEACHER)).toBe(Owner.REDIS_REASON_KEY(TEACHER));
    expect(w.seconds).toBe(Owner.REASON_WINDOW_SECS);

    jest.setSystemTime(pkt(8, 7));
    await mockRedis.set(Owner.REDIS_REASON_KEY(TEACHER), { promptedAt: Date.now() }, Owner.REASON_WINDOW_SECS);

    await tick(pkt(8, 10));

    expect(asksSent()).toHaveLength(0);
    expect(askRow().context).toEqual(expect.objectContaining({ deferred_for: kind }));
    expect(new Date(askRow().scheduled_at).getTime()).toBe(pkt(8, 7).getTime() + Owner.REASON_WINDOW_SECS * 1000);
  });
});

describe('the rule belongs to the sweeper, so the 15:00 offer keeps it too', () => {
  test('an offer due while the survey waits is held back as well, and handed to its handler after', async () => {
    seed({ offer: true });
    await tapsNotReally(pkt(8, 6));

    await tick(pkt(8, 10));
    expect(offerHandler).not.toHaveBeenCalled();
    expect(mockDb.rows('teacher_nudges').find((r) => r.id === OFFER).status).toBe('pending');

    await tick(pkt(8, 16, 30));
    expect(offerHandler).toHaveBeenCalledTimes(1);
  });
});

describe('kill switch — NUDGE_OPEN_QUESTION_DEFER, read at call time', () => {
  // Off = the sweeper before the hold-back, exactly: the claimed row goes straight to
  // its handler, the cache is not consulted, nothing is deferred.
  afterEach(() => { delete process.env.NUDGE_OPEN_QUESTION_DEFER; });

  test.each(['false', '0', 'off', 'no', 'OFF', ' False '])('"%s" sends the ask into the open window, as before the fix', async (value) => {
    process.env.NUDGE_OPEN_QUESTION_DEFER = value;
    await tapsNotReally(pkt(8, 6));
    mockRedis.get.mockClear();

    const tally = await tick(pkt(8, 10));

    expect(asksSent()).toHaveLength(1);
    expect(askRow().status).toBe('sent');
    expect(askRow().context).not.toHaveProperty('deferred_for');
    expect(tally).toEqual(expect.objectContaining({ sent: 1, deferred: 0 }));
    expect(logEvent).not.toHaveBeenCalledWith('teacher_nudges.deferred', expect.anything());
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  test.each([['unset', undefined], ['true', 'true'], ['1', '1'], ['empty', '']])('%s keeps the hold-back', async (_label, value) => {
    if (value !== undefined) process.env.NUDGE_OPEN_QUESTION_DEFER = value;
    await tapsNotReally(pkt(8, 6));
    await tick(pkt(8, 10));
    expect(asksSent()).toHaveLength(0);
    expect(askRow().status).toBe('pending');
  });

  test('turned off between two ticks without a restart, the next tick sends the held row', async () => {
    await tapsNotReally(pkt(8, 6));
    await tick(pkt(8, 10));
    expect(askRow().status).toBe('pending');             // held for 08:16

    await tapsNotReally(pkt(8, 15));                     // a second 👎 re-arms the window until 08:25
    const { openQuestion } = require('../../bot/shared/services/nudges/open-question');
    expect(await openQuestion(TEACHER, { now: pkt(8, 16, 30) })).not.toBeNull();

    process.env.NUDGE_OPEN_QUESTION_DEFER = 'off';
    await tick(pkt(8, 16, 30));                          // the window is open; only the switch decides
    expect(asksSent()).toHaveLength(1);
    expect(askRow().status).toBe('sent');
  });
});

describe('failing open, never shut', () => {
  test('a cache that cannot be read never costs the teacher the ask', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('cache down'));
    await tick(pkt(8, 10));
    expect(asksSent()).toHaveLength(1);
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('open-question'), expect.any(Object), 'error');
  });
});
