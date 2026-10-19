'use strict';
/**
 * The hub's boot flag for the page batch ids (web-quiz-hub.js hubPayload): with app_settings web_quiz_events_v2 on
 * (and its parent web_quiz_hub), the hub payload carries `ev2: true`, so hub.js puts the hub token and the picked
 * chip on its /api/wq/e batches. Off (absent, false, or the parent off): the payload's keys are exactly today's
 * (the key lists below were taken from the code before the change), picked and unpicked.
 * The scorecard's card already says so with its own key (web-quiz-card.js field: jugnu_ev, with the same switch).
 * Supabase, Redis and the logger transport are the faked boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true), sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');

const KID = '44444444-4444-4444-8444-000000000001';
const SIB = '44444444-4444-4444-8444-000000000002';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';

// The payload keys before the change, in order (origin/sandbox, this file's own fixture): one child, and two unpicked.
const KEYS_PICKED = ['lang', 'kids', 'kid', 'teacher', 'again', 'recs', 'challenge', 'lib', 'brand', 'rt'];
const KEYS_UNPICKED = ['lang', 'kids', 'kid', 'teacher', 'again', 'recs', 'challenge', 'lib', 'brand', 'rt'];

let db;
function seed() {
  db = {
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_challenge', value: true }],
    students: [
      { id: KID, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true },
      { id: SIB, student_name: 'Bilal Testwala', student_name_urdu: null, self_reported_class: '5', list_id: null, is_active: true },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [], quiz_share_codes: [], quiz_sessions: [], student_videos: [], web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'batch-ids-test-secret';
  process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(48);
  process.env.WEB_QUIZ_KID_KEY_V = '2026';
  Hub._resetCache();
  require('../../../shared/services/cache/railway-redis.service')._store.clear();
  seed();
});

const OFF = [
  ['absent', () => {}],
  ['false', () => db.app_settings.push({ key: 'web_quiz_events_v2', value: false })],
  ['parent off', () => { db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_hub'); db.app_settings.push({ key: 'web_quiz_events_v2', value: true }); }],
];

describe('web_quiz_events_v2 off: the hub payload keys are today\'s', () => {
  test.each(OFF.slice(0, 2))('picked and unpicked (%s): no ev2, the same keys in the same order', async (_label, setup) => {
    setup();
    const one = await Hub.hub(T.signHub([KID]), { device: DEV });
    const two = await Hub.hub(T.signHub([KID, SIB]), { device: DEV });
    expect(one.kid).toBeTruthy();
    expect(two.kid).toBeNull();
    expect(Object.keys(one)).toEqual(KEYS_PICKED);
    expect(Object.keys(two)).toEqual(KEYS_UNPICKED);
    expect('ev2' in one || 'ev2' in two).toBe(false);
  });

  test('the parent web_quiz_hub off: the hub is off (503) and no payload carries ev2', async () => {
    OFF[2][1]();
    await expect(Hub.hub(T.signHub([KID]), { device: DEV })).rejects.toMatchObject({ status: 503 });
  });
});

describe('web_quiz_events_v2 on: the hub payload says so', () => {
  test('picked and unpicked: ev2 true, and every other key is today\'s', async () => {
    db.app_settings.push({ key: 'web_quiz_events_v2', value: true });
    const one = await Hub.hub(T.signHub([KID]), { device: DEV });
    const two = await Hub.hub(T.signHub([KID, SIB]), { device: DEV });
    expect(one.ev2).toBe(true);
    expect(two.ev2).toBe(true);
    expect(Object.keys(one).filter((k) => k !== 'ev2')).toEqual(KEYS_PICKED);
    expect(Object.keys(two).filter((k) => k !== 'ev2')).toEqual(KEYS_UNPICKED);
  });

  test('a phone the token is not trusted on (the locked hub): no ev2', async () => {
    db.app_settings.push({ key: 'web_quiz_events_v2', value: true });
    const tok = T.signHub([KID]);
    await Hub.hub(tok, { device: DEV });
    const other = await Hub.hub(tok, { device: 'BBBBBBBBBBBBBBBBBBBBBB' });
    expect(other.locked).toBe(true);
    expect('ev2' in other).toBe(false);
  });
});
