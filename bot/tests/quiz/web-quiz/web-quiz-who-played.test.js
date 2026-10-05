'use strict';
/**
 * The teacher's "Who played?" on their own preview link (signed p token): every
 * child counted on the class code, by first name and roll number only, with a
 * mark on the children who typed a name that is not on the class list, and a
 * way to move such a row to the right child by roll number. Supabase, SQS,
 * Redis and WhatsApp are the faked boundaries.
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
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Roster = require('../../../shared/services/quiz/web-quiz-roster');
const Report = require('../../../shared/services/quiz/video-quiz-report.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const TYPED = '44444444-4444-4444-8444-444444444444';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const done = (id, studentId, name, correct, h, extra = {}) => ({ id, quiz_id: QUIZ, share_code_id: SC, student_id: studentId, student_name: name,
  user_id: null, status: 'completed', correct_answers: correct, total_questions_answered: 5, mastery_percentage: correct * 20,
  completed_at: ago(h), created_at: ago(h + 0.1), invited_by_student_id: null,
  // A child's web play always carries its phone's device_ref; the report picks the first-finish rule per class code from that.
  device_ref: extra.user_id ? null : `dev-${id}`, ...extra });

let fake;
let P;
beforeEach(() => {
  process.env.INTERNAL_API_KEY = 'test-key';
  fake = makeFake({
    app_settings: [{ key: 'web_quiz_roster_id', value: true }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, teacher_name: 'Example Teacher', language: 'en',
      active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(30) }],
    quizzes: [{ id: QUIZ, topic: 'Plants', grade: '3', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'B', is_active: true }],
    students: [
      { id: kid(1), list_id: LIST, roll_number: 1, student_name: 'Ayesha Testwala', father_name: 'Secret', is_active: true },
      { id: kid(12), list_id: LIST, roll_number: 12, student_name: 'Danish Testwala', is_active: true },
      { id: TYPED, list_id: null, student_name: 'Dansh', self_reported_class: '3' },
    ],
    quiz_sessions: [
      done('s1', kid(1), 'Ayesha Testwala', 4, 3, { student_class: '3-B' }),
      done('s2', TYPED, 'Dansh', 3, 2, { student_class: '3' }),
      done('s3', kid(1), 'Ayesha Testwala', 5, 1, { student_class: '3-B' }),
      done('s-t', null, 'Example Teacher', 5, 1, { user_id: TEACHER }),
    ],
    quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Roster._resetCache();
  P = T.signPreview({ shareCodeId: SC, teacherUserId: TEACHER });
});

describe('who played', () => {
  test('one row per child (their first finish), first name + roll only; a typed name off the list is marked', async () => {
    const out = await WQ.whoPlayed({ code: 'AB12CD', p: P });
    expect(out.rows).toEqual([
      { ref: 's2', first: 'Dansh', roll: null, on_list: false, correct: 3, total: 5 },
      { ref: 's1', first: 'Ayesha', roll: 1, on_list: true, correct: 4, total: 5 },
    ]);
    expect(out.roster).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/Testwala|Secret|Example Teacher/);
  });

  test('only the teacher: no token, a forged token or another code\'s token is refused', async () => {
    await expect(WQ.whoPlayed({ code: 'AB12CD' })).rejects.toMatchObject({ status: 401 });
    await expect(WQ.whoPlayed({ code: 'AB12CD', p: 'x.y' })).rejects.toMatchObject({ status: 401 });
    await expect(WQ.whoPlayed({ code: 'AB12CD', p: T.signPreview({ shareCodeId: 'other', teacherUserId: TEACHER }) })).rejects.toMatchObject({ status: 401 });
  });
});

describe('move a row to the right child', () => {
  test('a roll number asks "is this <first name>?", then the session becomes that child\'s; the report shows the list name', async () => {
    await expect(WQ.fixWho({ code: 'AB12CD', p: P, ref: 's2', roll: 12 }))
      .rejects.toMatchObject({ status: 409, body: { error: 'is_this_you', candidates: [{ chip: T.chipId(SC, kid(12)), first: 'Danish' }] } });
    const out = await WQ.fixWho({ code: 'AB12CD', p: P, ref: 's2', chip: T.chipId(SC, kid(12)) });
    expect(out).toMatchObject({ ok: true, row: { ref: 's2', first: 'Danish', roll: 12, on_list: true } });
    expect(fake.db.quiz_sessions.find((s) => s.id === 's2')).toMatchObject({ student_id: kid(12), student_name: 'Danish Testwala', student_class: '3-B' });
    const cls = await Report.loadClassRows(SC);
    expect(cls.rows.map((r) => r.name).sort()).toEqual(['Ayesha Testwala', 'Danish Testwala']);
  });

  test('moving onto a child who already finished keeps that child\'s FIRST finish in the report', async () => {
    await WQ.fixWho({ code: 'AB12CD', p: P, ref: 's2', chip: T.chipId(SC, kid(1)) });
    const cls = await Report.loadClassRows(SC);
    expect(cls.rows).toHaveLength(1);
    expect(cls.rows[0]).toMatchObject({ sessionId: 's1', correct: 4 });
  });

  test('never another code\'s session, never the teacher\'s own run, never an unknown roll', async () => {
    fake.db.quiz_sessions.push({ ...done('s-other', TYPED, 'Dansh', 1, 1), share_code_id: 'other-sc' });
    await expect(WQ.fixWho({ code: 'AB12CD', p: P, ref: 's-other', chip: T.chipId(SC, kid(12)) })).rejects.toMatchObject({ status: 404 });
    await expect(WQ.fixWho({ code: 'AB12CD', p: P, ref: 's-t', chip: T.chipId(SC, kid(12)) })).rejects.toMatchObject({ status: 404 });
    await expect(WQ.fixWho({ code: 'AB12CD', p: P, ref: 's2', roll: 40 })).rejects.toMatchObject({ status: 404, body: { error: 'roll_unknown' } });
    await expect(WQ.fixWho({ code: 'AB12CD', p: P, ref: 's2', chip: 'nope' })).rejects.toMatchObject({ status: 404 });
  });
});
