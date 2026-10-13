/**
 * bd-s6qbts.5 — an analytics-only account signs in with an ACCOUNT NAME, not a phone number.
 *
 * Operator (2026-10-13): "can we login the analytics account without using a phone number … like a name or
 * something? make an exception for this".
 *
 * The account's users.phone_number holds the reserved, non-numeric value `analytics:<name>`. It can never equal a
 * real phone, so no teacher can collide with it or claim it, and WhatsApp can never reach it.
 *
 * Every branch here is an access-control decision, so this pins all of them:
 *   - a name signs in ONLY when the account is on app_settings.portal_analytics_only. Not on the list, list absent,
 *     list malformed, list unreadable: refused (fail closed).
 *   - every way a name can be wrong answers the SAME status and body as a wrong password, and runs bcrypt once
 *     either way, so the answer does not say whether the name exists;
 *   - an identifier with no letter is a phone, and takes the phone path exactly as before;
 *   - the password-reset endpoints never turn a name into a phone and never send a WhatsApp code for one.
 */
let supabaseFrom;
let tableStates;
let bcryptCompare;
let logEvent;
let resetService;
let lookups;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { filters: {} };
  const chain = {};
  const rowsFor = () => {
    let rows = state.rows || [];
    for (const [col, val] of Object.entries(record.filters)) rows = rows.filter((r) => r[col] === val);
    return rows;
  };
  chain.select = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.eq = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  chain.maybeSingle = jest.fn(async () => {
    lookups.push({ table: tableName, filters: { ...record.filters } });
    if (state.error) return { data: null, error: state.error };
    return { data: rowsFor()[0] || null, error: null };
  });
  chain.then = (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function post(path, body) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'post', path);
  if (!stack) throw new Error(`POST ${path} not found on the portal router`);
  const session = { regenerate: (cb) => cb(null) };
  const req = { body, session, params: {}, query: {}, method: 'POST', path, ip: '127.0.0.1', headers: {}, get: () => undefined };
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(b) { payload = b; return this; },
  };
  for (const handler of stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, resolve);
      else if (!advanced) resolve();
    });
    if (!advanced) break;
  }
  return { statusCode, payload, session };
}

const login = (phoneNumber, password) => post('/login', { phoneNumber, password });

beforeEach(() => {
  jest.resetModules();
  tableStates = {};
  lookups = [];
  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
  const { installTrainingDelegation } = require('../fixtures/delegate-training-to-bot');
  installTrainingDelegation(() => supabaseFrom);
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  // Same contract as bcryptjs: a non-string hash is "Illegal arguments", a rejection.
  bcryptCompare = jest.fn(async (plain, hash) => {
    if (typeof hash !== 'string') throw new Error(`Illegal arguments: ${typeof plain}, ${typeof hash}`);
    return hash === `hash:${plain}`;
  });
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: bcryptCompare, genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  logEvent = jest.fn();
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent, flush: jest.fn(), isEnabled: () => true }));
  resetService = {
    checkRateLimit: jest.fn(async () => ({ allowed: true })),
    sendResetCode: jest.fn(async () => ({ success: true })),
    verifyResetCode: jest.fn(async () => ({ valid: true, userId: 'u-teacher' })),
  };
  jest.doMock('../../dashboard/services/password-reset.service', () => resetService);
});

afterEach(() => jest.resetModules());

const ACCOUNT = {
  id: 'acct-fde', name: 'FDE Islamabad', phone_number: 'analytics:fde-islamabad', role: 'unregistered',
  school_id: null, portal_activated: true, portal_password_hash: 'hash:secret123',
};
const TEACHER = {
  id: 'u-teacher', name: 'Ayesha', phone_number: '923000000000', role: 'teacher',
  portal_activated: true, portal_password_hash: 'hash:secret123',
};
const listed = (value) => ({ rows: [{ key: 'portal_analytics_only', value }] });

