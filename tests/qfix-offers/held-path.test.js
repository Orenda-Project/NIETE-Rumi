'use strict';
/**
 * The 15:00 LP quiz offer and the LP coaching ask already leave a teacher_nudges row when a closed window stops
 * them (skip_reason 'window_closed'). With `quiz_offer_closed_window` on, that row and its event also say that nothing
 * reached the teacher: held_path 'none' (this branch has no window-closed reminder template, so 'none' is the only path).
 * Switch off = exactly today's row and event. Real offer, ask, sweeper and switch modules; the store, Meta and the
 * database are the shared test fakes.
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
const Ask = require('../../bot/shared/services/nudges/lp-coaching-ask.service');
// Loaded as the worker loads it: the offer registers its kind with the sweeper.
require('../../bot/shared/services/nudges/lp-quiz-offer.service');

const NUDGE_DATE = '2026-09-22';
const T1 = '11111111-1111-4111-8111-111111111111';
const SEND_AT = pktTime.atPkt(NUDGE_DATE, 15, 0);
const CLOSED = { trace: true };
const lesson = { lesson_id: 'grade_4_math_ch2_seg1', asset_id: 'a-1', version_stamp: 'v', content_hash: 'h', topic: 'Fractions' };
const teacher = {
  id: T1, role: 'teacher', is_test_user: false, deleted_at: null, school_id: 's-1', region: 'X',
  phone_number: fixturePhone(31), preferred_language: 'en',
  last_message_at: pktTime.atPkt('2026-09-20', 8, 0).toISOString(),
};
const offerRow = (over = {}) => ({
  id: 'nudge-1', user_id: T1, kind: 'lp_quiz_offer', nudge_date: NUDGE_DATE, status: 'pending',
  scheduled_at: SEND_AT.toISOString(), quiz_id: null,
  context: { classes: [{ key: 'g4_math', grade: 4, subject: 'math', lessons: [lesson] }] },
  ...over,
});
const settings = (closed) => (closed ? [{ key: 'quiz_offer_closed_window', value: closed }] : []);
function install(appSettings) {
  const db = makeSupabase({ users: [teacher], coaching_sessions: [], quizzes: [], teacher_nudges: [], app_settings: appSettings });
  supabase.from.mockImplementation(db.from);
}

beforeEach(() => {
  jest.clearAllMocks();
  try { require('../../bot/shared/services/quiz/closed-window-offer')._resetCache(); } catch (_) { /* red run */ }
  process.env.TEACHER_NUDGES_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_COACHING_ASK_ENABLED = 'true';
  process.env.WEB_TRAINING_TOKEN_SECRET = 'test-secret';
  process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-web-quiz-secret-not-a-secret';
});
afterAll(() => {
  for (const k of ['TEACHER_NUDGES_ENABLED', 'LP_QUIZ_OFFER_ENABLED', 'LP_COACHING_ASK_ENABLED', 'WEB_TRAINING_TOKEN_SECRET',
    'WEB_QUIZ_TOKEN_SECRET']) delete process.env[k];
});

const sweep = async () => require('../../bot/shared/services/nudges/teacher-nudges.sweeper').runSweep({ now: SEND_AT });

describe('the 15:00 LP quiz offer, window closed (through the real sweeper)', () => {
  test('switch off → today\'s row: skip_reason window_closed and no held_path', async () => {
    mockStore = makeStore([offerRow()]);
    install(settings(null));
    await sweep();
    expect(mockStore.rows[0].context.skip_reason).toBe('window_closed');
    expect(mockStore.rows[0].context.held_path).toBeUndefined();
  });

  test('switch on → the row says held_path none, and nothing is sent', async () => {
    mockStore = makeStore([offerRow()]);
    install(settings(CLOSED));
    await sweep();
    expect(mockStore.rows[0].context).toMatchObject({ skip_reason: 'window_closed', held_path: 'none' });
    expect(logEvent).toHaveBeenCalledWith('lp_quiz.offer_skipped', expect.objectContaining({ reason: 'window_closed', held_path: 'none' }));
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('the LP coaching ask, window closed', () => {
  const askRow = { id: 'nudge-2', user_id: T1, kind: 'coaching_after_lp', nudge_date: NUDGE_DATE, status: 'sending',
    scheduled_at: SEND_AT.toISOString(), context: {} };

  test('switch off → today\'s skip, no context', async () => {
    mockStore = makeStore([]);
    install(settings(null));
    expect(await Ask.send(askRow, { now: SEND_AT })).toEqual({ skipped: 'window_closed' });
  });

  test('switch on → the skip carries held_path none (the sweeper writes it on the row)', async () => {
    mockStore = makeStore([]);
    install(settings(CLOSED));
    expect(await Ask.send(askRow, { now: SEND_AT })).toEqual({ skipped: 'window_closed', context: { held_path: 'none' } });
    expect(logEvent).toHaveBeenCalledWith('lp_ask.skipped', expect.objectContaining({ reason: 'window_closed', held_path: 'none' }));
  });
});
