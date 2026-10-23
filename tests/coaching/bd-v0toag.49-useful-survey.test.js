'use strict';
/**
 * v10 coaching test (bd-v0toag.49): "Do you agree with this report?" after the report in
 * groups A and B (today's report), the same question C and D get on the report page, so the four
 * groups compare. Ported from sandbox's coaching-feedback.service. Dark unless ab_v10_enabled is on
 * and the teacher's school is drawn into A or B. The ux catalog is real, so a wrong key goes red.
 */
const mockDb = { rows: {}, writes: [] };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => {
    const filters = [];
    const c = {
      select: () => c,
      eq: (k, v) => { filters.push([k, v]); return c; },
      maybeSingle: async () => ({ data: mockDb.rows[t] === undefined ? null : mockDb.rows[t], error: null }),
      limit: async () => ({ data: mockDb.rows[t] === undefined ? [] : [mockDb.rows[t]], error: null }),
      update: (patch) => { mockDb.writes.push([t, 'update', patch, filters]); return c; },
      insert: async (row) => { mockDb.writes.push([t, 'insert', row]); return { error: null }; },
      then: (ok, bad) => Promise.resolve({ error: null }).then(ok, bad),
    };
    return c;
  },
}));
const mockWA = {
  sendInteractiveButtons: jest.fn(async () => true),
  sendMessage: jest.fn(async () => true),
  sendReaction: jest.fn(async () => true),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWA);
const mockRedis = { store: {}, set: jest.fn(async (k, v) => { mockRedis.store[k] = v; }), get: jest.fn(async (k) => mockRedis.store[k] || null), delete: jest.fn(async (k) => { delete mockRedis.store[k]; }) };
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const mockArms = { groupFor: jest.fn() };
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => mockArms);
jest.mock('../../bot/shared/services/quiz/transcript-quiz-offer.service', () => ({ triggerEarly: jest.fn(async () => true) }));

const svc = require('../../bot/shared/services/coaching/coaching-feedback.service');

const S = '11111111-2222-3333-4444-555555555555';
const U = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PHONE = '923000000000';
const A = { group: 'A', plan: 'v9', report: 'today' };

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.rows = { users: { preferred_language: 'en' }, coaching_sessions: { id: S, user_id: U } };
  mockDb.writes = [];
  mockRedis.store = {};
  mockArms.groupFor.mockResolvedValue(A);
});

