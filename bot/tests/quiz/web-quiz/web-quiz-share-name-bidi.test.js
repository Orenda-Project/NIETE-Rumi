'use strict';
/**
 * The friend's name, one way in both languages (app_settings web_quiz_share_name_bidi, default OFF). On an Urdu page the
 * challenger was named by the class list's Urdu column; where that column held a Latin name that is not the child's own
 * first name, the friend read «آپ ۴/۷، Testwala ۴/۷» where the English page says "Beena 3/8". With the switch, on an Urdu
 * page a challenger's name in Urdu script is kept (the list's own spelling), and any other is the first name the child
 * played under, as the English page shows it. The same name reaches the friend's door, the result line and the
 * challenge picture (they share one source). Off (absent or anything but JSON true), and on an English page: today's.
 * The switch is read from the hub's switch cache only (nowOf('nameBidi'), no read of its own), and it rides the page's
 * answer as `name_bidi: true`, only when on.
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
// The figure engine pulls in openchemlib (ESM); the repo's CJS stand-in lets a figure really draw here.
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
// E2 asks for the quiz's read-aloud clips in the background; publishing has its own suite
// (web-quiz-publish.test.js, network mocked at its edge), so here only the ask is observed.
jest.mock('../../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../../shared/services/quiz/web-quiz-publish.service'),
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const SQS = require('../../../shared/services/queue/sqs-queue.service');
const redis = require('../../../shared/services/cache/railway-redis.service');
const WhatsApp = require('../../../shared/services/whatsapp.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID_A = '44444444-4444-4444-8444-444444444444';
const KID_B = '55555555-5555-4555-8555-555555555555';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
// A moment that is always "today" in Pakistan, never in the future: the live counts are per PKT day,
// so a fixed "N hours ago" seed stops counting as today for part of every day.
const todayPkt = () => new Date(Math.max(Date.parse(WQ.pktMidnightIso()) + 1000, Date.now() - 60000)).toISOString();

let fake;
let LANG = 'ur';
let ROW = {};
let SETTINGS = [];
function seed() {
  const questions = [1, 2, 3, 4].map((n) => ({
    id: qid(n), quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
    question_text: `Question ${n}`, option_a: 'Root', option_b: 'Leaf', option_c: 'Stem', option_d: null,
    correct_option: 'B', explanation: `Because ${n}`,
    option_feedback: { wrong: { 0: 'Roots hold the plant.' } },
    media: n === 1 ? { question_image: 'https://example.org/q1.png', option_images: [{ b64: Buffer.from('jpegbytes').toString('base64') }] } : {},
    render_pattern: 'P1',
  }));
  fake = makeFake({
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
        topic: 'Parts of a plant', language: LANG, active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
      { id: 'sc-old', code: 'OLD111', quiz_id: QUIZ, teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: ago(1), invited_by_student_id: null, parent_share_code_id: null, created_at: ago(800) },
    ],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: LANG, meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: questions,
    quiz_sessions: [
      // KID_A played on WhatsApp earlier today (has a phone row): a chip, and today's one finisher.
      { id: 's-a1', quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, student_name: 'Beena Testwala', user_id: null,
        status: 'completed', correct_answers: 3, total_questions_answered: 4, mastery_percentage: 75,
        completed_at: todayPkt(), created_at: todayPkt(), invited_by_student_id: null, device_ref: null, parent_phone: '0000', source: 'share_link' },
      // The teacher's own run — never a chip, never on the board.
      { id: 's-t', quiz_id: QUIZ, share_code_id: SC, student_id: null, student_name: 'Ms Example Teacher', user_id: TEACHER,
        status: 'completed', correct_answers: 4, total_questions_answered: 4, mastery_percentage: 100,
        completed_at: ago(19), created_at: ago(19), invited_by_student_id: null },
    ],
    students: [{ id: KID_A, student_name: 'Beena Testwala', self_reported_class: '3', phone: '0000', ...ROW }],
    app_settings: SETTINGS,
    quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  redis.__keys.clear();
  jest.clearAllMocks();
  require('../../../shared/services/quiz/web-quiz-card-switch')._reset();
});
afterAll(() => { process.env = SAVED; });


const CH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function addChallengeCode() {
  fake.db.quiz_share_codes.push({ id: CH, code: 'CH12AB', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
    topic: 'Parts of a plant', language: LANG, active: true, expires_at: future, invited_by_student_id: KID_A,
    parent_share_code_id: SC, uses_count: 0, created_at: ago(2) });
}
async function friendPlays(name, picks) {
  const s = await WQ.startSession({ code: 'CH12AB', new: { name, force: true } });
  await WQ.recordAnswers({ st: s.st, a: picks.map((slot, i) => ({ qid: qid(i + 1), slot, ms: 2000, seq: i + 1 })) });
  return WQ.finishSession({ st: s.st });
}
const ON = [{ key: 'web_quiz_share_name_bidi', value: true }];
async function both({ lang = 'ur', row = {}, settings = [] } = {}) {
  LANG = lang; ROW = row; SETTINGS = settings;
  seed();
  const Hub = require('../../../shared/services/quiz/web-quiz-hub-flags');
  Hub._resetCache();
  await Hub.flags(); // a warm process: the hub's switch cache holds this seed's switches
  addChallengeCode();
  const door = (await WQ.getQuiz('CH12AB')).challenge;
  const out = await friendPlays('Omar Testwala', ['B', 'B', 'A', 'A']);
  return { door, vs: out.vs };
}

describe('on: the Urdu page names the challenger as the English page does', () => {
  test('a Latin name in the list\'s Urdu column: the first name the child played under (it read «Testwala»)', async () => {
    const off = await both({ row: { student_name_urdu: 'Testwala' } });
    expect(off.door.first).toBe('Testwala');
    expect(off.vs.first).toBe('Testwala');
    const on = await both({ row: { student_name_urdu: 'Testwala' }, settings: ON });
    expect(on.door).toEqual({ first: 'Beena', correct: 3, total: 4 });
    expect(on.vs).toEqual({ first: 'Beena', correct: 3, total: 4, outcome: 'lose' });
  });
  test('the English page: "Beena", on and off', async () => {
    expect((await both({ lang: 'en', row: { student_name_urdu: 'Testwala' } })).vs.first).toBe('Beena');
    expect((await both({ lang: 'en', row: { student_name_urdu: 'Testwala' }, settings: ON })).vs.first).toBe('Beena');
  });
  test('the list\'s own Urdu spelling is kept, on and off', async () => {
    const row = { student_name_urdu: 'بینا ٹیسٹ والا' };
    expect((await both({ row })).vs.first).toBe('بینا');
    const on = await both({ row, settings: ON });
    expect(on.vs.first).toBe('بینا');
    expect(on.door.first).toBe('بینا');
  });
  test('no Urdu column: the list\'s name, as today', async () => {
    expect((await both({ settings: ON })).vs.first).toBe('Beena');
  });
});

describe('off: today\'s answers', () => {
  test.each([['absent', []], ['false', [{ key: 'web_quiz_share_name_bidi', value: false }]], ['the string "true"', [{ key: 'web_quiz_share_name_bidi', value: 'true' }]]])(
    'the key %s: the door and the result line are today\'s', async (_n, settings) => {
      const today = await both({ row: { student_name_urdu: 'Testwala' } });
      const off = await both({ row: { student_name_urdu: 'Testwala' }, settings });
      expect(off).toEqual(today);
    });
});

describe('the hub\'s switch cache only', () => {
  const Hub = () => require('../../../shared/services/quiz/web-quiz-hub-flags');
  test('on: nowOf(\'nameBidi\') once the hub\'s read has the key; the page answer says name_bidi', async () => {
    const on = await both({ settings: ON });
    expect(Hub().nowOf('nameBidi')).toBe(true);
    expect((await WQ.getQuiz('CH12AB')).name_bidi).toBe(true);
    expect(on.vs.first).toBe('Beena');
  });
  test('a cold cache: off, and no read of its own (the name is today\'s until the hub\'s read lands)', async () => {
    LANG = 'ur'; ROW = { student_name_urdu: 'Testwala' }; SETTINGS = ON;
    seed();
    Hub()._resetCache();
    addChallengeCode();
    expect(Hub().nowOf('nameBidi')).toBe(false);
    expect((await WQ.challengeOf({ shareCodeId: SC, invitedByStudentId: KID_A, lang: 'ur' })).first).toBe('Testwala');
  });
  test.each([['absent', []], ['false', false], ['"true"', 'true'], ['1', 1]])('off (%s): false, and the page answer has no name_bidi', async (_n, v) => {
    await both({ settings: Array.isArray(v) ? v : [{ key: 'web_quiz_share_name_bidi', value: v }] });
    expect(Hub().nowOf('nameBidi')).toBe(false);
    expect(await WQ.getQuiz('CH12AB')).not.toHaveProperty('name_bidi');
  });
  test('the picture switch is in the card switches\' one read (the read the picture already makes)', async () => {
    LANG = 'en'; ROW = {}; SETTINGS = [{ key: 'web_quiz_share_ur_stack', value: true }];
    seed();
    const Card = require('../../../shared/services/quiz/web-quiz-card-switch');
    Card._reset();
    await Card.on();
    expect(Card.urStackCached()).toBe(true);
    expect(Card.UR_STACK_KEY).toBe('web_quiz_share_ur_stack');
    expect(await Card.field()).toEqual({});
    for (const v of [false, 'true', 1]) {
      SETTINGS = [{ key: 'web_quiz_share_ur_stack', value: v }];
      seed();
      Card._reset();
      await Card.on();
      expect(Card.urStackCached()).toBe(false);
    }
  });
});
