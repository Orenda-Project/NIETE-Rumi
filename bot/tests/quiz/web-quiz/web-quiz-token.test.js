'use strict';
/**
 * The web quiz's signed tokens. Everything the child's page holds that the
 * server later trusts — the session token, the teacher's preview link, a name
 * chip — is signed here, and with no secret every token is invalid.
 */
const crypto = require('crypto');

const SAVED = { ...process.env };
afterEach(() => { process.env = { ...SAVED }; });

// The secret is read at call time, so `env` stays in force until afterEach.
// Flip the signature's last character to one it is guaranteed not to be —
// a fixed 'A' already matches 1 signature in 64, and that token verifies.
function tamper(sig) {
  return sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
}

function load(env) {
  jest.resetModules();
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  delete process.env.INTERNAL_API_KEY;
  Object.assign(process.env, env);
  return require('../../../shared/services/quiz/web-quiz-token');
}

describe('web-quiz-token', () => {
  test('no secret at all: fail closed — nothing signs, nothing verifies', () => {
    const T = load({});
    expect(T.secret()).toBeNull();
    expect(T.sign({ k: 's', sid: 'x' })).toBeNull();
    expect(T.verify('abc.def', 's')).toBeNull();
    expect(T.signPreview({ shareCodeId: 'sc', teacherUserId: 'u' })).toBeNull();
    expect(T.chipId('sc', 'st')).toBeNull();
  });

  test('secret derives from INTERNAL_API_KEY when WEB_QUIZ_TOKEN_SECRET is unset', () => {
    const T = load({ INTERNAL_API_KEY: 'k1' });
    const want = crypto.createHmac('sha256', 'k1').update('web-quiz-token-v1').digest();
    expect(Buffer.compare(T.secret(), want)).toBe(0);
  });

  test('WEB_QUIZ_TOKEN_SECRET wins when set', () => {
    const T = load({ INTERNAL_API_KEY: 'k1', WEB_QUIZ_TOKEN_SECRET: 'own' });
    expect(T.secret().toString()).toBe('own');
  });

  test('session token round-trips, carries kind, rejects tamper, wrong kind and expiry', () => {
    const T = load({ INTERNAL_API_KEY: 'k1' });
    const st = T.signSession({ sessionId: 'sess-1', deviceRef: 'dev-1', shareCodeId: 'sc-1' });
    const p = T.verify(st, 's');
    expect(p).toMatchObject({ k: 's', sid: 'sess-1', d: 'dev-1', sc: 'sc-1' });
    expect(T.verify(st, 'p')).toBeNull();
    const [body, sig] = st.split('.');
    const forged = Buffer.from(JSON.stringify({ ...p, sid: 'other' })).toString('base64url');
    expect(T.verify(`${forged}.${sig}`, 's')).toBeNull();
    expect(T.verify(`${body}.${tamper(sig)}`, 's')).toBeNull();
    const old = T.sign({ k: 's', sid: 'x', exp: Math.floor(Date.now() / 1000) - 5 });
    expect(T.verify(old, 's')).toBeNull();
    expect(T.verify(null, 's')).toBeNull();
    expect(T.verify('garbage', 's')).toBeNull();
  });

  test('tamper still fails when the signature already ends in the replacement character', () => {
    const T = load({ INTERNAL_API_KEY: 'k1' });
    let st = null;
    for (let i = 0; i < 5000 && !st; i++) {
      const t = T.signSession({ sessionId: `sess-${i}`, deviceRef: 'dev-1', shareCodeId: 'sc-1' });
      if (t.split('.')[1].endsWith('A')) st = t;
    }
    expect(st).not.toBeNull();
    const [body, sig] = st.split('.');
    expect(T.verify(`${body}.${tamper(sig)}`, 's')).toBeNull();
  });

  test('a token signed under another secret does not verify', () => {
    const A = load({ INTERNAL_API_KEY: 'k1' });
    const st = A.signSession({ sessionId: 's', deviceRef: 'd', shareCodeId: 'c' });
    const B = load({ INTERNAL_API_KEY: 'k2' });
    expect(A.verify(st, 's')).toBeNull(); // the secret is read per call
    expect(B.verify(st, 's')).toBeNull();
  });

  test('preview token: 30 days, names the share code and the teacher', () => {
    const T = load({ INTERNAL_API_KEY: 'k1' });
    const p = T.verify(T.signPreview({ shareCodeId: 'sc-9', teacherUserId: 'u-9' }), 'p');
    expect(p).toMatchObject({ k: 'p', sc: 'sc-9', t: 'u-9' });
    expect(p.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(29 * 86400);
  });

  test('chip id is stable, 16 hex, and differs per class and per child', () => {
    const T = load({ INTERNAL_API_KEY: 'k1' });
    const a = T.chipId('sc-1', 'st-1');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(T.chipId('sc-1', 'st-1')).toBe(a);
    expect(T.chipId('sc-2', 'st-1')).not.toBe(a);
    expect(T.chipId('sc-1', 'st-2')).not.toBe(a);
  });

  test('device_ref is server-random, 22 url-safe chars; a well-formed one is kept', () => {
    const T = load({ INTERNAL_API_KEY: 'k1' });
    const a = T.newDeviceRef();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(T.newDeviceRef()).not.toBe(a);
    expect(T.cleanDeviceRef(a)).toBe(a);
    expect(T.cleanDeviceRef('<script>')).toBeNull();
    expect(T.cleanDeviceRef('+920000000000')).toBeNull();
  });

  test('animal is derived from the student id, stable, one of twelve', () => {
    const T = load({});
    expect(T.ANIMALS).toHaveLength(12);
    expect(T.animalFor('st-1')).toBe(T.animalFor('st-1'));
    expect(T.ANIMALS).toContain(T.animalFor('st-1'));
  });
});
