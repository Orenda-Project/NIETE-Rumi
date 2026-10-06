'use strict';
/**
 * The teacher's report reads WHO is in the quiz's class from identity v2
 * (web-quiz-identity-roster.nonAttempters): the hand-out's bound class, its
 * deduplicated roster, the children not on it who typed a name (provisional),
 * and the opaque class keys the page posts to /who/class. Scores stay the
 * report's own counting. When identity v2 cannot answer, the report falls back
 * to the teacher's class lists, as before. Supabase is the faked boundary.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');

const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const done = (id, studentId, name, correct, h) => ({
  id, quiz_id: F.QUIZ, share_code_id: F.SC, student_id: studentId, student_name: name, user_id: null, status: 'completed',
  correct_answers: correct, total_questions_answered: 5, mastery_percentage: correct * 20, completed_at: ago(h), created_at: ago(h + 0.1),
  invited_by_student_id: null, device_ref: `dev-${id}`,
});

let Data;
function wire(opts) {
  const tables = F.db(opts);
  tables.quizzes = tables.quizzes.map((q) => ({ ...q, teacher_id: F.TEACHER, status: 'sent', created_at: ago(30), meta: { share_code_id: F.SC } }));
  const fake = makeFake(tables);
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
  Data = require('../../../shared/services/quiz/teacher-report.data');
  return fake;
}

const SESSIONS = [
  done('s1', F.kid(1), 'Ayesha Testwala', 4, 20),
  done('s2', F.kid(9), 'Bilal Testwala', 3, 19),      // the duplicate row of Bilal: one child
  done('s3', F.TYPED, 'Dansh', 5, 18),                // typed a name that is not on the list
];

test('a bound class: its deduplicated roster, list numbers, and the typed child as provisional', async () => {
  wire({ sessions: SESSIONS });
  const r = await Data.quizReport(F.TEACHER, F.QUIZ);
  expect(r.roster).toMatchObject({ state: 'known', className: '4-A', of: 8 });
  expect(r.notPlayed.map((k) => k.first)).not.toContain('Ayesha');
  expect(r.notPlayed.map((k) => k.first)).not.toContain('Bilal');
  expect(r.notPlayed).toHaveLength(6);
  expect(r.notPlayed[0]).toEqual(expect.objectContaining({ roll: 2, studentId: F.kid(2) }));
  expect(r.provisional).toEqual([expect.objectContaining({ sessionId: 's3', typed: 'Dansh', correct: 5, total: 5 })]);
  // scores are the report's own counting: three children finished
  expect(r.summary.played).toBe(3);
  const ayesha = r.played.find((p) => p.first === 'Ayesha');
  expect(ayesha).toMatchObject({ roll: 1, onList: true, correct: 4 });
  expect(r.played.find((p) => p.first === 'Dansh')).toMatchObject({ onList: false, roll: null });
});

test('an unbound hand-out of a teacher with two grade-4 classes: ambiguous, with the keys /who/class takes', async () => {
  wire({ codeClass: null, sessions: SESSIONS });
  const r = await Data.quizReport(F.TEACHER, F.QUIZ);
  expect(r.roster.state).toBe('ambiguous');
  expect(r.notPlayed).toBeNull();
  expect(r.roster.lists.map((l) => l.label).sort()).toEqual(['4-A', '4-B']);
  r.roster.lists.forEach((l) => expect(l.key).toMatch(/\S/));
});

test('identity v2 unavailable (its read fails): the teacher\'s class lists answer, as before', async () => {
  const fake = wire({ sessions: SESSIONS });
  fake.db.classes = undefined; // a DB without the v2 class tables
  const from = fake.from;
  require('../../../shared/config/supabase').from = (t) => {
    if (t === 'class_teachers' || t === 'classes') return { select() { throw new Error('relation does not exist'); } };
    return from(t);
  };
  const r = await Data.quizReport(F.TEACHER, F.QUIZ);
  expect(['known', 'ambiguous']).toContain(r.roster.state);
  expect(r.summary.played).toBe(3);
  expect(r.provisional).toEqual([]);
});

test('the same typed name finishing three times on one code is ONE provisional row (the first finish), not three', async () => {
  const typed2 = '44444444-4444-4444-8444-444444444445';
  const typed3 = '44444444-4444-4444-8444-444444444446';
  const fake = wire({ sessions: [
    ...SESSIONS,
    { ...done('s4', typed2, 'dansh', 2, 10) },
    { ...done('s5', typed3, 'Dansh ', 1, 5) },
  ] });
  fake.db.students.push(
    { id: typed2, student_name: 'dansh', self_reported_class: '4-A', list_id: null, is_active: true, status: 'active', created_at: '2026-10-02T00:00:00Z' },
    { id: typed3, student_name: 'Dansh ', self_reported_class: '4-A', list_id: null, is_active: true, status: 'active', created_at: '2026-10-03T00:00:00Z' },
  );
  const r = await Data.quizReport(F.TEACHER, F.QUIZ);
  expect(r.provisional).toHaveLength(1);
  expect(r.provisional[0]).toMatchObject({ sessionId: 's3', correct: 5, repeats: 3 });
  // and counted once among the players: Ayesha, Bilal, Dansh
  expect(r.summary.played).toBe(3);
  expect(r.played.filter((p) => p.first === 'Dansh')).toHaveLength(1);
});
