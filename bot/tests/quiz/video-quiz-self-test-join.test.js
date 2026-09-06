'use strict';
/**
 * PLAN_R5 §1 D8 — a teacher opening her own class link is joined as HERSELF,
 * not asked for a name/class and not written into `students`. A CHILD on the
 * same share code must be completely unaffected — that is the regression
 * this file guards against explicitly.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/student-identity.service', () => ({
  findByPhone: jest.fn().mockResolvedValue([]),
  remember: jest.fn().mockResolvedValue({ id: 'stu-1' }),
  touch: jest.fn().mockResolvedValue(undefined),
  normalisePhone: (p) => {
    let d = String(p || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = `92${d.slice(1)}`;
    else if (d.startsWith('3') && d.length === 10) d = `92${d}`;
    return d.slice(0, 15);
  },
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const StudentIdentity = require('../../shared/services/quiz/student-identity.service');
const share = require('../../shared/services/quiz/video-quiz-share.service');

const TEACHER_ID = 'u1';
const TEACHER_PHONE = '+923001234567';

const SHARE_CODE = {
  id: 'sc-1', quiz_id: 'q1', video_id: 'v1', teacher_user_id: TEACHER_ID,
  teacher_name: 'Miss Ayesha', topic: 'A Balanced Diet', language: 'en',
  active: true, expires_at: null,
};

/** Records every `startSession` call so the join can be asserted against it. */
function stubSupabase({ teacherPhone = TEACHER_PHONE, teacherFirstName = 'Ayesha' } = {}) {
  const supabase = require('../../shared/config/supabase');
  const startSessionCalls = [];
  supabase.from.mockImplementation((table) => {
    const orderable = {
      order: () => orderable,
      then: (resolve) => resolve({ data: [{ id: 'qq1', external_id: 'leg:1', sort_order: 1 }], error: null }),
    };
    const chain = {
      select: () => chain, eq: () => chain, update: () => chain,
      in: () => chain, limit: () => chain, order: () => orderable,
      insert: (payload) => {
        if (table === 'quiz_sessions') startSessionCalls.push(payload);
        return { select: () => ({ single: async () => ({ data: { id: 'sess-1' } }) }) };
      },
      single: async () => ({
        data: {
          id: 'qq1', question_text: 'Which one?', option_a: 'A', option_b: 'B',
          option_c: null, option_d: null, correct_option: 'A', media: {}, render_pattern: 'P1',
        },
        error: null,
      }),
      maybeSingle: async () => {
        if (table === 'users') return { data: { id: TEACHER_ID, first_name: teacherFirstName, last_name: null, phone_number: teacherPhone } };
        return { data: SHARE_CODE };
      },
    };
    return chain;
  });
  return startSessionCalls;
}

beforeEach(() => {
  jest.clearAllMocks();
  StudentIdentity.findByPhone.mockResolvedValue([]);
});

describe('PLAN_R5 D8 — a teacher self-test on her own share code', () => {
  test.each(['+923001234567', '03001234567', '923001234567'])(
    'her phone in the form %s is recognised and joined as herself, no Flow/name asked',
    async (phoneForm) => {
      const calls = stubSupabase();
      const handled = await share.beginFromCode(phoneForm, 'K7RM2');

      expect(handled).toBe(true);
      expect(StudentIdentity.remember).not.toHaveBeenCalled();
      expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(expect.objectContaining({
        user_id: TEACHER_ID, source: 'share_link',
      }));
    },
  );

  test('logs video_quiz.teacher_self_test, never the phone or name', async () => {
    stubSupabase();
    await share.beginFromCode(TEACHER_PHONE, 'K7RM2');

    expect(logEvent).toHaveBeenCalledWith('video_quiz.teacher_self_test', expect.objectContaining({
      shareCodeId: 'sc-1', quizId: 'q1', userId: TEACHER_ID,
    }));
    const [, payload] = logEvent.mock.calls.find(([e]) => e === 'video_quiz.teacher_self_test');
    expect(JSON.stringify(payload)).not.toMatch(/923001234567/);
    expect(JSON.stringify(payload)).not.toMatch(/Ayesha/);
  });

  test('she gets the self-test acknowledgement, never the ordinary child greeting', async () => {
    stubSupabase();
    await share.beginFromCode(TEACHER_PHONE, 'K7RM2');

    const bodies = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    expect(bodies.some((b) => /test run/i.test(b))).toBe(true);
    expect(bodies.some((b) => /what is your name/i.test(b))).toBe(false);
  });

  test('a CHILD on the SAME share code is completely unchanged: asked for name, userId null', async () => {
    const calls = stubSupabase();   // teacher phone is still 923001234567
    const CHILD_PHONE = '923009999999';

    const handled = await share.beginFromCode(CHILD_PHONE, 'K7RM2');

    expect(handled).toBe(true);
    // Never touched the self-test path.
    expect(logEvent).not.toHaveBeenCalledWith('video_quiz.teacher_self_test', expect.anything());
    // Falls into the existing "never met" chat-ask path (no Flow configured).
    const bodies = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    expect(bodies.some((b) => /what is your name/i.test(b))).toBe(true);
    // No session has been started yet for a brand-new child at this point —
    // they must answer name+class first (consumeJoinReply), unlike the teacher.
    expect(calls).toHaveLength(0);
  });
});