/** What a WRONG PASSWORD on a real phone answers. Every name failure must be indistinguishable from it. */
async function phoneWrongPassword() {
  const saved = tableStates;
  tableStates = { users: { rows: [TEACHER] } };
  const out = await login('03000000000', 'not-it-1');
  tableStates = saved;
  bcryptCompare.mockClear();
  lookups = [];
  return out;
}

describe('the account-name rules (dashboard/lib/analytics-account-name)', () => {
  const lib = () => require('../../dashboard/lib/analytics-account-name');

  it('an identifier is a name when it holds an ASCII letter; anything else is a phone', () => {
    const { isAccountNameInput } = lib();
    for (const s of ['fde-islamabad', 'FDE', ' fde ', 'a1', 'analytics:fde', '0300l234567']) expect(isAccountNameInput(s)).toBe(true);
    for (const s of ['03001234567', '+92 300 1234567', '0092-300-1234567', '', '   ', 'فون']) expect(isAccountNameInput(s)).toBe(false);
    // Not a string: never a name (RegExp.test would coerce ['abc'] to "abc").
    for (const v of [['abc'], { a: 1 }, 923001234567, null, undefined]) expect(isAccountNameInput(v)).toBe(false);
  });

  it('a name is trimmed and lower-cased, then held to ^[a-z][a-z0-9-]{2,39}$', () => {
    const { normaliseAccountName } = lib();
    expect(normaliseAccountName('  FDE-Islamabad ')).toBe('fde-islamabad');
    expect(normaliseAccountName('abc')).toBe('abc');
    expect(normaliseAccountName(`a${'b'.repeat(39)}`)).toHaveLength(40);
    for (const bad of ['ab', `a${'b'.repeat(40)}`, '9fde', '-fde', 'fde islamabad', 'fde_islamabad', 'analytics:fde', 'fdé', '', null, ['fde']]) {
      expect(normaliseAccountName(bad)).toBeNull();
    }
  });

  // Every phone normaliser that reads a STORED value joins all its digits (scripts/backfill-school-id-from-roster.py,
  // scripts/sync-training-from-fde.py, …), so analytics:fde-0300-123-4567 would read as 923001234567 — a real
  // teacher — and the roster backfill would make the account that teacher's school's teacher. A PK mobile needs 10
  // digits; a name holds at most 6, so its digits can never spell one.
  it('a name holds at most 6 digits, so its digits can never spell a phone number', () => {
    const { normaliseAccountName } = lib();
    expect(normaliseAccountName('district-123456')).toBe('district-123456');
    expect(normaliseAccountName('sector-g9')).toBe('sector-g9');
    for (const bad of ['fde-03001234567', 'fde-0300-123-4567', 'a1-2-3-4-5-6-7', 'fde-1234567']) {
      expect(normaliseAccountName(bad)).toBeNull();
    }
  });

  it('the stored value is the reserved, non-numeric analytics:<name>', () => {
    const { storedPhoneFor, ANALYTICS_PHONE_PREFIX } = lib();
    expect(ANALYTICS_PHONE_PREFIX).toBe('analytics:');
    expect(storedPhoneFor('fde-islamabad')).toBe('analytics:fde-islamabad');
  });
});

describe('POST /login with an account name — a listed analytics account', () => {
  it('signs in: 200, a session, analyticsOnly true', async () => {
    tableStates = { users: { rows: [ACCOUNT, TEACHER] }, app_settings: listed(['other', 'acct-fde']) };
    const { statusCode, payload, session } = await login('fde-islamabad', 'secret123');
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.user).toMatchObject({ firstName: 'FDE Islamabad', analyticsOnly: true });
    expect(session.portalUserId).toBe('acct-fde');
    expect(session.isPortalAuth).toBe(true);
  });

  it('looks up ONLY the reserved analytics:<name> value, activated accounts only', async () => {
    tableStates = { users: { rows: [ACCOUNT] }, app_settings: listed(['acct-fde']) };
    await login('fde-islamabad', 'secret123');
    const userLookups = lookups.filter((l) => l.table === 'users');
    expect(userLookups).toEqual([{ table: 'users', filters: { phone_number: 'analytics:fde-islamabad', portal_activated: true } }]);
  });

  it('trims and lower-cases what she typed', async () => {
    tableStates = { users: { rows: [ACCOUNT] }, app_settings: listed(['acct-fde']) };
    const { statusCode } = await login('  FDE-Islamabad ', 'secret123');
    expect(statusCode).toBe(200);
  });

  it('a JSON-string list works the same as a list', async () => {
    tableStates = { users: { rows: [ACCOUNT] }, app_settings: listed('["acct-fde"]') };
    const { statusCode } = await login('fde-islamabad', 'secret123');
    expect(statusCode).toBe(200);
  });
});

