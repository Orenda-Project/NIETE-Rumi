'use strict';
/**
 * The hub chip's pick record inherits the quiz start's pick (web-quiz-bind-page.js recordHubPick / recordPick):
 * a child who came to the hub from the quiz they just played on this phone keeps that start's id_src, id_confidence
 * and homonym_in_list on the Trail's run row; "remembered" is only a chip with no session pick behind it; a child
 * joined to no roster (no class list, no merged_into) is written low, as forced_new when the start said so.
 * Each path runs the whole route: quiz start pick -> hub chip -> the Trail's serve -> the run row's identity columns.
 * Faked: Supabase (in-memory), Redis (a Map), the loggers, R2/TTS/LLM/audio (the serve's boundaries), the identity
 * switches and the canonical-id helper (mapped per test). The hub token, device trust, homonym guard and serve run for real.
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
jest.mock('../../../shared/services/quiz/web-quiz-identity-flags', () => ({ flags: jest.fn() }));
jest.mock('../../../shared/services/quiz/child-bind-codes.repo', () => ({ mint: jest.fn(), get: jest.fn() }));
jest.mock('../../../shared/services/quiz/child-phone-bindings.repo', () => ({ eraseOne: jest.fn(), activeForChild: jest.fn(async () => []), renew: jest.fn(), expiresAtFor: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-identity-roster', () => ({
  ...jest.requireActual('../../../shared/services/quiz/web-quiz-identity-roster'),
  canonicalStudentId: jest.fn(async (id) => id),
  canonicalStudentIds: jest.fn(async (ids) => new Map((ids || []).map((id) => [String(id), String(id)]))),
}));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key) => `https://r2.test/put/${key}`), headObject: jest.fn(async () => ({ exists: true })),
  downloadFromR2: jest.fn(), getPresignedUrl: jest.fn(async (u) => u), buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'), presignKey: jest.fn(async (key) => `https://signed.test/${key}`), deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true), listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'test', voice: 'v', durationSec: 1 })) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const { guardColumns } = require('./registry-columns');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const Roster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bind = require('../../../shared/services/quiz/web-quiz-bind-page');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');

const LIST = 'c0000001-0000-4000-8000-0000000000aa';
const HINA1 = 'c0000001-0000-4000-8000-000000000011';   // two Hinas in 3-B, fathers differ
const HINA2 = 'c0000001-0000-4000-8000-000000000012';
const ZARA1 = 'c0000001-0000-4000-8000-000000000021';   // two Zaras in 3-B, no father's name
const ZARA2 = 'c0000001-0000-4000-8000-000000000022';
const ROSTER = 'c0000001-0000-4000-8000-000000000031';  // a roster child, unique first name
const LOOSE = 'c0000001-0000-4000-8000-000000000041';   // "My name isn't here": no list, no merged_into
const MERGED = 'c0000001-0000-4000-8000-000000000042';  // a loose row the teacher joined to ROSTER
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString();
const ON = { canon: true, phoneBind: false, guestHome: false };
const OFF = { canon: false, phoneBind: false, guestHome: false };
const hubOf = (ids) => T.sign({ k: 'h', ids, exp: Math.floor(Date.now() / 1000) + 3600 });
const chip = (id) => T.chipId('h', id);
const devH = require('crypto').createHash('sha256').update(DEV).digest('hex').slice(0, 16);
const hubKey = (id) => `wq:idpick:h:${id}:${devH}`;
const flagsOf = (...keys) => keys.map((key) => ({ key, value: true }));
let db;

beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-pick-test-secret'; });
beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  Hub._resetCache();
  Ch.__reset();
  IdFlags.flags.mockResolvedValue(ON);
  Roster.canonicalStudentId.mockImplementation(async (id) => id);
  Roster.canonicalStudentIds.mockImplementation(async (ids) => new Map((ids || []).map((id) => [String(id), String(id)])));
  db = {
    app_settings: flagsOf('web_quiz_hub', 'web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing', 'web_quiz_challenge_v2'),
    students: [
      { id: HINA1, student_name: 'Hina Testwala', father_name: 'Akbar Testwala', list_id: LIST, self_reported_class: '3', is_active: true, status: 'active', merged_into: null },
      { id: HINA2, student_name: 'Hina Testwala', father_name: 'Bilal Testwala', list_id: LIST, self_reported_class: '3', is_active: true, status: 'active', merged_into: null },
      { id: ZARA1, student_name: 'Zara Testwala', father_name: null, list_id: LIST, self_reported_class: '3', is_active: true, status: 'active', merged_into: null },
      { id: ZARA2, student_name: 'Zara Testwala', father_name: null, list_id: LIST, self_reported_class: '3', is_active: true, status: 'active', merged_into: null },
      { id: ROSTER, student_name: 'Moiz Testwala', father_name: null, list_id: LIST, self_reported_class: '3', is_active: true, status: 'active', merged_into: null },
      { id: LOOSE, student_name: 'Pari Testwala', father_name: null, list_id: null, self_reported_class: '3', is_active: true, status: 'active', merged_into: null },
      { id: MERGED, student_name: 'Bano Testwala', father_name: null, list_id: null, self_reported_class: '3', is_active: true, status: 'merged', merged_into: ROSTER },
    ],
    student_lists: [{ id: LIST, user_id: 't1', class_name: '3', section: 'B', is_active: true }],
    challenge_periods: [{ period_id: '2026-11', starts_at: iso(Date.now() - DAY), ends_at: iso(Date.now() + 29 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' }],
    challenge_passages: [], challenge_draws: [], web_quiz_challenge_runs: [], quiz_sessions: [], quiz_share_codes: [], quizzes: [], student_videos: [],
  };
  Object.assign(supabase, guardColumns(makeFake(db)));
});

// quiz start (the pick on this phone) -> Home -> the hub chip -> the Trail's serve -> the run row written for it
async function route({ sessionId, via, studentId, hubIds, chosen }) {
  if (via) await Bind.recordPick({ sessionId, via, studentId, device: DEV });
  const tok = hubOf(hubIds || [studentId]);
  const hub = await Hub.hub(tok, { device: DEV, kid: chip(chosen || studentId) });
  const ex = await Ch.exercise(tok, 'bigger', { device: DEV, lang: 'en' });
  const row = db.web_quiz_challenge_runs.find((r) => r.id === T.verify(ex.ct, 'c').r);
  return { hub, row, hubRec: redis._store.get(hubKey(chosen || studentId)) };
}
const pickEvents = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.id_pick').map((c) => c[1]);

describe('a loose child (RULING #87): low, forced_new carried, never high without a roster join', () => {
  test('path 3: "My name isn\'t here" -> hub -> Trail -> the record row is forced_new / low', async () => {
    const { hub, row, hubRec } = await route({ sessionId: 's-new', via: 'new', studentId: LOOSE });
    expect(hub.kid).toBe(chip(LOOSE));
    expect(hubRec).toEqual({ id_src: 'forced_new', id_confidence: 'low', homonym_in_list: false, canonical_id: LOOSE, at: expect.any(Number) });
    expect(row).toMatchObject({ id_src: 'forced_new', id_confidence: 'low', homonym_in_list: false, canonical_id: LOOSE });
    expect(pickEvents()).toEqual([
      { w: 's', id_src: 'forced_new', id_confidence: 'low', homonym_in_list: false, chips_k: 0 },
      { w: 's', id_src: 'forced_new', id_confidence: 'low', homonym_in_list: false, chips_k: 1 },
    ]);
  });
  test('a loose child whose session pick expired (a chip tap alone) is still low, as remembered', async () => {
    const { row, hubRec } = await route({ sessionId: null, via: null, studentId: LOOSE });
    expect(hubRec).toMatchObject({ id_src: 'remembered', id_confidence: 'low', homonym_in_list: false });
    expect(row).toMatchObject({ id_src: 'remembered', id_confidence: 'low' });
  });
  test('after merged_into joins the loose row to a roster child -> high (the stale forced_new pick is not inherited)', async () => {
    Roster.canonicalStudentId.mockImplementation(async (id) => (id === MERGED ? ROSTER : id));
    Roster.canonicalStudentIds.mockImplementation(async (ids) => new Map((ids || []).map((id) => [String(id), id === MERGED ? ROSTER : String(id)])));
    const { hub, row, hubRec } = await route({ sessionId: 's-merged', via: 'new', studentId: MERGED, hubIds: [MERGED], chosen: ROSTER });
    expect(hub.kid).toBe(chip(ROSTER));
    expect(hubRec).toEqual({ id_src: 'remembered', id_confidence: 'high', homonym_in_list: false, canonical_id: ROSTER, at: expect.any(Number) });
    expect(row).toMatchObject({ id_src: 'remembered', id_confidence: 'high', canonical_id: ROSTER });
  });
  test('the students row cannot be read -> low (a guess never puts a child into the trend)', async () => {
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'students') return b;
      const select = b.select;   // only the roster-join read fails (its column list); the hub's own reads run as before
      b.select = (cols, ...a) => { const bb = select.apply(b, [cols, ...a]); if (cols === 'id, list_id, merged_into') bb.maybeSingle = async () => ({ data: null, error: { message: 'boom' } }); return bb; };
      return b;
    };
    await Hub.hub(hubOf([ROSTER]), { device: DEV, kid: chip(ROSTER) });
    supabase.from = from;
    expect(redis._store.get(hubKey(ROSTER))).toMatchObject({ id_src: 'remembered', id_confidence: 'low' });
  });
});

describe('a roster child\'s session pick is inherited by the hub chip (RULING #90a)', () => {
  test('path 4 (storage wiped, two Hinas, the full name): roster_pick / homonym_in_list TRUE on the row, the start\'s confidence kept', async () => {
    const { row, hubRec } = await route({ sessionId: 's-hina', via: 'full_name', studentId: HINA1 });
    const start = redis._store.get('wq:idpick:s-hina');
    expect(start).toMatchObject({ id_src: 'roster_pick', homonym_in_list: true, canonical_id: HINA1 });
    expect(hubRec).toEqual({ id_src: 'roster_pick', id_confidence: start.id_confidence, homonym_in_list: true, canonical_id: HINA1, at: expect.any(Number) });
    expect(row).toMatchObject({ id_src: 'roster_pick', id_confidence: start.id_confidence, homonym_in_list: true, canonical_id: HINA1 });
  });
  test('path 6 (two Zaras, no father, the list number): roster_pick / TRUE / low on the row', async () => {
    const { row, hubRec } = await route({ sessionId: 's-zara', via: 'number', studentId: ZARA2 });
    expect(redis._store.get('wq:idpick:s-zara')).toMatchObject({ id_src: 'roster_pick', id_confidence: 'low', homonym_in_list: true });
    expect(hubRec).toMatchObject({ id_src: 'roster_pick', id_confidence: 'low', homonym_in_list: true, canonical_id: ZARA2 });
    expect(row).toMatchObject({ id_src: 'roster_pick', id_confidence: 'low', homonym_in_list: true, canonical_id: ZARA2 });
  });
  test('the hub record\'s `at` is the chip tap\'s instant, not the quiz start\'s (the serve\'s per-visit guard)', async () => {
    await Bind.recordPick({ sessionId: 's-old', via: 'name', studentId: ROSTER, device: DEV });
    redis._store.set('wq:idpick:s-old', { ...redis._store.get('wq:idpick:s-old'), at: Date.now() - 2 * 3600 * 1000 });
    const before = Date.now();
    await Hub.hub(hubOf([ROSTER]), { device: DEV, kid: chip(ROSTER) });
    const rec = redis._store.get(hubKey(ROSTER));
    expect(rec.id_src).toBe('roster_pick');
    expect(rec.at).toBeGreaterThanOrEqual(before);
  });
  test('a session pick older than 24 h is not inherited: remembered / high', async () => {
    await Bind.recordPick({ sessionId: 's-stale', via: 'number', studentId: ZARA1, device: DEV });
    redis._store.set('wq:idpick:s-stale', { ...redis._store.get('wq:idpick:s-stale'), at: Date.now() - 25 * 3600 * 1000 });
    const { row, hubRec } = await route({ sessionId: null, via: null, studentId: ZARA1 });
    expect(hubRec).toMatchObject({ id_src: 'remembered', id_confidence: 'high', homonym_in_list: false });
    expect(row).toMatchObject({ id_src: 'remembered', id_confidence: 'high', homonym_in_list: false });
  });
  test('a session pick of ANOTHER child on this phone (a sibling) is not inherited', async () => {
    await Bind.recordPick({ sessionId: 's-sib', via: 'number', studentId: ZARA1, device: DEV });
    const { hubRec } = await route({ sessionId: null, via: null, studentId: ROSTER });
    expect(hubRec).toMatchObject({ id_src: 'remembered', id_confidence: 'high' });
  });
  test('a /quiz hub link (src wa) stays hub_chip / high for a roster child, session pick or not', async () => {
    await Bind.recordPick({ sessionId: 's-wa', via: 'number', studentId: ZARA1, device: DEV });
    await Hub.hub(hubOf([ZARA1]), { device: DEV, kid: chip(ZARA1), src: 'wa' });
    expect(redis._store.get(hubKey(ZARA1))).toMatchObject({ id_src: 'hub_chip', id_confidence: 'high' });
  });
});

describe('goldens: untouched paths byte-identical', () => {
  test('a roster child with no session pick: the hub record and the row are today\'s (remembered / high), only the h: key written', async () => {
    const { row, hubRec } = await route({ sessionId: null, via: null, studentId: ROSTER });
    expect(hubRec).toEqual({ id_src: 'remembered', id_confidence: 'high', homonym_in_list: false, canonical_id: ROSTER, at: expect.any(Number) });
    expect(row).toMatchObject({ id_src: 'remembered', id_confidence: 'high', homonym_in_list: false });
    expect(redis.set.mock.calls.map((c) => c[0]).filter((k) => /^wq:idpick:/.test(k))).toEqual([hubKey(ROSTER)]);
  });
  test('recordPick without a device writes exactly today\'s one key (no pointer)', async () => {
    await Bind.recordPick({ sessionId: 's-nodev', via: 'name', studentId: ROSTER });
    expect(redis.set.mock.calls).toEqual([['wq:idpick:s-nodev', { id_src: 'roster_pick', id_confidence: 'high', homonym_in_list: false, canonical_id: ROSTER, at: expect.any(Number) }, 86400]]);
  });
  test('recordPick with a device writes the session key and the pointer, 24 h each, and one id_pick', async () => {
    await Bind.recordPick({ sessionId: 's-dev', via: 'name', studentId: ROSTER, device: DEV });
    expect(redis.set.mock.calls).toEqual([
      ['wq:idpick:s-dev', expect.objectContaining({ id_src: 'roster_pick' }), 86400],
      [`wq:idpick:d:${ROSTER}:${devH}`, { session_id: 's-dev', at: expect.any(Number) }, 86400],
    ]);
    expect(pickEvents()).toHaveLength(1);
    expect(JSON.stringify(pickEvents())).not.toContain('s-dev');
  });
  test('a preview (no id_src) writes no pointer', async () => {
    await Bind.recordPick({ sessionId: 's-prev', via: 'preview', studentId: ROSTER, device: DEV });
    expect(redis.set.mock.calls.map((c) => c[0])).toEqual(['wq:idpick:s-prev']);
  });
  test('canon off: no pick key of any kind, no id_pick, the row\'s identity columns NULL', async () => {
    IdFlags.flags.mockResolvedValue(OFF);
    const { row } = await route({ sessionId: 's-off', via: 'new', studentId: LOOSE });
    expect(redis.set.mock.calls.filter((c) => /^wq:idpick:/.test(c[0]))).toEqual([]);
    expect(pickEvents()).toEqual([]);
    expect(row).toMatchObject({ id_src: null, id_confidence: null, homonym_in_list: null });
  });
});
