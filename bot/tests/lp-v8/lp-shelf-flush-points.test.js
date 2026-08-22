/**
 * FEAT-059 / bd-njn7u Phase 1.3 — defensive shelf flush on real feature
 * switches (TDD, red first).
 *
 * When the teacher explicitly starts something NEW — browsing for another
 * lesson, a coaching session, a video, attendance — any in-flight LP context
 * belongs to the past. Parent-bot parity (bd-1349 / bd-1565): quiz already
 * flushes on NIETE; menu, coaching, video and attendance never got the call
 * because the shelf was dead when they were ported.
 *
 * Every flush is belt-and-suspenders: a flush FAILURE must never block the
 * feature itself.
 */

/* eslint-disable global-require */

// menu.service's require graph reaches the OpenRouter client, whose
// constructor throws without a key. These tests never call an LLM — the dummy
// keeps module load working everywhere (locally the shared .env has no key;
// see menu-entry.test.js failing to load for exactly this reason).
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-dummy-key';
process.env.PAKISTAN_LP_FLOW_ID = '1229471668881234';
process.env.VIDEO_GENERATION_ENABLED = 'false';

let mockFlushError = null;
const mockFlushCalls = [];
jest.mock('../../shared/services/lp-shelf.service', () => ({
  pushToShelf: jest.fn(async () => {}),
  getShelf: jest.fn(async () => []),
  flushShelf: jest.fn(async (userId) => {
    mockFlushCalls.push(userId);
    if (mockFlushError) throw mockFlushError;
  }),
}));

const mockSends = { flows: [], messages: [] };
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(async (to, opts) => { mockSends.flows.push({ to, ...opts }); return true; }),
  sendMessage: jest.fn(async (to, body) => { mockSends.messages.push({ to, body }); return true; }),
  sendInteractiveMessage: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  sendButtonMessage: jest.fn(async () => true),
}));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  redis: {
    set: jest.fn(async () => 'OK'),
    setex: jest.fn(async () => 'OK'),
    get: jest.fn(async () => null),
    del: jest.fn(async () => 1),
  },
  set: jest.fn(async () => true),
  get: jest.fn(async () => null),
  expire: jest.fn(async () => true),
  delete: jest.fn(async () => true),
}));

const mockTables = { users: [], student_lists: [], coaching_sessions: [] };
function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const b = {
    select: () => b,
    eq: (col, val) => { rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    order: () => b,
    limit: () => Promise.resolve({ data: rows, error: null }),
    single: () => Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } }),
    maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
    insert: (payload) => {
      const row = { id: `${table}-1`, ...(Array.isArray(payload) ? payload[0] : payload) };
      mockTables[table] = [...(mockTables[table] || []), row];
      const ret = {
        select: () => ret,
        single: () => Promise.resolve({ data: row, error: null }),
        then: (f, r) => Promise.resolve({ data: [row], error: null }).then(f, r),
      };
      return ret;
    },
    update: () => b,
    then: (f, r) => Promise.resolve({ data: rows, error: null }).then(f, r),
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));

jest.mock('../../shared/config/coaching-messages', () => ({
  getCoachingMessage: jest.fn(() => 'Got your recording — give me a moment.'),
}));

jest.mock('../../shared/services/video/video-session.service', () => ({}));
jest.mock('../../shared/services/video/video-job-queue.service', () => ({}));
jest.mock('../../shared/services/conversation-state.service', () => ({
  setState: jest.fn(async () => {}),
  getState: jest.fn(async () => null),
  clearState: jest.fn(async () => {}),
}));

const LPShelfService = require('../../shared/services/lp-shelf.service');
const MenuService = require('../../shared/services/menu.service');
const CoachingSessionService = require('../../shared/services/coaching/coaching-session.service');
const VideoOrchestrator = require('../../shared/services/video/video-orchestrator.service');
const AttendanceRouter = require('../../shared/services/attendance-router.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');

beforeEach(() => {
  mockFlushError = null;
  mockFlushCalls.length = 0;
  mockSends.flows.length = 0;
  mockSends.messages.length = 0;
  mockTables.users = [{ id: 'user-1', phone_number: '923001234567', role: 'teacher', name: 'Test', first_name: 'Test', preferred_language: 'ur' }];
  mockTables.student_lists = [];
  mockTables.coaching_sessions = [];
  jest.clearAllMocks();
});

describe('menu → Lesson Plans tap flushes the shelf', () => {
  test('the explicit menu tap starts fresh', async () => {
    await MenuService._handleLessonPlanningChoice('user-1', 'sess-1', '923001234567', 'en');
    expect(mockFlushCalls).toContain('user-1');
  });

  test('flush failure never costs her the lesson menu', async () => {
    mockFlushError = new Error('redis down');
    await MenuService._handleLessonPlanningChoice('user-1', 'sess-1', '923001234567', 'en');
    expect(LPShelfService.flushShelf).toHaveBeenCalled();
    expect(mockSends.flows.length).toBe(1);       // the LP Flow still went out
  });
});

describe('coaching start flushes the shelf', () => {
  test('initiateSession flushes before creating the session', async () => {
    await CoachingSessionService.initiateSession('user-1', 'sess-1', 'audio-1', '923001234567', 600);
    expect(mockFlushCalls).toContain('user-1');
  });
});

describe('video start flushes the shelf', () => {
  test('initiateVideoRequest flushes even when the feature flag is off', async () => {
    const user = { id: 'user-1', phone_number: '923001234567' };
    await VideoOrchestrator.initiateVideoRequest(user, '923001234567', 'sess-1', 'en', null);
    expect(mockFlushCalls).toContain('user-1');
  });
});

describe('attendance start flushes the shelf', () => {
  test('route() flushes for a real user', async () => {
    await AttendanceRouter.route('user-1');
    expect(mockFlushCalls).toContain('user-1');
  });

  test('flush failure never blocks attendance routing', async () => {
    mockFlushError = new Error('redis down');
    const res = await AttendanceRouter.route('user-1');
    expect(LPShelfService.flushShelf).toHaveBeenCalled();
    expect(res && res.action).toBeTruthy();       // she still gets an answer
  });
});
