'use strict';
/**
 * The kid hub's token (kind 'h'): the WhatsApp /quiz link names this phone's
 * own children by id, for 7 days, and carries no name and no phone.
 */
const SAVED = { ...process.env };
afterEach(() => { process.env = { ...SAVED }; jest.useRealTimers(); });

function load(env) {
  jest.resetModules();
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  delete process.env.INTERNAL_API_KEY;
  Object.assign(process.env, env);
  return require('../../../shared/services/quiz/web-quiz-token');
}

const A = '44444444-4444-4444-8444-444444444444';
const B = '44444444-4444-4444-8444-555555555555';

describe('hub token (kind h)', () => {
  test('genuine: the ids come back, 7 days, nothing else in the payload', () => {
    const T = load({ WEB_QUIZ_TOKEN_SECRET: 's1' });
    const t = T.signHub([A, B]);
    const p = T.verify(t, 'h');
    expect(p.ids).toEqual([A, B]);
    expect(p.exp - Math.floor(Date.now() / 1000)).toBe(7 * 24 * 60 * 60);
    expect(Object.keys(p).sort()).toEqual(['exp', 'ids', 'k']);
  });

  test('at most 4 children, duplicates and blanks dropped; none -> no token', () => {
    const T = load({ WEB_QUIZ_TOKEN_SECRET: 's1' });
    const ids = [A, A, '', B, 'c', 'd', 'e'];
    expect(T.verify(T.signHub(ids), 'h').ids).toEqual([A, B, 'c', 'd']);
    expect(T.signHub([])).toBeNull();
    expect(T.signHub(null)).toBeNull();
  });

  test('forged: a different secret, or a tampered body, does not verify', () => {
    const T1 = load({ WEB_QUIZ_TOKEN_SECRET: 's1' });
    const t = T1.signHub([A]);
    const T2 = load({ WEB_QUIZ_TOKEN_SECRET: 's2' });
    expect(T2.verify(t, 'h')).toBeNull();
    const body = Buffer.from(JSON.stringify({ k: 'h', ids: [B], exp: 9999999999 })).toString('base64url');
    expect(T2.verify(`${body}.${t.split('.')[1]}`, 'h')).toBeNull();
  });

  test('expired after 7 days', () => {
    const T = load({ WEB_QUIZ_TOKEN_SECRET: 's1' });
    jest.useFakeTimers({ now: Date.UTC(2026, 9, 6) });
    const t = T.signHub([A]);
    jest.setSystemTime(Date.UTC(2026, 9, 6) + 7 * 86400000 - 1000);
    expect(T.verify(t, 'h')).not.toBeNull();
    jest.setSystemTime(Date.UTC(2026, 9, 6) + 7 * 86400000 + 2000);
    expect(T.verify(t, 'h')).toBeNull();
  });

  test('wrong kind: a hub token is not a session token, and the reverse', () => {
    const T = load({ WEB_QUIZ_TOKEN_SECRET: 's1' });
    expect(T.verify(T.signHub([A]), 's')).toBeNull();
    expect(T.verify(T.signSession({ sessionId: 'x', deviceRef: 'd', shareCodeId: 'sc' }), 'h')).toBeNull();
  });

  test('no secret: fail closed', () => {
    const T = load({});
    expect(T.signHub([A])).toBeNull();
  });
});
