'use strict';
/**
 * The nightly answer-key review says where its suspects come from: `by_source` in the quiz_keys.flagged summary.
 *
 * n_total and n_new alone cannot tell a generation leak (a lesson or recording quiz whose key children keep rejecting)
 * from an old bank item. So the summary gains, per source, the count among n_total and among n_new:
 *   transcript (quizzes.quiz_source 'transcript'), lp ('lp_v8', 'lp612', 'lesson_plan'), bank (the item's external_id
 *   starts 'gen:' or 'leg:', whatever its quiz), story ('story'), other (anything else, or an item the read did not find).
 * The source is read for the suspects only, in ONE extra replica read (quiz_questions → quizzes.quiz_source); the
 * counts function and the migration are untouched. A failed read leaves by_source null and the run still succeeds.
 *
 * run() → tick() as in production; the replica reader, the primary writer and Redis are the faked boundaries.
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

// 02:10 PKT on 23 Nov 2026 = 21:10Z on 22 Nov.
const NOW = new Date('2026-11-22T21:10:00Z');
const id = (n) => `00000000-0000-4000-8000-0000000b00${String(n).padStart(2, '0')}`;
const ITEMS = [
  { qid: id(1), external_id: `tq:q1:S1:1`, quiz_source: 'transcript' },
  { qid: id(2), external_id: `tq:q2:S1:1`, quiz_source: 'lp_v8' },
  { qid: id(3), external_id: `tq:q3:S1:2`, quiz_source: 'lp612' },
  { qid: id(4), external_id: 'gen:Grade3_Science_Plants:4', quiz_source: 'video' },
  { qid: id(5), external_id: 'leg:Grade5_Maths_Fractions:8', quiz_source: 'video' },
  { qid: id(6), external_id: 'st:book7:p3', quiz_source: 'story' },
  { qid: id(7), external_id: null, quiz_source: 'video' },
];
// Every item is a suspect: 25 answers, 16 on wrong option A, key C.
const countsRow = (it) => ({ question_id: it.qid, correct_option: 'C', option_a: 'x', option_b: 'y', option_c: 'z', option_d: null, media: {}, counts: { A: 16, C: 9 }, answers_n: 25 });

function fakeRedis() {
  const m = new Map();
  return {
    async setNX(k, v) { if (!m.has(k)) m.set(k, v); return true; },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async set(k, v) { m.set(k, v); return true; },
  };
}

function fakeReader({ items = ITEMS, sourceError = null } = {}) {
  const reads = [];
  return {
    reads,
    async rpc(name) {
      if (name === 'db_is_replica') return { data: true, error: null };
      if (name === 'quiz_key_answer_counts') return { data: items.map(countsRow), error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table) {
      if (table === 'app_settings') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: { value: { at: '02:00' } }, error: null }; },
        };
      }
      if (table !== 'quiz_questions') throw new Error(`reader touched ${table}`);
      const q = { table, select: null, ids: null };
      reads.push(q);
      return {
        select(cols) { q.select = cols; return this; },
        async in(col, ids) {
          q.ids = ids;
          if (sourceError) return { data: null, error: sourceError };
          const rows = ITEMS.filter((it) => col === 'id' && ids.includes(it.qid))
            .map((it) => ({ id: it.qid, external_id: it.external_id, quizzes: { quiz_source: it.quiz_source } }));
          return { data: rows, error: null };
        },
      };
    },
  };
}

function fakeWriter(seed = []) {
  const store = new Map(seed.map((r) => [`${r.question_id}|${r.reason}`, r]));
  return {
    store,
    from(table) {
      if (table !== 'quiz_item_reviews') throw new Error(`writer touched ${table}`);
      return {
        select() { return this; },
        eq() { return this; },
        async in(_c, ids) { return { data: [...store.values()].filter((r) => ids.includes(r.question_id)).map((r) => ({ ...r })), error: null }; },
        async insert(rs) { rs.forEach((r) => store.set(`${r.question_id}|${r.reason}`, { status: 'open', ...r })); return { error: null }; },
        update() { return { eq() { return this; }, then: (res) => Promise.resolve({ error: null }).then(res) }; },
      };
    },
  };
}

const flagged = () => (mockLogEvent.mock.calls.find((c) => c[0] === 'quiz_keys.flagged') || [])[1];
beforeEach(() => mockLogEvent.mockClear());

test('by_source counts every suspect by its quiz\'s source, for n_total and for n_new, in one extra replica read', async () => {
  // item 2 (lp_v8) is already on the queue, open: counted in n_total, not in n_new
  const writer = fakeWriter([{ question_id: id(2), reason: 'dominant_wrong_option', status: 'open' }]);
  const reader = fakeReader();
  const out = await Review.run({ now: NOW, redis: fakeRedis(), reader, writer: () => writer });
  expect(out).toEqual(expect.objectContaining({ outcome: 'ran', n_total: 7, n_new: 6 }));
  expect(out.by_source).toEqual({
    transcript: { n_total: 1, n_new: 1 },
    lp: { n_total: 2, n_new: 1 },
    bank: { n_total: 2, n_new: 2 },
    story: { n_total: 1, n_new: 1 },
    other: { n_total: 1, n_new: 1 },
  });
  expect(flagged()).toEqual(expect.objectContaining({ by_source: out.by_source }));
  // one read, for the suspects only, along the quiz_id foreign key
  expect(reader.reads).toHaveLength(1);
  expect(reader.reads[0].select).toMatch(/external_id/);
  expect(reader.reads[0].select).toMatch(/quizzes\(quiz_source\)/);
  expect([...reader.reads[0].ids].sort()).toEqual(ITEMS.map((it) => it.qid).sort());
});

test('a failed source read leaves by_source null and the run still succeeds, the queue written', async () => {
  const writer = fakeWriter();
  const out = await Review.run({ now: NOW, redis: fakeRedis(), reader: fakeReader({ sourceError: { message: 'statement timeout' } }), writer: () => writer });
  expect(out).toEqual(expect.objectContaining({ outcome: 'ran', n_total: 7, n_new: 7 }));
  expect(out).toHaveProperty('by_source', null);
  expect(writer.store.size).toBe(7);
  expect(flagged()).toEqual(expect.objectContaining({ by_source: null, n_new: 7 }));
});

test('no suspect: by_source is all zeros and nothing extra is read', async () => {
  const reader = fakeReader({ items: [] });
  const out = await Review.run({ now: NOW, redis: fakeRedis(), reader, writer: () => fakeWriter() });
  expect(out.outcome).toBe('ran');
  const zero = { n_total: 0, n_new: 0 };
  expect(out.by_source).toEqual({ transcript: zero, lp: zero, bank: zero, story: zero, other: zero });
  expect(reader.reads).toHaveLength(0);
});
