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
    for (const value of ['false', 'true', false]) {   // a string 'true' is OFF too: JSON true only
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
  test('the slot lines: v3 envelope, the child\'s kid and sitting, only the v3 keys', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
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
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
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

  test('a page copy of a server-only v3 line (next_set, activity_start/end) is dropped under v3', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events({ events: [{ n: 'next_set', ctx: 'home', offer: 'AbCdEfGhIj' }, { n: 'activity_start', kind: 'quiz' }, { n: 'activity_end', kind: 'quiz' }] }, { device: DEV });
    await flush();
    expect(logEvent.mock.calls.filter(([n]) => /next_set|activity_/.test(n))).toEqual([]);
  });

  test('a quiz scorecard batch (no hub token): the child comes from the session token', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    const st = T.signSession({ sessionId: '66666666-6666-4666-8666-000000000001', deviceRef: DEV, shareCodeId: 'sc-1' });
    Svc.events({ st, events: [{ n: 'next_shown', ctx: 'after_quiz', kind: 'video', id: 'library', pos: 0, offer: 'ZyXwVuTsRq', arm: 'rand', rank_src: 'rand' }] }, { device: DEV });
    await flush();
    const [line] = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.next_shown').map(([, f]) => f);
    expect(line.kid).toBe(K.kid(KID));
    expect(line.ctx).toBe('after_quiz');
  });

  test('next_tap on the offer the slot showed resets its "shown, not tapped" streak', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    const kid = K.kid(KID);
    redis._store.set(`wq:next:${kid}`, { m: '2026-10', o: 3, s: { id: 'vid-1', n: 2 }, of: { AbCdEfGhIj: 'vid-1' } });
    Svc.events(BATCH(), { device: DEV });
    await flush();
    expect(redis._store.get(`wq:next:${kid}`).s).toEqual({ id: 'vid-1', n: 0 });
  });

  test('a forged hub token or chip -> kid null, the line still relayed, the streak untouched', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    const kid = K.kid(KID);
    redis._store.set(`wq:next:${kid}`, { s: { id: 'vid-1', n: 2 }, of: { AbCdEfGhIj: 'vid-1' } });
    Svc.events({ ht: 'forged', chip: 'nope', events: [{ n: 'next_tap', offer: 'AbCdEfGhIj', pos: 0 }] }, { device: DEV });
    await flush();
    const [line] = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.next_tap').map(([, f]) => f);
    expect(line.kid).toBeNull();
    // no child: the sitting is the phone's (EVENTS v3 §0, kid|dk), under its own key
    expect(line.sit).toMatch(/^[a-z0-9]{10}$/);
    expect(redis._store.get(`wq:sit:d.${K.dk(DEV)}`)).toBe(line.sit);
    expect(redis._store.get(`wq:next:${kid}`).s.n).toBe(2);
  });
});