describe('POST /login with an account name — every refusal is the wrong-password answer', () => {
  const cases = [
    ['an unknown name', { users: { rows: [ACCOUNT] }, app_settings: listed(['acct-fde']) }, 'nobody-here', 'secret123'],
    ['a name too short', { users: { rows: [ACCOUNT] }, app_settings: listed(['acct-fde']) }, 'ab', 'secret123'],
    ['a name with a space', { users: { rows: [ACCOUNT] }, app_settings: listed(['acct-fde']) }, 'fde islamabad', 'secret123'],
    ['the stored value typed in full', { users: { rows: [ACCOUNT] }, app_settings: listed(['acct-fde']) }, 'analytics:fde-islamabad', 'secret123'],
    ['a name starting with a digit', { users: { rows: [ACCOUNT] }, app_settings: listed(['acct-fde']) }, '9fde', 'secret123'],
    ['a real account NOT on the list', { users: { rows: [ACCOUNT] }, app_settings: listed(['someone-else']) }, 'fde-islamabad', 'secret123'],
    ['the list row absent', { users: { rows: [ACCOUNT] } }, 'fde-islamabad', 'secret123'],
    ['the list is a broadcast true', { users: { rows: [ACCOUNT] }, app_settings: listed(true) }, 'fde-islamabad', 'secret123'],
    ['the list is "teachers"', { users: { rows: [ACCOUNT] }, app_settings: listed('teachers') }, 'fde-islamabad', 'secret123'],
    ['the list is unparseable JSON', { users: { rows: [ACCOUNT] }, app_settings: listed('["acct-fde"') }, 'fde-islamabad', 'secret123'],
    ['the list is an object', { users: { rows: [ACCOUNT] }, app_settings: listed({ 'acct-fde': true }) }, 'fde-islamabad', 'secret123'],
    ['the list cannot be read', { users: { rows: [ACCOUNT] }, app_settings: { error: { message: 'connection reset' } } }, 'fde-islamabad', 'secret123'],
    ['a wrong password', { users: { rows: [ACCOUNT] }, app_settings: listed(['acct-fde']) }, 'fde-islamabad', 'secret124'],
    ['an account not yet set up', { users: { rows: [{ ...ACCOUNT, portal_activated: false }] }, app_settings: listed(['acct-fde']) }, 'fde-islamabad', 'secret123'],
    ['a listed account with no password saved', { users: { rows: [{ ...ACCOUNT, portal_password_hash: null }] }, app_settings: listed(['acct-fde']) }, 'fde-islamabad', 'secret123'],
  ];

  it.each(cases)('%s: same status and body as a wrong password, bcrypt run once, no session', async (_n, state, name, pw) => {
    const wrong = await phoneWrongPassword();
    expect(wrong.statusCode).toBe(401);

    tableStates = state;
    const { statusCode, payload, session } = await login(name, pw);
    expect(statusCode).toBe(wrong.statusCode);
    expect(payload).toEqual(wrong.payload);
    expect(bcryptCompare).toHaveBeenCalledTimes(1);
    expect(session.portalUserId).toBeUndefined();
  });

  it('a teacher cannot be reached by a name: only analytics:<name> is ever looked up', async () => {
    // A teacher named "ayesha" on the list still has a phone, not analytics:ayesha — nothing to find.
    tableStates = { users: { rows: [{ ...TEACHER, name: 'ayesha' }] }, app_settings: listed(['u-teacher']) };
    const { statusCode, session } = await login('ayesha', 'secret123');
    expect(statusCode).toBe(401);
    expect(session.portalUserId).toBeUndefined();
    for (const l of lookups.filter((x) => x.table === 'users')) expect(l.filters.phone_number).toBe('analytics:ayesha');
  });

  it('a refusal is visible in telemetry without the name or the password', async () => {
    tableStates = { users: { rows: [ACCOUNT] }, app_settings: listed(['someone-else']) };
    await login('fde-islamabad', 'secret123');
    expect(logEvent).toHaveBeenCalledWith('portal.login.name_rejected', expect.any(Object));
    const logged = JSON.stringify(logEvent.mock.calls);
    expect(logged).not.toMatch(/fde-islamabad/);
    expect(logged).not.toMatch(/secret123/);
  });
});

