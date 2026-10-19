'use strict';
/**
 * The teacher join queue (switch web_quiz_identity_canon): who enters the teacher's "same child?" queue, what one
 * tap writes, the "link this class's quiz codes" tap, and the strict backward join as a job function. Supabase (an
 * in-memory table set that applies filters) is the faked boundary; the module under test and the routes run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true), isAvailable: () => true,
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// the event-key module (web-quiz-kid.js) is real now: mock it NON-virtually, so id_confirmed can be checked for its kid.
// A virtual mock registers under the extension-less path while Jest's resolver caches module ids per worker across test
// files; a file that loaded the real `./web-quiz-kid` edge earlier in the same worker made this mock miss (kid_key_missing).
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({ kidOf: (id) => (id ? `k_${String(id).slice(-2)}` : null) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Queue = require('../../../shared/services/quiz/web-quiz-join-queue');

const T1 = '10000000-0000-4000-8000-000000000001';
const T2 = '10000000-0000-4000-8000-000000000002';
const C1 = 'c0000000-0000-4000-8000-000000000001';
const C2 = 'c0000000-0000-4000-8000-000000000002';
const C9 = 'c0000000-0000-4000-8000-000000000009';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const L2 = 'a0000000-0000-4000-8000-000000000002';
const SC1 = '30000000-0000-4000-8000-000000000001';
const SC2 = '30000000-0000-4000-8000-000000000002';
const SC3 = '30000000-0000-4000-8000-000000000003';
const Q1 = '20000000-0000-4000-8000-000000000001';
const r = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const c = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const P = (n) => `92000000${String(600 + n).padStart(4, '0')}`;

const ON = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true }];
const roster = (id, name, list, extra = {}) => ({ id, list_id: list, student_name: name, student_name_urdu: null, status: 'active', is_active: true, merged_into: null, ...extra });
const loose = (id, name, extra = {}) => ({ id, list_id: null, student_name: name, status: 'active', is_active: true, merged_into: null, enrolled_by_user_id: T1, self_reported_class: '3', phone: null, ...extra });
const sess = (id, student, extra = {}) => ({ id, student_id: student, quiz_id: Q1, share_code_id: SC1, parent_phone: null, device_ref: null, user_id: null, ...extra });

let fake;
function seed(over = {}) {
  const db = {
    app_settings: ON.map((x) => ({ ...x })),
    classes: [{ id: C1, grade_code: '3', is_active: true }, { id: C2, grade_code: '4', is_active: true }, { id: C9, grade_code: '3', is_active: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }, { class_id: C2, teacher_user_id: T2, is_active: true }],
    student_lists: [{ id: L1, user_id: T1, class_name: 'Class 3', class_id: C1, is_active: true }, { id: L2, user_id: T2, class_name: 'Class 4', class_id: C2, is_active: true }],
    class_enrollments: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ class_id: C1, student_id: r(n), is_active: true })),
    students: [
      roster(r(1), 'Ali Testwala', L1, { parent_phone: P(1) }),
      roster(r(2), 'Sara Testwala', L1),
      roster(r(3), 'Zainab Testwala', L1),
      roster(r(4), 'Zainab Testwala', L1),
      roster(r(5), 'Hamza Testwala', L1),
      roster(r(6), 'Omar Testwala', L1),
      roster(r(7), 'Huda Testwala', L1),
      roster(r(9), 'Bilal Testwala', L2),
      loose(c(1), 'ali testwala', { phone: P(1) }),       // phone + name → joined (phone_name)
      loose(c(2), 'Sara Testwala'),                       // roster-unique exact name, same grade → joined (strict)
      loose(c(3), 'Omar Testwala'),                       // roster-unique, but another loose Omar on another device → blocked
      loose(c(33), 'Omar  Testwala', { phone: null }),    // that other loose Omar: a page child on another device
      loose(c(4), 'Zainab Testwala'),                     // two roster Zainabs → ambiguous
      loose(c(5), 'Yusuf Testwala'),                      // no roster name → none
      loose(c(6), 'Danish'),                              // a sibling on Ali's family phone → not joined
      loose(c(7), 'Hamza'),                               // every typed word in one roster name → probable (queue only)
      loose(c(8), 'Huda Testwala', { self_reported_class: '5' }), // the name is there, the grade is not → none
      loose(c(9), 'Bilal Testwala', { enrolled_by_user_id: T2 }),
    ],
    quiz_sessions: [
      sess('s1', c(1), { parent_phone: P(1), device_ref: 'dev-1' }),
      sess('s2', c(2), { parent_phone: P(2), device_ref: 'dev-2' }),
      sess('s3', c(3), { parent_phone: P(3), device_ref: 'dev-3' }),
      sess('s33', c(33), { device_ref: 'dev-9' }),
      sess('s4', c(4), { parent_phone: P(4) }),
      sess('s5', c(5), { parent_phone: P(5) }),
      sess('s6', c(6), { parent_phone: P(1) }),
      sess('s7', c(7), { parent_phone: P(7) }),
      sess('s8', c(8), { parent_phone: P(8) }),
      sess('s9', c(9), { parent_phone: P(9), share_code_id: SC3 }),
    ],
    quiz_share_codes: [
      { id: SC1, teacher_user_id: T1, class_id: null },
      { id: SC2, teacher_user_id: T1, class_id: C9 },
      { id: SC3, teacher_user_id: T2, class_id: null },
    ],
    quizzes: [{ id: Q1, teacher_id: T1, list_id: null }],
    merge_log: [],
    ...over,
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdFlags._resetCache();
  HubFlags._resetCache();
  Queue._resetPrecisionCache();
  return fake;
}
const writes = () => fake.calls.filter((x) => x.op !== 'select');
const student = (id) => fake.db.students.find((s) => s.id === id);

beforeEach(() => { jest.clearAllMocks(); seed(); });

describe('the queue rows (Mock M4)', () => {
  test('the two tiers for one teacher: the §11-blocked exact name and the probable word match', async () => {
    const rows = await Queue.computeCandidates(T1);
    expect(rows).toEqual([
      { loose_id: c(3), candidate_id: r(6), first: 'Omar', candidate_first: 'Omar', father_first: null, candidate_father_first: null, class_id: C1, grade: 3,
        evidence: { tier: 'roster_unique_with_loose', name_words_matched: 2, same_grade: true, other_same_name_loose: true } },
      { loose_id: c(7), candidate_id: r(5), first: 'Hamza', candidate_first: 'Hamza', father_first: null, candidate_father_first: null, class_id: C1, grade: 3,
        evidence: { tier: 'probable', name_words_matched: 1, same_grade: true, other_same_name_loose: false } },
    ]);
  });

  test('§11 blocker: the same Omar on the SAME device is no blocker — the pair is a strict join, not a queue row', async () => {
    fake.db.quiz_sessions.find((s) => s.id === 's33').device_ref = 'dev-3';
    const rows = await Queue.computeCandidates(T1);
    expect(rows.map((x) => x.loose_id)).not.toContain(c(3));
  });

  test('the row carries the father\'s FIRST name on both sides for the teacher view (null when the record has none; never a surname)', async () => {
    // the roster Omar has a father on file; the loose Omar typed one too; the probable pair (Hamza) has none
    fake.db.students.find((x) => x.id === r(6)).father_name = 'Khalid Testwala';
    fake.db.students.find((x) => x.id === c(3)).father_name = 'Khalid';
    const rows = await Queue.computeCandidates(T1);
    const omar = rows.find((x) => x.loose_id === c(3));
    expect(omar).toMatchObject({ father_first: 'Khalid', candidate_father_first: 'Khalid' });
    expect(JSON.stringify(omar)).not.toContain('Testwala');
    const hamza = rows.find((x) => x.loose_id === c(7));
    expect(hamza).toMatchObject({ father_first: null, candidate_father_first: null });
  });

  test('first names only: no surname, phone or device in any row', async () => {
    const out = JSON.stringify(await Queue.computeCandidates(T1));
    expect(out).not.toMatch(/Testwala|dev-|92000000/);
  });

  test('another teacher sees only their own loose children and roster', async () => {
    expect(await Queue.computeCandidates(T2)).toEqual([]);
  });

  test('a pair decided "no" leaves the queue; a later "undo" re-admits it', async () => {
    fake.db.merge_log.push({ id: 1, loose_id: c(7), candidate_id: r(5), teacher_id: T1, decision: 'no', source: 'queue', decided_at: '2026-10-15T10:00:00Z' });
    expect((await Queue.computeCandidates(T1)).map((x) => x.loose_id)).toEqual([c(3)]);
    fake.db.merge_log.push({ id: 2, loose_id: c(7), candidate_id: r(5), teacher_id: T1, decision: 'undo', source: 'queue', decided_at: '2026-10-15T11:00:00Z' });
    expect((await Queue.computeCandidates(T1)).map((x) => x.loose_id)).toEqual([c(3), c(7)]);
  });

  test('the gate: only roster_unique_with_loose is served (bounded labelling mode); probable is held out', async () => {
    expect(Queue.TIERS_SERVED).toEqual(['roster_unique_with_loose']);
    expect((await Queue.candidatesFor(T1)).map((x) => [x.loose_id, x.evidence.tier])).toEqual([[c(3), 'roster_unique_with_loose']]);
    expect(Queue.serveTiers(await Queue.computeCandidates(T1), ['probable']).map((x) => x.evidence.tier)).toEqual(['probable']);
  });
});

describe('decide: only a tap writes', () => {
  // These taps are on pairs of both tiers, so both are served here; the gate itself is tested below.
  beforeEach(() => { Queue._serveForTest(Queue.TIERS); });
  afterEach(() => { Queue._serveForTest(null); });

  test('"same" merges the loose row, logs the decision and emits id_confirmed{by:merged, w:s}', async () => {
    const out = await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'same' });
    expect(out).toEqual({ ok: true, decision: 'same' });
    expect(student(c(7))).toMatchObject({ merged_into: r(5), status: 'merged', is_active: false });
    expect(fake.db.merge_log).toEqual([expect.objectContaining({ loose_id: c(7), candidate_id: r(5), teacher_id: T1, decision: 'same', source: 'queue' })]);
    // the surviving canonical id, keyed through the event-key module (never the raw id)
    expect(logEvent).toHaveBeenCalledWith('web_quiz.id_confirmed', { w: 's', by: 'merged', kid: `k_${r(5).slice(-2)}` });
    expect(JSON.stringify(logEvent.mock.calls)).not.toMatch(/src|device_ref|920000/);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(r(5));
  });

  test('a candidate on ANOTHER teacher\'s roster is refused and nothing is written', async () => {
    const out = await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(9), decision: 'same' });
    expect(out).toEqual({ ok: false, reason: 'not_your_roster' });
    expect(writes()).toEqual([]);
    expect(student(c(7))).toMatchObject({ merged_into: null, status: 'active' });
  });

  test('a loose row that is no longer loose is not merged twice and logs nothing', async () => {
    Object.assign(student(c(7)), { status: 'merged', merged_into: r(2), is_active: false });
    const out = await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'same' });
    // a merged row is no longer in the served queue, so the tap stops there (the update's own loose guard is second)
    expect(out).toEqual({ ok: false, reason: 'not_served' });
    expect(fake.db.merge_log).toEqual([]);
    expect(student(c(7)).merged_into).toBe(r(2));
  });

  test('"no" only logs; "undo" after "same" clears merged_into and logs undo', async () => {
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'no' })).toEqual({ ok: true, decision: 'no' });
    expect(student(c(3))).toMatchObject({ merged_into: null, status: 'active' });
    await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'same' });
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'undo' })).toEqual({ ok: true, decision: 'undo' });
    expect(student(c(7))).toMatchObject({ merged_into: null, status: 'active', is_active: true });
    expect(fake.db.merge_log.map((m) => m.decision)).toEqual(['no', 'same', 'undo']);
  });

  test('"undo" with no "same" of this teacher for the pair writes nothing', async () => {
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'undo' })).toEqual({ ok: false, reason: 'nothing_to_undo' });
    expect(writes()).toEqual([]);
  });

  test('a double submit (303 and refresh) writes once: "same" twice → one merge_log row, one merged_into', async () => {
    const tap = () => Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'same' });
    expect(await tap()).toEqual({ ok: true, decision: 'same' });
    expect(await tap()).toEqual({ ok: true, decision: 'same', already: true });
    expect(fake.db.merge_log).toHaveLength(1);
    expect(fake.calls.filter((x) => x.table === 'students' && x.op === 'update')).toHaveLength(1);
    expect(logEvent.mock.calls.filter((x) => x[0] === 'web_quiz.id_confirmed')).toHaveLength(1);
  });

  test('"no" twice and "undo" twice each write one row', async () => {
    const tap = (decision, loose = c(3), cand = r(6)) => Queue.decide({ teacherUserId: T1, looseId: loose, candidateId: cand, decision });
    await tap('no');
    expect(await tap('no')).toEqual({ ok: true, decision: 'no', already: true });
    await tap('same', c(7), r(5));
    await tap('undo', c(7), r(5));
    expect(await tap('undo', c(7), r(5))).toEqual({ ok: true, decision: 'undo', already: true });
    expect(fake.db.merge_log.map((m) => m.decision)).toEqual(['no', 'same', 'undo']);
  });

  test('a bad decision or missing id writes nothing', async () => {
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'maybe' })).toEqual({ ok: false, reason: 'bad_request' });
    expect(await Queue.decide({ looseId: c(7), candidateId: r(5), decision: 'same' })).toEqual({ ok: false, reason: 'bad_request' });
    expect(writes()).toEqual([]);
  });

  test('computing the queue writes nothing', async () => {
    await Queue.computeCandidates(T1);
    expect(writes()).toEqual([]);
  });
});

describe('decide("same") only for a served pair', () => {
  afterEach(() => { Queue._serveForTest(null); });
  test('a pair of the held-out tier (probable): "same" on a valid pair is refused and nothing is written', async () => {
    expect(Queue.TIERS_SERVED).not.toContain('probable');
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'same' })).toEqual({ ok: false, reason: 'not_served' });
    expect(writes()).toEqual([]);
    expect(student(c(7))).toMatchObject({ merged_into: null, status: 'active' });
  });
  test('with the tier served, "same" merges as before; a pair of a tier still held out is refused', async () => {
    Queue._serveForTest(['probable']);
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'same' })).toEqual({ ok: false, reason: 'not_served' });
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'same' })).toEqual({ ok: true, decision: 'same' });
    expect(student(c(7))).toMatchObject({ merged_into: r(5), status: 'merged' });
  });
  test('"no" and "undo" keep their checks on a pair of a held-out tier', async () => {
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(3), candidateId: r(6), decision: 'no' })).toEqual({ ok: true, decision: 'no' });
    Object.assign(student(c(7)), { status: 'merged', merged_into: r(5), is_active: false });
    fake.db.merge_log.push({ id: 9, loose_id: c(7), candidate_id: r(5), teacher_id: T1, decision: 'same', source: 'queue', decided_at: '2026-10-15T09:00:00Z' });
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'undo' })).toEqual({ ok: true, decision: 'undo' });
  });
});

describe('link this class\'s quiz codes', () => {
  test('links only this teacher\'s unbound codes to their own class; a second call links 0', async () => {
    expect(await Queue.linkClassCodes({ teacherUserId: T1, classId: C1 })).toEqual({ linked: 1 });
    expect(fake.db.quiz_share_codes.map((x) => x.class_id)).toEqual([C1, C9, null]);
    expect(await Queue.linkClassCodes({ teacherUserId: T1, classId: C1 })).toEqual({ linked: 0 });
  });
  test('a class that is not the teacher\'s is refused and nothing is written', async () => {
    expect(await Queue.linkClassCodes({ teacherUserId: T1, classId: C2 })).toEqual({ linked: 0, reason: 'not_your_class' });
    expect(writes()).toEqual([]);
  });
});

describe('the strict backward join (a job function)', () => {
  const EXPECTED = {
    [c(1)]: 'phone_name', [c(2)]: 'strict', [c(3)]: 'blocked', [c(4)]: 'ambiguous',
    [c(5)]: 'none', [c(6)]: 'sibling_phone', [c(7)]: 'none', [c(8)]: 'grade_mismatch', [c(9)]: 'grade_mismatch',
  };
  test('dryRun (the default) labels every chat child exactly and writes nothing', async () => {
    const out = await Queue.runBackwardJoin();
    expect(out.dryRun).toBe(true);
    expect(out.labels).toEqual(EXPECTED);
    expect(out.counts).toEqual({ phone_name: 1, strict: 1, blocked: 1, ambiguous: 1, none: 2, sibling_phone: 1, grade_mismatch: 2, refused_by_teacher: 0, joined: 2 });
    expect(writes()).toEqual([]);
  });
  test('a same-name loose record on another device blocks the join; on the same device it does not', async () => {
    fake.db.quiz_sessions.find((s) => s.id === 's33').device_ref = 'dev-3';
    expect((await Queue.runBackwardJoin()).labels[c(3)]).toBe('strict');
  });
  test('dryRun:false writes merged_into and a merge_log row for each join, and only those', async () => {
    const out = await Queue.runBackwardJoin({ dryRun: false });
    expect(out.counts.joined).toBe(2);
    expect(student(c(1))).toMatchObject({ merged_into: r(1), status: 'merged', is_active: false });
    expect(student(c(2))).toMatchObject({ merged_into: r(2), status: 'merged', is_active: false });
    expect(fake.db.students.filter((s) => s.merged_into).map((s) => s.id).sort()).toEqual([c(1), c(2)]);
    expect(fake.db.merge_log.map((m) => [m.loose_id, m.candidate_id, m.teacher_id, m.decision, m.source]))
      .toEqual([[c(1), r(1), T1, 'same', 'job'], [c(2), r(2), T1, 'same', 'job']]);   // a job never wears a tap's label
    expect(fake.db.merge_log.every((m) => m.tier === null)).toBe(true);
    expect(logEvent.mock.calls.filter(([n]) => n === 'web_quiz.id_confirmed').map(([, d]) => d.kid).sort()).toEqual([`k_${r(1).slice(-2)}`, `k_${r(2).slice(-2)}`]);
  });
});

describe('golden: the switch off', () => {
  beforeEach(() => { seed({ app_settings: [{ key: 'web_quiz_hub', value: true }] }); });
  test('candidatesFor → [], decide → {off:true}, links and joins nothing; only app_settings is read', async () => {
    expect(await Queue.candidatesFor(T1)).toEqual([]);
    expect(await Queue.computeCandidates(T1)).toEqual([]);
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'same' })).toEqual({ off: true });
    expect(await Queue.linkClassCodes({ teacherUserId: T1, classId: C1 })).toEqual({ off: true });
    expect(await Queue.runBackwardJoin({ dryRun: false })).toEqual({ off: true });
    expect([...new Set(fake.calls.map((x) => x.table))]).toEqual(['app_settings']);
    expect(writes()).toEqual([]);
  });
  test('never throws: a failing database is an empty queue and a refused tap', async () => {
    seed();
    supabase.from = () => { throw new Error('down'); };
    expect(await Queue.candidatesFor(T1)).toEqual([]);
    expect(await Queue.decide({ teacherUserId: T1, looseId: c(7), candidateId: r(5), decision: 'same' })).toEqual({ off: true });
  });
});

describe('the internal routes', () => {
  const express = require('express');
  let server; let base;
  beforeEach(async () => {
    process.env.INTERNAL_API_KEY = 'test-key';
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((res) => { server = app.listen(0, '127.0.0.1', res); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterEach(async () => { Queue._serveForTest(null); await new Promise((res) => server.close(res)); });
  const H = { 'x-api-key': 'test-key', 'content-type': 'application/json' };
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: H, body: JSON.stringify(body) });

  test('GET /teacher/queue → {rows, tiers_served}', async () => {
    const res = await fetch(`${base}/teacher/queue?teacher=${T1}`, { headers: H });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tiers_served).toEqual(['roster_unique_with_loose']);
    expect(body.rows.map((x) => [x.loose_id, x.candidate_id, x.evidence.tier])).toEqual([[c(3), r(6), 'roster_unique_with_loose']]);
  });
  test('POST /teacher/queue/decide and /teacher/queue/link-codes', async () => {
    let res = await post('/teacher/queue/decide', { teacher: T1, loose_id: c(7), candidate_id: r(5), decision: 'same' });
    expect(await res.json()).toEqual({ ok: false, reason: 'not_served' });
    Queue._serveForTest(Queue.TIERS);
    res = await post('/teacher/queue/decide', { teacher: T1, loose_id: c(7), candidate_id: r(5), decision: 'same' });
    expect(await res.json()).toEqual({ ok: true, decision: 'same' });
    res = await post('/teacher/queue/link-codes', { teacher: T1, class_id: C1 });
    expect(await res.json()).toEqual({ linked: 1 });
  });
});
