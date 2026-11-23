'use strict';
/**
 * The nightly answer-key review flag (shared/services/quiz/quiz-key-review.service.js): an item that at least
 * min_answers children answered, where ONE wrong option drew at least min_share of them, goes to the review queue
 * (quiz_item_reviews) once; a second run adds nothing; a reviewed row is never flagged again. The run goes through
 * run() → tick() with the real replica check, switch read, claim and marker; Supabase (the replica reader and the
 * primary writer) and Redis are the faked boundaries.
 */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
const mockLogEvent = jest.fn();
jest.mock('../../shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  generateCorrelationId: () => 'corr-test',
  runWithCorrelation: (_id, fn) => fn(),
  getCurrentCorrelationId: () => null,
}));

const Review = require('../../shared/services/quiz/quiz-key-review.service');

// 02:10 PKT on 22 Nov 2026 = 21:10Z on 21 Nov.
const NOW = new Date('2026-11-21T21:10:00Z');
const Q_WRONG_KEY = '00000000-0000-4000-8000-000000000001';   // 25 answers, 65% on wrong option A, key C
const Q_MISCONCEPTION_FEW = '00000000-0000-4000-8000-000000000002'; // 19 answers: under the floor
const Q_FINE = '00000000-0000-4000-8000-000000000003';          // 30 answers, key B right for 70%
const Q_WEB_KEY = '00000000-0000-4000-8000-000000000004';       // row key A, web item key B: 70% on A is WRONG by the web key

function fakeRedis() {
  const m = new Map();
  return {
    m,
    async setNX(k, v) { if (!m.has(k)) m.set(k, v); return true; },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async set(k, v) { m.set(k, v); return true; },
  };
}

function answerRows() {
  return [
    { question_id: Q_WRONG_KEY, correct_option: 'C', option_a: 'Maa, Maa', option_b: 'put-tur-hoo', option_c: 'Bhaoo, Bhaoo', option_d: null,
      media: { language: 'en' }, counts: { A: 16, B: 2, C: 7 }, answers_n: 25 },
    { question_id: Q_MISCONCEPTION_FEW, correct_option: 'A', option_a: 'x', option_b: 'y', option_c: 'z', option_d: null,
      media: {}, counts: { A: 3, B: 16 }, answers_n: 19 },
    { question_id: Q_FINE, correct_option: 'B', option_a: 'x', option_b: 'y', option_c: 'z', option_d: null,
      media: {}, counts: { A: 5, B: 21, C: 4 }, answers_n: 30 },
    { question_id: Q_WEB_KEY, correct_option: 'A', option_a: 'Who', option_b: 'Whose', option_c: 'What', option_d: null,
      media: { web: { v: 2, type: 'single', key: 'B' } }, counts: { A: 21, B: 6, C: 3 }, answers_n: 30 },
  ];
}

const Q_WRONG_KEY_LATE = 'ffffffff-0000-4000-8000-000000000001';

/** `n` items that are fine (key A right for 21 of 25), ids in question_id order, then `suspect` (key C, 16 of 25 on A)
 *  with the highest id: the row a read that stops at the server's cap never sees. */
