'use strict';
/**
 * bd-6jaq0i — the 15:00 LP quiz offer, when WhatsApp could not be reached at all.
 *
 * 24 Nov 2026, 10:08–10:10Z: 102 of 308 offers failed with `connect ENETUNREACH` to Meta's address. No request
 * reached Meta, so no teacher got anything, and the sweeper marked every one of those rows failed for good: 102
 * teachers got no offer that day. A send that never connected is safe to try again, so the row goes back to
 * pending 10 minutes later, at most twice. A refusal Meta itself answered (a 400, a closed window) is not retried.
 * Kill switch: NUDGE_NET_RETRY=off is the behaviour before the fix. Real offer and sweeper; fake store, Meta, DB.
 */
const { makeSupabase } = require('../quiz/helpers/filtering-chain');
const { makeStore } = require('../quiz/helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');
const { fixturePhone } = require('../../bot/tests/quiz/web-quiz/fixture-phone');

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('m-1') }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('../quiz/helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
require('../../bot/shared/services/nudges/lp-quiz-offer.service');
const { isUnreached } = require('../../bot/shared/services/nudges/send-retry');

const NUDGE_DATE = '2026-09-22';
const T1 = '11111111-1111-4111-8111-111111111111';
const SEND_AT = pktTime.atPkt(NUDGE_DATE, 15, 0);
const lesson = { lesson_id: 'grade_4_math_ch2_seg1', asset_id: 'a-1', version_stamp: 'v', content_hash: 'h', topic: 'Fractions' };
const teacher = {
  id: T1, role: 'teacher', is_test_user: false, deleted_at: null, school_id: 's-1', region: 'X',
  phone_number: fixturePhone(32), preferred_language: 'en',
  last_message_at: pktTime.atPkt(NUDGE_DATE, 12, 0).toISOString(),
};
const offerRow = (context = {}) => ({
  id: 'nudge-1', user_id: T1, kind: 'lp_quiz_offer', nudge_date: NUDGE_DATE, status: 'pending',
  scheduled_at: SEND_AT.toISOString(), quiz_id: null,
  context: { classes: [{ key: 'g4_math', grade: 4, subject: 'math', lessons: [lesson] }], ...context },
});
const unreached = () => Object.assign(new Error('connect ENETUNREACH 2a03:2880::2:443 - Local (:::0)'), { code: 'ENETUNREACH' });
const refused = () => Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: {} } });
function failWith(makeError) {
  WhatsAppService.sendInteractiveButtons.mockImplementation(async (to, msg, opts) => {
    if (opts && typeof opts.onError === 'function') opts.onError(makeError());
    return false;
  });
}
const sweep = (now = SEND_AT) => require('../../bot/shared/services/nudges/teacher-nudges.sweeper').runSweep({ now });
const offerMade = () => logEvent.mock.calls.filter(([m, d]) => m === 'quiz_funnel.offer_made' && d.channel === 'lp_offer');

beforeEach(() => {
  jest.clearAllMocks();
  WhatsAppService.sendInteractiveButtons.mockResolvedValue(true);
  supabase.from.mockImplementation(makeSupabase({ users: [teacher], coaching_sessions: [], quizzes: [], teacher_nudges: [], app_settings: [] }).from);
  process.env.TEACHER_NUDGES_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  delete process.env.NUDGE_NET_RETRY;
});
afterAll(() => {
  for (const k of ['TEACHER_NUDGES_ENABLED', 'LP_QUIZ_OFFER_ENABLED', 'NUDGE_NET_RETRY']) delete process.env[k];
});

describe('isUnreached: only a send that never reached Meta', () => {
  test.each(['ENETUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH'])('%s', (code) => {
    expect(isUnreached(Object.assign(new Error(code), { code }))).toBe(true);
  });
  test('fetch failed with a network cause', () => {
    expect(isUnreached(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENETUNREACH' } }))).toBe(true);
  });
  test('Meta answered (any HTTP status) → not unreached', () => {
    expect(isUnreached(Object.assign(new Error('x'), { code: 'ECONNRESET', response: { status: 400 } }))).toBe(false);
    expect(isUnreached(refused())).toBe(false);
  });
  test('nothing known → not unreached', () => {
    expect(isUnreached(null)).toBe(false);
    expect(isUnreached(new Error('boom'))).toBe(false);
  });
});

describe('the 15:00 offer when WhatsApp cannot be reached', () => {
  test('first miss → back to pending in 10 minutes, no "undelivered" offer counted', async () => {
    mockStore = makeStore([offerRow()]);
    failWith(unreached);
    await sweep();
    const row = mockStore.rows[0];
    expect(row.status).toBe('pending');
    expect(new Date(row.scheduled_at).getTime()).toBe(SEND_AT.getTime() + 10 * 60 * 1000);
    expect(row.context.net_retries).toBe(1);
    expect(offerMade()).toHaveLength(0);
    expect(logEvent).toHaveBeenCalledWith('teacher_nudges.retry', expect.objectContaining({ kind: 'lp_quiz_offer', tries: 1 }));
  });

  test('the retry goes through → sent, one offer counted as delivered', async () => {
    mockStore = makeStore([offerRow({ net_retries: 1 })]);
    await sweep(new Date(SEND_AT.getTime() + 10 * 60 * 1000));
    expect(mockStore.rows[0].status).toBe('sent');
    expect(offerMade().map(([, d]) => d.delivered)).toEqual([true]);
  });

  test('third miss in a row → failed, counted undelivered once', async () => {
    mockStore = makeStore([offerRow({ net_retries: 2 })]);
    failWith(unreached);
    await sweep(new Date(SEND_AT.getTime() + 20 * 60 * 1000));
    expect(mockStore.rows[0].status).toBe('failed');
    expect(offerMade().map(([, d]) => d.delivered)).toEqual([false]);
  });

  test('Meta refused it (400) → failed at once, no retry', async () => {
    mockStore = makeStore([offerRow()]);
    failWith(refused);
    await sweep();
    expect(mockStore.rows[0].status).toBe('failed');
    expect(offerMade().map(([, d]) => d.delivered)).toEqual([false]);
  });

  test('kill switch NUDGE_NET_RETRY=off → failed at once, as before the fix', async () => {
    process.env.NUDGE_NET_RETRY = 'off';
    mockStore = makeStore([offerRow()]);
    failWith(unreached);
    await sweep();
    expect(mockStore.rows[0].status).toBe('failed');
    expect(offerMade().map(([, d]) => d.delivered)).toEqual([false]);
  });
});