describe('events v3 on: the relay keeps the amended names (EVENTS v3 §2 and §4)', () => {
  const by = (n) => logEvent.mock.calls.filter(([name]) => name === n).map(([, f]) => f);
  const hub = () => ({ ht: T.signHub([KID]), chip: T.chipId('h', KID) });

  test('next_tap landed: where the tap took the child (home | target); anything else dropped', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events({ ...hub(), events: [
      { n: 'next_tap', ctx: 'home', kind: 'quiz', pos: 0, offer: 'AbCdEfGhIj', landed: 'home' },
      { n: 'next_tap', ctx: 'home', kind: 'quiz', pos: 0, offer: 'AbCdEfGhIj', landed: 'target' },
      { n: 'next_tap', ctx: 'home', kind: 'quiz', pos: 0, offer: 'AbCdEfGhIj', landed: 'elsewhere' },
    ] }, { device: DEV });
    await flush();
    const [h, t, x] = by('web_quiz.next_tap');
    expect(h.landed).toBe('home');
    expect(t.landed).toBe('target');
    expect(x).not.toHaveProperty('landed');
  });

  test('next_shown and next_tap carry the slot\'s variant (a video: recommended | library); an unknown one dropped', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events({ ...hub(), events: [
      { n: 'next_shown', ctx: 'home', kind: 'video', id: 'library', pos: 0, offer: 'AbCdEfGhIj', variant: 'library' },
      { n: 'next_tap', ctx: 'home', kind: 'video', pos: 0, offer: 'AbCdEfGhIj', variant: 'recommended' },
      { n: 'next_tap', ctx: 'home', kind: 'video', pos: 0, offer: 'AbCdEfGhIj', variant: 'Bad Variant!' },
    ] }, { device: DEV });
    await flush();
    expect(by('web_quiz.next_shown')[0]).toMatchObject({ kind: 'video', variant: 'library' });
    const [tap, bad] = by('web_quiz.next_tap');
    expect(tap).toMatchObject({ kind: 'video', variant: 'recommended', kid: K.kid(KID) });
    expect(bad).not.toHaveProperty('variant');
  });

  test('next_shown kind door; rank_src ctrl', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events({ ...hub(), events: [
      { n: 'next_shown', ctx: 'home', kind: 'door', id: 'stories', pos: 0, source: 'fallback' },
      { n: 'next_shown', ctx: 'after_quiz', kind: 'quiz', id: 'abcdef0123', pos: 0, rank_src: 'ctrl', arm: 'ctrl', offer: 'AbCdEfGhIj', source: 'fallback' },
      { n: 'next_shown', ctx: 'after_read_tried', kind: 'story', id: 'en.listen.1.k02', pos: 0, rank_src: 'prior' },
    ] }, { device: DEV });
    await flush();
    const [door, ctrl, tried] = by('web_quiz.next_shown');
    expect(door).toMatchObject({ kind: 'door', source: 'fallback', kid: K.kid(KID) });
    expect(ctrl).toMatchObject({ rank_src: 'ctrl', arm: 'ctrl' });
    expect(tried).toMatchObject({ ctx: 'after_read_tried' });
  });

  test('a coach\'s preview (practice 1): kept as practice:1 with kid null even with a real hub token; no streak reset', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    const kid = K.kid(KID);
    redis._store.set(`wq:next:${kid}`, { s: { id: 'vid-1', n: 2 }, of: { AbCdEfGhIj: 'vid-1' } });
    Svc.events({ ...hub(), events: [
      { n: 'home_view', src: 'home', practice: 1 },
      { n: 'next_tap', offer: 'AbCdEfGhIj', pos: 0, practice: '1' },
      { n: 'home_view', src: 'home', practice: 2 },
    ] }, { device: DEV });
    await flush();
    const views = by('web_quiz.home_view');
    expect(views[0]).toMatchObject({ practice: 1, kid: null });
    expect(by('web_quiz.next_tap')[0]).toMatchObject({ practice: 1, kid: null });
    expect(views[1]).not.toHaveProperty('practice');   // only 1 is the practice flag
    expect(views[1].kid).toBe(kid);
    expect(redis._store.get(`wq:next:${kid}`).s.n).toBe(2);
  });

  test('who_open { kids, jn }: small whole numbers only', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events({ ...hub(), events: [
      { n: 'who_open', kids: 3, jn: 1 },
      { n: 'who_open', kids: '3', jn: true },
      { n: 'who_open', kids: 99, jn: 2, name: 'Zara Testwala' },
    ] }, { device: DEV });
    await flush();
    const [a, b, c] = by('web_quiz.who_open');
    expect(a).toMatchObject({ ev_v: 3, kids: 3, jn: 1, kid: K.kid(KID) });
    expect(b).not.toHaveProperty('kids'); expect(b).not.toHaveProperty('jn');
    expect(c).not.toHaveProperty('kids'); expect(c).not.toHaveProperty('jn'); expect(c).not.toHaveProperty('name');
  });

  test('card_shown { source, share_ok, tried } and card_share { source, kind, path }: the contract values only', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }]);
    Svc.events({ ...hub(), events: [
      { n: 'card_shown', source: 'read', share_ok: true, tried: false },
      { n: 'card_shown', source: 'exam', share_ok: 'true', tried: 1 },
      { n: 'card_share', source: 'story', kind: 'card_image', path: 'wa' },
      { n: 'card_share', source: 'quiz', kind: 'pdf', path: 'email', code: 'TSTQ42' },
    ] }, { device: DEV });
    await flush();
    const [s1, s2] = by('web_quiz.card_shown');
    expect(s1).toMatchObject({ ev_v: 3, source: 'read', share_ok: true, tried: false });
    ['source', 'share_ok', 'tried'].forEach((k) => expect(s2).not.toHaveProperty(k));
    const [h1, h2] = by('web_quiz.card_share');
    expect(h1).toMatchObject({ source: 'story', kind: 'card_image', path: 'wa' });
    expect(h2).toMatchObject({ source: 'quiz' });
    ['kind', 'path', 'code'].forEach((k) => expect(h2).not.toHaveProperty(k));
  });

  test('rich telemetry and events v3 both on: a v3 line never carries the device hash or the session id', async () => {
    await seed([{ key: 'web_quiz_events_v3', value: true }, { key: 'web_quiz_rich_telemetry', value: 'true' }]);
    const Tel = require('../../../shared/services/quiz/web-quiz-telemetry');
    await Tel.flag(Date.now() + 60 * 1000);   // past the cache's life: read the switch now
    expect(Tel.on()).toBe(true);
    const st = T.signSession({ sessionId: '66666666-6666-4666-8666-000000000001', deviceRef: DEV, shareCodeId: 'sc-1' });
    expect(Object.keys(Tel.batchIds({ st, dr: DEV })).length).toBeGreaterThan(0);   // the batch HAS ids to leak
    Svc.events({ st, dr: DEV, events: [{ n: 'next_shown', ctx: 'after_quiz', kind: 'video', id: 'library', pos: 0 }, { n: 'card_shown', source: 'quiz', share_ok: true }] }, { device: DEV });
    await flush();
    const v3 = logEvent.mock.calls.filter(([, f]) => f && f.ev_v === 3).map(([, f]) => f);
    expect(v3).toHaveLength(2);
    v3.forEach((f) => { ['dh', 'sid', 'device_ref', 'dr', 'st', 'code'].forEach((k) => expect(f).not.toHaveProperty(k)); });
  });
});

