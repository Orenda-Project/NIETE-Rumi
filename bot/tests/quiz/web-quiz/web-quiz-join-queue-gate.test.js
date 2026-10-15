'use strict';
/**
 * The teacher join queue's serve gate: the queue serves the roster_unique_with_loose tier only, every decision
 * records the tier it was made on (merge_log.tier), and a tier whose Wilson 95% lower bound falls under 0.85 once it
 * has 50 decisions is held automatically. Supabase (an in-memory table set that applies filters) is the faked
 * boundary; the module under test runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true), isAvailable: () => true,
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const crypto = require('crypto');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logToFile } = require('../../../shared/utils/logger');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Queue = require('../../../shared/services/quiz/web-quiz-join-queue');

const T1 = '10000000-0000-4000-8000-000000000001';
const T2 = '10000000-0000-4000-8000-000000000002';
const C1 = 'c0000000-0000-4000-8000-000000000001';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const SC1 = '30000000-0000-4000-8000-000000000001';
const Q1 = '20000000-0000-4000-8000-000000000001';
const r = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const c = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = (n) => `92000000${String(600 + n).padStart(4, '0')}`;
const RUL = 'roster_unique_with_loose';

const ON = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }];
const roster = (id, name) => ({ id, list_id: L1, student_name: name, student_name_urdu: null, status: 'active', is_active: true, merged_into: null });
const loose = (id, name, extra = {}) => ({ id, list_id: null, student_name: name, status: 'active', is_active: true, merged_into: null, enrolled_by_user_id: T1, self_reported_class: '3', phone: null, ...extra });
const sess = (id, student, extra = {}) => ({ id, student_id: student, quiz_id: Q1, share_code_id: SC1, parent_phone: null, device_ref: null, ...extra });

/** Earlier queue decisions on one tier (other teachers' pairs), as merge_log rows. */
function decisions(tier, { same = 0, no = 0, undo = 0, source = 'queue' } = {}) {
  const out = [];
  const add = (decision, k) => { for (let i = 0; i < k; i += 1) out.push({ id: out.length + 1000, loose_id: crypto.randomUUID(), candidate_id: crypto.randomUUID(), teacher_id: T2, decision, source, tier, decided_at: '2026-10-15T10:00:00Z' }); };
  add('same', same); add('no', no); add('undo', undo);
  return out;
}

let fake;
function seed(over = {}) {
  fake = makeFake({
    app_settings: ON.map((x) => ({ ...x })),
    classes: [{ id: C1, grade_code: '3', is_active: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }],
    student_lists: [{ id: L1, user_id: T1, class_name: 'Class 3', class_id: C1, is_active: true }],
    class_enrollments: [5, 6].map((n) => ({ class_id: C1, student_id: r(n), is_active: true })),
    students: [
      roster(r(5), 'Hamza Testwala'),
      roster(r(6), 'Omar Testwala'),
      loose(c(3), 'Omar Testwala'),                    // roster-unique, another loose Omar on another device → roster_unique_with_loose
      loose(c(33), 'Omar  Testwala'),                  // that other loose Omar: a page child on another device
      loose(c(7), 'Hamza'),                            // every typed word in one roster name → probable
    ],
    quiz_sessions: [
      sess('s3', c(3), { parent_phone: P(3), device_ref: 'dev-3' }),
      sess('s33', c(33), { device_ref: 'dev-9' }),
      sess('s7', c(7), { parent_phone: P(7) }),
    ],
    quiz_share_codes: [{ id: SC1, teacher_user_id: T1, class_id: null }],
    quizzes: [{ id: Q1, teacher_id: T1, list_id: null }],
    merge_log: [],
    ...over,
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdFlags._resetCache();
  HubFlags._resetCache();
  if (Queue._resetPrecisionCache) Queue._resetPrecisionCache();
  return fake;
}
const writes = () => fake.calls.filter((x) => x.op !== 'select');
const tierOf = (out, tier) => out.find((x) => x.tier === tier);

beforeEach(() => { jest.clearAllMocks(); seed(); });

describe('bounded labelling mode: the served tier', () => {
  test('(a) switch on → candidatesFor serves the roster_unique_with_loose row and no probable row', async () => {
    expect(Queue.TIERS_SERVED).toEqual([RUL]);
    const rows = await Queue.candidatesFor(T1);
    expect(rows.map((x) => [x.loose_id, x.candidate_id, x.evidence.tier])).toEqual([[c(3), r(6), RUL]]);
    expect(rows.some((x) => x.evidence.tier === 'probable')).toBe(false);
  });

  test('(b) decide writes the shown pair\'s tier on merge_log; the undo carries the tier of the "same" it reverses', async () => {
    Queue._serveForTest([RUL]);
    try {
      expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'same' })).toEqual({ ok: true, decision: 'same' });
      expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'undo' })).toEqual({ ok: true, decision: 'undo' });
      expect(await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'no' })).toEqual({ ok: true, decision: 'no' });
      expect(fake.db.merge_log.map((m) => [m.decision, m.loose_id, m.tier])).toEqual([
        ['same', c(3), RUL], ['undo', c(3), RUL], ['no', c(7), 'probable'],
      ]);
    } finally { Queue._serveForTest(null); }
  });
});

