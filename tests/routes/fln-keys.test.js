'use strict';
/** PR-E (m-links) — keyed ids: 16 hex, per purpose, per environment, null without a key. */
const ENV = { ...process.env };
const ID = '11111111-1111-4111-8111-111111111111';
beforeEach(() => { jest.resetModules(); process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://envone.supabase.co' }; });
afterAll(() => { process.env = ENV; });
const K = () => require('../../bot/shared/services/fln-keys');

test('16 hex, stable, and the two purposes never collide', () => {
  const t = K().teacherKey(ID);
  expect(t).toMatch(K().KEY_RX);
  expect(K().teacherKey(ID)).toBe(t);
  expect(K().userKey(ID)).toMatch(K().KEY_RX);
  expect(K().userKey(ID)).not.toBe(t);
  expect(t).not.toContain(ID.slice(0, 8));
});

test('another environment (Supabase host) gives another key', () => {
  const a = K().teacherKey(ID);
  process.env.SUPABASE_URL = 'https://envtwo.supabase.co';
  expect(K().teacherKey(ID)).not.toBe(a);
});

test('no INTERNAL_API_KEY, no SUPABASE_URL, or no id → null', () => {
  expect(K().teacherKey('')).toBeNull();
  expect(K().teacherKey(null)).toBeNull();
  delete process.env.INTERNAL_API_KEY;
  expect(K().teacherKey(ID)).toBeNull();
  process.env.INTERNAL_API_KEY = 'k1';
  process.env.SUPABASE_URL = 'not a url';
  expect(K().userKey(ID)).toBeNull();
});
