'use strict';
/**
 * A classroom recording ends the "send me your recording" wait.
 *
 * "Record my lesson" (the coaching ask after a lesson plan), the menu's
 * Classroom Coaching row and /coaching all go through one door:
 * `MenuService._handleClassroomCoachingChoice`, which writes the teacher's
 * conversation state `coaching / AWAITING_CLASSROOM_AUDIO` for six hours.
 * Nothing cleared it when the recording arrived. For the rest of the six hours
 * every plain text the teacher sent was answered "Please send your classroom
 * audio or video" (text-message.handler reads this state), and when it lapsed
 * the resume sweep asked "Earlier you started a classroom observation but we
 * did not finish. Shall we pick up?" — of a lesson that had been coached.
 * Production, 30 days: 46% of the daytime coaching resume offers went to a
 * teacher whose session had started in the previous six hours.
 *
 * Driven through the real menu door, the real coaching start, the real state
 * store and the real resume sweep. Only the network boundary is faked:
 * Supabase (a stateful in-memory table set), the cache, WhatsApp, the LLM.
 */

const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockRedis = createMemoryRedis();

jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({}),
  getClientForModel: (m) => ({ client: {}, model: String(m || '') }),
}));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  storeConversation: jest.fn(), getOrCreateSession: jest.fn().mockResolvedValue('session-1'),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn().mockResolvedValue('en'),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const MenuService = require('../../bot/shared/services/menu.service');
const CoachingSessionService = require('../../bot/shared/services/coaching/coaching-session.service');
const ConversationState = require('../../bot/shared/services/conversation-state.service');
const ConversationResume = require('../../bot/shared/services/conversation-resume.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const PHONE = '923001234567';

/** An instant given as a PKT wall-clock time on Tue 22 Sep 2026 (PKT = UTC+5). */
const pkt = (h, m = 0) => new Date(Date.UTC(2026, 8, 22, h - 5, m, 0));

const resumeOffers = () => WhatsAppService.sendInteractiveButtons.mock.calls
  .filter(([, payload]) => (payload.buttons || []).some((b) => String(b.id).startsWith('resume_')));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
  mockRedis.reset();
  mockDb.reset({
    users: [{
      id: TEACHER, name: 'Teacher', phone_number: PHONE, preferred_language: 'en', role: 'teacher',
      conversation_state: null, conversation_state_expires_at: null,
    }],
    coaching_sessions: [],
  });
});

afterEach(() => {
  jest.useRealTimers();
});

async function saysRecordMyLesson(at = pkt(8, 15)) {
  jest.setSystemTime(at);
  await MenuService._handleClassroomCoachingChoice(TEACHER, 'session-1', PHONE, 'en');
}

async function sendsTheRecording(at = pkt(11, 0)) {
  jest.setSystemTime(at);
  await CoachingSessionService.initiateSession(TEACHER, 'session-1', 'audio-media-1', PHONE, 30 * 60);
}

describe('the recording arrives — the wait is over', () => {
  test('the teacher is no longer waiting for a recording once one has started a coaching session', async () => {
    await saysRecordMyLesson();
    expect((await ConversationState.getState(TEACHER))).toEqual(
      expect.objectContaining({ flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO' }),
    );

    await sendsTheRecording();

    expect(mockDb.rows('coaching_sessions')).toHaveLength(1);
    // text-message.handler reads exactly this to decide on the "Please send your
    // classroom audio or video" reply; null means her next text is answered as usual.
    expect(await ConversationState.getState(TEACHER)).toBeNull();
  });

  test('six hours later nobody asks them to "pick up" the observation they already finished', async () => {
    await saysRecordMyLesson(pkt(8, 15));
    await sendsTheRecording(pkt(11, 0));

    jest.setSystemTime(pkt(14, 30));        // the 6-hour wait would have lapsed at 14:15
    const tally = await ConversationResume.sweepAndOffer();

    expect(resumeOffers()).toHaveLength(0);
    expect(tally.offered).toBe(0);
  });
});

describe('what must not change', () => {
  test('a teacher who said yes and never recorded IS still offered it back', async () => {
    await saysRecordMyLesson(pkt(8, 15));

    jest.setSystemTime(pkt(14, 30));
    const tally = await ConversationResume.sweepAndOffer();

    expect(tally.offered).toBe(1);
    expect(resumeOffers()).toHaveLength(1);
    expect(resumeOffers()[0][1].buttons.map((b) => b.id)).toEqual(['resume_yes:coaching', 'resume_no:coaching']);
  });

  test('a recording never clears another feature\'s wait (the clear is scoped to coaching)', async () => {
    jest.setSystemTime(pkt(10, 0));
    await ConversationState.setState(TEACHER, { flow: 'reading', step: 'awaiting_audio', ttlSeconds: 3600 });

    await sendsTheRecording(pkt(10, 5));

    expect(await ConversationState.getState(TEACHER)).toEqual(
      expect.objectContaining({ flow: 'reading', step: 'awaiting_audio' }),
    );
  });

  test('a failing state write never costs the teacher the coaching session', async () => {
    await saysRecordMyLesson();
    const realFrom = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementation((table) => {
      const chain = realFrom(table);
      if (table !== 'users') return chain;
      const update = chain.update;
      chain.update = (patch) => {
        if (patch && 'conversation_state' in patch) throw new Error('users update refused');
        return update(patch);
      };
      return chain;
    });

    await expect(sendsTheRecording()).resolves.toBeUndefined();
    mockDb.from.mockImplementation(realFrom);

    expect(mockDb.rows('coaching_sessions')).toHaveLength(1);
    // The failure is said out loud, at error level (Class N)…
    const { logToFile } = require('../../bot/shared/utils/logger');
    expect(logToFile).toHaveBeenCalledWith(
      expect.stringContaining('Coaching wait not cleared'), expect.any(Object), 'error',
    );
    // …and the confirmation ("I detected a 30-minute recording… Yes, Analyze") still went out.
    expect(WhatsAppService.sendInteractiveButtons.mock.calls.some(([, p]) =>
      (p.buttons || []).some((b) => String(b.id).startsWith('coaching_confirm_')))).toBe(true);
  });
});