describe('askIfInTest: only groups A and B, only while the test is on', () => {
  test.each([
    ['switch off or not drawn', null],
    ['group C', { group: 'C', plan: 'v9', report: 'new' }],
    ['group D', { group: 'D', plan: 'v10', report: 'new' }],
  ])('%s: nothing is sent', async (_, g) => {
    mockArms.groupFor.mockResolvedValue(g);
    expect(await svc.askIfInTest({ coachingSessionId: S, userId: U, phone: PHONE })).toBe(false);
    expect(mockWA.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  test.each(['A', 'B'])('group %s: the question and two buttons, logged with the group', async (letter) => {
    mockArms.groupFor.mockResolvedValue({ group: letter, plan: letter === 'A' ? 'v9' : 'v10', report: 'today' });
    expect(await svc.askIfInTest({ coachingSessionId: S, userId: U, phone: PHONE })).toBe(true);
    expect(mockWA.sendInteractiveButtons).toHaveBeenCalledWith(PHONE, {
      body: 'What do you think of this report?',
      buttons: [
        { id: `coaching_fb_yes_${S}`, title: 'Accurate' },
        { id: `coaching_fb_no_${S}`, title: 'Not accurate' },
      ],
    });
    expect(logEvent).toHaveBeenCalledWith('coaching.useful.asked', { coachingSessionId: S, userId: U, group: letter });
  });

  test('in her language: Urdu', async () => {
    mockDb.rows.users = { preferred_language: 'ur' };
    await svc.askIfInTest({ coachingSessionId: S, userId: U, phone: PHONE });
    expect(mockWA.sendInteractiveButtons.mock.calls[0][1].body).toBe('اس رپورٹ کے بارے میں آپ کی کیا رائے ہے؟');
  });

  test('never throws: a failed send is false', async () => {
    mockWA.sendInteractiveButtons.mockRejectedValueOnce(new Error('meta down'));
    expect(await svc.askIfInTest({ coachingSessionId: S, userId: U, phone: PHONE })).toBe(false);
  });
});

describe('the tap', () => {
  test('not ours: false, nothing written', async () => {
    expect(await svc.handleFeedbackButton('lp_feedback_yes_x', PHONE)).toBe(false);
    expect(mockDb.writes).toEqual([]);
  });

  test('👍 stores 1 on a new metrics row, logs the group, thanks with a 🙏 reaction', async () => {
    expect(await svc.handleFeedbackButton(`coaching_fb_yes_${S}`, PHONE, { messageId: 'wamid.1' })).toBe(true);
    expect(mockDb.writes).toContainEqual(['coaching_quality_metrics', 'insert', expect.objectContaining({ coaching_session_id: S, user_satisfaction_rating: 1 })]);
    expect(logEvent).toHaveBeenCalledWith('coaching.useful.answered', { coachingSessionId: S, userId: U, useful: true, group: 'A' });
    expect(mockWA.sendReaction).toHaveBeenCalledWith(PHONE, 'wamid.1', '🙏');
    expect(mockWA.sendMessage).not.toHaveBeenCalled();
  });

  test('👍 with no wamid: the thank-you goes as text', async () => {
    await svc.handleFeedbackButton(`coaching_fb_yes_${S}`, PHONE);
    expect(mockWA.sendMessage).toHaveBeenCalledWith(PHONE, 'Thank you.');
  });

  test('👎 updates the existing row with 0, asks why and opens a 10-minute window', async () => {
    mockDb.rows.coaching_quality_metrics = { id: 7 };
    await svc.handleFeedbackButton(`coaching_fb_no_${S}`, PHONE);
    expect(mockDb.writes).toContainEqual(['coaching_quality_metrics', 'update', { user_satisfaction_rating: 0 }, [['coaching_session_id', S]]]);
    expect(mockWA.sendMessage).toHaveBeenCalledWith(PHONE, 'Thanks for telling us. What wasn’t accurate? (one line is enough)');
    expect(mockRedis.set).toHaveBeenCalledWith(`coaching_feedback_pending:${U}`, expect.objectContaining({ coachingSessionId: S }), 600);
  });

  test('a tap is logged even when the switch has since gone off (group null)', async () => {
    mockArms.groupFor.mockResolvedValue(null);
    await svc.handleFeedbackButton(`coaching_fb_yes_${S}`, PHONE);
    expect(logEvent).toHaveBeenCalledWith('coaching.useful.answered', { coachingSessionId: S, userId: U, useful: true, group: null });
  });
});

describe('the reason', () => {
  test('no window: not consumed', async () => {
    expect(await svc.handlePendingReason(U, PHONE, 'hello')).toBe(false);
    expect(mockDb.writes).toEqual([]);
  });

  test('inside the window: stored, window closed, 🙏', async () => {
    mockRedis.store[`coaching_feedback_pending:${U}`] = { coachingSessionId: S };
    mockDb.rows.coaching_quality_metrics = { id: 7 };
    expect(await svc.handlePendingReason(U, PHONE, '  too long  ', { messageId: 'wamid.2' })).toBe(true);
    expect(mockDb.writes).toContainEqual(['coaching_quality_metrics', 'update', { user_feedback: 'too long' }, [['coaching_session_id', S]]]);
    expect(mockRedis.store[`coaching_feedback_pending:${U}`]).toBeUndefined();
    expect(mockWA.sendReaction).toHaveBeenCalledWith(PHONE, 'wamid.2', '🙏');
  });

  test('a Redis error is not consumed', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('down'));
    expect(await svc.handlePendingReason(U, PHONE, 'hi')).toBe(false);
  });
});
