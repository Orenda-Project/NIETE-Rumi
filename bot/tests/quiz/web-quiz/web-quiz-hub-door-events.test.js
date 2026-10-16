'use strict';
/**
 * The server `web_quiz.hub_door` event's writer mark (web-quiz-hub-door.js): with web_quiz_events_v2 on, every
 * server emit of the door carries `w:'s'` (EVENTS §0.1: every count of a server event reads w=='s'); with the switch
 * off, the event is byte-identical to today's. Supabase and Redis are the boundaries and are faked; the token signer,
 * the hub's device binding and the flags run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => store.delete(k)),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Door = require('../../../shared/services/quiz/web-quiz-hub-door');

const SC = '33333333-3333-4333-8333-333333333333';
const KID = '44444444-4444-4444-8444-444444444444';
const D1 = 'AAAAAAAAAAAAAAAAAAAAAA';

class Err extends Error { constructor(status, body) { super(body && body.error); this.status = status; this.body = body; } }

function seed({ eventsV2 = false, door = true } = {}) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_hub_door', value: door }, { key: 'web_quiz_events_v2', value: eventsV2 }],
    quiz_sessions: [{ id: 's1', share_code_id: SC, student_id: KID, status: 'completed', user_id: null, invited_by_student_id: null, device_ref: D1 }],
    students: [{ id: KID, student_name: 'Zara Testwala' }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
const st = () => T.signSession({ sessionId: 's1', deviceRef: D1, shareCodeId: SC });
const doorEvents = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.hub_door').map((c) => c[1]);

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'door-events-test-secret' };
  jest.clearAllMocks();
  redis._store.clear();
  Flags._resetCache();
});
afterAll(() => { process.env = SAVED; });

describe('server hub_door with web_quiz_events_v2 ON: the writer mark', () => {
  test('the door opens: the event carries w:\'s\' beside today\'s fields', async () => {
    seed({ eventsV2: true });
    expect((await Door.door({ st: st() }, Err)).href).toMatch(/^\/h\//);
    expect(doorEvents()).toEqual([{ ok: true, sessionId: 's1', reason: 'bound', w: 's' }]);
  });
  test('the door refuses (switch off): the failure event carries w:\'s\' too', async () => {
    seed({ eventsV2: true, door: false });
    await expect(Door.door({ st: st() }, Err)).rejects.toMatchObject({ status: 404 });
    expect(doorEvents()).toEqual([{ ok: false, reason: 'off', w: 's' }]);
  });
});

describe('golden: web_quiz_events_v2 OFF: the event is today\'s, byte for byte', () => {
  test('the door opens: no w key', async () => {
    seed({ eventsV2: false });
    await Door.door({ st: st() }, Err);
    expect(doorEvents()).toEqual([{ ok: true, sessionId: 's1', reason: 'bound' }]);
  });
  test('the door refuses: no w key', async () => {
    seed({ eventsV2: false, door: false });
    await expect(Door.door({ st: st() }, Err)).rejects.toMatchObject({ status: 404 });
    expect(doorEvents()).toEqual([{ ok: false, reason: 'off' }]);
  });
});