function manyRows(n, suspect = Q_WRONG_KEY_LATE) {
  const rows = [];
  for (let i = 1; i <= n; i += 1) {
    rows.push({ question_id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`, correct_option: 'A', option_a: 'x', option_b: 'y',
      option_c: 'z', option_d: null, media: {}, counts: { A: 21, B: 4 }, answers_n: 25 });
  }
  rows.push({ question_id: suspect, correct_option: 'C', option_a: 'Maa, Maa', option_b: 'put-tur-hoo', option_c: 'Bhaoo, Bhaoo', option_d: null,
    media: {}, counts: { A: 16, B: 2, C: 7 }, answers_n: 25 });
  return rows;
}

/** A PostgREST call: filters, order and limit apply to the function's rows, and no response holds more than maxRows
 *  (the server's max-rows; 1,000 on the NIETE prod replica), cut with no error. ignorePaging: a server that answers
 *  every call with the same first rows. */
function query(result, { maxRows = Infinity, ignorePaging = false } = {}) {
  const q = { gt: null, order: null, offset: 0, limit: Infinity };
  return {
    gt(col, v) { q.gt = [col, v]; return this; },
    order(col) { q.order = col; return this; },
    limit(n) { q.limit = n; return this; },
    range(from, to) { q.offset = from; q.limit = to - from + 1; return this; },
    then(resolve, reject) {
      if (!Array.isArray(result.data)) return Promise.resolve(result).then(resolve, reject);
      let out = result.data.slice();
      if (!ignorePaging) {
        if (q.gt) out = out.filter((r) => r[q.gt[0]] > q.gt[1]);
        if (q.order) out.sort((a, b) => (a[q.order] < b[q.order] ? -1 : a[q.order] > b[q.order] ? 1 : 0));
        out = out.slice(q.offset, q.offset + q.limit);
      }
      return Promise.resolve({ data: out.slice(0, maxRows), error: null }).then(resolve, reject);
    },
  };
}

/** The replica: db_is_replica, the switch row, and the counts function. Like the NIETE prod replica, it
 *  answers rpc over GET only and refuses POST (supabase-js's default) with a 400, and cuts every response at 1,000 rows. */
function fakeReader({ switchValue = { at: '02:00' }, rows = answerRows(), maxRows = 1000, ignorePaging = false } = {}) {
  const calls = [];
  return {
    calls,
    rpc(name, args, opts) {
      calls.push({ name, args });
      if (!opts || opts.get !== true) return query({ data: null, error: { message: `400: replica refuses POST rpc ${name}` } });
      if (name === 'db_is_replica') return query({ data: true, error: null });
      if (name === 'quiz_key_answer_counts') return query({ data: rows, error: null }, { maxRows, ignorePaging });
      return query({ data: null, error: { message: `unexpected rpc ${name}` } });
    },
    from(table) {
      if (table !== 'app_settings') throw new Error(`reader touched ${table}`);
      return {
        select() { return this; },
        eq(_c, key) { this.key = key; return this; },
        async maybeSingle() {
          if (this.key !== Review.SWITCH_KEY || switchValue === null) return { data: null, error: null };
          return { data: { value: switchValue }, error: null };
        },
      };
    },
  };
}

/** The primary: the queue table only. */
function fakeWriter(store = new Map()) {
  return {
    store,
    from(table) {
      if (table !== 'quiz_item_reviews') throw new Error(`writer touched ${table}`);
      return {
        select() { return this; },
        eq(c, v) { (this.eqs = this.eqs || []).push([c, v]); return this; },
        async in(_c, ids) {
          return { data: [...store.values()].filter((r) => ids.includes(r.question_id)).map((r) => ({ ...r })), error: null };
        },
        async insert(rows) {
          for (const r of rows) {
            if ([...store.values()].some((x) => x.question_id === r.question_id && x.reason === r.reason)) {
              return { error: { code: '23505', message: 'duplicate' } };
            }
            store.set(`${r.question_id}|${r.reason}`, { status: 'open', ...r });
          }
          return { error: null };
        },
        update(patch) {
          const self = this;
          return {
            eq(c, v) { (self.eqs = self.eqs || []).push([c, v]); return this; },
            then(resolve) {
              for (const [k, r] of store) {
                if ((self.eqs || []).every(([c, v]) => r[c] === v)) store.set(k, { ...r, ...patch });
              }
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
        },
      };
    },
  };
}

beforeEach(() => mockLogEvent.mockClear());

describe('nightly answer-key review flag', () => {
  test('flags the dominant-wrong item, by the web key where the item has one, and nothing else', async () => {
    const writer = fakeWriter();
    const out = await Review.run({ now: NOW, redis: fakeRedis(), reader: fakeReader(), writer: () => writer });
    expect(out.outcome).toBe('ran');
    const flagged = [...writer.store.values()].map((r) => r.question_id).sort();
    expect(flagged).toEqual([Q_WRONG_KEY, Q_WEB_KEY].sort());
    const row = writer.store.get(`${Q_WRONG_KEY}|dominant_wrong_option`);
    expect(row).toMatchObject({
      status: 'open', key_at_flag: 'C', top_wrong_option: 'A', answers_n: 25, top_wrong_n: 16, right_n: 7,
      first_flagged_on: '2026-11-22', last_seen_on: '2026-11-22',
    });
    expect(writer.store.get(`${Q_WEB_KEY}|dominant_wrong_option`)).toMatchObject({ key_at_flag: 'B', top_wrong_option: 'A' });
    expect(mockLogEvent).toHaveBeenCalledWith('quiz_keys.flagged', expect.objectContaining({ n_new: 2, n_total: 2, run_date: '2026-11-22' }));
  });

  test('a second run adds no row; a reviewed row is never flagged again', async () => {
    const writer = fakeWriter();
    await Review.run({ now: NOW, redis: fakeRedis(), reader: fakeReader(), writer: () => writer });
    // A human reviews one item (the key was right: a real misconception).
    writer.store.get(`${Q_WEB_KEY}|dominant_wrong_option`).status = 'key_ok';
    const next = new Date('2026-11-22T21:10:00Z');
    const again = await Review.run({ now: next, redis: fakeRedis(), reader: fakeReader(), writer: () => writer });
    expect(again.outcome).toBe('ran');
    expect(writer.store.size).toBe(2);
    expect(writer.store.get(`${Q_WEB_KEY}|dominant_wrong_option`).status).toBe('key_ok');
    // The verdict and the numbers the reviewer judged stay; only "still seen" moves.
    expect(writer.store.get(`${Q_WEB_KEY}|dominant_wrong_option`)).toMatchObject({ answers_n: 30, top_wrong_n: 21, last_seen_on: '2026-11-23' });
    expect(writer.store.get(`${Q_WRONG_KEY}|dominant_wrong_option`).last_seen_on).toBe('2026-11-23');
    expect(mockLogEvent).toHaveBeenLastCalledWith('quiz_keys.flagged', expect.objectContaining({ n_new: 0, n_total: 2, n_reviewed_skipped: 1 }));
  });

  test('switch off (no app_settings row) reads nothing more and writes nothing', async () => {
    const writer = fakeWriter();
    const reader = fakeReader({ switchValue: null });
    const out = await Review.run({ now: NOW, redis: fakeRedis(), reader, writer: () => writer });
    expect(out).toEqual({ outcome: 'off', reason: 'switch_off' });
    expect(reader.calls.map((c) => c.name)).toEqual(['db_is_replica']);
    expect(writer.store.size).toBe(0);
  });

  test('runs once per Pakistan date and only in its window', async () => {
    const writer = fakeWriter();
    const redis = fakeRedis();
    expect((await Review.run({ now: new Date('2026-11-21T19:00:00Z'), redis, reader: fakeReader(), writer: () => writer })).outcome).toBe('not_due');
    expect((await Review.run({ now: NOW, redis, reader: fakeReader(), writer: () => writer })).outcome).toBe('ran');
    redis.m.delete(Review.TICK_KEY);
    expect((await Review.run({ now: new Date('2026-11-21T21:40:00Z'), redis, reader: fakeReader(), writer: () => writer })).outcome).toBe('done_already');
  });

  test('thresholds come from the switch and the counts call gets them', async () => {
    const writer = fakeWriter();
    const reader = fakeReader({ switchValue: { at: '02:00', min_answers: 30, min_share: 0.7, recent_days: 60 } });
    await Review.run({ now: NOW, redis: fakeRedis(), reader, writer: () => writer });
    expect(reader.calls.find((c) => c.name === 'quiz_key_answer_counts').args).toEqual({ p_min_answers: 30, p_recent_days: 60 });
    expect([...writer.store.values()].map((r) => r.question_id)).toEqual([Q_WEB_KEY]);
  });

  test('heldQuestionIds names open and key_wrong rows, not reviewed-ok ones', async () => {
    const writer = fakeWriter();
    await Review.run({ now: NOW, redis: fakeRedis(), reader: fakeReader(), writer: () => writer });
    writer.store.get(`${Q_WEB_KEY}|dominant_wrong_option`).status = 'key_ok';
    const held = await Review.heldQuestionIds(writer, [Q_WRONG_KEY, Q_WEB_KEY, Q_FINE]);
    expect([...held]).toEqual([Q_WRONG_KEY]);
  });

  // Production, 23 Nov: quiz_key_answer_counts(20, 47) has 6,739 rows and one GET came back with exactly 1,000, no error.
  test('reads every count row past the server\'s 1,000-row cap, and logs the true number scanned', async () => {
    const writer = fakeWriter();
    const out = await Review.run({ now: NOW, redis: fakeRedis(), reader: fakeReader({ rows: manyRows(2345) }), writer: () => writer });
    expect(out.outcome).toBe('ran');
    expect([...writer.store.values()].map((r) => r.question_id)).toEqual([Q_WRONG_KEY_LATE]);
    expect(mockLogEvent).toHaveBeenCalledWith('quiz_keys.flagged', expect.objectContaining({ scanned: 2346, n_new: 1 }));
  });

  test('a server cap below the page size still reads every row', async () => {
    const writer = fakeWriter();
    const out = await Review.run({ now: NOW, redis: fakeRedis(), reader: fakeReader({ rows: manyRows(1000), maxRows: 400 }), writer: () => writer });
    expect(out).toMatchObject({ outcome: 'ran', scanned: 1001, n_new: 1 });
  });

  test('a server that ignores the paging stops the run with an error and writes nothing, never loops', async () => {
    const writer = fakeWriter();
    const out = await Review.run({ now: NOW, redis: fakeRedis(), reader: fakeReader({ rows: manyRows(2345), ignorePaging: true }), writer: () => writer });
    expect(out).toEqual({ outcome: 'error' });
    expect(writer.store.size).toBe(0);
  });
});
