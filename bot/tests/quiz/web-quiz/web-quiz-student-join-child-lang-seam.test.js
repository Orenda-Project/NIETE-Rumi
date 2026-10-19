'use strict';
/**
 * A child who joins on their own (web-quiz-student-join.js join()) against the REAL child-language.repo: with
 * app_settings `web_quiz_return_lang` on (JSON true), the join writes the join link's language on the child's own row
 * through the repo's joined(): child_language {canonical_id, language, source 'join'}. Off: the table is never touched
 * and the join's answer is today's. Real: the join service, binder, repos, door keys and the switch reader. Faked: the
 * supabase transport (./fake-supabase), Redis, the WhatsApp send and the loggers.
 */
process.env.STUDENT_MODE_ENABLED = 'true';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    get: jest.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
    incr: jest.fn(async (k) => { const v = (Number(keys.get(k)) || 0) + 1; keys.set(k, v); return v; }),
    expire: jest.fn(async () => true),
    isAvailable: () => true,
    redis: { get: jest.fn(async (k) => (keys.has(k) ? JSON.stringify(keys.get(k)) : null)) },
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
  sendFlow: jest.fn(async () => false), sendReaction: jest.fn(async () => true),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
const Repo = require('../../../shared/services/quiz/child-language.repo');
const GoNonce = require('../../../shared/services/first-touch/go-nonce');
const Join = require('../../../shared/services/quiz/web-quiz-student-join');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(753);
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
const USER = { id: 'u-new', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher', preferred_language: 'en' };

let fake;
function seed(ret) {
  const settings = { web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true, quiz_student_join: true, web_quiz_return_lang: ret };
  fake = makeFake({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    users: [USER], students: [], child_phone_bindings: [], child_identity: [], child_language: [], user_feature_first_use: [],
    quiz_sessions: [], quiz_share_codes: [], class_enrollments: [], student_lists: [], class_teachers: [], quizzes: [], coaching_sessions: [],
    lesson_plans: [], training_assessment_attempts: [], assessment_requests: [], message_ledger: [],
  }, { uniques: { child_language: ['canonical_id'] } });
  supabase.from = (t) => {
    // the columns' database defaults (is_active true, status 'active') on rows the code inserted
    if (t === 'students') (fake.db.students || []).forEach((r) => { if (!('is_active' in r)) r.is_active = true; if (!('status' in r)) r.status = 'active'; });
    const b = fake.from(t);
    b.or = () => b;
    if (t !== Repo.TABLE) b.upsert = (row) => b.insert(row);
    return b;
  };
  supabase.rpc = fake.rpc;
  fake.rpcResult = { data: null, error: { code: '42883', message: 'absent' } };
  redis.__keys.clear();
  IdFlags._resetCache();
  HubFlags._resetCache();
  Join._resetCache();
  Ret._resetCache();
}
const langCalls = () => fake.calls.filter((c) => c.table === Repo.TABLE);

/** A self-join from an `lang` join link: the join's answer (its home path with the child's chip) and the new child's id. */
async function joinIn(lang) {
  const n = await GoNonce.mint({ phoneNorm: PHONE, userId: USER.id });
  const out = await Join.join({ t: Join.signJoin({ n, lang }), grade: 2, name: 'Sara Testwala', device: DEVICE });
  expect(out.next).toMatch(/^\/h\//);
  return { out, kid: String(fake.db.students[fake.db.students.length - 1].id) };
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, STUDENT_MODE_ENABLED: 'true', WQ_TOMB_SALT: 'unit-salt-not-a-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
    WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_BASE_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
});
afterAll(() => { process.env = SAVED; });

test('switch on: a self-join in "ur" writes child_language {canonical_id, ur, join} through the repo, once', async () => {
  seed(true);
  const { kid } = await joinIn('ur');
  expect(fake.db.child_language).toEqual([expect.objectContaining({ canonical_id: kid, language: 'ur', source: 'join' })]);
  expect(langCalls().map((c) => c.op)).toEqual(['insert']);
  expect(langCalls()[0].payload).toEqual([{ canonical_id: kid, language: 'ur', source: 'join' }]);
});

test('switch off: the same join never touches child_language; its answer has today\'s shape', async () => {
  seed(false);
  const { out } = await joinIn('ur');
  expect(langCalls()).toEqual([]);
  expect(fake.db.child_language).toEqual([]);
  expect(Object.keys(out)).toEqual(['next']);
});
