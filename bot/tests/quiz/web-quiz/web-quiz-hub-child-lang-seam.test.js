'use strict';
/**
 * The hub (web-quiz-hub.js hubPayload) against the REAL child-language.repo: with app_settings `web_quiz_return_lang`
 * on (JSON true), the home of a child with no class quiz speaks the language kept on the child's child_language row
 * (stored()), and a grown-up's kept tap (`keep`) is written through choose(). Off: the table is never touched and the
 * payload is today's (the same as for a child with no row at all). Real: the hub, the resolver ladder, the repo and the
 * switch reader. Faked: the supabase transport (in-memory tables via ./fake-supabase), Redis, WhatsApp and the loggers.
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
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');
const Ret = require('../../../shared/services/quiz/web-quiz-return-lang');
const Repo = require('../../../shared/services/quiz/child-language.repo');
const { fixturePhone } = require('./fixture-phone');

const PHONE = fixturePhone(751);
const KID = '44444444-4444-4444-8444-0000000000e1';
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const HUB = [{ key: 'web_quiz_hub', value: true }];
const ON = [...HUB, { key: 'web_quiz_return_lang', value: true }];
const OFF = [...HUB, { key: 'web_quiz_return_lang', value: false }];
const CHIP = T.chipId('h', KID);

let db;
let fake;
function seed(settings, kept = null) {
  db = {
    app_settings: settings,
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: 'زارا', self_reported_class: '2', list_id: null, is_active: true, phone: PHONE, created_at: new Date().toISOString() }],
    student_lists: [], quizzes: [], quiz_share_codes: [], quiz_sessions: [],
    child_language: kept ? [{ canonical_id: KID, ...kept }] : [],
  };
  fake = makeFake(db, { uniques: { child_language: ['canonical_id'] } });
  const from = (t) => {
    const b = fake.from(t);
    if (t === Repo.TABLE) {
      b.upsert = (row) => {
        fake.calls.push({ table: t, op: 'upsert', payload: [row] });
        const at = db.child_language.findIndex((r) => r.canonical_id === row.canonical_id);
        if (at >= 0) Object.assign(db.child_language[at], row); else db.child_language.push({ ...row });
        return Promise.resolve({ data: null, error: null });
      };
    }
    return b;
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  redis._store.clear();
  Hub._resetCache();
  Play._resetCache();
  Ret._resetCache();
}
const langCalls = () => fake.calls.filter((c) => c.table === 'child_language');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
});

describe('switch on: the hub reaches child_language through the real repo', () => {
  test.each([['join'], ['chosen']])('a "%s" row in Urdu, no quiz → the home is Urdu, the row read from child_language', async (source) => {
    seed(ON, { language: 'ur', source });
    const page = await Hub.hub(T.signHub([KID]), A);
    expect(page.lang).toBe('ur');
    expect(page.kids[0].first).toBe('زارا');
    expect(langCalls().filter((c) => c.op === 'select').length).toBeGreaterThanOrEqual(1);
  });

  test('a grown-up\'s tap (keep) is written as the chosen row', async () => {
    seed(ON);
    const page = await Hub.hub(T.signHub([KID]), { ...A, kid: CHIP, lang: 'ur', keep: true });
    expect(page.lang).toBe('ur');
    expect(db.child_language).toEqual([expect.objectContaining({ canonical_id: KID, language: 'ur', source: 'chosen' })]);
    expect(langCalls().map((c) => c.op)).toContain('upsert');
  });
});

describe('switch off: child_language is never touched, today\'s payload', () => {
  test('a join row in Urdu and a keep tap: no child_language call, the payload equals the no-row payload', async () => {
    seed(OFF, { language: 'ur', source: 'join' });
    const t = T.signHub([KID]);
    const withRow = await Hub.hub(t, { ...A, kid: CHIP, lang: 'ur', keep: true });
    expect(langCalls()).toEqual([]);
    expect(db.child_language).toEqual([{ canonical_id: KID, language: 'ur', source: 'join' }]);
    seed(OFF);
    const today = await Hub.hub(t, { ...A, kid: CHIP, lang: 'ur' });
    expect(withRow).toEqual(today);
    seed(OFF, { language: 'ur', source: 'join' });
    expect((await Hub.hub(t, A)).lang).toBe('en');
    expect(langCalls()).toEqual([]);
  });
});
