'use strict';
/**
 * A quiz code minted for a child with no class (under the watch root, app_settings VALUE web_quiz_watch_root) carries
 * the root's teacher, so the "who are you" chips must not pool that teacher's other codes: those are other class-less
 * children from other schools. A watch code shows only the names played on THIS code and no class name. Every other
 * code (a class code, a "watch another video" code of a real class, any code when no watch root is set) is unchanged.
 * Supabase, SQS, Redis and WhatsApp are the faked boundaries. Invented children only.
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
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Report = require('../../../shared/services/quiz/video-quiz-report.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const ROOT = '33333333-3333-4333-8333-777777777777';
const SC = '33333333-3333-4333-8333-333333333333';    // a real class code of the same teacher
const MORE = '33333333-3333-4333-8333-888888888888';  // "watch another video" under the class code
const WA = '33333333-3333-4333-8333-aaaaaaaaaaaa';    // Zara's own watch code
const WB = '33333333-3333-4333-8333-bbbbbbbbbbbb';    // Hina's own watch code
const KID_A = '44444444-4444-4444-8444-44444444444a';
const KID_B = '44444444-4444-4444-8444-44444444444b';
const KID_C = '44444444-4444-4444-8444-44444444444c';
const KID_R = '44444444-4444-4444-8444-44444444444d';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

const code = (id, c, extra = {}) => ({
  id, code: c, quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example Teacher', topic: 'Parts of a plant',
  language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, created_at: ago(40), ...extra,
});
const sess = (id, sc, kid, name, h) => ({
  id, quiz_id: QUIZ, share_code_id: sc, student_id: kid, student_name: name, user_id: null, status: 'completed', student_class: '3',
  correct_answers: 1, total_questions_answered: 2, mastery_percentage: 50, completed_at: ago(h), created_at: ago(h), invited_by_student_id: null,
});

let fake;
let rootReads;
function seed({ root = true } = {}) {
  fake = makeFake({
    app_settings: root ? [{ key: 'web_quiz_watch_root', value: JSON.stringify(ROOT) }] : [],
    quiz_share_codes: [
      code(ROOT, 'ROOT01', { active: false, expires_at: null, created_at: ago(300) }),
      code(SC, 'AB12CD'),
      code(MORE, 'MORE01', { parent_share_code_id: SC }),
      code(WA, 'WATCHA', { parent_share_code_id: ROOT }),
      code(WB, 'WATCHB', { parent_share_code_id: ROOT }),
    ],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: [1, 2].map((n) => ({
      id: `9999999${n}-9999-4999-8999-999999999999`, quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
      question_text: `Question ${n}`, option_a: 'Root', option_b: 'Leaf', option_c: 'Stem', option_d: null, correct_option: 'B', media: {},
    })),
    quiz_sessions: [
      sess('s-r', ROOT, KID_R, 'Omar Testwala', 200),  // an old finish on the root itself: gives it a class heading
      sess('s-c', SC, KID_C, 'Bilal Testwala', 5),
      sess('s-b', WB, KID_B, 'Hina Testwala', 3),
      sess('s-a', WA, KID_A, 'Zara Testwala', 1),
    ],
    students: [],
    student_lists: [],
    quiz_answers: [],
  });
  rootReads = [];
  // Every app_settings read of the watch root key is counted (a normal code must add none).
  supabase.rpc = fake.rpc;
  supabase.from = (t) => {
    const b = fake.from(t);
    if (t !== 'app_settings') return b;
    const eq = b.eq;
    b.eq = (c, v) => { if (c === 'key' && v === 'web_quiz_watch_root') rootReads.push(v); return eq(c, v); };
    return b;
  };
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  redis.__keys.clear();
  jest.clearAllMocks();
  require('../../../shared/services/quiz/web-quiz-roster')._resetCache();
  seed();
});
afterAll(() => { process.env = SAVED; });

const firsts = (out) => out.cls.chips.map((c) => c.first);
// Today's pool for this teacher: every non-invited code's named children, most recent first.
const TEACHER_POOL = ['Zara', 'Hina', 'Bilal', 'Omar'];

describe('a watch code (a class-less child\'s own code under the watch root)', () => {
  test('its page shows no other child\'s chip: only the names played on this code', async () => {
    const out = await WQ.getQuiz('WATCHB');
    expect(firsts(out)).toEqual(['Hina']);
    expect(JSON.stringify(out)).not.toMatch(/Zara|Bilal|Omar/);
  });

  test('the child\'s own chip on this code still resolves', async () => {
    const chips = await WQ.classChips(await WQ.resolveCode('WATCHB'));
    expect(chips.map((c) => c.chip)).toEqual([T.chipId(WB, KID_B)]);
  });

  test('its page names no class (the root\'s class is nobody\'s class)', async () => {
    expect((await Report.loadClassRows(ROOT)).className).toBeTruthy();
    const out = await WQ.getQuiz('WATCHB');
    expect(out.cls.label).toBeNull();
    expect(rootReads.length).toBeGreaterThan(0); // the counter the class-code test relies on does see a read
  });
});

describe('a watch code when the root\'s teacher keeps a class list (roll numbers, web_quiz_roster_id on)', () => {
  const LIST = '55555555-5555-4555-8555-555555555555';
  function withRoster() {
    fake.db.app_settings.push({ key: 'web_quiz_roster_id', value: 'true' });
    fake.db.student_lists.push({ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true });
    fake.db.students.push({ id: KID_C, list_id: LIST, roll_number: 7, student_name: 'Bilal Testwala', student_name_urdu: null, is_active: true });
  }
  test('its page never offers the root teacher\'s class to pick from (a class-less child is nobody\'s roll number)', async () => {
    withRoster();
    const out = await WQ.getQuiz('WATCHB');
    expect(out.cls.roster).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/Bilal/);
    expect(firsts(out)).toEqual(['Hina']);
  });
  test('GOLDEN: a class code of the same teacher still plays against the roster', async () => {
    withRoster();
    const out = await WQ.getQuiz('AB12CD');
    expect(out.cls.roster).toEqual(expect.objectContaining({ lists: 1 }));
    expect(rootReads).toEqual([]);
  });
});

describe('every other code is unchanged', () => {
  test('GOLDEN: a class code of the same teacher pools as today, and never reads the watch root', async () => {
    const out = await WQ.getQuiz('AB12CD');
    expect(firsts(out)).toEqual(TEACHER_POOL);
    expect(out.cls.label).toBe((await Report.loadClassRows(SC)).className);
    expect(rootReads).toEqual([]);
  });

  test('a "watch another video" code of a real class pools and is named as today', async () => {
    const out = await WQ.getQuiz('MORE01');
    expect(firsts(out)).toEqual(TEACHER_POOL);
    expect(out.cls.label).toBe((await Report.loadClassRows(SC)).className);
    expect(out.cls.label).toBeTruthy();
  });

  test('no watch root set: a code under the old root behaves as today', async () => {
    seed({ root: false });
    const out = await WQ.getQuiz('WATCHB');
    expect(firsts(out)).toEqual(TEACHER_POOL);
    expect(out.cls.label).toBe((await Report.loadClassRows(ROOT)).className);
  });
});
