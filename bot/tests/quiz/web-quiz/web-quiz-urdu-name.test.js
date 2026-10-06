'use strict';
/**
 * An Urdu quiz shows a child's name ONE way on every screen: the class list's Urdu spelling.
 * "Are you…?" and the teacher's Who-played already used it (حورین); the session's child, the
 * scorecard, the class league and the challenge line used the Latin roster name (Hoorain).
 * Supabase, SQS, Redis and WhatsApp are the faked boundaries; scoring, the league ranking and
 * the one-attempt rule run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    get: jest.fn(async (k) => keys.get(k) || null),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Roster = require('../../../shared/services/quiz/web-quiz-roster');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST_3B = 'a0000000-0000-4000-8000-00000000003b';
const LIST_4A = 'a0000000-0000-4000-8000-00000000004a';
const OLD_KID = '44444444-4444-4444-8444-444444444444';
const kid = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

let fake;
function seed({ flag = true, lists = 'one' } = {}) {
  const students = [
    { id: kid(1), list_id: LIST_3B, roll_number: 1, student_name: 'Ayesha Testwala', father_name: 'Secret Father', is_active: true, status: 'active' },
    { id: kid(2), list_id: LIST_3B, roll_number: 2, student_name: 'Bilal Testwala', is_active: true, status: 'active' },
    { id: kid(3), list_id: LIST_3B, roll_number: 12, student_name: 'Danish Testwala', is_active: true, status: 'active' },
    { id: kid(4), list_id: LIST_3B, roll_number: 13, student_name: 'Esha Testwala', is_active: false, status: 'active' },
    { id: OLD_KID, list_id: null, roll_number: null, student_name: 'Zara Testwala', self_reported_class: '3' },
  ];
  const studentLists = [{ id: LIST_3B, user_id: TEACHER, class_name: '3', section: 'B', is_active: true }];
  if (lists === 'two') {
    studentLists.push({ id: LIST_4A, user_id: TEACHER, class_name: '4', section: 'A', is_active: true });
    students.push({ id: kid(21), list_id: LIST_4A, roll_number: 1, student_name: 'Faizan Testwala', is_active: true, status: 'active' });
  }
  fake = makeFake({
    app_settings: flag ? [{ key: 'web_quiz_roster_id', value: true }] : [],
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example Teacher',
        topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
    ],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: [1, 2].map((n) => ({
      id: `9999999${n}-9999-4999-8999-999999999999`, quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
      question_text: `Question ${n}`, option_a: 'Root', option_b: 'Leaf', option_c: 'Stem', option_d: null, correct_option: 'B', media: {},
    })),
    quiz_sessions: [
      { id: 's-old', quiz_id: QUIZ, share_code_id: SC, student_id: OLD_KID, student_name: 'Zara Testwala', user_id: null,
        status: 'completed', correct_answers: 1, total_questions_answered: 2, completed_at: ago(2), created_at: ago(2), invited_by_student_id: null },
    ],
    student_lists: studentLists,
    students,
    quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Roster._resetCache();
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  redis.__keys.clear();
  jest.clearAllMocks();
  seed();
});
afterAll(() => { process.env = SAVED; });

const chipOf = (studentId) => T.chipId(SC, studentId);
const Q1 = '99999991-9999-4999-8999-999999999999';
const Q2 = '99999992-9999-4999-8999-999999999999';

function urdu() {
  fake.db.quiz_share_codes[0].language = 'ur';
  fake.db.students.find((k) => k.id === kid(3)).student_name_urdu = 'دانش ٹیسٹ والا';
}
async function play(chip) {
  const s = await WQ.startSession({ code: 'AB12CD', chip });
  await WQ.recordAnswers({ st: s.st, a: [{ qid: Q1, slot: 'B' }, { qid: Q2, slot: 'A' }] });
  return { s, fin: await WQ.finishSession({ st: s.st }) };
}

describe('an Urdu quiz: the list\'s Urdu spelling everywhere', () => {
  test('the session\'s child (what the page remembers and compares the league row to)', async () => {
    urdu();
    const out = await WQ.startSession({ code: 'AB12CD', chip: chipOf(kid(3)) });
    expect(out.child).toMatchObject({ chip: chipOf(kid(3)), first: 'دانش' });
  });

  test('a returning page that resumes its session gets the same name', async () => {
    urdu();
    const a = await WQ.startSession({ code: 'AB12CD', chip: chipOf(kid(3)) });
    const b = await WQ.startSession({ code: 'AB12CD', resume_st: a.st });
    expect(b.resume).toBeDefined();
    expect(b.child).toMatchObject({ first: 'دانش' });
  });

  test('the scorecard', async () => {
    urdu();
    const { fin } = await play(chipOf(kid(3)));
    expect(fin.card).toMatchObject({ first: 'دانش', correct: 1, total: 2 });
  });

  test('the class league, where the child\'s own row is the one with that name', async () => {
    urdu();
    const { s } = await play(chipOf(kid(3)));
    const b = await WQ.board('AB12CD', { st: s.st });
    const names = b.rows.map((r) => r.first);
    expect(names).toContain('دانش');
    expect(names).not.toContain('Danish');
    expect(names).toContain('Zara');
    expect(b.you).toBeDefined();
  });

  test('the challenge line on a friend\'s link', async () => {
    urdu();
    await play(chipOf(kid(3)));
    fake.db.quiz_share_codes.push({ ...fake.db.quiz_share_codes[0], id: 'sc-chal', code: 'CHAL12', invited_by_student_id: kid(3), parent_share_code_id: SC, language: 'ur' });
    const q = await WQ.getQuiz('CHAL12');
    expect(q.challenge).toMatchObject({ first: 'دانش', correct: 1, total: 2 });
  });

  test('a child the list has no Urdu spelling for keeps the list\'s name', async () => {
    urdu();
    const { fin } = await play(chipOf(kid(2)));
    expect(fin.card.first).toBe('Bilal');
  });
});

describe('an English quiz is unchanged', () => {
  test('the Latin roster name, even when the list also has an Urdu spelling', async () => {
    fake.db.students.find((k) => k.id === kid(3)).student_name_urdu = 'دانش ٹیسٹ والا';
    const { s, fin } = await play(chipOf(kid(3)));
    expect(s.child.first).toBe('Danish');
    expect(fin.card.first).toBe('Danish');
    const b = await WQ.board('AB12CD', { st: s.st });
    expect(b.rows.map((r) => r.first)).toContain('Danish');
  });
});
