'use strict';
/**
 * The later teacher link for a child who joined on their own (web-quiz-join-queue.js, switch quiz_student_join):
 * when ONE roster child of the teacher has the same first name AND grade AND shares the family phone (or the child
 * played the teacher's code), the teacher-confirm queue asks the teacher once; "Same child" merges through
 * merged_into; nothing merges before the tap; the strict job never touches the row. Switch off: the queue is today's.
 * Real join-queue service; Supabase (in-memory), Redis (a Map) and the loggers are faked. Children are "Testwala".
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Queue = require('../../../shared/services/quiz/web-quiz-join-queue');
const Join = require('../../../shared/services/quiz/web-quiz-student-join');
const { fixturePhone } = require('./fixture-phone');

const T1 = '10000000-0000-4000-8000-000000000001';
const C1 = 'c0000000-0000-4000-8000-000000000001';
const L1 = 'a0000000-0000-4000-8000-000000000001';
const SC1 = '30000000-0000-4000-8000-000000000001';
const Q1 = '20000000-0000-4000-8000-000000000001';
const R_SARA = 'b0000000-0000-4000-8000-000000000005';
const R_HAMZA = 'b0000000-0000-4000-8000-000000000006';
const R_SARA2 = 'b0000000-0000-4000-8000-000000000007';
const S_SARA = 'e0000000-0000-4000-8000-000000000001';
const S_HAMZA = 'e0000000-0000-4000-8000-000000000002';
const FAMILY = fixturePhone(731);
const roster = (id, name, extra = {}) => ({ id, list_id: L1, student_name: name, student_name_urdu: null, father_name: null, phone: null, parent_phone: null, status: 'active', is_active: true, merged_into: null, ...extra });
const selfJoined = (id, name, grade) => ({ id, list_id: null, student_name: name, self_reported_class: `Grade ${grade}`, enrolled_by_user_id: null, phone: null, parent_phone: null, status: 'active', is_active: true, merged_into: null });
const guest = (kid, phone = FAMILY) => ({ id: `g-${kid.slice(-2)}`, canonical_id: kid, phone_norm: phone, phone_tomb: 't', via: 'guest', revoked_at: null, expires_at: '2099-03-31T18:59:59.000Z', bound_at: '2026-10-16T10:00:00Z' });

let fake;
function seed({ join = true, students, bindings, identity, sessions = [] } = {}) {
  const settings = [{ key: 'web_quiz_identity_canon', value: 'true' }, { key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_phone_bind', value: 'true' }];
  if (join) settings.push({ key: 'quiz_student_join', value: 'true' });
  fake = makeFake({
    app_settings: settings,
    users: [{ id: T1, preferred_language: 'en' }],
    classes: [{ id: C1, grade_code: '3', is_active: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }],
    student_lists: [{ id: L1, user_id: T1, class_name: 'Grade 3', section: 'B', class_id: C1, is_active: true }],
    class_enrollments: [],
    students: students || [roster(R_SARA, 'Sara Testwala', { parent_phone: `+${FAMILY}` }), roster(R_HAMZA, 'Hamza Testwala'), selfJoined(S_SARA, 'Sara', 3)],
    child_phone_bindings: bindings || [guest(S_SARA)],
    child_identity: identity || [{ canonical_id: S_SARA, year_code: '2026-27', fixed_grade: 3, grade_source: 'tapped' }],
    quizzes: [{ id: Q1, teacher_id: T1 }],
    quiz_share_codes: [{ id: SC1, code: 'AB12CD', quiz_id: Q1, teacher_user_id: T1 }],
    quiz_sessions: sessions,
    merge_log: [],
  });
  supabase.from = (t) => { const b = fake.from(t); b.or = () => b; return b; };
  supabase.rpc = fake.rpc;
  IdFlags._resetCache(); HubFlags._resetCache(); Join._resetCache();
  Queue._resetQueueCache(); Queue._resetPrecisionCache();
  redis._store.clear();
}
const writes = (table) => fake.calls.filter((c) => c.table === table && ['insert', 'update', 'delete'].includes(c.op));

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, WQ_TOMB_SALT: 'unit-salt-not-a-secret' }; jest.clearAllMocks(); });
afterAll(() => { process.env = SAVED; });

describe('the self-joined child on the teacher-confirm queue', () => {
  test('ON: same first name + same grade + the family phone on the roster → ONE pair, tier self_join; nothing merged before the tap', async () => {
    seed();
    const rows = (await Queue.computeCandidates(T1)).filter((x) => x.evidence.tier === 'self_join');
    expect(rows).toEqual([expect.objectContaining({ loose_id: S_SARA, candidate_id: R_SARA, first: 'Sara', candidate_first: 'Sara', grade: 3,
      evidence: expect.objectContaining({ tier: 'self_join', via: 'phone', same_grade: true }) })]);
    expect((await Queue.candidatesFor(T1)).map((x) => x.loose_id)).toContain(S_SARA);
    expect(writes('students')).toHaveLength(0);
    expect(writes('merge_log')).toHaveLength(0);
  });

  test('ON: "Same child" merges through merged_into (merge_log tier NULL, source queue); "Undo" restores', async () => {
    seed();
    await Queue.candidatesFor(T1);
    expect(await Queue.decide({ teacherUserId: T1, looseId: S_SARA, candidateId: R_SARA, decision: 'same' })).toEqual({ ok: true, decision: 'same' });
    expect(fake.db.students.find((s) => s.id === S_SARA)).toMatchObject({ merged_into: R_SARA, status: 'merged' });
    expect(fake.db.merge_log).toEqual([expect.objectContaining({ loose_id: S_SARA, candidate_id: R_SARA, decision: 'same', source: 'queue', tier: null })]);
    expect(await Queue.decide({ teacherUserId: T1, looseId: S_SARA, candidateId: R_SARA, decision: 'undo' })).toEqual({ ok: true, decision: 'undo' });
    expect(fake.db.students.find((s) => s.id === S_SARA)).toMatchObject({ merged_into: null, status: 'active' });
  });

  test('ON: the teacher\'s answer on a self-joined pair is its label — join_confirm{tier self_join, same | different | undo}, keyed refs only', async () => {
    const { logEvent } = require('../../../shared/utils/structured-logger');
    const confirms = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.join_confirm').map(([, d]) => d);
    const KEY = 'k'.repeat(32);
    const TK = require('crypto').createHmac('sha256', KEY).update(`t|${T1}`).digest('hex').slice(0, 16);
    const before = process.env.WEB_QUIZ_KID_KEY;
    process.env.WEB_QUIZ_KID_KEY = KEY;
    try {
      seed();
      await Queue.candidatesFor(T1);
      await Queue.decide({ teacherUserId: T1, looseId: S_SARA, candidateId: R_SARA, decision: 'same' });
      await Queue.decide({ teacherUserId: T1, looseId: S_SARA, candidateId: R_SARA, decision: 'undo' });
      seed();
      Queue._resetQueueCache();
      await Queue.candidatesFor(T1);
      await Queue.decide({ teacherUserId: T1, looseId: S_SARA, candidateId: R_SARA, decision: 'no' });
      expect(confirms().map((d) => [d.tier, d.decision, d.tk])).toEqual([['self_join', 'same', TK], ['self_join', 'undo', TK], ['self_join', 'different', TK]]);
      expect(confirms().every((d) => !('teacher' in d))).toBe(true);
      expect(JSON.stringify(confirms())).not.toContain(T1);
      expect(JSON.stringify(confirms())).not.toContain(S_SARA);
      expect(JSON.stringify(confirms())).not.toContain(R_SARA);
      // A key under 32 bytes is no key: tk is null, never an unkeyed hash and never the id.
      process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(31);
      logEvent.mockClear();
      seed();
      Queue._resetQueueCache();
      await Queue.candidatesFor(T1);
      await Queue.decide({ teacherUserId: T1, looseId: S_SARA, candidateId: R_SARA, decision: 'no' });
      expect(confirms().map((d) => [d.decision, d.tk])).toEqual([['different', null]]);
      expect(JSON.stringify(confirms())).not.toContain(T1);
    } finally {
      if (before === undefined) delete process.env.WEB_QUIZ_KID_KEY; else process.env.WEB_QUIZ_KID_KEY = before;
    }
  });

  test('ON: "Different" keeps them apart for good', async () => {
    seed();
    await Queue.candidatesFor(T1);
    expect(await Queue.decide({ teacherUserId: T1, looseId: S_SARA, candidateId: R_SARA, decision: 'no' })).toEqual({ ok: true, decision: 'no' });
    Queue._resetQueueCache();
    expect((await Queue.computeCandidates(T1)).filter((x) => x.loose_id === S_SARA)).toEqual([]);
  });

  test('ON: a different grade, or two roster children of that name on the phone → never asked (never a guess)', async () => {
    seed({ identity: [{ canonical_id: S_SARA, year_code: '2026-27', fixed_grade: 4, grade_source: 'tapped' }] });
    expect((await Queue.computeCandidates(T1)).filter((x) => x.evidence.tier === 'self_join')).toEqual([]);
    seed({ students: [roster(R_SARA, 'Sara Testwala', { parent_phone: `+${FAMILY}` }), roster(R_SARA2, 'Sara Bibi Testwala', { parent_phone: FAMILY }), selfJoined(S_SARA, 'Sara', 3)] });
    expect((await Queue.computeCandidates(T1)).filter((x) => x.evidence.tier === 'self_join')).toEqual([]);
  });

  test('ON: no shared phone, but the self-joined child played this teacher\'s code → asked (via played)', async () => {
    seed({
      students: [roster(R_SARA, 'Sara Testwala'), roster(R_HAMZA, 'Hamza Testwala'), selfJoined(S_HAMZA, 'Hamza', 3)],
      bindings: [guest(S_HAMZA)], identity: [{ canonical_id: S_HAMZA, year_code: '2026-27', fixed_grade: 3, grade_source: 'tapped' }],
      sessions: [{ id: 's1', student_id: S_HAMZA, quiz_id: Q1, share_code_id: SC1, parent_phone: null, device_ref: 'dev-1' }],
    });
    expect((await Queue.computeCandidates(T1)).filter((x) => x.evidence.tier === 'self_join'))
      .toEqual([expect.objectContaining({ loose_id: S_HAMZA, candidate_id: R_HAMZA, evidence: expect.objectContaining({ via: 'played' }) })]);
  });

  test('OFF: the self-joined child is on no queue and every queue answer is today\'s', async () => {
    seed({ join: false });
    expect((await Queue.computeCandidates(T1)).filter((x) => x.loose_id === S_SARA)).toEqual([]);
    expect(await Queue.servedTiers()).toEqual(['roster_unique_with_loose']);
    expect(await Queue.decide({ teacherUserId: T1, looseId: S_SARA, candidateId: R_SARA, decision: 'same' })).toEqual({ ok: false, reason: 'not_served' });
    expect(fake.db.students.find((s) => s.id === S_SARA)).toMatchObject({ merged_into: null });
  });

  test('the strict job never merges a self-joined child (no phone on the row: only the teacher\'s tap can)', async () => {
    seed();
    await Queue.runBackwardJoin({ dryRun: false });
    expect(fake.db.students.find((s) => s.id === S_SARA)).toMatchObject({ merged_into: null, status: 'active' });
  });
});
