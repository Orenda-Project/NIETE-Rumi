'use strict';
/**
 * The nightly answer-key review narrows its own window after a wide run.
 *
 * The first night is meant to read a long window once (the backlog: recent_days 47), then go back to 3 days. Leaving
 * that return to a person the next morning makes it a production write someone has to remember. Instead, after a run
 * that COMPLETED with recent_days > 7, the job writes its own switch row back to the same value with recent_days 3,
 * as a compare-and-set on the PRIMARY: UPDATE app_settings SET value = <narrowed> WHERE key = 'quiz_key_review_job'
 * AND value = <the exact value it read>. An operator's change made meanwhile matches nothing and is kept; `true` and a
 * narrow window are left alone; a failed write never fails the run. The summary says which (`narrowed`).
 *
 * The run goes through run() → tick() as in production; the replica reader, the primary writer and Redis are the
 * faked boundaries. The writer's filter is applied the way PostgREST receives it: as text (postgrest-js sends
 * `value=eq.<String(v)>`), compared as jsonb.
 */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
const mockLogEvent = jest.fn();
jest.mock('../../shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  generateCorrelationId: () => 'corr-test',
  runWithCorrelation: (_id, fn) => fn(),
  getCurrentCorrelationId: () => null,
}));
const { logToFile } = require('../../shared/utils/logger');
const Review = require('../../shared/services/quiz/quiz-key-review.service');

// 00:50 PKT on 23 Nov 2026 = 19:50Z on 22 Nov.
const NOW = new Date('2026-11-22T19:50:00Z');
const Q = '00000000-0000-4000-8000-00000000a001';

function fakeRedis() {
  const m = new Map();
  return {
    async setNX(k, v) { if (!m.has(k)) m.set(k, v); return true; },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async set(k, v) { m.set(k, v); return true; },
  };
}

