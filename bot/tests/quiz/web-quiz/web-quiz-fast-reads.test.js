'use strict';
/**
 * Fast first page (app_settings web_quiz_fast, default off): getQuiz runs the reads that need only the resolved code
 * (identity/roster, the class label, the live counts, the page switches) together instead of one after another.
 * Supabase is the boundary and is faked with a fixed delay per read; every first-party module on the path runs for real.
 *
 * Off: the payload is exactly today's (golden recorded before the change). On: the same payload plus `fast: true`
 * (the edge reads it to send the page's head before the bot answers), and more reads in flight at once.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');

const GOLDEN = path.join(__dirname, 'web-quiz-fast-reads.golden.json');
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID = (n) => `44444444-4444-4444-8444-44444444444${n}`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const READ_MS = 25;

let fake;
let inflight = 0;
let maxInflight = 0;
const CLASS = '66666666-6666-4666-8666-666666666666';
function seed({ fast = null, v2 = false } = {}) {
  fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'FAST01', quiz_id: QUIZ, video_id: null, ...(v2 ? { class_id: CLASS } : {}), teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
      topic: 'Plants', language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(2) }],
    quizzes: [{ id: QUIZ, topic: 'Plants', grade: '3', subject: 'Science', language: 'en', meta: {}, video_id: null, list_id: null }],
    quiz_questions: [1, 2, 3].map((n) => ({
      id: `9999999${n}-9999-4999-8999-999999999999`, quiz_id: QUIZ, external_id: `q${n}`, sort_order: n,
      question_text: `Which one grows from a seed? (${n})`, option_a: 'Tree', option_b: 'Stone', option_c: 'Cup', option_d: null,
      correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null,
    })),
    quiz_sessions: [1, 2].map((n) => ({ id: `55555555-5555-4555-8555-55555555555${n}`, share_code_id: SC, quiz_id: QUIZ, student_id: KID(n),
      user_id: null, status: 'completed', source: 'share_link', invited_by_student_id: null, student_class: '3-A',
      completed_at: new Date().toISOString(), created_at: new Date().toISOString() })),
    students: v2 ? [{ id: KID(1), name: 'Zara Testwala', list_id: '77777777-7777-4777-8777-777777777777', is_active: true }] : [],
    student_lists: v2 ? [{ id: '77777777-7777-4777-8777-777777777777', class_id: CLASS, is_active: true, teacher_user_id: TEACHER }] : [],
    classes: v2 ? [{ id: CLASS, grade_code: 'G3', section: 'A', shift_code: null, is_active: true }] : [],
    app_settings: [...(fast == null ? [] : [{ key: 'web_quiz_fast', value: fast }]), ...(v2 ? [{ key: 'web_quiz_identity', value: 'v2' }] : [])],
  });
  // Every read takes READ_MS and is counted while in flight (a Supabase round trip, as the page pays it).
  const from = (t) => {
    const b = fake.from(t);
    const then = b.then;
    b.then = (res, rej) => {
      inflight += 1; maxInflight = Math.max(maxInflight, inflight);
      return new Promise((r) => setTimeout(r, READ_MS)).then(() => { inflight -= 1; return then.call(b, (x) => x); }).then(res, rej);
    };
    return b;
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
let WQ;
function fresh() {
  jest.resetModules();
  WQ = require('../../../shared/services/quiz/web-quiz.service');
}
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  inflight = 0; maxInflight = 0;
});
afterAll(() => { process.env = SAVED; });

// Signed links and clocks are not part of what this test pins.
const stable = (out) => JSON.parse(JSON.stringify(out));

test('switch off: the payload is today\'s, byte for byte (golden), with no `fast` key', async () => {
  fresh();
  seed();
  const out = stable(await WQ.getQuiz('FAST01'));
  expect(out.fast).toBeUndefined();
  if (!fs.existsSync(GOLDEN)) fs.writeFileSync(GOLDEN, `${JSON.stringify(out, null, 1)}\n`);
  expect(JSON.stringify(out, null, 1)).toBe(fs.readFileSync(GOLDEN, 'utf8').trimEnd());
});

test('switch on: the reads that need only the code run together (more than the questions pair in flight at once)', async () => {
  fresh();
  seed({ fast: true });
  // The first read of a switch waits (fail closed); the page after it is the one a class meets.
  await WQ.getQuiz('FAST01');
  maxInflight = 0;
  await WQ.getQuiz('FAST01');
  expect(maxInflight).toBeGreaterThanOrEqual(4);
});

test('switch on: the payload is the switch-off payload plus `fast: true`', async () => {
  fresh();
  seed();
  const off = stable(await WQ.getQuiz('FAST01'));
  fresh();
  seed({ fast: true });
  await WQ.getQuiz('FAST01');
  const on = stable(await WQ.getQuiz('FAST01'));
  expect(on.fast).toBe(true);
  delete on.fast;
  expect(on).toEqual(off);
});

test('switch on: a read that fails inside the fan-out fails the page the same way it does today, and leaves nothing unhandled', async () => {
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  try {
    fresh();
    seed({ fast: true });
    await WQ.getQuiz('FAST01');
    const brand = require('../../../shared/config/web-quiz-brand');
    const spy = jest.spyOn(brand, 'resolveBrandKey').mockRejectedValue(new Error('boom'));
    await expect(WQ.getQuiz('FAST01')).rejects.toThrow('boom');
    spy.mockRestore();
    await new Promise((r) => setTimeout(r, 4 * READ_MS));
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});

test('identity v2 (the class from the hand-out): switch on gives the switch-off payload plus `fast: true`', async () => {
  fresh();
  seed({ v2: true });
  const off = stable(await WQ.getQuiz('FAST01'));
  expect(off.cls.identity && off.cls.identity.mode).toBe('v2');
  fresh();
  seed({ fast: true, v2: true });
  await WQ.getQuiz('FAST01');
  const on = stable(await WQ.getQuiz('FAST01'));
  expect(on.fast).toBe(true);
  delete on.fast;
  expect(on).toEqual(off);
});
