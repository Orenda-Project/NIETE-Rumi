'use strict';
/**
 * Who is playing, by roll number (app_settings web_quiz_roster_id). The teacher's
 * class list already knows each child's roll number; the page asks for it, the
 * server answers "Are you <first name>?", and a confirmed child plays as their
 * roster row. Supabase, SQS, Redis and WhatsApp are the faked boundaries; the
 * roster lookup, scoring and the one-attempt rule run for real.
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

describe('E2 with a roster', () => {
  test('roster mode: the page learns a roster exists and gets NO class names', async () => {
    const out = await WQ.getQuiz('AB12CD');
    expect(out.cls.roster).toEqual({ lists: 1 });
    expect(out.cls.chips).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/Ayesha|Bilal|Danish|Zara/);
  });

  test('switch off: no roster key, the class chips as today', async () => {
    seed({ flag: false });
    const out = await WQ.getQuiz('AB12CD');
    expect(out.cls.roster).toBeUndefined();
    expect(out.cls.chips.map((c) => c.first)).toEqual(['Zara']);
  });

  test('a teacher with no class list: no roster key, the class chips as today', async () => {
    fake.db.student_lists.length = 0;
    const out = await WQ.getQuiz('AB12CD');
    expect(out.cls.roster).toBeUndefined();
    expect(out.cls.chips.map((c) => c.first)).toEqual(['Zara']);
  });
});

describe('E3 by roll number', () => {
  test('a known roll number asks "is this you?" with the first name and animal only', async () => {
    await expect(WQ.startSession({ code: 'AB12CD', roll: '12' }))
      .rejects.toMatchObject({ status: 409, body: { error: 'is_this_you', candidates: [{ chip: chipOf(kid(3)), first: 'Danish', animal: T.animalFor(kid(3)) }] } });
    try { await WQ.startSession({ code: 'AB12CD', roll: 1 }); } catch (e) {
      expect(JSON.stringify(e.body)).not.toMatch(/Testwala|Father|roll_number/);
    }
  });

  test('an unknown, inactive or nonsense roll number answers roll_unknown', async () => {
    await expect(WQ.startSession({ code: 'AB12CD', roll: 31 })).rejects.toMatchObject({ status: 404, body: { error: 'roll_unknown' } });
    await expect(WQ.startSession({ code: 'AB12CD', roll: 13 })).rejects.toMatchObject({ status: 404, body: { error: 'roll_unknown' } });
    await expect(WQ.startSession({ code: 'AB12CD', roll: 'abc' })).rejects.toMatchObject({ status: 400 });
  });

  test('switch off: a roll number is not a way in', async () => {
    seed({ flag: false });
    await expect(WQ.startSession({ code: 'AB12CD', roll: 12 })).rejects.toMatchObject({ status: 400, body: { error: 'bad_request' } });
  });

  test('"yes, it is me": the child plays as their roster row, class from the list, no new child created', async () => {
    const n = fake.db.students.length;
    const out = await WQ.startSession({ code: 'AB12CD', chip: chipOf(kid(3)) });
    expect(fake.db.students.length).toBe(n);
    const row = fake.db.quiz_sessions.find((s) => s.id === T.verify(out.st, 's').sid);
    expect(row).toMatchObject({ student_id: kid(3), student_name: 'Danish Testwala', student_class: '3-B', source: 'share_link' });
    expect(out).toMatchObject({ counted: true, child: { chip: chipOf(kid(3)), first: 'Danish' } });
  });

  test('the session log says how the child was identified (a short token only, never a name)', async () => {
    const { logEvent } = require('../../../shared/utils/structured-logger');
    await WQ.startSession({ code: 'AB12CD', chip: chipOf(kid(3)), via: 'roll' });
    await WQ.startSession({ code: 'AB12CD', chip: chipOf(kid(3)), via: '<script>Danish' });
    const vias = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.session_started').map((c) => c[1].via);
    expect(vias).toEqual(['roll', null]);
  });

  test('the first finish counts: the same roster child on a second phone is practice', async () => {
    const a = await WQ.startSession({ code: 'AB12CD', chip: chipOf(kid(3)) });
    Object.assign(fake.db.quiz_sessions.find((s) => s.id === T.verify(a.st, 's').sid), { status: 'completed', completed_at: ago(0.1) });
    const b = await WQ.startSession({ code: 'AB12CD', chip: chipOf(kid(3)) });
    expect(b).toMatchObject({ counted: false, reason: 'finished_elsewhere' });
  });

  test('two classes: the quiz grade picks the list; one card, no class label', async () => {
    seed({ lists: 'two' });
    await expect(WQ.startSession({ code: 'AB12CD', roll: 1 }))
      .rejects.toMatchObject({ status: 409, body: { candidates: [{ chip: chipOf(kid(1)), first: 'Ayesha' }] } });
  });

  test('two classes and the grade does not decide: one card per class, each with its class label', async () => {
    seed({ lists: 'two' });
    fake.db.quizzes[0].grade = null;
    let err;
    try { await WQ.startSession({ code: 'AB12CD', roll: 1 }); } catch (e) { err = e; }
    expect(err.body.candidates).toEqual([
      { chip: chipOf(kid(1)), first: 'Ayesha', animal: T.animalFor(kid(1)), cls: '3-B' },
      { chip: chipOf(kid(21)), first: 'Faizan', animal: T.animalFor(kid(21)), cls: '4-A' },
    ]);
  });

  test("the grade's list lacks that number: the other class still answers", async () => {
    seed({ lists: 'two' });
    fake.db.students.find((s) => s.id === kid(21)).roll_number = 40;
    await expect(WQ.startSession({ code: 'AB12CD', roll: 40 }))
      .rejects.toMatchObject({ status: 409, body: { candidates: [{ chip: chipOf(kid(21)), first: 'Faizan', cls: '4-A' }] } });
  });
});

describe('the grade threshold (app_settings web_quiz_roster_from_grade)', () => {
  test('a quiz below the threshold grade keeps the name chips; at or above it, the pad', async () => {
    fake.db.app_settings.push({ key: 'web_quiz_roster_from_grade', value: 3 });
    fake.db.quizzes[0].grade = '2';
    let out = await WQ.getQuiz('AB12CD');
    expect(out.cls.roster).toBeUndefined();
    expect(out.cls.chips.map((c) => c.first)).toEqual(['Zara']);
    await expect(WQ.startSession({ code: 'AB12CD', roll: 12 })).rejects.toMatchObject({ status: 400 });
    Roster._resetCache();
    fake.db.quizzes[0].grade = '3';
    out = await WQ.getQuiz('AB12CD');
    expect(out.cls.roster).toEqual({ lists: 1 });
  });
});

describe('a grade range like "1-2" or "3-5" reads as its first grade', () => {
  test('"1-2" is below a threshold of 3; "3-5" picks the grade-3 list', async () => {
    fake.db.app_settings.push({ key: 'web_quiz_roster_from_grade', value: 3 });
    fake.db.quizzes[0].grade = '1-2';
    expect((await WQ.getQuiz('AB12CD')).cls.roster).toBeUndefined();
    seed({ lists: 'two' });
    fake.db.quizzes[0].grade = '3-5';
    await expect(WQ.startSession({ code: 'AB12CD', roll: 1 }))
      .rejects.toMatchObject({ status: 409, body: { candidates: [{ chip: chipOf(kid(1)), first: 'Ayesha' }] } });
  });
});

describe("a roster child's chip from the teacher's EARLIER code (the phone remembers it; the next quiz or a lesson video's quiz)", () => {
  test('still plays as the roster row, with the class label', async () => {
    const SC0 = '77777777-7777-4777-8777-777777777777';
    fake.db.quiz_share_codes.push({ id: SC0, code: 'OLD222', quiz_id: QUIZ, teacher_user_id: TEACHER, language: 'en', active: true,
      expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(48) });
    fake.db.quiz_sessions.push({ id: 's-prev', quiz_id: QUIZ, share_code_id: SC0, student_id: kid(3), student_name: 'Danish Testwala', user_id: null,
      status: 'completed', completed_at: ago(47), created_at: ago(47), invited_by_student_id: null });
    const out = await WQ.startSession({ code: 'AB12CD', chip: T.chipId(SC0, kid(3)) });
    const row = fake.db.quiz_sessions.find((s) => s.id === T.verify(out.st, 's').sid);
    expect(row).toMatchObject({ student_id: kid(3), student_class: '3-B' });
  });
});

describe('an Urdu quiz', () => {
  test("the roster child's Urdu first name is the one the child is asked about, when the list has it", async () => {
    fake.db.quiz_share_codes[0].language = 'ur';
    fake.db.students.find((k) => k.id === kid(3)).student_name_urdu = 'دانش ٹیسٹ والا';
    await expect(WQ.startSession({ code: 'AB12CD', roll: 12 }))
      .rejects.toMatchObject({ status: 409, body: { candidates: [{ chip: chipOf(kid(3)), first: 'دانش' }] } });
    await expect(WQ.startSession({ code: 'AB12CD', roll: 2 }))
      .rejects.toMatchObject({ status: 409, body: { candidates: [{ first: 'Bilal' }] } });
  });
});

describe('E3 by typed name, with a roster', () => {
  test('a name one letter off a roster child asks "is this you?"', async () => {
    await expect(WQ.startSession({ code: 'AB12CD', new: { name: 'Aysha' } }))
      .rejects.toMatchObject({ status: 409, body: { error: 'maybe_you', candidates: [{ chip: chipOf(kid(1)), first: 'Ayesha' }] } });
  });

  test('no near name: a new child as today', async () => {
    const out = await WQ.startSession({ code: 'AB12CD', new: { name: 'Moiz' } });
    expect(out.child.first).toBe('Moiz');
  });
});

describe('fuzzy first names', () => {
  test.each([
    ['Ayesha', 'aysha', true], ['Ayesha', 'Ayeshaa', true], ['Bilal', 'Bilal', true], ['Ali', 'Alia', true],
    ['Bilal', 'Hilal', true], ['Ali', 'Ahmed', false], ['Sana', 'Saad', false], ['Al', 'Ali', false],
    ['عائشہ', 'عائشه', true], ['Ayesha', 'عائشہ', false],
  ])('%s ~ %s → %s', (a, b, want) => {
    expect(Roster.nearName(a, b)).toBe(want);
  });
});
