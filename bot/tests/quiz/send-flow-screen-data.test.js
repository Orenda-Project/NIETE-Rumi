'use strict';
/**
 * bd-mg9c7.79 — sendFlow() drops navigateData, so two Flows open with empty
 * screen data.
 *
 * whatsapp.service.js's sendFlow() destructures `screenData` and fills
 * `flow_action_payload.data` from it alone. Two live callers pass
 * `navigateData` instead — video-quiz-share.service's student-join Flow
 * (screen WHO: teacher/topic) and video-quiz-sender.service's picture-quiz
 * Flow (screen ASK: question/options) — so both open on a blank screen. The
 * seam was green because student-join-flow.test.js asserts the OPTIONS
 * OBJECT passed to the mocked sendFlow, never what actually reaches Meta.
 *
 * This suite mocks only the HTTP boundary (axios) so whatsapp.service,
 * video-quiz-share.service and video-quiz-sender.service all run for real,
 * and asserts the payload axios.post actually receives.
 */

process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'test-token';
process.env.PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || 'test-phone-id';

jest.mock('axios');
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn(),
}));
jest.mock('../../shared/services/quiz/student-identity.service', () => ({
  findByPhone: jest.fn().mockResolvedValue([]),
  remember: jest.fn().mockResolvedValue({ id: 'stu-1' }),
  touch: jest.fn().mockResolvedValue(undefined),
  normalisePhone: (p) => String(p || '').replace(/\D/g, ''),
}));

const axios = require('axios');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const share = require('../../shared/services/quiz/video-quiz-share.service');
const sender = require('../../shared/services/quiz/video-quiz-sender.service');

const SHARE_CODE = {
  id: 'sc-1', quiz_id: 'q1', video_id: 'v1', teacher_user_id: 'u1',
  teacher_name: 'Miss Ayesha', topic: 'A Balanced Diet', language: 'en',
  active: true, expires_at: null,
};

function stubShareCodeLookup() {
  const supabase = require('../../shared/config/supabase');
  supabase.from.mockImplementation(() => {
    const orderable = {
      order: () => orderable,
      then: (resolve) => resolve({
        data: [{ id: 'q1', external_id: 'leg:1', sort_order: 1 }], error: null,
      }),
    };
    const chain = {
      select: () => chain, eq: () => chain, update: () => chain,
      in: () => chain, limit: () => chain,
      order: () => orderable,
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'sess-1' } }) }) }),
      single: async () => ({
        data: {
          id: 'q1', question_text: 'Which one?', option_a: 'A', option_b: 'B',
          option_c: null, option_d: null, correct_option: 'A',
          media: {}, render_pattern: 'P1',
        },
        error: null,
      }),
      maybeSingle: async () => ({ data: SHARE_CODE }),
    };
    return chain;
  });
}

function lastPayload() {
  const call = axios.post.mock.calls[axios.post.mock.calls.length - 1];
  expect(call).toBeDefined();
  return call[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
});

describe('bd-mg9c7.79 — navigateData reaches flow_action_payload.data', () => {
  test('student-join Flow: teacher + topic reach the WHO screen', async () => {
    const OLD = process.env.STUDENT_JOIN_FLOW_ID;
    process.env.STUDENT_JOIN_FLOW_ID = 'join-flow-1';
    stubShareCodeLookup();

    await share.beginFromCode('923001234567', 'K7RM2');

    const payload = lastPayload();
    const flowPayload = payload.interactive.action.parameters.flow_action_payload;
    expect(flowPayload.screen).toBe('WHO');
    expect(flowPayload.data).toEqual({ teacher: 'Miss Ayesha', topic: 'A Balanced Diet' });

    process.env.STUDENT_JOIN_FLOW_ID = OLD;
  });

  test('picture-quiz Flow: options reach the ASK screen', async () => {
    const OLD = process.env.VIDEO_QUIZ_FLOW_ID;
    process.env.VIDEO_QUIZ_FLOW_ID = 'vq-flow-1';

    const msg = {
      phase: 'interaction', kind: 'flow', role: 'picture_flow',
      body: 'Which picture is right?',
      options: ['Cat', 'Dog'],
      optionIndices: [0, 1],
      optionImages: ['base64cat', 'base64dog'],
    };
    await sender.sendPhase('923009999999', [msg], 'interaction', {
      questionId: 'q-1', sessionId: 'sess-1',
    });

    const payload = lastPayload();
    const flowPayload = payload.interactive.action.parameters.flow_action_payload;
    expect(flowPayload.screen).toBe('ASK');
    expect(flowPayload.data.options).toEqual([
      { id: '0', title: 'Cat', image: 'base64cat', 'alt-text': 'Cat' },
      { id: '1', title: 'Dog', image: 'base64dog', 'alt-text': 'Dog' },
    ]);

    process.env.VIDEO_QUIZ_FLOW_ID = OLD;
  });

  test('screenData still lands in flow_action_payload.data (the alias does not displace the primary name)', async () => {
    const ok = await WhatsAppService.sendFlow('923000000000', {
      flowId: 'flow-x', screen: 'X', screenData: { a: 1 },
    });
    expect(ok).toBe(true);

    const payload = lastPayload();
    expect(payload.interactive.action.parameters.flow_action_payload.data).toEqual({ a: 1 });
  });

  test('data_exchange mode emits no flow_action_payload at all, whichever key was passed', async () => {
    await WhatsAppService.sendFlow('923000000000', {
      flowId: 'flow-y', flowToken: 'tok-1', navigateData: { a: 1 },
    });
    expect(lastPayload().interactive.action.parameters.flow_action_payload).toBeUndefined();

    await WhatsAppService.sendFlow('923000000000', {
      flowId: 'flow-y', flowToken: 'tok-1', screenData: { a: 1 },
    });
    expect(lastPayload().interactive.action.parameters.flow_action_payload).toBeUndefined();
  });
});
