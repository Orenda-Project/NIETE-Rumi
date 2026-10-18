'use strict';
/**
 * The door's verdict with both switches ON (DOOR.md §1–§3): ONE indexed read of the three keys at
 * student-ingress.js:229 (after boundVerdict, before guestVerdict), only for a quiz-shaped text; the guest pattern's
 * shape with one more field `door`; null (= today's path) on any error, for a non-quiz text, and for the §8.3
 * hand-off (child key + the sister's guest home ON). The decision itself is pure (decideDoor): teacher key → maker,
 * child key → family, newest wins, a key older than 90 days is absent, ≥ 2 shows and no key → capped, else chooser.
 */
process.env.STUDENT_MODE_ENABLED = 'true';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/database/bot-helpers', () => ({ getOrCreateSession: jest.fn(async () => 'sess-1'), storeConversation: jest.fn(async () => true) }));
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({ getActiveState: jest.fn(async () => null), getPostQuizState: jest.fn(async () => null) }));
jest.mock('../../shared/services/quiz/student-quiz.service', () => ({ open: jest.fn(async () => true), handleButton: jest.fn(async () => true), RETRY_ID: 'sq_retry', CARD_ID: 'sq_card' }));
jest.mock('../../shared/handlers/text-message.handler', () => ({ handleGeneralConversation: jest.fn(), tryChildVideoMenu: jest.fn(async () => true) }));

const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Ingress = require('../../shared/services/student-ingress');
const Door = require('../../shared/services/first-touch/door.service');
const { TABLE, UNKNOWN_USER, PHONE, SISTER_ON, GUEST_ON, OURS_ON, seedDb, firstUse, firstUseReads, trace, daysAgo } = require('./door-fixture');

const SAVED = { ...process.env };
let fake;
function seed(opts = {}) {
  fake = seedDb(supabase, { settings: { ...SISTER_ON, ...OURS_ON }, ...opts });
  IdFlags._resetCache(); HubFlags._resetCache();
  redisService.__keys.clear();
}
const classify = (body) => Ingress.classify({ user: { ...UNKNOWN_USER }, phone: PHONE, body });
const SHAPE = (door) => ({ persona: null, mode: 'unknown', reason: 'first_door', door, language: null, studentClass: null });

beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret' };
  jest.clearAllMocks();
});
afterAll(() => { process.env = SAVED; });

describe('the constants', () => {
  test('reason first_door; TTL 60 s, never the unknown verdict\'s 10 minutes; the cap is 2 shows', () => {
    expect(Door.FIRST_DOOR_REASON).toBe('first_door');
    expect(Door.FIRST_DOOR_TTL_SECS).toBe(60);
    expect(Door.FIRST_DOOR_TTL_SECS).not.toBe(Ingress.CACHE_TTL_SECS);
    expect(Door.CAP_SHOWS).toBe(2);
  });
});

