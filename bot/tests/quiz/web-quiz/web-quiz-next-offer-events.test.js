'use strict';
/**
 * The next-thing slot's page lines through the page relay (web-quiz.service.js events -> web-quiz-events-v3.js relay):
 *   - web_quiz_events_v3 off: every line is today's (the same calls as with the key absent) — the golden;
 *   - on: next_shown / next_tap / home_view / door_tap (a v3 door) carry ev_v 3, v3 1, w 'p', the child's kid (hub
 *     token + chip, or the quiz session's child), the sitting id, only the v3 keys; never the token, the chip, a code,
 *     a name or a phone; a next_tap on an offer resets that offer's "shown, not tapped" streak.
 * Faked boundaries only: Supabase, Redis, the logger transport.
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
  const db = { app_settings: settings, quiz_sessions: [{ id: '66666666-6666-4666-8666-000000000001', student_id: KID, share_code_id: 'sc-1' }], students: [{ id: KID }] };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  NO._resetCache();
  require('../../../shared/services/quiz/web-quiz-hub-flags')._resetCache();
  await NO.switches();
  await require('../../../shared/services/quiz/web-quiz-hub-flags').flags();
}

const BATCH = () => ({
  ht: T.signHub([KID]), chip: T.chipId('h', KID),
  events: [
    { n: 'next_shown', ctx: 'home', kind: 'story', id: 'en.read.1.k01', pos: 0, rank_src: 'prior', offer: 'AbCdEfGhIj', arm: 'rank', score_v: '2026-10-16.2', source: 'ranked', code: 'TSTQ42', name: 'Zara Testwala' },
    { n: 'next_tap', offer: 'AbCdEfGhIj', ctx: 'home', kind: 'story', pos: 0, ms_to_tap: 2210.4 },
    { n: 'door_tap', door: 'stories', pos: 1 },
    { n: 'door_tap', door: 'hub_first', surface: 'hub', slot: 2 },
    { n: 'home_view', src: 'home' },
    { n: 'answer', code: 'TSTQ42', i: 3, ok: 1, ms: 1200 },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'ev3-test-secret';
  process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(40);
});

describe('GOLDEN: web_quiz_events_v3 off -> the relay is today\'s', () => {
  test.each([[false], [true]])('events v2 %s: the v3 key false gives exactly the calls of the key absent', async (v2) => {
    const v2s = v2 ? [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_events_v2', value: true }] : [];
    await seed(v2s);
    Svc.events(BATCH(), { device: DEV });
    await flush();
    const base = logEvent.mock.calls.map((c) => JSON.stringify(c));
    jest.clearAllMocks();
    await seed([...v2s, { key: 'web_quiz_events_v3', value: 'false' }]);
    Svc.events(BATCH(), { device: DEV });
    await flush();
    expect(logEvent.mock.calls.map((c) => JSON.stringify(c))).toEqual(base);
    expect(logEvent.mock.calls.some(([, f]) => f && f.ev_v === 3)).toBe(false);
  });
});

describe('events v3 on', () => {
  test('the slot lines: v3 envelope, the child\'s kid and sitting, only the v3 keys', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: 'true' }]);
    const out = Svc.events(BATCH(), { device: DEV });
    expect(out.logged).toBe(6);
    await flush();
    const by = (n) => logEvent.mock.calls.filter(([name]) => name === n).map(([, f]) => f);
    const [shown] = by('web_quiz.next_shown');
    expect(shown).toMatchObject({ ev_v: 3, v3: 1, w: 'p', kid: K.kid(KID), ctx: 'home', kind: 'story', id: 'en.read.1.k01', pos: 0, rank_src: 'prior', offer: 'AbCdEfGhIj', arm: 'rank', score_v: '2026-10-16.2', source: 'ranked' });
    expect(shown.sit).toMatch(/^[a-z0-9]{10}$/);
    const [tap] = by('web_quiz.next_tap');
    expect(tap).toMatchObject({ offer: 'AbCdEfGhIj', pos: 0, ms_to_tap: 2210, kid: K.kid(KID) });
    expect(tap.sit).toBe(shown.sit);   // one sitting
    expect(by('web_quiz.home_view')[0]).toMatchObject({ src: 'home', ev_v: 3 });
    // a v3 door goes v3; a v2 door (hub_first) keeps today's path
    const doors = by('web_quiz.door_tap');
    expect(doors.find((d) => d.door === 'stories')).toMatchObject({ ev_v: 3, pos: 1 });
    expect(doors).toHaveLength(2);
    expect(doors.filter((d) => d.ev_v === 3)).toHaveLength(1);
    const text = JSON.stringify(logEvent.mock.calls.filter(([, f]) => f && f.ev_v === 3));
    ['TSTQ42', 'Zara', KID, BATCH().chip].forEach((s) => expect(text).not.toContain(s));
    expect(text).not.toMatch(/"(code|name|ht|chip|student_id|dh|sid)"/);
  });

  test('the door screens\' lines: door_row_tap (pos up to 99), video_open / video_watched (ms) keep their own keys only', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: 'true' }]);
    Svc.events({ ht: T.signHub([KID]), chip: T.chipId('h', KID), events: [
      { n: 'door_row_tap', door: 'videos', kind: 'subject', item: 'science', pos: 12, ctx: 'home' },
      { n: 'video_open', item: 'vid-9', via: 'hub_door' },
      { n: 'video_watched', item: 'vid-9', via: 'hub_door', ms: 61234.6, code: 'TSTQ42' },
    ] }, { device: DEV });
    await flush();
    const by = (n) => logEvent.mock.calls.filter(([name]) => name === n).map(([, f]) => f)[0];
    expect(by('web_quiz.door_row_tap')).toMatchObject({ ev_v: 3, door: 'videos', kind: 'subject', item: 'science', pos: 12, kid: K.kid(KID) });
    expect(by('web_quiz.door_row_tap')).not.toHaveProperty('ctx');
    expect(by('web_quiz.video_open')).toMatchObject({ item: 'vid-9', via: 'hub_door' });
    expect(by('web_quiz.video_watched')).toMatchObject({ item: 'vid-9', ms: 61235 });
    expect(by('web_quiz.video_watched')).not.toHaveProperty('code');
  });

  test('a quiz scorecard batch (no hub token): the child comes from the session token', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: 'true' }]);
    const st = T.signSession({ sessionId: '66666666-6666-4666-8666-000000000001', deviceRef: DEV, shareCodeId: 'sc-1' });
    Svc.events({ st, events: [{ n: 'next_shown', ctx: 'after_quiz', kind: 'video', id: 'library', pos: 0, offer: 'ZyXwVuTsRq', arm: 'rand', rank_src: 'rand' }] }, { device: DEV });
    await flush();
    const [line] = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.next_shown').map(([, f]) => f);
    expect(line.kid).toBe(K.kid(KID));
    expect(line.ctx).toBe('after_quiz');
  });

  test('next_tap on the offer the slot showed resets its "shown, not tapped" streak', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: 'true' }]);
    const kid = K.kid(KID);
    redis._store.set(`wq:next:${kid}`, { m: '2026-10', o: 3, s: { id: 'vid-1', n: 2 }, of: { AbCdEfGhIj: 'vid-1' } });
    Svc.events(BATCH(), { device: DEV });
    await flush();
    expect(redis._store.get(`wq:next:${kid}`).s).toEqual({ id: 'vid-1', n: 0 });
  });

  test('a forged hub token or chip -> kid null, the line still relayed, the streak untouched', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: 'true' }]);
    const kid = K.kid(KID);
    redis._store.set(`wq:next:${kid}`, { s: { id: 'vid-1', n: 2 }, of: { AbCdEfGhIj: 'vid-1' } });
    Svc.events({ ht: 'forged', chip: 'nope', events: [{ n: 'next_tap', offer: 'AbCdEfGhIj', pos: 0 }] }, { device: DEV });
    await flush();
    const [line] = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.next_tap').map(([, f]) => f);
    expect(line.kid).toBeNull();
    expect(line.sit).toBeNull();
    expect(redis._store.get(`wq:next:${kid}`).s.n).toBe(2);
  });
});