describe('POST /login — an identifier without a letter is a phone, exactly as before', () => {
  it('normalises 03XX and looks up the 92 form', async () => {
    tableStates = { users: { rows: [TEACHER] } };
    const { statusCode, payload } = await login('+92 300 0000000', 'secret123');
    expect(statusCode).toBe(200);
    expect(payload.user.analyticsOnly).toBe(false);
    expect(lookups.find((l) => l.table === 'users').filters.phone_number).toBe('923000000000');
  });

  it('an unknown phone is still a 404, a bad one still a 400', async () => {
    tableStates = { users: { rows: [] } };
    expect((await login('03000000000', 'secret123')).statusCode).toBe(404);
    expect((await login('12', 'secret123')).statusCode).toBe(400);
  });

  it('a non-string identifier is not a name (still the phone path\'s 400)', async () => {
    tableStates = { users: { rows: [ACCOUNT] }, app_settings: listed(['acct-fde']) };
    expect((await login(['fde-islamabad'], 'secret123')).statusCode).toBe(400);
  });

  it('a missing field is still a 400', async () => {
    expect((await login('fde-islamabad', '')).statusCode).toBe(400);
    expect((await login('', 'secret123')).statusCode).toBe(400);
  });
});

describe('password reset never treats a name as a phone', () => {
  it.each(['fde-islamabad', 'analytics:fde-islamabad', 'fde-03001234567', 'FDE 0300 1234567'])(
    '/request-reset %s: the invalid-phone answer, and no WhatsApp code', async (input) => {
      const { statusCode, payload } = await post('/request-reset', { phoneNumber: input });
      expect(statusCode).toBe(400);
      expect(payload).toEqual({ success: false, error: 'Please enter a valid phone number.' });
      expect(resetService.checkRateLimit).not.toHaveBeenCalled();
      expect(resetService.sendResetCode).not.toHaveBeenCalled();
    });

  it.each(['fde-islamabad', 'fde-03001234567'])('/verify-reset-code %s: the generic invalid-code answer, nothing checked', async (input) => {
    const { statusCode, payload, session } = await post('/verify-reset-code', { phoneNumber: input, code: '123456' });
    expect(statusCode).toBe(400);
    expect(payload).toEqual({ success: false, error: 'Invalid or expired code. Please request a new reset code.' });
    expect(resetService.verifyResetCode).not.toHaveBeenCalled();
    expect(session.resetUserId).toBeUndefined();
  });

  it('a phone still gets its code (unchanged)', async () => {
    const { statusCode } = await post('/request-reset', { phoneNumber: '0300 1234567' });
    expect(statusCode).toBe(200);
    expect(resetService.sendResetCode).toHaveBeenCalledWith('923001234567');
  });

  it('a phone still verifies (unchanged)', async () => {
    const { statusCode, session } = await post('/verify-reset-code', { phoneNumber: '0300 1234567', code: '123456' });
    expect(statusCode).toBe(200);
    expect(resetService.verifyResetCode).toHaveBeenCalledWith('923001234567', '123456');
    expect(session.resetUserId).toBe('u-teacher');
  });
});
