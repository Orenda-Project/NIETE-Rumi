'use strict';
/**
 * door-bound.js's seam test: the REAL child-phone-bindings repo (never mocked or spied on) gives the phone its keyed
 * hash, the real message ledger keys the counters with it; only the network is faked (Redis as a Map, the table
 * client empty, the structured log captured).
 *  1 a repeat inside 10 s: the door_dedup log's phone_hash IS the repo's ukeyOf(phone) — 16 hex, never the phone —
 *    and every Redis key the bound writes holds that hash, never the phone's digits
 *  2 the same phone written with a '+' is the same phone (the repo normalises it): its repeat is deduped too
 *  3 the ceiling's counter key is wq:door_ceiling:<PKT day>:<the repo's ukeyOf(phone)>
 *  4 no kid key (and no tomb salt): the log carries phone_hash null — never a fallback to the phone — and the
 *    repeat is still deduped (the ledger's own boot hash keys it)
 */
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret';
delete process.env.WQ_TOMB_SALT;
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const Repo = require('../../shared/services/quiz/child-phone-bindings.repo');
const Ledger = require('../../shared/services/quiz/message-ledger');
const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const Bound = require('../../shared/services/first-touch/door-bound');
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');

const dedups = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.door_dedup').map(([, p]) => p);
const keysWritten = () => [...redis.setNX.mock.calls, ...redis.set.mock.calls, ...redis.incr.mock.calls].map(([k]) => String(k));

beforeEach(() => {
  process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret';
  logEvent.mockClear(); redis.setNX.mockClear(); redis.set.mockClear(); redis.incr.mockClear();
  Bound._reset();
});

test('a repeat inside 10 s: the log\'s phone_hash is the real repo\'s ukeyOf, and no Redis key holds the phone', async () => {
  const phone = fixturePhone(21);
  const t0 = Date.parse('2026-10-17T06:00:00Z');
  expect(await Bound.repeat(phone, 'text|quiz', t0)).toBe(false);
  expect(await Bound.repeat(phone, 'text|quiz', t0 + 3000)).toBe(true);
  const ukey = Repo.ukeyOf(phone);
  expect(ukey).toMatch(/^[0-9a-f]{16}$/);
  expect(dedups()).toEqual([{ phone_hash: ukey, gap_ms: 3000, w: 's' }]);
  const keys = keysWritten();
  expect(keys.length).toBeGreaterThan(0);
  keys.forEach((k) => { expect(k).toContain(ukey); expect(k).not.toContain(phone); });
});

test('the same phone with a \'+\' is the same phone to the repo: its repeat is deduped', async () => {
  const phone = fixturePhone(22);
  const t0 = Date.parse('2026-10-17T06:10:00Z');
  expect(Repo.ukeyOf(`+${phone}`)).toBe(Repo.ukeyOf(phone));
  expect(await Bound.repeat(phone, 'text|quiz', t0)).toBe(false);
  expect(await Bound.repeat(`+${phone}`, 'text|quiz', t0 + 2000)).toBe(true);
});

test('the ceiling counts under wq:door_ceiling:<PKT day>:<the repo\'s ukeyOf>', async () => {
  const phone = fixturePhone(23);
  const now = Date.parse('2026-10-17T20:30:00Z'); // 01:30 on the 18th in Pakistan
  expect(await Bound.overCeiling(phone, 1, now)).toEqual({ over: false });
  expect(await Bound.overCeiling(phone, 1, now + 1000)).toEqual({ over: true, first: true });
  expect(redis.incr.mock.calls.map(([k]) => k)).toEqual([
    `wq:door_ceiling:${Ledger.pktDay(new Date(now))}:${Repo.ukeyOf(phone)}`,
    `wq:door_ceiling:${Ledger.pktDay(new Date(now))}:${Repo.ukeyOf(phone)}`,
  ]);
  expect(Ledger.pktDay(new Date(now))).toBe('2026-10-18');
});

test('no kid key: phone_hash null in the log (never the phone), and the repeat is still deduped', async () => {
  delete process.env.WEB_QUIZ_KID_KEY;
  const phone = fixturePhone(24);
  const t0 = Date.parse('2026-10-17T06:20:00Z');
  expect(Repo.ukeyOf(phone)).toBeNull();
  expect(await Bound.repeat(phone, 'text|quiz', t0)).toBe(false);
  expect(await Bound.repeat(phone, 'text|quiz', t0 + 1000)).toBe(true);
  expect(dedups()).toEqual([{ phone_hash: null, gap_ms: 1000, w: 's' }]);
  keysWritten().forEach((k) => expect(k).not.toContain(phone));
});
