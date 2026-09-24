'use strict';
/**
 * The 15:00 quiz offer never goes out at night.
 *
 * The offer's cohort is built on ANY sweep tick from 15:00 until midnight, and
 * its rows are booked for 15:00 of the same day — so a cohort built late is due
 * the moment it exists. `send` had no night check (the coaching ask has one:
 * lp-coaching-ask.service, "a morning ask at 22:00 is stale, not deferred").
 * Two ordinary ways to get there: the worker is down across 15:00 and comes back
 * after 21:00, or the switch is turned on in the evening — which is how a flag
 * goes live. Either way every teacher in that day's cohort was offered a quiz
 * on the day's lessons in the middle of the night.
 *
 * The send now answers `quiet_hours` inside the quiet window, through the one
 * rule every later-sent message keeps (deferQuietHours / NUDGE_QUIET_HOURS_PKT).
 */

const { makeSupabase } = require('./helpers/filtering-chain');
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

let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);

function nudgeRow(over = {}) {
  return {
    id: 'nudge-1',
    user_id: T1,
    kind: 'lp_quiz_offer',
    nudge_date: NUDGE_DATE,
    status: 'sending',
    scheduled_at: pkt(NUDGE_DATE, 15, 0).toISOString(),
    sent_at: null,
    choice: null,
    quiz_id: null,
    context: {
      classes: [{
        key: 'g4_math', grade: 4, subject: 'math',
        lessons: [{
          lesson_id: 'grade_4_math_ch2_seg1', asset_id: 'asset-1', version_stamp: 'v8.2026-09-01',
          content_hash: 'hash-aaa', delivered_at: pkt(NUDGE_DATE, 9, 30).toISOString(),
          topic: 'Fractions on a Number Line',
        }],
      }],
    },
    ...over,
  };
}

function install() {
  const db = makeSupabase({
    users: [{
      id: T1, role: 'teacher', is_test_user: false, deleted_at: null, school_id: 'school-1', region: 'Sihala',
      phone_number: '923001112222', preferred_language: 'en',
      last_message_at: pkt(NUDGE_DATE, 12, 0).toISOString(),
    }],
    coaching_sessions: [],
    quizzes: [],
    teacher_nudges: [],
  });
  supabase.from.mockImplementation(db.from);
}

const offersSent = () => WhatsAppService.sendInteractiveButtons.mock.calls.length
  + WhatsAppService.sendInteractiveMessage.mock.calls.length;

const QUIET = 'NUDGE_QUIET_HOURS_PKT';

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = makeStore();
  install();
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  delete process.env[QUIET];
});

afterEach(() => {
  delete process.env.LP_QUIZ_OFFER_ENABLED;
  delete process.env[QUIET];
});

describe('an offer claimed at night is skipped, not sent', () => {
  test.each([
    ['21:30 the same day (the switch went on in the evening)', NUDGE_DATE, 21, 30],
    ['23:55 the same day', NUDGE_DATE, 23, 55],
    ['06:40 the next morning, still inside the window', '2026-09-23', 6, 40],
  ])('%s', async (_label, date, h, m) => {
    const res = await Offer.send(nudgeRow(), { now: pkt(date, h, m) });

    expect(res).toEqual({ skipped: 'quiet_hours' });
    expect(offersSent()).toBe(0);
    expect(logEvent).toHaveBeenCalledWith('lp_quiz.offer_skipped', expect.objectContaining({
      nudgeId: 'nudge-1', reason: 'quiet_hours', at: 'send',
    }));
  });
});

describe('what must not change', () => {
  test('at 15:00 the offer goes', async () => {
    const res = await Offer.send(nudgeRow(), { now: pkt(NUDGE_DATE, 15, 0) });
    expect(res).toMatchObject({ sent: true });
    expect(offersSent()).toBe(1);
  });

  test('a late but still daytime claim (20:30) still goes', async () => {
    const res = await Offer.send(nudgeRow(), { now: pkt(NUDGE_DATE, 20, 30) });
    expect(res).toMatchObject({ sent: true });
  });

  test('the window is the shared one: with it lifted (a test environment) 21:30 sends', async () => {
    process.env[QUIET] = 'off';
    const res = await Offer.send(nudgeRow(), { now: pkt(NUDGE_DATE, 21, 30) });
    expect(res).toMatchObject({ sent: true });
  });

  test('quiet_hours is a reason the store records', () => {
    expect(Offer.SKIP_REASONS_USED).toContain('quiet_hours');
  });
});