describe('tk: the teacher key, one helper beside kid()', () => {
  const crypto = require('crypto');
  const UID = '11111111-1111-4111-8111-000000000001';
  test('HMAC-SHA256(key, "t|" + id) hex[0:16], the same function from the kid and the events modules', () => {
    const EV3 = require('../../../shared/services/quiz/web-quiz-events-v3');
    const want = crypto.createHmac('sha256', 'k'.repeat(40)).update(`t|${UID}`).digest('hex').slice(0, 16);
    expect(K.tk(UID)).toBe(want);
    expect(EV3.tk(UID)).toBe(want);
    expect(EV3.tk).toBe(K.tk);
    expect(K.tk(null)).toBeNull();
    expect(K.tk('')).toBeNull();
    expect(K.tk(UID)).not.toBe(K.kid(UID));   // a teacher's key never equals a child's key for the same id
  });
  test('a key under 32 bytes (or none): null, and the one missing-key line', () => {
    K._reset();
    process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(31);
    expect(K.tk(UID)).toBeNull();
    delete process.env.WEB_QUIZ_KID_KEY;
    expect(K.tk(UID)).toBeNull();
    expect(logEvent.mock.calls.filter(([n]) => n === 'web_quiz.kid_key_missing')).toHaveLength(1);
    process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(32);
    expect(K.tk(UID)).toMatch(/^[0-9a-f]{16}$/);
    // the team's pinned vector (the same literal every teacher surface's test asserts on its emitted line)
    expect(K.tk('a0000000-0000-4000-8000-000000000001')).toBe('e815e81977411f12');
  });
});
