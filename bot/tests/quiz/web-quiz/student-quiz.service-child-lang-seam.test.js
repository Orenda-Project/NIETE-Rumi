'use strict';
/**
 * The /quiz reply (student-quiz.service.js open()) against the REAL child-language.repo: with app_settings
 * `web_quiz_return_lang` on (JSON true) and the home on, keptOf() reads the phone's children's child_language rows, so
 * a child who joined in Urdu on an English family row is answered in Urdu and the reply's link carries l "ur". Off: the
 * table is never touched and the reply is today's (the same as for a child with no row). Real: the reply, the ladder,
 * the repo, the hub link and the switch reader. Faked: the supabase transport (./fake-supabase), Redis, WhatsApp and
 * the loggers.
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable() { return true; },
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true), sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../../shared/services/whatsapp.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
const SQ = require('../../../shared/services/quiz/student-quiz.service');
const Repo = require('../../../shared/services/quiz/child-language.repo');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(752);
const KID = '44444444-4444-4444-8444-0000000000e2';
const HUB = [{ key: 'web_quiz_hub', value: true }];
const ON = [...HUB, { key: 'web_quiz_return_lang', value: true }];
const OFF = [...HUB, { key: 'web_quiz_return_lang', value: false }];
const URDU = /[؀-ۿ]/;

let fake;
function seed(settings, kept = []) {
  fake = makeFake({
    app_settings: settings,
    students: [{ id: KID, student_name: 'Kid Testwala', student_name_urdu: 'بچہ', self_reported_class: '2', list_id: null, is_active: true, phone: PHONE, created_at: new Date().toISOString() }],
    student_lists: [], quizzes: [], quiz_share_codes: [], quiz_sessions: [],
    child_language: kept.map((r) => ({ ...r })),
  }, { uniques: { child_language: ['canonical_id'] } });
  Object.assign(supabase, { from: (t) => fake.from(t), rpc: fake.rpc });
  redis._store.clear();
  Hub._resetCache();
  Play._resetCache();
  Ret._resetCache();
}
const langCalls = () => fake.calls.filter((c) => c.table === Repo.TABLE);

/** The /quiz reply for an English family row: whether its words are Urdu, and its link's token. */
async function reply() {
  WhatsAppService.sendCtaUrl.mockClear();
  expect(await SQ.open(PHONE, { language: 'en' })).toBe(true);
  const [, msg] = WhatsAppService.sendCtaUrl.mock.calls[WhatsAppService.sendCtaUrl.mock.calls.length - 1];
  const { exp: _exp, ...tok } = T.verify(/\/h\/([^/?#]+)$/.exec(msg.url)[1], 'h');
  return { urdu: URDU.test(JSON.stringify(msg)), tok, words: { body: msg.body, buttonText: msg.buttonText } };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  delete process.env.WEB_QUIZ_BASE_URL;
  delete process.env.STUDENT_QUIZ_FLOW_ID;
});

test('switch on: a join row "ur" on an English family row → the reply is Urdu, its link l "ur"; child_language read once', async () => {
  seed(ON, [{ canonical_id: KID, language: 'ur', source: 'join' }]);
  const r = await reply();
  expect(r.urdu).toBe(true);
  expect(r.tok.l).toBe('ur');
  expect(langCalls().map((c) => c.op)).toEqual(['select']);
});

test('switch off: the same join row is never read; the reply equals the no-row reply (English, no l)', async () => {
  seed(OFF, [{ canonical_id: KID, language: 'ur', source: 'join' }]);
  const withRow = await reply();
  expect(langCalls()).toEqual([]);
  seed(OFF);
  const today = await reply();
  expect(withRow.urdu).toBe(false);
  expect(withRow.tok).not.toHaveProperty('l');
  expect(withRow).toEqual(today);
});
