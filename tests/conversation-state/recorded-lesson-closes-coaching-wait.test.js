'use strict';
/**
 * A recorded lesson closes the "waiting for your classroom recording" step.
 *
 * Tapping Classroom Coaching in the menu (and, once it is switched on, "Yes" to the
 * coaching ask after a lesson plan) stores a six-hour wait: flow 'coaching', step
 * AWAITING_CLASSROOM_AUDIO. Nothing closed that wait when the recording arrived, so
 * six hours later the resume sweep found it "expired" and asked the teacher whether
 * to pick up the classroom observation — the one they had already recorded and been
 * coached on. Production, 17–24 Sep: 1,651 of 2,308 resume offers (72%) went to a
 * teacher whose own coaching session had been created in the seven hours before.
 *
 * The real ConversationState, CoachingSessionService and resume sweep run here,
 * against one in-memory database. Only the network boundary is mocked: Supabase (an
 * in-memory fake that applies the filters), WhatsApp and Redis.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

const mockDb = { current: null };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => mockDb.current.from(t),
}));

const mockSends = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendInteractiveButtons: jest.fn(async (to, options) => { mockSends.push({ to, options }); return true; }),
  sendMessage: jest.fn(async (to, text) => { mockSends.push({ to, text }); return true; }),
}));

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => true),
  delete: jest.fn(async () => true),
  acquireLock: jest.fn(async () => true),
  releaseLock: jest.fn(async () => true),
}));

const ConversationState = require('../../bot/shared/services/conversation-state.service');
const CoachingSessionService = require('../../bot/shared/services/coaching/coaching-session.service');
const ConversationResume = require('../../bot/shared/services/conversation-resume.service');

const USER = '11111111-2222-3333-4444-555555555555';
const PHONE = '000000000002';

// The menu's own contract for this step (menu.service.js STEP_CONTRACT).
const COACHING_WAIT = { flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO', ttlSeconds: 21600 };

// The sweep holds offers during the quiet hours; this suite is about WHAT is
// offered, not WHEN, so the window is lifted (resume-quiet-hours.test.js owns it).
const QUIET_KEY = 'NUDGE_QUIET_HOURS_PKT';
const savedQuiet = process.env[QUIET_KEY];
beforeAll(() => { process.env[QUIET_KEY] = 'off'; });
afterAll(() => {
  if (savedQuiet === undefined) delete process.env[QUIET_KEY];
  else process.env[QUIET_KEY] = savedQuiet;
});

function freshDb() {
  return createFakeSupabase({
    users: [{
      id: USER, name: 'Test Teacher', phone_number: PHONE, preferred_language: 'en',
      conversation_state: null, conversation_state_expires_at: null,
    }],
    coaching_sessions: [],
  });
}

/** Six hours pass: whatever wait is stored is now past its deadline. */
function sixHoursLater() {
  const row = mockDb.current._tables.users[0];
  if (row.conversation_state) row.conversation_state_expires_at = new Date(Date.now() - 60 * 1000).toISOString();
}

const resumeOffers = () => mockSends.filter((s) => s.options
  && (s.options.buttons || []).some((b) => String(b.id).startsWith('resume_')));

beforeEach(() => {
  mockSends.length = 0;
  jest.clearAllMocks();
  mockDb.current = freshDb();
});

describe('the classroom recording closes the coaching wait', () => {
  it('once the recording starts a coaching session, the wait is gone', async () => {
    await ConversationState.setState(USER, COACHING_WAIT);
    expect((await ConversationState.getState(USER)).step).toBe('AWAITING_CLASSROOM_AUDIO');

    await CoachingSessionService.initiateSession(USER, 'chat-1', 'audio-1', PHONE, 900);

    expect(await ConversationState.getState(USER)).toBeNull();
    expect(mockDb.current._tables.users[0].conversation_state).toBeNull();
  });

  it('six hours later the teacher is NOT asked to pick up the observation they already recorded', async () => {
    await ConversationState.setState(USER, COACHING_WAIT);
    await CoachingSessionService.initiateSession(USER, 'chat-1', 'audio-1', PHONE, 900);
    mockSends.length = 0;   // the confirm buttons for the recording itself are not the point

    sixHoursLater();
    await ConversationResume.sweepAndOffer();

    expect(resumeOffers()).toHaveLength(0);
  });
});

describe('what must not change', () => {
  it('a teacher who tapped Classroom Coaching and never recorded IS still offered it back', async () => {
    await ConversationState.setState(USER, COACHING_WAIT);

    sixHoursLater();
    const tally = await ConversationResume.sweepAndOffer();

    expect(tally.offered).toBe(1);
    expect(resumeOffers()).toHaveLength(1);
  });

  it("another feature's step is left alone when a recording starts coaching", async () => {
    await ConversationState.setState(USER, { flow: 'quiz', step: 'AWAITING_QUIZ_TOPIC', ttlSeconds: 3600 });

    await CoachingSessionService.initiateSession(USER, 'chat-1', 'audio-1', PHONE, 900);

    expect((await ConversationState.getState(USER)).flow).toBe('quiz');
  });
});
