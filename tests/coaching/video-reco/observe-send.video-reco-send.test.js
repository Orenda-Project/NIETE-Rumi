'use strict';
/**
 * bd-gzfdu9 (VIDREC) hook B2: on the coach /observe path the recommended clip goes to the TEACHER, once, right
 * after their report image is delivered (deliver or teacher_tap) — never with the coach's preview, never to the
 * operator review number, never when the window was closed and only the invite template went out.
 *
 * Drives the real observe-send service with the network boundary stubbed (the harness of coach-fewer-bubbles.test.js);
 * the clip sender itself (video-reco/send.js) has its own tests and is a spy here.
 */
const mockSendAfter = jest.fn(async () => ({ sent: true, via: 'cta' }));
jest.mock('../../../bot/shared/services/coaching/video-reco/send', () => ({ sendAfterReport: (...a) => mockSendAfter(...a) }));
const mockHero = jest.fn(async () => ({ png: Buffer.from('png'), caption: 'cap', narrative: null }));
jest.mock('../../../bot/shared/services/coaching/report-v2/hero-report.service', () => ({ generateHeroReport: (...a) => mockHero(...a) }));
jest.mock('../../../bot/shared/services/coaching/report-v2/narrative-store', () => ({ persistReportNarrative: jest.fn(async () => true) }));
const SESSION_ID = 'sess-1';
const COACH_PHONE = '923330000001';
const TEACHER_PHONE = '923001234567';
const PNG = Buffer.from('png');

let mockTables;
let mockUpdates;
let mockRedis;

jest.mock('../../../bot/shared/config/supabase', () => {
  const { chain } = require('../../quiz/helpers/supabase-chain');
  return {
    from: jest.fn((table) => {
      const c = chain(() => ({ data: (mockTables[table] || (() => null))(), error: null }));
      // Writes are recorded and answered without touching the row stub.
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
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (k) => (mockRedis.has(k) ? mockRedis.get(k) : null)),
  set: jest.fn(async (k, v) => { mockRedis.set(k, v); return true; }),
  setexWithCeiling: jest.fn(async (k, _t, v) => { mockRedis.set(k, typeof v === 'string' ? JSON.parse(v) : v); return true; }),
  delete: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
  del: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
  setNX: jest.fn().mockResolvedValue(true),
  isAvailable: () => true,
}));
const mockWa = {
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendReaction: jest.fn().mockResolvedValue(true),
  showTypingIndicator: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
};
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../../bot/shared/services/gpt5-mini.service', () => ({
  completeJson: jest.fn().mockRejectedValue(new Error('LLM unavailable in test — fallback guide')),
}));
jest.mock('../../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveTeacherReport: jest.fn().mockResolvedValue(true),
  queueObserveDebrief: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(async () => Buffer.from('png')),
  uploadImageBuffer: jest.fn(async () => 'k'),
}));
// Playwright is the render boundary. The real renderer returns null for a harmful
// debrief (no celebration card) — mirrored here so that path stays testable.
jest.mock('../../../bot/shared/services/observe/observe-coach-card', () => ({
  renderCoachCard: jest.fn(async (fb) => (fb && fb.rubric && fb.rubric.disparaged_teacher ? null : Buffer.from('png'))),
}));

const { observeStrings } = require('../../../bot/shared/services/observe/observe-strings');

const cp = (s) => [...String(s)].length;
const texts = (to) => mockWa.sendMessage.mock.calls.filter(([t]) => !to || t === to).map(([, b]) => String(b));

const COACH = { id: 'coach-1', phone_number: COACH_PHONE, preferred_language: 'en', first_name: 'Sana' };

function rubric(over = {}) {
  return {
    disparaged_teacher: false, opened_with_specific_praise: true, anchored_in_real_moment: true,
    asked_and_waited: true, one_improvement_only: true, moves_not_teacher: true, elicited_if_then: true,
    ...over,
  };
}
const goodFeedback = (over = {}) => ({
  praise_line: 'You opened warmly and let the teacher think.',
  wins: [{ behaviour: 'Opened with specific praise', evidence: 'you named the pair work' }],
  try: { move: 'Let the teacher name the next step', evidence: 'you offered the plan', instead: 'ask what they will try, then wait' },
  reflection_question: 'What will you do differently next time?',
  value: null,
  rubric: rubric(),
  concern: null,
  ...over,
});

