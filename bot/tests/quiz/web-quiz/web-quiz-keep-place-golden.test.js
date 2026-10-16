'use strict';
/**
 * Goldens for "keep my place": with the phone-bind and identity-canon switches OFF, the hub's boot JSON and
 * the challenge's answers for a two-child hub link are byte-identical to the snapshots taken from the code
 * path before this change (the snapshot file was written by running this test on the untouched base).
 * Faked boundaries: Supabase (in-memory, filters applied), Redis (a Map), the loggers, and the identity
 * switches module (its own module, owned elsewhere).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async () => true),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
// non-virtual: the module is real, and a virtual mock can miss when another file in the same worker loaded it first (resolver id cache).
jest.mock('../../../shared/services/quiz/web-quiz-identity-flags', () => ({ flags: jest.fn(async () => ({ canon: false, phoneBind: false, guestHome: false })) }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const KID = '44444444-4444-4444-8444-000000000001';
const SIB = '44444444-4444-4444-8444-000000000002';
const LIST = '55555555-5555-4555-8555-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
let fake;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'golden-test-secret';
  redis._store.clear();
  Hub._resetCache();
  Ch.__reset();
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_challenge', value: true }],
    students: [
      { id: KID, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true },
      { id: SIB, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true },
    ],
    student_lists: [{ id: LIST, user_id: 't1', class_name: '3', section: 'A', is_active: true }],
    quiz_sessions: [], quiz_share_codes: [], quizzes: [], student_videos: [], web_quiz_challenge_runs: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const hubToken = () => T.sign({ k: 'h', ids: [KID, SIB], exp: 2000000000 });

test('switches off: two children, no pick -> the hub JSON is the snapshot (no bind key, no line2/played)', async () => {
  const out = await Hub.hub(hubToken(), { device: DEV });
  expect(out).not.toHaveProperty('bind');
  expect(out).toMatchSnapshot();
  // byte-identical: the serialised JSON, key order included
  expect(JSON.stringify(out)).toMatchSnapshot();
});

test('switches off: one child picked -> the hub JSON is the snapshot (no bind key)', async () => {
  const out = await Hub.hub(hubToken(), { device: DEV, kid: T.chipId('h', SIB) });
  expect(out).not.toHaveProperty('bind');
  expect(out).toMatchSnapshot();
  // byte-identical: the serialised JSON, key order included
  expect(JSON.stringify(out)).toMatchSnapshot();
});

test('switches off: a deep link to a scored route with two children and no tap answers as today (400 pick_kid)', async () => {
  await expect(Ch.exercise(hubToken(), 'bigger', { device: DEV })).rejects.toMatchObject({ status: 400, body: { error: 'pick_kid' } });
  await expect(Ch.menu(hubToken(), { device: DEV })).rejects.toMatchObject({ status: 400, body: { error: 'pick_kid' } });
  expect(fake.calls.filter((c) => c.op === 'insert')).toEqual([]);
});

test('switches off: the redis calls and events of a hub open are the snapshot', async () => {
  await Hub.hub(hubToken(), { device: DEV, kid: T.chipId('h', KID) });
  expect(redis.set.mock.calls.map((c) => c[0]).filter((k) => /^wq:idpick:/.test(k))).toEqual([]);
  expect(logEvent.mock.calls.map((c) => c[0])).toMatchSnapshot();
});
