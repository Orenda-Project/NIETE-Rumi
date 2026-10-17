'use strict';
/**
 * The class link's "Is it <First>?" sheet (web_quiz_link_known_child) under events v3 (app_settings
 * `web_quiz_events_v3`): `known_ask {kids}` and the sheet's two answers, `identity_pick {src: known | known_else}`,
 * are v3 lines (the v3 envelope, the phone's dk and sitting; `kids` a whole number 0-4, `src` those two values, nothing
 * else kept: never a name, a code or a chip). Every other identity_pick stays on today's path. Off: today's relay,
 * call for call. Supabase and Redis are the faked boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable() { return true; },
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, typeof v === 'string' ? v : JSON.parse(JSON.stringify(v))); return true; }),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }), delete: jest.fn(async () => true),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const K = require('../../../shared/services/quiz/web-quiz-kid');
const NO = require('../../../shared/services/quiz/web-quiz-next-offer');
const Svc = require('../../../shared/services/quiz/web-quiz.service');

const KID = '44444444-4444-4444-8444-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const flush = () => new Promise((r) => setTimeout(r, 30));

async function seed(settings) {
  const db = { app_settings: settings, quiz_sessions: [], students: [{ id: KID }] };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  NO._resetCache();
  require('../../../shared/services/quiz/web-quiz-hub-flags')._resetCache();
  await NO.switches();
  await require('../../../shared/services/quiz/web-quiz-hub-flags').flags();
}

// The quiz page's batch before a session starts: no session token, no hub token; the phone is the edge's device.
const BATCH = () => ({
  events: [
    { n: 'known_ask', kids: 2, code: 'TSTQ42', name: 'Zara Testwala' },
    { n: 'identity_pick', src: 'known', chip: 'c1a2b3', first: 'Zara' },
    { n: 'identity_pick', src: 'known_else' },
    { n: 'identity_pick', src: 'roll' },
  ],
});
const by = (n) => logEvent.mock.calls.filter(([name]) => name === n).map(([, f]) => f);

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'ev3-test-secret';
  process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(40);
});

describe('GOLDEN: web_quiz_events_v3 off -> the sheet\'s lines are today\'s', () => {
  test.each([[false], [true]])('events v2 %s: the v3 key false / "true" / absent give exactly the same calls', async (v2) => {
    const v2s = v2 ? [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_events_v2', value: true }] : [];
    await seed(v2s);
    Svc.events(BATCH(), { device: DEV });
    await flush();
    const base = logEvent.mock.calls.map((c) => JSON.stringify(c));
    for (const value of ['false', 'true', false]) {
      jest.clearAllMocks();
      await seed([...v2s, { key: 'web_quiz_events_v3', value }]);
      Svc.events(BATCH(), { device: DEV });
      await flush();
      expect(logEvent.mock.calls.map((c) => JSON.stringify(c))).toEqual(base);
    }
    expect(logEvent.mock.calls.some(([, f]) => f && f.ev_v === 3)).toBe(false);
  });
});

describe('events v3 on', () => {
  test('known_ask: a v3 line with the count and the phone\'s dk; never the code or a name', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events(BATCH(), { device: DEV });
    await flush();
    const [ask] = by('web_quiz.known_ask');
    expect(ask).toMatchObject({ ev_v: 3, v3: 1, w: 'p', kids: 2, kid: null, dk: K.dk(DEV) });
    expect(ask.sit).toMatch(/^[a-z0-9]{10}$/);
    expect(JSON.stringify(ask)).not.toMatch(/TSTQ42|Zara/);
  });

  test('known_ask kids: a whole number 0-4 only', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events({ events: [{ n: 'known_ask', kids: 4 }, { n: 'known_ask', kids: '2' }, { n: 'known_ask', kids: 9 }, { n: 'known_ask', kids: 1.5 }] }, { device: DEV });
    await flush();
    expect(by('web_quiz.known_ask').map((f) => f.kids)).toEqual([4, undefined, undefined, undefined]);
  });

  test('the sheet\'s two answers are v3 lines (src only); every other identity_pick stays on today\'s path', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events(BATCH(), { device: DEV });
    await flush();
    const picks = by('web_quiz.identity_pick');
    const v3 = picks.filter((f) => f.ev_v === 3);
    expect(v3.map((f) => f.src)).toEqual(['known', 'known_else']);
    for (const f of v3) {
      expect(f).toMatchObject({ v3: 1, w: 'p', kid: null, dk: K.dk(DEV) });
      expect(f).not.toHaveProperty('chip');
      expect(f).not.toHaveProperty('first');
    }
    const today = logEvent.mock.calls.filter(([, f]) => f && f.ev_v !== 3 && JSON.stringify(f).includes('"roll"'));
    expect(today).toHaveLength(1);
  });
});

describe('the page\'s /known timing lines (link_known_answer, link_known_late) under events v3', () => {
  test('both are v3 lines: ms (a whole number 0-600000), kids (0-4) on the answer; never the code or a name', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events({ events: [
      { n: 'link_known_answer', ms: 3480, kids: 1, code: 'TSTQ42', first: 'Zara' },
      { n: 'link_known_late', ms: 5120, code: 'TSTQ42' },
    ] }, { device: DEV });
    await flush();
    const [ans] = by('web_quiz.link_known_answer');
    const [late] = by('web_quiz.link_known_late');
    expect(ans).toMatchObject({ ev_v: 3, v3: 1, w: 'p', ms: 3480, kids: 1, kid: null, dk: K.dk(DEV) });
    expect(late).toMatchObject({ ev_v: 3, v3: 1, w: 'p', ms: 5120, kid: null, dk: K.dk(DEV) });
    expect(late).not.toHaveProperty('kids');
    expect(JSON.stringify([ans, late])).not.toMatch(/TSTQ42|Zara/);
  });

  test('out of range or not a whole number: the field is dropped, the line kept', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events({ events: [
      { n: 'link_known_answer', ms: -1, kids: 5 }, { n: 'link_known_answer', ms: '300', kids: 1.5 },
      { n: 'link_known_late', ms: 600001 }, { n: 'link_known_late', ms: 600000 },
    ] }, { device: DEV });
    await flush();
    expect(by('web_quiz.link_known_answer').map((f) => [f.ms, f.kids])).toEqual([[undefined, undefined], [undefined, undefined]]);
    expect(by('web_quiz.link_known_late').map((f) => f.ms)).toEqual([undefined, 600000]);
  });

  test('events v3 off: today\'s path (no v3 envelope)', async () => {
    await seed([]);
    Svc.events({ events: [{ n: 'link_known_answer', ms: 3480, kids: 1 }, { n: 'link_known_late', ms: 5120 }] }, { device: DEV });
    await flush();
    expect(logEvent.mock.calls.some(([, f]) => f && f.ev_v === 3)).toBe(false);
  });
});