/** A jsonb comparison of the text a filter arrives as with a stored value (key order does not matter). */
function jsonbEqual(text, stored) {
  let v;
  try { v = JSON.parse(text); } catch (_) { return false; }
  const canon = (x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`
    : JSON.stringify(x));
  return canon(v) === canon(stored);
}

/** One app_settings table both clients see; `readAs` lets a test make the replica lag the primary. */
function fakeDb({ value, readAs }) {
  const settings = new Map([[Review.SWITCH_KEY, value]]);
  const updates = [];
  const reader = {
    calls: [],
    async rpc(name, args) {
      this.calls.push(name);
      if (name === 'db_is_replica') return { data: true, error: null };
      if (name === 'quiz_key_answer_counts') {
        return { data: [{ question_id: Q, correct_option: 'C', option_a: 'x', option_b: 'y', option_c: 'z', option_d: null, media: {}, counts: { A: 16, C: 9 }, answers_n: 25 }], error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table) {
      if (table !== 'app_settings') throw new Error(`reader touched ${table}`);
      return {
        select() { return this; },
        eq(_c, key) { this.key = key; return this; },
        async maybeSingle() {
          const v = readAs !== undefined ? readAs : settings.get(this.key);
          return v === undefined ? { data: null, error: null } : { data: { value: v }, error: null };
        },
      };
    },
  };
  const queue = new Map();
  let failUpdate = null;
  const writer = {
    from(table) {
      if (table === 'quiz_item_reviews') {
        return {
          select() { return this; },
          eq() { return this; },
          async in(_c, ids) { return { data: [...queue.values()].filter((r) => ids.includes(r.question_id)), error: null }; },
          async insert(rs) { rs.forEach((r) => queue.set(`${r.question_id}|${r.reason}`, { status: 'open', ...r })); return { error: null }; },
          update() { return { eq() { return this; }, then: (res) => Promise.resolve({ error: null }).then(res) }; },
        };
      }
      if (table !== 'app_settings') throw new Error(`writer touched ${table}`);
      return {
        update(patch) {
          const filters = [];
          const chain = {
            eq(c, v) { filters.push([c, `${v}`]); return chain; },
            async select() {
              updates.push({ patch, filters: filters.map((f) => [...f]) });
              if (failUpdate) return { data: null, error: failUpdate };
              const key = (filters.find(([c]) => c === 'key') || [])[1];
              const val = (filters.find(([c]) => c === 'value') || [])[1];
              if (!settings.has(key) || val === undefined || !jsonbEqual(val, settings.get(key))) return { data: [], error: null };
              settings.set(key, patch.value);
              return { data: [{ key }], error: null };
            },
          };
          return chain;
        },
      };
    },
  };
  return { reader, writer, settings, updates, queue, failWith: (e) => { failUpdate = e; } };
}

const run = (db, now = NOW) => Review.run({ now, redis: fakeRedis(), reader: db.reader, writer: () => db.writer });
const summary = () => (mockLogEvent.mock.calls.find((c) => c[0] === 'quiz_keys.flagged') || [])[1];

beforeEach(() => { mockLogEvent.mockClear(); logToFile.mockClear(); });

test('a completed run at recent_days 47 narrows its own row to 3, keeping every other field', async () => {
  const db = fakeDb({ value: { at: '00:45', recent_days: 47 } });
  const out = await run(db);
  expect(out.outcome).toBe('ran');
  expect(db.queue.size).toBe(1);
  expect(db.settings.get(Review.SWITCH_KEY)).toEqual({ at: '00:45', recent_days: 3 });
  expect(out.narrowed).toBe(true);
  expect(summary()).toEqual(expect.objectContaining({ outcome: 'ran', narrowed: true }));
  // compare-and-set: the key AND the exact value it read
  expect(db.updates).toHaveLength(1);
  expect(db.updates[0].filters).toEqual([['key', Review.SWITCH_KEY], ['value', JSON.stringify({ at: '00:45', recent_days: 47 })]]);
});

test('a run at 3 (or 7) leaves the row untouched: no write at all', async () => {
  for (const days of [3, 7]) {
    const db = fakeDb({ value: { at: '00:45', recent_days: days } });
    // eslint-disable-next-line no-await-in-loop
    const out = await run(db);
    expect(out.outcome).toBe('ran');
    expect(db.updates).toHaveLength(0);
    expect(db.settings.get(Review.SWITCH_KEY)).toEqual({ at: '00:45', recent_days: days });
    expect(out.narrowed).toBe(false);
  }
});

test('true (the 3-day default) is left alone', async () => {
  const db = fakeDb({ value: true });
  const out = await run(db, new Date('2026-11-22T21:10:00Z')); // `true` runs at 02:00 PKT
  expect(out.outcome).toBe('ran');
  expect(db.updates).toHaveLength(0);
  expect(db.settings.get(Review.SWITCH_KEY)).toBe(true);
  expect(out.narrowed).toBe(false);
});

test('a value changed between the read and the write is untouched (an operator\'s change is never clobbered)', async () => {
  // The run read 47; meanwhile an operator set 14 on the primary.
  const db = fakeDb({ value: { at: '00:45', recent_days: 14 }, readAs: { at: '00:45', recent_days: 47 } });
  const out = await run(db);
  expect(out.outcome).toBe('ran');
  expect(db.updates).toHaveLength(1);
  expect(db.settings.get(Review.SWITCH_KEY)).toEqual({ at: '00:45', recent_days: 14 });
  expect(out.narrowed).toBe(false);
});

test('a failed narrowing write never fails the run: it ran, narrowed false, logged', async () => {
  const db = fakeDb({ value: { at: '00:45', recent_days: 47 } });
  db.failWith({ code: '57014', message: 'canceling statement due to statement timeout' });
  const out = await run(db);
  expect(out.outcome).toBe('ran');
  expect(db.queue.size).toBe(1);
  expect(out.narrowed).toBe(false);
  expect(db.settings.get(Review.SWITCH_KEY)).toEqual({ at: '00:45', recent_days: 47 });
  expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/could not narrow/), expect.any(Object), 'warn');
});

test('a run that stopped (the counts failed) does not narrow', async () => {
  const db = fakeDb({ value: { at: '00:45', recent_days: 47 } });
  const rpc = db.reader.rpc.bind(db.reader);
  db.reader.rpc = async (name, args) => (name === 'quiz_key_answer_counts' ? { data: null, error: { message: 'timeout' } } : rpc(name, args));
  const out = await run(db);
  expect(out.outcome).toBe('error');
  expect(db.updates).toHaveLength(0);
  expect(db.settings.get(Review.SWITCH_KEY)).toEqual({ at: '00:45', recent_days: 47 });
});
