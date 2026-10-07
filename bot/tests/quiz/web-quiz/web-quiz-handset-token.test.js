'use strict';
/**
 * The handset link token (web-quiz-token.js), pure: kind 'x' carries a random nonce, the share
 * code it was sent for and a one-hour expiry — never a phone, never a student id, never a key.
 * Verified only as 'x'. The ids it stands for live server-side (web-quiz-handset.js).
 */
process.env.INTERNAL_API_KEY = 'test-only-internal-key';
delete process.env.WEB_QUIZ_TOKEN_SECRET;

const T = require('../../../shared/services/quiz/web-quiz-token');

describe('newNonce / signHandset / verify x', () => {
  test('a nonce is 16 random bytes, base64url; two differ', () => {
    const a = T.newNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(T.newNonce()).not.toBe(a);
  });

  test('the token carries the nonce, the share code and a 1-hour expiry; kind x only; nothing else', () => {
    const n = T.newNonce();
    const tok = T.signHandset({ n, shareCodeId: 'sc-1' });
    expect(typeof tok).toBe('string');
    const p = T.verify(tok, 'x');
    expect(p).toBeTruthy();
    expect(Object.keys(p).sort()).toEqual(['exp', 'k', 'n', 'sc']);
    expect(p.n).toBe(n);
    expect(p.sc).toBe('sc-1');
    expect(p.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(T.HANDSET_TTL_S);
    expect(p.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(T.HANDSET_TTL_S - 5);
    expect(T.HANDSET_TTL_S).toBe(60 * 60);
    expect(T.verify(tok, 'h')).toBeNull();
    expect(T.verify(tok, 's')).toBeNull();
    expect(T.verify(`${tok.slice(0, -2)}zz`, 'x')).toBeNull();
  });

  test('no nonce, a bad nonce, or no secret: null', () => {
    expect(T.signHandset({ shareCodeId: 'sc-1' })).toBeNull();
    expect(T.signHandset({ n: 'short', shareCodeId: 'sc-1' })).toBeNull();
    expect(T.signHandset({ n: T.newNonce() })).toBeTruthy();   // a hub link has no code
    const key = process.env.INTERNAL_API_KEY;
    delete process.env.INTERNAL_API_KEY;
    expect(T.signHandset({ n: T.newNonce(), shareCodeId: 'sc-1' })).toBeNull();
    process.env.INTERNAL_API_KEY = key;
  });
});
