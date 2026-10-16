'use strict';
/**
 * The child identity store: its switches, the family-phone binding store, the bind codes and the
 * academic-year clock. Supabase (an in-memory table set that applies filters) is the faked boundary;
 * the modules under test run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true), isAvailable: () => true,
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logToFile } = require('../../../shared/utils/logger');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Bind = require('../../../shared/services/quiz/child-phone-bindings.repo');
const Codes = require('../../../shared/services/quiz/child-bind-codes.repo');
const Share = require('../../../shared/services/quiz/video-quiz-share.service');
const StudentIdentity = require('../../../shared/services/quiz/student-identity.service');

const { fixturePhone } = require('./fixture-phone');
const PHONE = fixturePhone(501);
const KID_A = 'e0000000-0000-4000-8000-00000000000a';
const KID_B = 'e0000000-0000-4000-8000-00000000000b';
const KID_C = 'e0000000-0000-4000-8000-00000000000c';
const SALT = 'unit-salt-not-a-secret';
const NOW = new Date('2026-10-15T10:00:00Z');
const NEXT_END = '2027-03-31T18:59:59.000Z';

let fake;
function seed(db = {}) {
  fake = makeFake({ app_settings: [], students: [], child_phone_bindings: [], child_bind_codes: [], ...db },
    { uniques: { child_bind_codes: ['code'] } });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdFlags._resetCache();
  HubFlags._resetCache();
}
const settings = (on) => Object.entries(on).map(([key, value]) => ({ key, value }));

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, WQ_TOMB_SALT: SALT };
  jest.clearAllMocks();
  seed();
});
afterAll(() => { process.env = SAVED; });

describe('switches: each only with its parent on; a failed read is all off', () => {
  test('all keys on → all on', async () => {
    seed({ app_settings: settings({ web_quiz_hub: true, web_quiz_identity_canon: 'true', web_quiz_phone_bind: true, web_quiz_guest_home: true }) });
    expect(await IdFlags.flags()).toMatchObject({ canon: true, phoneBind: true, guestHome: true });
  });
  test('hub off → canon off even with every child key true', async () => {
    seed({ app_settings: settings({ web_quiz_identity_canon: true, web_quiz_phone_bind: true, web_quiz_guest_home: true }) });
    expect(await IdFlags.flags()).toMatchObject({ canon: false, phoneBind: false, guestHome: false });
  });
  test('canon off → phoneBind and guestHome off; phoneBind off → guestHome off', async () => {
    seed({ app_settings: settings({ web_quiz_hub: true, web_quiz_phone_bind: true, web_quiz_guest_home: true }) });
    expect(await IdFlags.flags()).toMatchObject({ canon: false, phoneBind: false, guestHome: false });
    seed({ app_settings: settings({ web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_guest_home: true }) });
    expect(await IdFlags.flags()).toMatchObject({ canon: true, phoneBind: false, guestHome: false });
  });
  test('a read failure → all false', async () => {
    supabase.from = () => { throw new Error('down'); };
    expect(await IdFlags.flags()).toEqual({ canon: false, phoneBind: false, guestHome: false, makerPage: false, firstDoor: false });
  });
  test('the three keys are SPEC\'s names', () => {
    expect([IdFlags.CANON_KEY, IdFlags.PHONE_BIND_KEY, IdFlags.GUEST_HOME_KEY]).toEqual(['web_quiz_identity_canon', 'web_quiz_phone_bind', 'web_quiz_guest_home']);
  });
});

describe('the academic-year clock (1 Apr 00:00 PKT → 31 Mar 23:59:59 PKT)', () => {
  test.each([
    ['mid-year play', '2026-10-15T10:00:00Z', '2027-03-31T18:59:59.000Z', '2026-27'],
    ['1 April 00:00 PKT (31 Mar 19:00:00Z) starts a new year', '2027-03-31T19:00:00Z', '2028-03-31T18:59:59.000Z', '2027-28'],
    ['31 Mar 23:59:59 PKT (18:59:59Z) is the old year, within 31 days → a year later', '2027-03-31T18:59:59Z', '2028-03-31T18:59:59.000Z', '2026-27'],
    ['1 March 00:00 PKT is within the last 31 days → a year later', '2027-02-28T19:00:00Z', '2028-03-31T18:59:59.000Z', '2026-27'],
    ['28 Feb 23:59:59 PKT is not within 31 days → this year', '2027-02-28T18:59:59Z', '2027-03-31T18:59:59.000Z', '2026-27'],
    ['1 April 2026 midday', '2026-04-01T07:00:00Z', '2027-03-31T18:59:59.000Z', '2026-27'],
    ['31 March 2026 noon PKT is the 2025-26 year', '2026-03-31T07:00:00Z', '2027-03-31T18:59:59.000Z', '2025-26'],
    ['a century turn pads the code', '2099-06-01T00:00:00Z', '2100-03-31T18:59:59.000Z', '2099-00'],
  ])('%s', (_, at, expires, code) => {
    expect(Bind.expiresAtFor(new Date(at)).toISOString()).toBe(expires);
    expect(Bind.yearCode(new Date(at))).toBe(code);
  });
});

describe('the tombstone', () => {
  test('normalisePhone is student-identity\'s, and the tomb is HMAC-SHA256(salt, phone_norm)[0:32]', () => {
    expect(Bind.normalisePhone).toBe(StudentIdentity.normalisePhone);
    const want = require('crypto').createHmac('sha256', SALT).update(PHONE).digest('hex').slice(0, 32);
    expect(Bind.tombOf(PHONE)).toBe(want);
    expect(Bind.tombOf('0000000501'.replace(/^/, '0'))).not.toBe(null);
  });
  test('no salt → null tomb and every write refuses; the salt is never logged', async () => {
    delete process.env.WQ_TOMB_SALT;
    expect(Bind.tombOf(PHONE)).toBeNull();
    expect(await Bind.insert({ canonicalId: KID_A, phoneNorm: PHONE, via: 'save', expiresAt: NEXT_END })).toBeNull();
    expect(fake.db.child_phone_bindings).toHaveLength(0);
    process.env.WQ_TOMB_SALT = SALT;
    await Bind.insert({ canonicalId: KID_A, phoneNorm: PHONE, via: 'save', expiresAt: NEXT_END });
    expect(JSON.stringify(logToFile.mock.calls)).not.toContain(SALT);
  });
});

describe('the binding store', () => {
  const bind = (kid, over = {}) => Bind.insert({ canonicalId: kid, phoneNorm: PHONE, via: 'save', confirmedAt: NOW, expiresAt: NEXT_END, ...over });

  test('insert and renew name the code that made or renewed the binding (code_id); none → null', async () => {
    const row = await Bind.insert({ canonicalId: KID_A, phoneNorm: PHONE, via: 'save', expiresAt: NEXT_END, codeId: 'JUGNU-AB2CD' });
    expect(row).toMatchObject({ canonical_id: KID_A, code_id: 'JUGNU-AB2CD' });
    const renewed = await Bind.renew(row.id, NEXT_END, new Date('2026-10-20T10:00:00Z'), 'JUGNU-7KQ2X');
    expect(renewed).toMatchObject({ id: row.id, code_id: 'JUGNU-7KQ2X' });
    const plain = await Bind.insert({ canonicalId: KID_B, phoneNorm: fixturePhone(712), via: 'teacher', expiresAt: NEXT_END });
    expect(plain.code_id).toBeNull();
  });

  test('insert writes the normalised phone, the tomb and the via; a bad via writes nothing', async () => {
    const row = await bind(KID_A, { phoneNorm: '+92 000 0000501' });
    expect(row).toMatchObject({ canonical_id: KID_A, phone_norm: PHONE, phone_tomb: Bind.tombOf(PHONE), via: 'save', expires_at: NEXT_END, rebind_of: null });
    expect(await bind(KID_B, { via: 'sms' })).toBeNull();
    expect(fake.db.child_phone_bindings).toHaveLength(1);
  });

  test('activeForPhone: not revoked, not expired, oldest first; activeForChild: the child\'s live phones', async () => {
    fake.db.child_phone_bindings.push(
      { id: 'b2', canonical_id: KID_B, phone_norm: PHONE, revoked_at: null, expires_at: NEXT_END, bound_at: '2026-10-02T00:00:00Z' },
      { id: 'b1', canonical_id: KID_A, phone_norm: PHONE, revoked_at: null, expires_at: NEXT_END, bound_at: '2026-10-01T00:00:00Z' },
      { id: 'bx', canonical_id: KID_C, phone_norm: PHONE, revoked_at: null, expires_at: '2026-03-31T18:59:59.000Z', bound_at: '2025-10-01T00:00:00Z' },
      { id: 'br', canonical_id: KID_C, phone_norm: null, phone_tomb: 't', revoked_at: '2026-09-01T00:00:00Z', expires_at: NEXT_END, bound_at: '2026-08-01T00:00:00Z' },
    );
    expect((await Bind.activeForPhone(PHONE, NOW)).map((r) => [r.id, r.bound_at])).toEqual([['b1', '2026-10-01T00:00:00Z'], ['b2', '2026-10-02T00:00:00Z']]);
    expect((await Bind.activeForChild(KID_C, NOW)).map((r) => r.id)).toEqual([]);
    expect((await Bind.activeForChild(KID_A, NOW)).map((r) => [r.id, r.bound_at])).toEqual([['b1', '2026-10-01T00:00:00Z']]);
  });

  test('a failed read is "no binding"', async () => {
    supabase.from = () => { throw new Error('down'); };
    expect(await Bind.activeForPhone(PHONE)).toEqual([]);
    expect(await Bind.findByTomb('t')).toBeNull();
    expect(await Bind.insert({ canonicalId: KID_A, phoneNorm: PHONE, via: 'save', expiresAt: NEXT_END })).toBeNull();
  });

  test('eraseOne / eraseAllForPhone erase the phone, keep the tomb, and say which rows', async () => {
    const a = await bind(KID_A);
    const b = await bind(KID_B);
    expect(await Bind.eraseOne(a.id, 'nonsense')).toEqual([]);
    expect(await Bind.eraseOne(a.id, 'page_undo', NOW)).toEqual([{ id: a.id, canonical_id: KID_A, phone_norm: PHONE }]);
    expect(await Bind.eraseOne(a.id, 'page_undo', NOW)).toEqual([]);
    const erased = fake.db.child_phone_bindings.find((r) => r.id === a.id);
    expect(erased).toMatchObject({ phone_norm: null, phone_tomb: Bind.tombOf(PHONE), revoked_by: 'page_undo', revoked_at: NOW.toISOString() });
    expect(await Bind.eraseAllForPhone(PHONE, 'stop', NOW)).toEqual([{ id: b.id, canonical_id: KID_B, phone_norm: PHONE }]);
    expect(fake.db.child_phone_bindings.every((r) => r.phone_norm === null)).toBe(true);
    expect(await Bind.activeForPhone(PHONE, NOW)).toEqual([]);
  });

  test('findByTomb → the newest erased row (a re-bind\'s rebind_of); renew moves expires_at', async () => {
    const a = await bind(KID_A);
    await Bind.eraseOne(a.id, 'stop', new Date('2026-10-01T00:00:00Z'));
    const c = await bind(KID_C);
    await Bind.eraseOne(c.id, 'expiry', new Date('2026-10-05T00:00:00Z'));
    expect((await Bind.findByTomb(Bind.tombOf(PHONE))).id).toBe(c.id);
    const again = await bind(KID_A, { rebindOf: c.id });
    expect(again.rebind_of).toBe(c.id);
    const r = await Bind.renew(again.id, '2028-03-31T18:59:59.000Z', NOW);
    expect(r).toMatchObject({ expires_at: '2028-03-31T18:59:59.000Z', last_played_at: NOW.toISOString() });
    expect(await Bind.renew(c.id, '2028-03-31T18:59:59.000Z')).toBeNull();
  });
});

describe('childrenForPhone: one helper for the door and /quiz open', () => {
  const chatRow = { id: KID_C, student_name: 'Chat Testwala', self_reported_class: '3', phone: PHONE, list_id: null, is_active: true, created_at: '2026-09-01T00:00:00Z' };
  const roster = { id: KID_A, student_name: 'Bound Testwala', self_reported_class: '4', list_id: null, is_active: true, created_at: '2026-08-01T00:00:00Z' };

  test('switch off: exactly quizStudentsForPhone(phone) — golden', async () => {
    seed({ students: [chatRow, roster], child_phone_bindings: [{ id: 'b1', canonical_id: KID_A, phone_norm: PHONE, revoked_at: null, expires_at: NEXT_END, bound_at: 'x' }] });
    const StudentMode = require('../../../shared/services/student-mode.service');
    const today = await StudentMode.quizStudentsForPhone(PHONE);
    expect(await Bind.childrenForPhone(PHONE)).toEqual(today);
  });

  test('switch on: bound first, then chat, folded and deduped, with their source', async () => {
    seed({
      app_settings: settings({ web_quiz_hub: true, web_quiz_identity_canon: true, web_quiz_phone_bind: true }),
      students: [chatRow, roster],
      child_phone_bindings: [
        { id: 'b1', canonical_id: KID_A, phone_norm: PHONE, revoked_at: null, expires_at: NEXT_END, bound_at: '2026-10-01T00:00:00Z' },
        { id: 'b2', canonical_id: KID_C, phone_norm: PHONE, revoked_at: null, expires_at: NEXT_END, bound_at: '2026-10-02T00:00:00Z' },
      ],
    });
    const got = await Bind.childrenForPhone(PHONE);
    expect(got.map((r) => [r.id, r.src])).toEqual([[KID_A, 'bound'], [KID_C, 'bound']]);
    expect(got[0]).toEqual({ id: KID_A, student_name: 'Bound Testwala', self_reported_class: '4', created_at: '2026-08-01T00:00:00Z', src: 'bound' });
  });
});

describe('bind codes', () => {
  test('mint → { code: JUGNU- + 5 of [A-Z2-9] without O or I, expires_at }, valid 1 hour, device_ref kept for the audit', async () => {
    const codes = [];
    // forty devices: one fresh code each (the same device within the hour would get its live code back, below)
    for (let i = 0; i < 40; i += 1) codes.push(await Codes.mint(KID_A, `dev-${i}`, NOW));
    codes.forEach((c) => expect(c).toEqual({ code: expect.stringMatching(/^JUGNU-[A-HJ-NP-Z2-9]{5}$/), expires_at: '2026-10-15T11:00:00.000Z' }));
    const row = fake.db.child_bind_codes[0];
    expect(row).toMatchObject({ code: codes[0].code, canonical_id: KID_A, device_ref: 'dev-0', minted_at: NOW.toISOString(), expires_at: '2026-10-15T11:00:00.000Z' });
  });

  test('the same child on the same device within the hour → the live code again (reused), no new row; without a device → a new code', async () => {
    const first = await Codes.mint(KID_A, 'dev-1', NOW);
    const again = await Codes.mint(KID_A, 'dev-1', new Date(NOW.getTime() + 30 * 60000));
    expect(again).toEqual({ code: first.code, expires_at: first.expires_at, reused: true });
    expect(fake.db.child_bind_codes).toHaveLength(1);
    const noDevice = await Codes.mint(KID_A, null, NOW);
    expect(noDevice.code).not.toBe(first.code);
    expect(noDevice.reused).toBeUndefined();
    expect(fake.db.child_bind_codes).toHaveLength(2);
    // with under ten minutes left the live code is not handed out again: a new one
    const later = await Codes.mint(KID_A, 'dev-1', new Date(NOW.getTime() + 51 * 60000));
    expect(later.code).not.toBe(first.code);
    expect(fake.db.child_bind_codes).toHaveLength(3);
    // at 49 minutes it still is
    expect((await Codes.mint(KID_A, 'dev-1', new Date(NOW.getTime() + 49 * 60000))).code).toBe(later.code);
    expect(fake.db.child_bind_codes).toHaveLength(3);
  });

  test('a collision retries once with a new code', async () => {
    const spy = jest.spyOn(require('crypto'), 'randomInt').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0)
      .mockReturnValueOnce(0).mockReturnValueOnce(0);
    fake.db.child_bind_codes.push({ code: 'JUGNU-AAAAA', canonical_id: KID_B });
    const { code: c } = await Codes.mint(KID_A, null, NOW);
    spy.mockRestore();
    expect(c).toMatch(/^JUGNU-/);
    expect(c).not.toBe('JUGNU-AAAAA');
  });

  test('get is case-insensitive; markUsed spends a code once', async () => {
    const { code: c } = await Codes.mint(KID_A, null, NOW);
    expect((await Codes.get(c.toLowerCase())).canonical_id).toBe(KID_A);
    expect(await Codes.markUsed(c, 'nonsense')).toBe(false);
    expect(await Codes.markUsed(c.toLowerCase(), 'bound', NOW)).toBe(true);
    expect(await Codes.markUsed(c, 'code_used', NOW)).toBe(false);
    expect(await Codes.get(c)).toMatchObject({ outcome: 'bound', used_at: NOW.toISOString() });
    expect(await Codes.get('JUGNU-0000')).toBeNull();
  });

  test('parseCode: only the WHOLE last token, never the words; never a share code', () => {
    expect(Codes.parseCode('Save my place JUGNU-AB2C9')).toBe('JUGNU-AB2C9');
    expect(Codes.parseCode('  jugnu-ab2c9 \n')).toBe('JUGNU-AB2C9');
    expect(Codes.parseCode('JUGNU-AB2C9 please')).toBeNull();
    expect(Codes.parseCode('xJUGNU-AB2C9')).toBeNull();
    expect(Codes.parseCode('JUGNU-AB2C9.')).toBeNull();
    expect(Codes.parseCode('JUGNU-AB2C')).toBeNull();
    expect(Codes.parseCode('QUIZ-ABC123')).toBeNull();
    expect(Codes.parseCode('')).toBeNull();
  });

  test('the share-code pattern never matches a JUGNU code', () => {
    ['JUGNU-AB2C9', 'Save my place JUGNU-ZZ999', 'jugnu-abcde'].forEach((t) => expect(Share.parseShareCode(t)).toBeNull());
    expect(Share.CODE_RX.test('JUGNU-AB2C9')).toBe(false);
  });
});
