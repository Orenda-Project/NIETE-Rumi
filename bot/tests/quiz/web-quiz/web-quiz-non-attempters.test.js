'use strict';
/**
 * Who of the hand-out's class has NOT played — the teacher's follow-up list
 * (nonAttempters, for the report and the /quiz web report), and the teacher's
 * two reconcile actions on it: "This is <name>" (move a typed child's finish
 * onto the roster child) and "Add to 4-A" (enrol the typed child), plus the
 * teacher binding an unbound hand-out to a class (POST /who/class).
 * Counted finishes only (each child's FIRST finish; the teacher's own runs and
 * invited friends out). Supabase is the faked boundary; the class resolver,
 * the roster read, ClassService's enrolment and the one-attempt rule run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');

const { kid, done } = F;
const SESSIONS = () => [
  done('s1', kid(1), 'Ayesha Testwala', 4, 5),                 // Ayesha's first finish: counts
  done('s1b', kid(1), 'Ayesha Testwala', 5, 1),                // her replay: practice
  done('s9', kid(9), 'Bilal Testwala', 3, 4),                  // the pasted-again row of Bilal: still Bilal
  done('s4', kid(4), 'Sana Testwala', 2, 3),
  done('sT', F.TYPED, 'Dansh', 3, 2),                          // a typed child the list does not have
  done('sx', null, 'Example Teacher', 5, 1, { user_id: F.TEACHER }), // the teacher's own run
  done('sf', kid(10), 'Zara Testwala', 5, 1, { invited_by_student_id: kid(1) }), // an invited friend
  { ...done('sp', kid(2), 'Ali Raza Testwala', 0, 1), status: 'in_progress', completed_at: null },
];

let fake;
function seed(opts = {}) {
  fake = makeFake(F.db({ sessions: SESSIONS(), ...opts }));
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdRoster._resetCache();
}
const SAVED = { ...process.env };
let P;
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
  seed();
  P = T.signPreview({ shareCodeId: F.SC, teacherUserId: F.TEACHER });
});
afterAll(() => { process.env = SAVED; });

describe('nonAttempters — a hand-out bound to 4-A', () => {
  test('played (first finish, on the list), not played, and the typed child as provisional', async () => {
    const out = await IdRoster.nonAttempters({ shareCodeId: F.SC });
    expect(out.class).toMatchObject({ state: 'known', id: F.CLS_A, label: '4-A', of: 8 });
    expect(out.played.map((p) => [p.first, p.number, p.correct])).toEqual([['Ayesha', 1, 4], ['Sana', 4, 2], ['Bilal', 8, 3]]);
    expect(out.played.every((p) => p.onList)).toBe(true);
    expect(out.played.find((p) => p.first === 'Bilal').studentId).toBe(kid(8));
    expect(out.notPlayed.map((k) => [k.first, k.number])).toEqual([['Ali', 2], ['Ali', 3], ['Sana', 5], ['Hina', 6], ['Hina', 7]]);
    expect(out.provisional).toEqual([expect.objectContaining({ sessionId: 'sT', studentId: F.TYPED, typed: 'Dansh', correct: 3, total: 5 })]);
    expect(JSON.stringify(out)).not.toMatch(/Example Teacher|Zara|Testwala/);
  });

  test('batched reads: one sessions read; the roster in one enrolment read and two students reads (enrolled + the list\'s strays)', async () => {
    await IdRoster.nonAttempters({ shareCodeId: F.SC });
    const n = (t) => fake.calls.filter((c) => c.table === t).length;
    expect([n('quiz_sessions'), n('class_enrollments'), n('students')]).toEqual([1, 1, 2]);
  });
});

describe('canonicalStudentIds — the one id a child is known by (for the hub)', () => {
  test('an enrolled child is itself; a stray un-enrolled row of the same child maps to the enrolled one; an unknown id is itself', async () => {
    fake.db.students.push({ id: 'b0000000-0000-4000-8000-0000000000aa', student_name: 'Ayesha Testwala', father_name: null, roll_number: null,
      list_id: F.LIST_A, is_active: true, status: 'active', created_at: '2026-09-05T00:00:00Z' });
    const m = await IdRoster.canonicalStudentIds([kid(1), 'b0000000-0000-4000-8000-0000000000aa', kid(9), F.TYPED, 'nope']);
    expect(m.get(kid(1))).toBe(kid(1));
    expect(m.get('b0000000-0000-4000-8000-0000000000aa')).toBe(kid(1));
    expect(m.get(kid(9))).toBe(kid(8));
    expect(m.get(F.TYPED)).toBe(F.TYPED);
    expect(m.get('nope')).toBe('nope');
    expect(await IdRoster.canonicalStudentId(kid(9))).toBe(kid(8));
  });
});

describe('nonAttempters — class not known', () => {
  test('ambiguous: every finish listed off-list, no not-played list, the classes to choose from', async () => {
    seed({ codeClass: null });
    const out = await IdRoster.nonAttempters({ shareCodeId: F.SC });
    expect(out.class.state).toBe('ambiguous');
    expect(out.class.classes.map((c) => c.label)).toEqual(['4-A', '4-B']);
    expect(out.notPlayed).toBeNull();
    expect(out.played).toHaveLength(4);
    expect(out.played.every((p) => p.onList === false)).toBe(true);
  });

  test('a teacher with no class: state none, nothing to compare against', async () => {
    seed({ codeClass: null, classes: 'none' });
    const out = await IdRoster.nonAttempters({ shareCodeId: F.SC });
    expect(out.class).toMatchObject({ state: 'none', of: null });
    expect(out.notPlayed).toBeNull();
  });
});

describe('whoPlayed under v2 — today\'s shape plus provisional', () => {
  test('rows, not_played and the summary come from the class roster; provisional rows are listed', async () => {
    const out = await WQ.whoPlayed({ code: 'AB12CD', p: P });
    expect(out.rows.map((r) => [r.ref, r.first, r.roll, r.on_list])).toEqual([
      ['sT', 'Dansh', null, false], ['s1', 'Ayesha', 1, true], ['s4', 'Sana', 4, true], ['s9', 'Bilal', 8, true],
    ]);
    expect(out.not_played.map((k) => [k.first, k.roll])).toEqual([['Ali', 2], ['Ali', 3], ['Sana', 5], ['Hina', 6], ['Hina', 7]]);
    expect(out.not_played[0].studentId).toBe(kid(2));
    expect(out.summary).toMatchObject({ played: 4, on_list: 3, of: 8 });
    expect(out.provisional).toEqual([{ ref: 'sT', first: 'Dansh', correct: 3, total: 5 }]);
    expect(out.class).toMatchObject({ state: 'known', label: '4-A' });
  });
});

describe('/who/fix under v2', () => {
  test('{ref, studentId}: the typed child\'s finish moves onto the roster child the teacher picked', async () => {
    const out = await WQ.fixWho({ code: 'AB12CD', p: P, ref: 'sT', studentId: kid(2) });
    expect(out.ok).toBe(true);
    expect(fake.db.quiz_sessions.find((s) => s.id === 'sT')).toMatchObject({ student_id: kid(2), student_class: '4-A' });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.identity_fixed', expect.objectContaining({ sessionId: 'sT', shareCodeId: F.SC }));
    const after = await IdRoster.nonAttempters({ shareCodeId: F.SC });
    expect(after.provisional).toEqual([]);
  });

  test('a studentId outside the hand-out\'s class is refused', async () => {
    await expect(WQ.fixWho({ code: 'AB12CD', p: P, ref: 'sT', studentId: kid(10) })).rejects.toMatchObject({ status: 404 });
    expect(fake.db.quiz_sessions.find((s) => s.id === 'sT').student_id).toBe(F.TYPED);
  });

  test('{ref, add:true}: the typed child is enrolled in 4-A (and on the teacher\'s list), next time found by name', async () => {
    const out = await WQ.fixWho({ code: 'AB12CD', p: P, ref: 'sT', add: true });
    expect(out.ok).toBe(true);
    expect(fake.db.class_enrollments.filter((e) => e.student_id === F.TYPED && e.class_id === F.CLS_A && e.is_active)).toHaveLength(1);
    expect(fake.db.students.find((s) => s.id === F.TYPED).list_id).toBe(F.LIST_A);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.identity_enrolled', { sessionId: 'sT', shareCodeId: F.SC });
    IdRoster._resetCache();
    const after = await IdRoster.nonAttempters({ shareCodeId: F.SC });
    expect(after.provisional).toEqual([]);
    expect(after.played.map((p) => p.first)).toContain('Dansh');
  });

  test('only the teacher: no token is a 401', async () => {
    await expect(WQ.fixWho({ code: 'AB12CD', ref: 'sT', add: true })).rejects.toMatchObject({ status: 401 });
  });
});

describe('POST /who/class — the teacher binds an unbound hand-out', () => {
  test('the key of 4-B writes quiz_share_codes.class_id; the children\'s page is then bound too', async () => {
    seed({ codeClass: null });
    const { class: c } = await IdRoster.nonAttempters({ shareCodeId: F.SC });
    const key = c.classes.find((x) => x.label === '4-B').key;
    const out = await WQ.whoClass({ code: 'AB12CD', p: P, key });
    expect(out).toEqual({ ok: true, class: { label: '4-B' } });
    expect(fake.db.quiz_share_codes.find((s) => s.id === F.SC).class_id).toBe(F.CLS_B);
    expect((await WQ.getQuiz('AB12CD')).cls.identity.class).toEqual({ state: 'known', label: '4-B', ask: null });
  });

  test('an unknown key is a 404, no token is a 401', async () => {
    seed({ codeClass: null });
    await expect(WQ.whoClass({ code: 'AB12CD', p: P, key: 'nope' })).rejects.toMatchObject({ status: 404 });
    await expect(WQ.whoClass({ code: 'AB12CD', key: 'nope' })).rejects.toMatchObject({ status: 401 });
  });
});
