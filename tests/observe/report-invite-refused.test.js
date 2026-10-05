'use strict';
/**
 * A report invite that WhatsApp refuses is a failed send, not a sent one.
 *
 * When the teacher has not written to the bot in 24 hours, the report cannot go
 * as a normal message: the teacher gets an approved template ("X has sent you
 * the report… Tap below") and the report follows the tap. WhatsAppService.sendTemplate
 * answers `false` when Meta refuses the template (it never throws), and every
 * caller of the invite treated that `false` as success: the delivery was filed
 * as "waiting for the teacher's tap", the coach was told the invite had gone,
 * and the teacher received nothing. Live on the sandbox, 5 Oct 2026: the
 * template did not exist on that WhatsApp account (Meta #132001), the log said
 * "template sent (window closed)", and the coach was told the report was on
 * its way.
 *
 * Drives the real send service; only the network boundary is stubbed.
 */
const SESSION_ID = 'sess-1';
const COACH_PHONE = '923330000001';
const TEACHER_PHONE = '923001234567';

let mockTables;
let mockUpdates;

jest.mock('../../bot/shared/config/supabase', () => {
  const { chain } = require('../quiz/helpers/supabase-chain');
  return {
    from: jest.fn((table) => {
      const c = chain(() => ({ data: (mockTables[table] || (() => null))(), error: null }));
      const record = (op) => (payload) => { mockUpdates.push({ table, op, payload }); return c; };
      return new Proxy(c, {
        get(target, prop) {
          if (prop === 'update' || prop === 'insert' || prop === 'upsert') return record(prop);
          return target[prop];
        },
      });
    }),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  setexWithCeiling: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
  del: jest.fn().mockResolvedValue(true),
  setNX: jest.fn().mockResolvedValue(true),
  isAvailable: () => true,
}));
const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../bot/shared/services/quiz/quiz-delivery.service', () => ({
  _hasOpenMessageWindow: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(async () => Buffer.from('png')),
  uploadImageBuffer: jest.fn(async () => 'k'),
}));
jest.mock('../../bot/shared/services/child-test/conversation/offer', () => ({ sendOffer: jest.fn().mockResolvedValue(false) }));

const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const Send = () => require('../../bot/shared/services/observe/observe-send.service');

const COACH = { id: 'coach-1', phone_number: COACH_PHONE, preferred_language: 'en', name: 'Sana' };
const S = observeStrings('en');
const coachTexts = () => mockWa.sendMessage.mock.calls.filter(([t]) => t === COACH_PHONE).map(([, b]) => String(b));
const deliveryWrites = () => mockUpdates
  .filter((u) => u.table === 'coaching_sessions' && u.payload && u.payload.analysis_data)
  .map((u) => u.payload.analysis_data.teacher_delivery || {});

function withDelivery(over = {}) {
  mockTables.coaching_sessions = () => ({
    id: SESSION_ID,
    user_id: 'teacher-1',
    observer_user_id: COACH.id,
    status: 'observer_review_complete',
    debrief_status: 'done',
    analysis_data: {
      framework: 'fico',
      teacher_delivery: {
        status: 'awaiting_confirm', report_key: 'observe-reports/x.png',
        teacher_phone: TEACHER_PHONE, teacher_name: 'Rifsha',
        caption: 'Your lesson report', companion_text: null, ...over,
      },
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdates = [];
  mockTables = { coaching_sessions: () => null, users: () => COACH };
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_REVIEW_MODE = 'off';
});
afterAll(() => { delete process.env.OBSERVE_FRAMEWORK; delete process.env.OBSERVE_REVIEW_MODE; });

describe("Send now, the teacher's window closed: the invite template is the only way in", () => {
  test('WhatsApp refuses the invite: the coach is told it failed, and nothing claims it was sent', async () => {
    withDelivery();
    mockWa.sendTemplate.mockResolvedValueOnce(false);   // Meta #132001: no such template on this account
    await Send().processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH_PHONE });

    expect(mockWa.sendTemplate).toHaveBeenCalledTimes(1);
    expect(coachTexts()).toContain(S.send_failed_fo);
    expect(coachTexts()).not.toContain(S.send_template_queued_fo);
    const statuses = deliveryWrites().map((d) => d.status);
    expect(statuses).toContain('send_failed');
    expect(statuses).not.toContain('awaiting_teacher_tap');
  });

  test('WhatsApp accepts the invite: as before, the report waits for the tap and the coach is told', async () => {
    withDelivery();
    await Send().processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH_PHONE });

    expect(coachTexts()).toContain(S.send_template_queued_fo);
    expect(coachTexts()).not.toContain(S.send_failed_fo);
    expect(deliveryWrites().map((d) => d.status)).toContain('awaiting_teacher_tap');
  });
});

describe('the reminder to a teacher who has not tapped', () => {
  test('a refused reminder is not recorded as sent, and the coach is not told it was', async () => {
    const DAY = 24 * 3600 * 1000;
    const now = Date.parse('2026-10-05T12:00:00Z');
    withDelivery({ status: 'awaiting_teacher_tap', template_sent_at: new Date(now - 1.5 * DAY).toISOString() });
    const { classifyUntappedDelivery } = require('../../bot/shared/services/observe/observe-untapped.service');
    const decision = classifyUntappedDelivery(deliveryWrites()[0] || mockTables.coaching_sessions().analysis_data.teacher_delivery, now);
    expect(decision.action).toBe('nudge');   // the planner wants a reminder at this age

    mockWa.sendTemplate.mockResolvedValueOnce(false);
    await expect(Send().processUntappedDelivery(SESSION_ID, now)).rejects.toThrow();
    expect(deliveryWrites().some((d) => d.nudged_at)).toBe(false);
    expect(coachTexts().some((t) => t.includes('Rifsha'))).toBe(false);
  });
});