describe('the per-tier auto-hold (n >= 50 and Wilson 95% lower bound < 0.85)', () => {
  test('(c) 50 decisions with 10 "no" (precision 0.80) → held, the queue is empty', async () => {
    seed({ merge_log: decisions(RUL, { same: 40, no: 10 }) });
    const out = await Queue.precisionByTier();
    expect(out[0].tier).toBe(RUL);
    expect(out[0]).toMatchObject({ n: 50, same: 40, no: 10, undo: 0, precision: 0.8, held: true });
    expect(out[0].wilson_lower_95).toBeCloseTo(0.6696, 3);
    expect(await Queue.candidatesFor(T1)).toEqual([]);
    expect(writes()).toEqual([]);
  });

  test('(d) 49 decisions at the same ratio → not held (too few to judge), the tier is served', async () => {
    seed({ merge_log: decisions(RUL, { same: 39, no: 10 }) });
    const t = tierOf(await Queue.precisionByTier(), RUL);
    expect(t).toMatchObject({ n: 49, held: false });
    expect(t.wilson_lower_95).toBeLessThan(0.85);
    expect((await Queue.candidatesFor(T1)).map((x) => x.loose_id)).toEqual([c(3)]);
  });

  test('(e) 50 decisions with 2 "no" → lower bound >= 0.85, served', async () => {
    seed({ merge_log: decisions(RUL, { same: 48, no: 2 }) });
    const t = tierOf(await Queue.precisionByTier(), RUL);
    expect(t).toMatchObject({ n: 50, precision: 0.96, held: false });
    expect(t.wilson_lower_95).toBeGreaterThanOrEqual(0.85);
    expect((await Queue.candidatesFor(T1)).map((x) => x.loose_id)).toEqual([c(3)]);
  });

  test('(f) an "undo" reverses one "same" in the counts; class_tab and untiered rows are not counted', async () => {
    seed({ merge_log: [
      ...decisions(RUL, { same: 49, no: 1, undo: 1 }),
      ...decisions(RUL, { same: 5, source: 'class_tab' }),
      ...decisions(null, { same: 5 }),
    ] });
    const t = tierOf(await Queue.precisionByTier(), RUL);
    expect(t).toMatchObject({ tier: RUL, n: 49, same: 49, no: 1, undo: 1, held: false });
    expect(t.precision).toBeCloseTo(48 / 49, 4);
    expect(tierOf(await Queue.precisionByTier(), 'probable')).toEqual({
      tier: 'probable', n: 0, same: 0, no: 0, undo: 0, precision: null, wilson_lower_95: null, held: false,
    });
  });

  test('(g) a failing merge_log read holds every tier (fail closed), logs once and never throws', async () => {
    const from = fake.from;
    supabase.from = (t) => { if (t === 'merge_log') throw new Error('down'); return from(t); };
    const out = await Queue.precisionByTier();
    expect(out.map((x) => [x.tier, x.held, x.error])).toEqual([[RUL, true, true], ['probable', true, true]]);
    expect(logToFile.mock.calls.filter((x) => /precision/.test(x[0]))).toHaveLength(1);
    await expect(Queue.candidatesFor(T1)).resolves.toEqual([]);
    Queue._serveForTest([RUL]);
    try {
      expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'same' })).toMatchObject({ ok: false });
    } finally { Queue._serveForTest(null); }
    expect(writes()).toEqual([]);
  });

  test('a held tier cannot be written either: "same" on its pair is refused with not_served', async () => {
    seed({ merge_log: decisions(RUL, { same: 40, no: 10 }) });
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'same' })).toEqual({ ok: false, reason: 'not_served' });
    expect(writes()).toEqual([]);
  });

  test('the precision read is cached for 60 s in-process', async () => {
    await Queue.precisionByTier();
    const n = fake.calls.filter((x) => x.table === 'merge_log').length;
    await Queue.precisionByTier();
    expect(fake.calls.filter((x) => x.table === 'merge_log').length).toBe(n);
  });
});

describe('golden: the switch off', () => {
  test('(h) candidatesFor → [], decide → {off:true}; only app_settings is read, nothing is written', async () => {
    seed({ app_settings: [{ key: 'web_quiz_hub', value: true }], merge_log: decisions(RUL, { same: 48, no: 2 }) });
    expect(await Queue.candidatesFor(T1)).toEqual([]);
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'same' })).toEqual({ off: true });
    expect([...new Set(fake.calls.map((x) => x.table))]).toEqual(['app_settings']);
    expect(writes()).toEqual([]);
  });
});