describe('classify() with both ON — an unknown phone', () => {
  test('"quiz", no key → the chooser: the guest shape + door, ONE read of the three keys, placed after the child rows and the binding', async () => {
    seed();
    const v = await classify('quiz');
    expect(v).toEqual(SHAPE('chooser'));
    expect(firstUseReads(fake)).toBe(1);
    expect(fake.inLists.filter((c) => c.table === TABLE)).toEqual([{ table: TABLE, column: 'feature', values: ['quiz_door_teacher', 'quiz_door_child', 'quiz_door_asked'] }]);
    const t = trace(fake);
    expect(t.indexOf('select:students')).toBeLessThan(t.indexOf('select:child_phone_bindings'));
    expect(t.indexOf('select:child_phone_bindings')).toBeLessThan(t.indexOf(`select:${TABLE}`));
    expect(t[t.length - 1]).toBe(`select:${TABLE}`);
  });

  test.each([['کوئز'], ['/quiz'], ['Quiz banao']])('"%s" is quiz-shaped too', async (body) => {
    seed();
    expect((await classify(body)).door).toBe('chooser');
  });

  test.each([['hello'], ['/register'], ['I am a teacher'], ['menu'], ['']])('"%s" is not quiz-shaped: today\'s verdict and NO key read', async (body) => {
    seed();
    const v = await classify(body);
    expect(v).toMatchObject({ mode: 'unknown', reason: 'no_student_row' });
    expect(firstUseReads(fake)).toBe(0);
  });

  test('a non-text message (body undefined) → no read', async () => {
    seed();
    expect((await classify(undefined)).reason).toBe('no_student_row');
    expect(firstUseReads(fake)).toBe(0);
  });

  test('teacher key → maker; child key → family; the newer of the two wins (last tap wins)', async () => {
    seed({ rows: [firstUse('quiz_door_teacher', { usedAt: daysAgo(2) })] });
    expect(await classify('quiz')).toEqual(SHAPE('maker'));
    seed({ rows: [firstUse('quiz_door_child', { usedAt: daysAgo(2) })] });
    expect(await classify('quiz')).toEqual(SHAPE('family'));
    seed({ rows: [firstUse('quiz_door_teacher', { usedAt: daysAgo(2) }), firstUse('quiz_door_child', { usedAt: daysAgo(1) })] });
    expect((await classify('quiz')).door).toBe('family');
    seed({ rows: [firstUse('quiz_door_teacher', { usedAt: daysAgo(1) }), firstUse('quiz_door_child', { usedAt: daysAgo(2) })] });
    expect((await classify('quiz')).door).toBe('maker');
  });

  test('a key with feature_used_at older than 90 days is read as absent (never deleted): the chooser', async () => {
    seed({ rows: [firstUse('quiz_door_teacher', { usedAt: daysAgo(91) })] });
    expect((await classify('quiz')).door).toBe('chooser');
    expect(fake.db[TABLE]).toHaveLength(1);
    seed({ rows: [firstUse('quiz_door_teacher', { usedAt: daysAgo(89) })] });
    expect((await classify('quiz')).door).toBe('maker');
  });

  test('intro_shown_count ≥ 2 and no key → capped (never the chooser); with a key the key wins; quiz_door_asked never expires', async () => {
    seed({ rows: [firstUse('quiz_door_asked', { usedAt: daysAgo(400), count: 2 })] });
    expect(await classify('quiz')).toEqual(SHAPE('capped'));
    seed({ rows: [firstUse('quiz_door_asked', { usedAt: daysAgo(1), count: 1 })] });
    expect((await classify('quiz')).door).toBe('chooser');
    seed({ rows: [firstUse('quiz_door_asked', { usedAt: daysAgo(1), count: 2 }), firstUse('quiz_door_teacher', { usedAt: daysAgo(1) })] });
    expect((await classify('quiz')).door).toBe('maker');
  });

  test('the key read throws → null → today\'s path for that message (no_student_row, cached as today)', async () => {
    seed({ throwOn: TABLE });
    const v = await classify('quiz');
    expect(v).toMatchObject({ persona: null, mode: 'unknown', reason: 'no_student_row' });
    expect(redisService.set).toHaveBeenCalledWith(Ingress.CACHE_KEY(PHONE), expect.objectContaining({ reason: 'no_student_row' }), Ingress.CACHE_TTL_SECS);
  });

  test('the sister\'s guest home ON: no key → OUR chooser first (D6); child key → the hand-off to their guest verdict (§8.3)', async () => {
    seed({ settings: { ...GUEST_ON, ...OURS_ON } });
    expect(await classify('quiz')).toEqual(SHAPE('chooser'));
    seed({ settings: { ...GUEST_ON, ...OURS_ON }, rows: [firstUse('quiz_door_child')] });
    const v = await classify('quiz');
    expect(v).toEqual({ persona: 'student', mode: 'student', reason: 'guest_phone', language: null, studentClass: null });
    expect(logEvent).toHaveBeenCalledWith('student_ingress.decided', expect.objectContaining({ reason: 'guest_phone' }));
    seed({ settings: { ...GUEST_ON, ...OURS_ON }, rows: [firstUse('quiz_door_teacher')] });
    expect((await classify('quiz')).door).toBe('maker');
  });

  test('the decision is logged as today\'s student_ingress.decided with our reason', async () => {
    seed();
    await classify('quiz');
    expect(logEvent).toHaveBeenCalledWith('student_ingress.decided', expect.objectContaining({ mode: 'unknown', reason: 'first_door', userId: UNKNOWN_USER.id }));
  });
});

describe('route() with a first_door verdict (D1: nothing of ours answers yet)', () => {
  test('persona is null, so route() falls through to today\'s dispatch and sends nothing', async () => {
    seed();
    const user = { ...UNKNOWN_USER };
    await Ingress.attach(user, PHONE, { body: 'quiz' });
    expect(user.persona).toBeNull();
    expect(user.personaReason).toBe('first_door');
    expect(await Ingress.route({ messageType: 'text', messageBody: 'quiz', from: PHONE, user })).toBe(false);
  });
});

describe('decideDoor — pure', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const k = (days, count = 0) => ({ count, usedAt: new Date(now.getTime() - days * 86400000) });
  test.each([
    ['no keys', {}, 'chooser'],
    ['teacher', { quiz_door_teacher: k(1) }, 'maker'],
    ['child', { quiz_door_child: k(1) }, 'family'],
    ['both, child newer', { quiz_door_teacher: k(3), quiz_door_child: k(1) }, 'family'],
    ['both, teacher newer', { quiz_door_teacher: k(1), quiz_door_child: k(3) }, 'maker'],
    ['teacher at 90 days exactly', { quiz_door_teacher: k(90) }, 'maker'],
    ['teacher at 91 days', { quiz_door_teacher: k(91) }, 'chooser'],
    ['asked twice, no key', { quiz_door_asked: k(500, 2) }, 'capped'],
    ['asked once', { quiz_door_asked: k(1, 1) }, 'chooser'],
    ['asked twice, stale child key', { quiz_door_asked: k(1, 2), quiz_door_child: k(100) }, 'capped'],
    ['a row with no feature_used_at is absent', { quiz_door_teacher: { count: 0, usedAt: null } }, 'chooser'],
  ])('%s → %s', (_, keys, door) => {
    expect(Door.decideDoor(keys, now)).toBe(door);
  });
});

describe('doorVerdict() called directly', () => {
  test('switch OFF → null without a read; not quiz-shaped → null without a read; no user → null', async () => {
    seed({ settings: SISTER_ON });
    expect(await Door.doorVerdict({ user: UNKNOWN_USER, phone: PHONE, body: 'quiz', quizShaped: true })).toBeNull();
    seed();
    expect(await Door.doorVerdict({ user: UNKNOWN_USER, phone: PHONE, body: 'hello', quizShaped: false })).toBeNull();
    expect(await Door.doorVerdict({ user: null, phone: PHONE, body: 'quiz', quizShaped: true })).toBeNull();
    expect(firstUseReads(fake)).toBe(0);
  });
});
