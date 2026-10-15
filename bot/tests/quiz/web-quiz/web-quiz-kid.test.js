'use strict';
/**
 * The keyed child key (web-quiz-kid.js): kid / dk / cls / ukey are HMAC-SHA256 under WEB_QUIZ_KID_KEY with a
 * domain prefix each, truncated; no key (or a short one) is null and one web_quiz.kid_key_missing per PKT day,
 * never an unkeyed hash. envelope() is the v2 event envelope and strips every id that may not sit beside a kid.
 * Only the logger transport is faked.
 */
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const crypto = require('crypto');
const { logEvent } = require('../../../shared/utils/structured-logger');
const K = require('../../../shared/services/quiz/web-quiz-kid');

const KEY = 'test-only-kid-key-0123456789abcdef0123456789';
const CHILD = '44444444-4444-4444-8444-000000000001';
const OTHER = '44444444-4444-4444-8444-000000000002';
const CLASS = '55555555-5555-4555-8555-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const hmac = (s) => crypto.createHmac('sha256', KEY).update(s).digest('hex');
const missing = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.kid_key_missing');

beforeEach(() => {
  jest.clearAllMocks();
  K._reset();
  process.env.WEB_QUIZ_KID_KEY = KEY;
  process.env.WEB_QUIZ_KID_KEY_V = '2026';
});
afterAll(() => { delete process.env.WEB_QUIZ_KID_KEY; delete process.env.WEB_QUIZ_KID_KEY_V; });

describe('kid refuses without the secret', () => {
  test('no key: kid, dk, cls and ukey are all null, and kid_key_missing is logged once (not per call)', () => {
    delete process.env.WEB_QUIZ_KID_KEY;
    expect(K.kid(CHILD)).toBeNull();
    expect(K.kid(OTHER)).toBeNull();
    expect(K.dk(DEV)).toBeNull();
    expect(K.cls(CLASS)).toBeNull();
    expect(K.ukey('923001112223')).toBeNull();
    expect(missing()).toHaveLength(1);
    expect(missing()[0][1]).toEqual({ w: 's', ev_v: 2, kid_v: '2026', kid: null });
  });

  test('a key shorter than 32 bytes is no key: null, never an unkeyed sha256 of the id', () => {
    process.env.WEB_QUIZ_KID_KEY = 'short-key';
    expect(K.kid(CHILD)).toBeNull();
    expect(missing()).toHaveLength(1);
    const unkeyed = crypto.createHash('sha256').update(`kid|${CHILD}`).digest('hex').slice(0, 16);
    process.env.WEB_QUIZ_KID_KEY = KEY;
    expect(K.kid(CHILD)).not.toBe(unkeyed);
  });

  test('kid_key_missing again on the next PKT day, not before', () => {
    delete process.env.WEB_QUIZ_KID_KEY;
    const day1 = Date.parse('2026-11-03T10:00:00Z');
    K.kid(CHILD, { now: day1 });
    K.kid(CHILD, { now: day1 + 8 * 3600e3 }); // 23:00 PKT, same PKT day
    expect(missing()).toHaveLength(1);
    K.kid(CHILD, { now: day1 + 10 * 3600e3 }); // 01:00 PKT next day
    expect(missing()).toHaveLength(2);
  });
});

describe('the keys', () => {
  test('same id, same kid; the canonical id is lower-cased first; a different child differs', () => {
    expect(K.kid(CHILD)).toBe(hmac(`kid|${CHILD}`).slice(0, 16));
    expect(K.kid(CHILD.toUpperCase())).toBe(K.kid(CHILD));
    expect(K.kid(CHILD)).toMatch(/^[0-9a-f]{16}$/);
    expect(K.kid(OTHER)).not.toBe(K.kid(CHILD));
  });

  test('the domain prefixes differ: the same value hashed as kid, dev, cls never collide; lengths 16/12/12/16', () => {
    expect(K.dk(DEV)).toBe(hmac(`dev|${DEV}`).slice(0, 12));
    expect(K.cls(CLASS)).toBe(hmac(`cls|${CLASS}`).slice(0, 12));
    expect(K.ukey('923001112223')).toBe(hmac('ukey|923001112223').slice(0, 16));
    expect(K.kid(CLASS).slice(0, 12)).not.toBe(K.cls(CLASS));
    expect(K.kid(CHILD)).toHaveLength(16);
    expect(K.dk(DEV)).toHaveLength(12);
  });

  test('not an id: null (a phone or a name is never hashed as a kid)', () => {
    expect(K.kid('923001112223')).toBeNull();
    expect(K.kid('Sana Testwala')).toBeNull();
    expect(K.kid(null)).toBeNull();
    expect(K.cls('not-a-class')).toBeNull();
    expect(K.ukey('Sana')).toBeNull();
    expect(missing()).toHaveLength(0);
  });

  test('kid_v is the key label from WEB_QUIZ_KID_KEY_V', () => {
    expect(K.kidV()).toBe('2026');
    delete process.env.WEB_QUIZ_KID_KEY_V;
    expect(K.kidV()).toBeNull();
  });
});

describe('the *Of aliases callers use', () => {
  test('kidOf, dkOf, clsOf, ukeyOf are the same functions as kid, dk, cls, ukey', () => {
    expect(K.kidOf).toBe(K.kid);
    expect(K.dkOf).toBe(K.dk);
    expect(K.clsOf).toBe(K.cls);
    expect(K.ukeyOf).toBe(K.ukey);
    expect(K.clsOf(CLASS)).toBe(hmac(`cls|${CLASS}`).slice(0, 12));
  });
});

describe('envelope', () => {
  test('carries w, ev_v 2, kid_v and kid (null when not given)', () => {
    expect(K.envelope({ n: 3 })).toEqual({ w: 's', ev_v: 2, kid_v: '2026', kid: null, n: 3 });
    const kid = K.kid(CHILD);
    expect(K.envelope({ kid, run: 'r1' })).toEqual({ w: 's', ev_v: 2, kid_v: '2026', kid, run: 'r1' });
  });

  test('never carries device_ref / share_code / dh / sid / class_id (or any other forbidden id) beside a kid', () => {
    const kid = K.kid(CHILD);
    const dirty = {
      kid, run: 'r1', device_ref: DEV, share_code: 'ABCD12', share_code_id: 'x', dh: 'abc', sid: 's1', code: 'ABCD12', code_h: 'h',
      to_h: 't', shareCodeId: 'sc', sessionId: 'se', student_id: CHILD, class_id: CLASS, userId: 'u', phone: '923001112223',
      phone_norm: '923001112223', name: 'Sana Testwala', token: 'tok', ukey: 'a0000000000009', dk: K.dk(DEV),
    };
    const out = K.envelope(dirty);
    expect(Object.keys(out).sort()).toEqual(['dk', 'ev_v', 'kid', 'kid_v', 'run', 'w']);
    expect(JSON.stringify(out)).not.toMatch(/AAAAAAAA|ABCD12|Testwala|923001112223|55555555|44444444/);
  });

  test('without a kid the event keeps its own fields (a diagnostics event is not rewritten)', () => {
    expect(K.envelope({ n: 1, where: 'batch_slice' })).toEqual({ w: 's', ev_v: 2, kid_v: '2026', kid: null, n: 1, where: 'batch_slice' });
  });
});