function sessionRow(over = {}) {
  return {
    id: SESSION_ID,
    user_id: 'teacher-1',
    observer_user_id: COACH.id,
    observation_type: 'leader_observation',
    status: 'observer_review_complete',
    debrief_status: 'pending',
    analysis_data: { framework: 'fico' },
    users: { name: 'T', phone_number: TEACHER_PHONE, preferred_language: 'en' },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdates = [];
  mockRedis = new Map();
  mockTables = {
    coaching_sessions: () => sessionRow(),
    users: () => COACH,
  };
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_REVIEW_MODE = 'off';
});
afterAll(() => { delete process.env.OBSERVE_FRAMEWORK; delete process.env.OBSERVE_REVIEW_MODE; });


const Send = () => require('../../../bot/shared/services/observe/observe-send.service');
const CAPTION = 'Your lesson report';
const withDelivery = (over = {}) => {
  mockTables.coaching_sessions = () => sessionRow({
    analysis_data: {
      framework: 'fico',
      teacher_delivery: {
        status: 'awaiting_teacher_tap', report_key: 'observe-reports/x.png',
        teacher_phone: TEACHER_PHONE, teacher_name: 'T', caption: CAPTION, companion_text: null, ...over,
      },
    },
  });
};
beforeEach(() => {
  mockSendAfter.mockReset().mockResolvedValue({ sent: true, via: 'cta' });
  mockWa.sendImageFromBuffer.mockReset().mockResolvedValue(true);
});

describe('hook B2', () => {
  test('teacher_tap: the clip goes to the teacher once, after the report image, in the teacher\'s language', async () => {
    withDelivery();
    const order = [];
    mockWa.sendImageFromBuffer.mockImplementation(async (to) => { order.push(`image:${to}`); return true; });
    mockSendAfter.mockImplementation(async (a) => { order.push(`video:${a.phone}`); return { sent: true, via: 'cta' }; });
    await Send().processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER_PHONE });
    expect(mockSendAfter).toHaveBeenCalledTimes(1);
    expect(mockSendAfter.mock.calls[0][0]).toMatchObject({ coachingSessionId: SESSION_ID, phone: TEACHER_PHONE, language: 'en' });
    expect(order).toEqual([`image:${TEACHER_PHONE}`, `video:${TEACHER_PHONE}`]);
  });

  test('deliver with the window open: the clip goes too', async () => {
    withDelivery({ status: 'awaiting_confirm' });
    const QD = require('../../../bot/shared/services/quiz/quiz-delivery.service');
    jest.spyOn(QD, '_hasOpenMessageWindow').mockResolvedValue(true);
    await Send().processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH_PHONE });
    expect(mockSendAfter).toHaveBeenCalledTimes(1);
    expect(mockSendAfter.mock.calls[0][0].phone).toBe(TEACHER_PHONE);
  });

  test('deliver with the window closed (invite template only): no clip', async () => {
    withDelivery({ status: 'awaiting_confirm' });
    const QD = require('../../../bot/shared/services/quiz/quiz-delivery.service');
    jest.spyOn(QD, '_hasOpenMessageWindow').mockResolvedValue(false);
    await Send().processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH_PHONE });
    expect(mockSendAfter).not.toHaveBeenCalled();
  });

  test('operator review mode: no clip (the report went to the review number, not the teacher)', async () => {
    withDelivery({ status: 'awaiting_confirm' });
    process.env.OBSERVE_REVIEW_MODE = 'operator';
    await Send().processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH_PHONE });
    expect(mockSendAfter).not.toHaveBeenCalled();
  });

  test('the coach\'s preview never sends a clip', async () => {
    mockTables.coaching_sessions = () => sessionRow({ analysis_data: { framework: 'fico', teacher_delivery: { teacher_name: 'T', teacher_phone: TEACHER_PHONE } } });
    await Send().processTeacherReport(SESSION_ID, { phase: 'preview', from: COACH_PHONE });
    expect(mockHero).toHaveBeenCalled();
    expect(mockSendAfter).not.toHaveBeenCalled();
  });

  test('the teacher\'s report image failed: no clip', async () => {
    withDelivery();
    mockWa.sendImageFromBuffer.mockResolvedValue(false);
    await Send().processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER_PHONE }).catch(() => null);
    expect(mockSendAfter).not.toHaveBeenCalled();
  });

  test('a clip failure that throws changes nothing: the delivery is still marked sent and the coach told', async () => {
    withDelivery();
    mockSendAfter.mockRejectedValue(new Error('boom'));
    await Send().processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER_PHONE });
    const sent = mockUpdates.some((u) => JSON.stringify(u.payload).includes('"status":"sent"'));
    expect(sent).toBe(true);
    expect(texts(COACH_PHONE).length).toBeGreaterThan(0);
  });
});
