'use strict';
/**
 * An attendance or class-manager save is answered by its own Flow, never by
 * "Thanks for your response! Type /menu to see what I can help you with."
 *
 * What production delivers (niete-logs, 24-30 Sep 2026): 1,461 Flow completions a
 * week whose response_json fields are exactly ["flow_token"] — nothing else — each
 * classified 'unknown' and answered with that English catch-all. 1,369 followed an
 * attendance-marking Flow, 89 a class-manager Flow.
 *
 * Why nothing but the token arrives: the completion carries whatever the PUBLISHED
 * asset's SAVED Footer asks for. The earlier fix added `attendance_action: "saved"`
 * to the Footer in docs/flows and taught the classifier to read it, but the payload
 * lives in the asset on each WABA. Read back from Meta on 1 Oct 2026: the
 * production Attendance Marking asset was last published 28 Aug and its SAVED Footer
 * completes with an empty payload; staging and sandbox were republished on 11 Sep
 * and carry the tag. The Class Manager asset carries no tag on any WABA. Meta
 * delivered exactly what each published asset asked for — not a dropped field.
 *
 * So the discriminator moves to the one field we set at send time and that arrives
 * on every completion regardless of which asset version a WABA holds: the token.
 * These tests take the token from the REAL senders, then drive the REAL webhook
 * with the payload production actually delivers ({ flow_token } and nothing else).
 */
const http = require('http');
const { makeDb } = require('../quiz/helpers/memory-db');

const PHONE = '923001234567';
const CATCH_ALL = /Thanks for your response/;
const later = (ms) => new Promise((r) => setTimeout(r, ms));

const TEACHER = { id: 't1', role: 'teacher', school_id: 'sch1', preferred_language: 'en', phone_number: PHONE };
const PRINCIPAL = { id: 'p1', role: 'principal', school_id: 'sch1', preferred_language: 'en', phone_number: PHONE };

let mockDb;
let mockWa;

function nfmBody(responseJson) {
  return {
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'pnid' },
          messages: [{
            id: `wamid.${Math.random().toString(36).slice(2)}`,
            from: PHONE,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'interactive',
            interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify(responseJson) } },
          }],
        },
      }],
    }],
  };
}

function mockBoundaries() {
  jest.doMock('../../bot/shared/utils/validators', () => ({
    validateWebhookStatus: () => null,
    validateWebhookMessage: (req) => {
      const value = req.body.entry[0].changes[0].value;
      const message = value.messages[0];
      return {
        entry: req.body.entry[0], message, from: message.from, messageBody: '',
        messageType: message.type, messageTimestamp: message.timestamp,
        phoneNumberId: value.metadata.phone_number_id,
      };
    },
    isOurPhoneNumber: () => true,
    isTestWebhook: () => false,
    isTestPhoneNumber: () => false,
    isWithin24Hours: () => true,
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    get: jest.fn().mockResolvedValue(null), set: jest.fn(), delete: jest.fn(), setNX: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/services/session.service', () => ({
    isProcessed: jest.fn().mockResolvedValue(false),
    markAsProcessed: jest.fn().mockResolvedValue(undefined),
    getReactionEmoji: jest.fn().mockReturnValue('👍'),
  }));
  mockWa = {
    sendReaction: jest.fn().mockResolvedValue(true),
    showTypingIndicator: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendFlow: jest.fn().mockResolvedValue(true),
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => mockWa);
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn().mockResolvedValue(TEACHER),
    trackChatStart: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({
    handleResumeButton: jest.fn().mockResolvedValue(false),
    sweep: jest.fn(),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (...a) => mockDb.from(...a),
    rpc: (...a) => mockDb.rpc(...a),
  }));
}

function seed() {
  return {
    users: [TEACHER, PRINCIPAL],
    student_lists: [{ id: 'l1', user_id: 't1', is_active: true, class_name: 'Grade 4', section: 'A' }],
    students: [{ id: 's1', list_id: 'l1', student_name: 'Aleeha Noor', is_active: true }],
    class_teachers: [{ id: 'ct1', class_id: 'c1', teacher_user_id: 't1', is_class_teacher: true, is_active: true }],
    classes: [{ id: 'c1', school_id: 'sch1', grade_code: 'G4', section: 'A', shift_code: 'morning', session_code: '2026-27', is_active: true }],
    class_teacher_subjects: [],
  };
}

