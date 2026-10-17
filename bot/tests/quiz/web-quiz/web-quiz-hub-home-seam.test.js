'use strict';
/**
 * The child home's phone rows (web-quiz-hub-home.js: "Someone new?" and the grown-ups corner's teacher switch) against
 * the REAL binding store (child-phone-bindings.repo) and the columns the table really has. Faked: the supabase
 * transport only (in-memory tables that apply filters; a column the schema mirror lacks answers 42703), the loggers,
 * and the two minting functions other changes add (injected, so this test never depends on whether they are merged).
 * Real: the store's "active binding of a child" read (not revoked, not expired, phone not erased).
 * Why it matters: the token is minted for the phone the store says keeps the child; an erased (STOP / Undo), expired or
 * another child's phone must never get one.
 */
process.env.WQ_TOMB_SALT = 'test-tomb-salt-not-a-secret-000000000000';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const { strictFrom } = require('./strict-columns');
const { fixturePhone } = require('./fixture-phone');
const supabase = require('../../../shared/config/supabase');
const Repo = require('../../../shared/services/quiz/child-phone-bindings.repo');
const Home = require('../../../shared/services/quiz/web-quiz-hub-home');

const KID = '44444444-4444-4444-8444-000000000081';
const OTHER = '44444444-4444-4444-8444-000000000082';
const FUTURE = '2099-03-31T18:59:59.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

let DB;
const asked = [];
function world(bindings) {
  DB = { app_settings: [{ key: 'web_quiz_home_v3', value: true }], web_quiz_challenge_runs: [], child_phone_bindings: bindings };
  const fake = makeFake(DB);
  supabase.from = strictFrom(fake.from, ['child_phone_bindings']);
  supabase.rpc = fake.rpc;
  Home._resetCache();
  asked.length = 0;
  Home._useModules({
    join: { siblingJoinToken: async ({ phoneNorm }) => { asked.push(phoneNorm); return 'eyJrIjoiaiJ9.SeamTok1'; } },
    door: { mintLandingForPhone: async ({ phoneNorm }) => { asked.push(phoneNorm); return '/quiz/go/SeamGo01'; } },
  });
}
afterAll(() => Home._useModules(null));
const row = (n, over) => ({ id: `b${n}`, canonical_id: KID, phone_norm: fixturePhone(n), phone_tomb: null, via: 'save', confirmed_at: PAST, bound_at: ago(100 - n), last_played_at: ago(50 - n), expires_at: FUTURE, revoked_at: null, revoked_by: null, rebind_of: null, code_id: null, ...over });

test('the newest active binding\'s phone is the one minted for; the rows land on the payload', async () => {
  world([row(1), row(2), row(3, { canonical_id: OTHER })]);
  expect((await Repo.activeForChild(KID)).map((r) => r.id)).toEqual(['b1', 'b2']);
  const out = await Home.homeField({ out: { lang: 'en' }, chosenId: KID, history: [] });
  expect(asked).toEqual([fixturePhone(2), fixturePhone(2)]);
  expect(out).toMatchObject({ home_v3: 1, jn: 'eyJrIjoiaiJ9.SeamTok1', grownups: { teacher_href: '/quiz/go/SeamGo01' } });
  expect(JSON.stringify(out)).not.toContain(fixturePhone(2));
});

test('an erased (STOP / Undo), revoked or expired binding is never minted for', async () => {
  world([row(1, { phone_norm: null, revoked_at: ago(2), revoked_by: 'stop' }), row(2, { revoked_at: ago(1), revoked_by: 'page_undo' }), row(3, { expires_at: PAST })]);
  const out = await Home.homeField({ out: { lang: 'ur' }, chosenId: KID, history: [] });
  expect(asked).toEqual([]);
  expect(out).not.toHaveProperty('jn');
  expect(out).not.toHaveProperty('grownups');
});
