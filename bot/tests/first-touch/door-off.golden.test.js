'use strict';
/**
 * SPEC v2 §8.1 — both switches OFF: an unknown phone's "quiz", «کوئز», `/quiz` (and a non-text message) take
 * today's path byte-identical — the same verdict, the same table calls, the 10-minute cache — and make ZERO new
 * reads (`user_feature_first_use` is never selected). With the sister's guest home ON and ours OFF, their guest
 * verdict and reply are byte-identical and `guestVerdict()` is reached as today. `quiz_first_door` ON without its
 * parent `quiz_maker_page` reads OFF. The real door (student-ingress) runs; only the network boundary is faked.
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
const StudentQuiz = require('../../shared/services/quiz/student-quiz.service');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Ingress = require('../../shared/services/student-ingress');
const { UNKNOWN_USER, PHONE, GUEST_ON, seedDb, firstUseReads, trace } = require('./door-fixture');

const SAVED = { ...process.env };
let fake;
function seed(opts = {}) {
  fake = seedDb(supabase, opts);
  IdFlags._resetCache(); HubFlags._resetCache();
  redisService.__keys.clear();
}
/** One inbound: attach (the door decides) then route (a child is answered; everyone else falls through). */
async function inbound(body, { type = 'text' } = {}) {
  const user = { ...UNKNOWN_USER };
  await Ingress.attach(user, PHONE, { body });
  const routed = await Ingress.route({ messageType: type, messageBody: body, from: PHONE, user });
  return { user, routed, verdict: { persona: user.persona, reason: user.personaReason, language: user.personaLanguage, studentClass: user.personaClass } };
}
const TODAY_UNKNOWN = { persona: null, reason: 'no_student_row', language: null, studentClass: null };

beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret' };
  jest.clearAllMocks();
});
afterAll(() => { process.env = SAVED; });

describe('both switches OFF (absent): today\'s unknown path, byte-identical, zero new reads', () => {
  test.each([
    ['quiz'], ['کوئز'], ['/quiz'], ['Quiz please'],
  ])('"%s" → reason no_student_row, route() false, 10-minute cache, no user_feature_first_use read', async (body) => {
    seed();
    const { routed, verdict } = await inbound(body);
    expect(verdict).toEqual(TODAY_UNKNOWN);
    expect(routed).toBe(false);
    expect(firstUseReads(fake)).toBe(0);
    expect(redisService.set).toHaveBeenCalledWith(Ingress.CACHE_KEY(PHONE), expect.objectContaining({ mode: 'unknown', reason: 'no_student_row' }), Ingress.CACHE_TTL_SECS);
    expect(StudentQuiz.open).not.toHaveBeenCalled();
  });

  test('the table trace of "quiz" is today\'s exactly (every call, in order, except the switch reads)', async () => {
    seed();
    await inbound('quiz');
    expect(trace(fake)).toEqual([
      'select:quizzes', 'select:coaching_sessions', 'select:lesson_plans', 'select:student_lists',
      'select:training_assessment_attempts', 'select:assessment_requests', 'select:students',
    ]);
  });

  test('a non-text message (no body) → today\'s path, no read', async () => {
    seed();
    const { verdict } = await inbound(undefined, { type: 'image' });
    expect(verdict).toEqual(TODAY_UNKNOWN);
    expect(firstUseReads(fake)).toBe(0);
  });

  test('switches present and false → the same', async () => {
    seed({ settings: { quiz_maker_page: false, quiz_first_door: false } });
    const { verdict } = await inbound('quiz');
    expect(verdict).toEqual(TODAY_UNKNOWN);
    expect(firstUseReads(fake)).toBe(0);
  });
});

describe('quiz_first_door ON without its parent → reads OFF (D6)', () => {
  test('"quiz" from an unknown phone → today\'s path, zero reads', async () => {
    seed({ settings: { quiz_first_door: true } });
    const { verdict } = await inbound('quiz');
    expect(verdict).toEqual(TODAY_UNKNOWN);
    expect(firstUseReads(fake)).toBe(0);
    expect((await IdFlags.flags()).firstDoor).toBe(false);
  });
});

describe('the sister\'s guest home ON, ours OFF → their guest verdict and reply, byte-identical', () => {
  test('"quiz" → reason guest_phone, 60 s cache, guestVerdict() reached, their /quiz opened; no read of ours', async () => {
    seed({ settings: GUEST_ON });
    const { routed, verdict } = await inbound('quiz');
    expect(verdict).toEqual({ persona: 'student', reason: 'guest_phone', language: null, studentClass: null });
    expect(redisService.set).toHaveBeenCalledWith(Ingress.CACHE_KEY(PHONE), expect.objectContaining({ reason: 'guest_phone' }), 60);
    expect(routed).toBe(true);
    expect(StudentQuiz.open).toHaveBeenCalledWith(PHONE, { language: 'en' });
    expect(firstUseReads(fake)).toBe(0);
  });

  test('"hello" with theirs ON → the guest reset to today\'s unknown path, as today; no read of ours', async () => {
    seed({ settings: GUEST_ON });
    const { routed, user } = await inbound('hello');
    expect(routed).toBe(false);
    expect(user.persona).toBeNull();
    expect(user.personaReason).toBe('no_student_row');
    expect(firstUseReads(fake)).toBe(0);
  });
});

describe('the door module broken at LOAD (the sister\'s condition): the ingress still loads and every verdict is today\'s', () => {
  test('door.service throws at require → classify() is today\'s unknown verdict, even with both switches ON; no read', async () => {
    jest.resetModules();
    jest.doMock('../../shared/services/first-touch/door.service', () => { throw new Error('broken at load'); });
    const IsolatedIngress = require('../../shared/services/student-ingress');
    const IsolatedFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
    const IsolatedHub = require('../../shared/services/quiz/web-quiz-hub-flags');
    const isolatedSupabase = require('../../shared/config/supabase');
    const f = seedDb(isolatedSupabase, { settings: { ...GUEST_ON, quiz_maker_page: true, quiz_first_door: true } });
    IsolatedFlags._resetCache(); IsolatedHub._resetCache();
    require('../../shared/services/cache/railway-redis.service').__keys.clear();
    const v = await IsolatedIngress.classify({ user: { ...UNKNOWN_USER }, phone: PHONE, body: 'quiz' });
    expect(v).toMatchObject({ persona: 'student', mode: 'student', reason: 'guest_phone' });   // theirs ON: their verdict, as today
    const f2 = seedDb(isolatedSupabase, { settings: {} });
    IsolatedFlags._resetCache(); IsolatedHub._resetCache();
    require('../../shared/services/cache/railway-redis.service').__keys.clear();
    const v2 = await IsolatedIngress.classify({ user: { ...UNKNOWN_USER }, phone: PHONE, body: 'quiz' });
    expect(v2).toEqual({ persona: null, mode: 'unknown', reason: 'no_student_row', language: null, studentClass: null });
    expect(firstUseReads(f)).toBe(0);
    expect(firstUseReads(f2)).toBe(0);
    jest.dontMock('../../shared/services/first-touch/door.service');
  });
});