/** POST one completion to the real /webhook and wait until its work has drained. */
async function deliver(responseJson) {
  const { app } = require('../../bot/whatsapp-bot');
  const drain = require('../../bot/shared/utils/web-drain');
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(nfmBody(responseJson)),
    });
    expect(res.status).toBe(200);
    await later(20);
    const deadline = Date.now() + 5000;
    while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
    expect(drain.inFlightCount()).toBe(0);
  } finally {
    server.close();
  }
}

const catchAllSent = () => mockWa.sendMessage.mock.calls.some(([, body]) => CATCH_ALL.test(String(body)));

/** The token the real attendance router hands a TEACHER who taps "Mark by tapping". */
async function teacherMarkingToken() {
  const router = require('../../bot/shared/services/attendance-router.service');
  const decision = await router.resolveMethodChoice('t1', 'att_method_tap');
  expect(decision.action).toBe('OPEN_REGISTER');
  return decision.flowToken;
}

/** The token the real /class sender puts on the class-manager Flow. */
async function classManagerToken() {
  process.env.CLASS_MANAGER_FLOW_ID = 'flow-classes';
  const { openClassManagerFlow } = require('../../bot/shared/services/classes/class-entry.service');
  const sent = await openClassManagerFlow({ from: PHONE, user: TEACHER, language: 'en', reason: 'test' });
  expect(sent).toBe(true);
  const call = mockWa.sendFlow.mock.calls.find(([, o]) => o && o.flowId === 'flow-classes');
  expect(call).toBeTruthy();
  return call[1].flowToken;
}

beforeEach(() => {
  jest.resetModules();
  mockDb = makeDb(seed());
  mockBoundaries();
});
afterAll(() => { delete process.env.CLASS_MANAGER_FLOW_ID; });

describe('a teacher\'s attendance save, as production delivers it', () => {
  test('the token alone classifies it as attendance marking', async () => {
    const token = await teacherMarkingToken();
    const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');
    // The shape the production asset produces: no attendance_action, only the token.
    expect(detectFlowType({ flow_token: token })).toBe('attendance_marking');
  });

  test('the webhook answers it with nothing — the register document already went', async () => {
    const token = await teacherMarkingToken();
    await deliver({ flow_token: token });
    expect(catchAllSent()).toBe(false);
  });

  test('the marking endpoint reads the new token exactly as it read the bare id', async () => {
    const token = await teacherMarkingToken();
    const { parseToken } = require('../../bot/shared/routes/attendance-marking-endpoint');
    // A Flow already delivered with the bare id must still open, and the new token
    // must mean the same thing: this teacher, marking students, class not yet picked.
    expect(parseToken(token)).toEqual(parseToken('t1'));
    expect(parseToken(token)).toMatchObject({ userId: 't1', subject: 'student', picked: false, mode: 'tap' });
  });
});

describe('a class-manager save, as production delivers it', () => {
  test('the token alone classifies it — not unknown, and not attendance', async () => {
    const token = await classManagerToken();
    const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');
    expect(detectFlowType({ flow_token: token })).toBe('class_manager');
  });

  test('the webhook answers it with nothing — the Flow\'s own SAVED screen confirmed it', async () => {
    const token = await classManagerToken();
    await deliver({ flow_token: token });
    expect(catchAllSent()).toBe(false);
  });

  test('the class-manager endpoint still finds the teacher\'s classes from that token', async () => {
    const token = await classManagerToken();
    const Endpoint = require('../../bot/shared/routes/class-manager-endpoint');
    const init = await Endpoint.handleClassesInit(token);
    expect(init.screen).toBe('CLASSES');
    // Her one class is offered (plus "add a new one"), so the endpoint resolved her id.
    expect(init.data.options.map((o) => o.id)).toContain('c1');
  });
});

describe('what already worked keeps working', () => {
  test('a principal\'s and a voice-review token still classify as attendance', () => {
    const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');
    expect(detectFlowType({ flow_token: 'p1:teacher:sch1' })).toBe('attendance_marking');
    expect(detectFlowType({ flow_token: 't1:student:l1:voice' })).toBe('attendance_marking');
    expect(detectFlowType({ attendance_action: 'saved', flow_token: 't1' })).toBe('attendance_marking');
  });

  test('a completion we genuinely cannot place still gets the catch-all', async () => {
    // A bare token with no tag is not ours to guess at: the catch-all stays the
    // honest answer for it (1 such completion in the window had no Flow behind it).
    await deliver({ flow_token: 'someone' });
    expect(catchAllSent()).toBe(true);
  });
});
