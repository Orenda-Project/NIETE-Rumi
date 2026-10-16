'use strict';
/**
 * SPEC v2 §8.2 — both switches ON: a registered teacher, a teacher by activity, a chat child and a bound child get
 * today's verdict byte-identical (the same fields, the same table calls) and NO key of ours is ever read for them
 * (identity, activity and the child rows run before :229). From an unknown phone a `QUIZ-` code, a `JUGNU-` code
 * and whole-message STOP are not quiz-shaped: the door is never consulted (D7). Each golden runs the SAME inbound
 * with ours OFF and ours ON and compares.
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
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
const Ingress = require('../../shared/services/student-ingress');
const { UNKNOWN_USER, PHONE, KID, SISTER_ON, OURS_ON, seedDb, firstUseReads, trace } = require('./door-fixture');

const SAVED = { ...process.env };
const CHILD_ROW = [{ id: 'st-1', student_name: 'Ayesha Testwala', self_reported_class: '4', is_active: true, phone: PHONE, created_at: '2026-09-01T00:00:00Z' }];
const CHILD_SESSION = [{ id: 's1', created_at: '2026-09-10T08:00:00Z', quiz_id: 'q1', student_class: '4', student_id: 'st-1' }];
const binding = () => ({ id: 'b-1', canonical_id: KID, phone_norm: PHONE, phone_tomb: BindRepo.tombOf(PHONE), via: 'save',
  confirmed_at: '2026-04-02T00:00:00.000Z', bound_at: '2026-04-02T00:00:00.000Z', last_played_at: null,
  expires_at: '2099-03-31T18:59:59.000Z', revoked_at: null, revoked_by: null, rebind_of: null });

let fake;
function seed(opts = {}) {
  fake = seedDb(supabase, opts);
  IdFlags._resetCache(); HubFlags._resetCache();
  redisService.__keys.clear();
}
async function inbound(user, body) {
  const u = { ...user };
  await Ingress.attach(u, PHONE, { body });
  const routed = await Ingress.route({ messageType: 'text', messageBody: body, from: PHONE, user: u });
  return { routed, verdict: { persona: u.persona, reason: u.personaReason, language: u.personaLanguage, studentClass: u.personaClass }, trace: trace(fake), reads: firstUseReads(fake) };
}
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret' };
  jest.clearAllMocks();
});
afterAll(() => { process.env = SAVED; });

const SENDERS = [
  ['a registered teacher', { ...UNKNOWN_USER, id: 'u-teacher', registration_completed: true, name: 'Teacher Testwala' }, {}, 'identity'],
  ['a teacher by activity only (owns a quiz)', { ...UNKNOWN_USER }, { counts: { quizzes: 1 } }, 'activity'],
  ['a chat child (quiz-joined students row)', { ...UNKNOWN_USER }, { students: CHILD_ROW, sessions: CHILD_SESSION }, 'no_identity_quiz_joined'],
  ['a bound child (family phone binding)', { ...UNKNOWN_USER }, { bindings: [binding()] }, 'phone_bound_page_child'],
];

describe.each(SENDERS)('%s', (_, user, db, reason) => {
  test.each([['quiz'], ['کوئز'], ['/quiz']])('"%s": ours ON → the same verdict and table trace as ours OFF; no key read', async (body) => {
    seed({ ...db, settings: SISTER_ON });
    const off = await inbound(user, body);
    seed({ ...db, settings: { ...SISTER_ON, ...OURS_ON } });
    const on = await inbound(user, body);
    expect(on.verdict.reason).toBe(reason);
    expect(on.verdict).toEqual(off.verdict);
    expect(on.trace).toEqual(off.trace);
    expect(on.routed).toBe(off.routed);
    expect(off.reads).toBe(0);
    expect(on.reads).toBe(0);
  });
});

describe('codes and STOP from an unknown phone, ours ON (D7)', () => {
  test.each([['QUIZ-A7K2PQ'], ['JUGNU-ABCDE'], ['STOP'], ['stop']])('"%s" is not quiz-shaped: the door is never consulted, no key read, today\'s verdict', async (body) => {
    seed({ settings: { ...SISTER_ON, ...OURS_ON } });
    const on = await inbound(UNKNOWN_USER, body);
    expect(on.verdict.reason).toBe('no_student_row');
    expect(on.reads).toBe(0);
  });

  test('"quiz" from the same phone IS quiz-shaped (the control): one key read, the first_door verdict', async () => {
    seed({ settings: { ...SISTER_ON, ...OURS_ON } });
    const u = { ...UNKNOWN_USER };
    await Ingress.attach(u, PHONE, { body: 'quiz' });
    expect(u.personaReason).toBe('first_door');
    expect(firstUseReads(fake)).toBe(1);                    // the verdict: ONE key read
    const at = fake.calls.length;
    await Ingress.route({ messageType: 'text', messageBody: 'quiz', from: PHONE, user: u });
    // the chooser's show adds only its own write (FeatureIntro's read-then-write of the count): never a second key read
    expect(fake.calls.slice(at).map((c) => `${c.op}:${c.table}`).filter((c) => c.endsWith('user_feature_first_use')))
      .toEqual(['select:user_feature_first_use', 'upsert:user_feature_first_use', 'update:user_feature_first_use']);
  });
});
