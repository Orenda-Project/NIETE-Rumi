'use strict';
/**
 * Peer pulse — "Sara got Q4 right" while classmates play the same class code.
 *
 * Part 1 is the in-memory ring itself on a fake clock (TTL, own-session
 * exclusion, newest 3, the memory bound). Part 2 runs two children through the
 * real service on one class code (Supabase is the only fake): a right answer
 * reaches the other child's next /answers response and their idle poll, a wrong
 * answer never does, an invited friend is "a friend", the teacher's preview is
 * never a peer.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../../shared/services/quiz/web-quiz-publish.service'),
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Pulse = require('../../../shared/services/quiz/web-quiz-pulse');

// ─── part 1: the ring ───────────────────────────────────────────────────────

describe('the ring (fake clock)', () => {
  let t;
  beforeEach(() => { Pulse._reset(); t = 1_000_000; Pulse._setClock(() => t); });
  afterAll(() => Pulse._setClock(null));

  test('others only, newest first, at most 3, only after `since`', () => {
    Pulse.push({ shareCodeId: 'c1', sessionId: 's-me', first: 'Me', qn: 1 });
    t += 10; Pulse.push({ shareCodeId: 'c1', sessionId: 's-a', first: 'Sara', qn: 1 });
    t += 10; Pulse.push({ shareCodeId: 'c1', sessionId: 's-b', first: 'Ali', qn: 2 });
    t += 10; Pulse.push({ shareCodeId: 'c1', sessionId: 's-c', first: 'Hina', qn: 3 });
    t += 10; Pulse.push({ shareCodeId: 'c1', sessionId: 's-d', first: 'Omar', qn: 4 });
    const got = Pulse.since({ shareCodeId: 'c1', sessionId: 's-me', sinceMs: 0 });
    expect(got.map((e) => e.first)).toEqual(['Omar', 'Hina', 'Ali']);
    expect(got[0]).toEqual({ first: 'Omar', qn: 4, at: t });
    // Nothing of the caller's own, ever.
    expect(Pulse.since({ shareCodeId: 'c1', sessionId: 's-a', sinceMs: 0, max: 30 }).map((e) => e.first)).not.toContain('Sara');
    // `since` is the newest `at` the page has already seen.
    expect(Pulse.since({ shareCodeId: 'c1', sessionId: 's-me', sinceMs: t - 15 }).map((e) => e.first)).toEqual(['Omar', 'Hina']);
    // Another class code sees nothing.
    expect(Pulse.since({ shareCodeId: 'c2', sessionId: 's-me', sinceMs: 0 })).toEqual([]);
  });

  test('an event lives 120 s', () => {
    Pulse.push({ shareCodeId: 'c1', sessionId: 's-a', first: 'Sara', qn: 2 });
    t += 119_000;
    expect(Pulse.since({ shareCodeId: 'c1', sessionId: 's-me', sinceMs: 0 })).toHaveLength(1);
    t += 2_000;
    expect(Pulse.since({ shareCodeId: 'c1', sessionId: 's-me', sinceMs: 0 })).toEqual([]);
  });

  test('a ring keeps the last 30 events', () => {
    for (let i = 1; i <= 40; i += 1) { t += 1; Pulse.push({ shareCodeId: 'c1', sessionId: `s-${i}`, first: `Kid${i}`, qn: 1 }); }
    const all = Pulse.since({ shareCodeId: 'c1', sessionId: 's-me', sinceMs: 0, max: 100 });
    expect(all).toHaveLength(30);
    expect(all[29].first).toBe('Kid11');
  });

  test('memory is bounded: past 2,000 class codes the least recently active one is dropped', () => {
    for (let i = 0; i < 2000; i += 1) Pulse.push({ shareCodeId: `c${i}`, sessionId: 's-a', first: 'Sara', qn: 1 });
    Pulse.push({ shareCodeId: 'c0', sessionId: 's-b', first: 'Ali', qn: 2 }); // c0 is active again; c1 is now the oldest
    Pulse.push({ shareCodeId: 'c-new', sessionId: 's-a', first: 'Sara', qn: 1 });
    expect(Pulse._size()).toBe(2000);
    expect(Pulse.since({ shareCodeId: 'c1', sessionId: 's-me', sinceMs: 0 })).toEqual([]);
    expect(Pulse.since({ shareCodeId: 'c0', sessionId: 's-me', sinceMs: 0 })).toHaveLength(2);
    expect(Pulse.since({ shareCodeId: 'c-new', sessionId: 's-me', sinceMs: 0 })).toHaveLength(1);
  });

  test('an invited friend carries no name; a bad event is refused', () => {
    expect(Pulse.push({ shareCodeId: 'c1', sessionId: 's-f', first: 'Secret Name', qn: 3, invited: true })).toBe(true);
    expect(Pulse.since({ shareCodeId: 'c1', sessionId: 's-me', sinceMs: 0 })).toEqual([{ first: null, invited: true, qn: 3, at: t }]);
    expect(Pulse.push({ shareCodeId: 'c1', sessionId: 's-x', first: '', qn: 1 })).toBe(false);
    expect(Pulse.push({ shareCodeId: 'c1', sessionId: 's-x', first: 'Ali', qn: 0 })).toBe(false);
    expect(Pulse.push({ shareCodeId: null, sessionId: 's-x', first: 'Ali', qn: 1 })).toBe(false);
  });
});

// ─── part 2: two children on one class code, through the service ────────────

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

let fake;
const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  Pulse._reset();
  Pulse._setClock(null);
  fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'PULSE1', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
      topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
      parent_share_code_id: null, uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: [1, 2, 3, 4].map((n) => ({
      id: qid(n), quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n, question_text: `Question ${n}`,
      option_a: 'Root', option_b: 'Leaf', option_c: 'Stem', option_d: null, correct_option: 'B', explanation: `Because ${n}`,
      option_feedback: {}, media: {}, render_pattern: 'P1',
    })),
    quiz_sessions: [], students: [], quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});
afterAll(() => { process.env = SAVED; });

const play = (name) => WQ.startSession({ code: 'PULSE1', new: { name, force: true } });

describe('two children on one class code', () => {
  test("A's right answer reaches B's next /answers response with A's first name and the number A saw; a wrong one never does", async () => {
    const a = await play('Sara Testwala');
    const b = await play('Ali Testwala');
    const recA = await WQ.recordAnswers({ st: a.st, a: [{ qid: qid(1), slot: 'A' }, { qid: qid(3), slot: 'B' }] });
    expect(recA.pulse).toBeUndefined(); // nobody else has played yet: the response is unchanged
    const recB = await WQ.recordAnswers({ st: b.st, a: [{ qid: qid(1), slot: 'B' }], since: 0 });
    expect(recB.pulse).toEqual([{ first: 'Sara', qn: 3, at: expect.any(Number) }]);
    // Q1 was wrong for A: never a pulse. And B never sees B.
    expect(JSON.stringify(recB.pulse)).not.toMatch(/Ali|"qn":1\b/);
    // A, in turn, sees B's right answer on Q1.
    const recA2 = await WQ.recordAnswers({ st: a.st, a: [{ qid: qid(2), slot: 'C' }], since: 0 });
    expect(recA2.pulse).toEqual([{ first: 'Ali', qn: 1, at: expect.any(Number) }]);
    // Seen already: `since` = the newest `at` the page holds.
    const recB2 = await WQ.recordAnswers({ st: b.st, a: [{ qid: qid(2), slot: 'C' }], since: recB.pulse[0].at });
    expect(recB2.pulse).toBeUndefined();
  });

  test('the idle poll answers from memory: no database read for the session, and only for the code the token belongs to', async () => {
    const a = await play('Sara Testwala');
    const b = await play('Ali Testwala');
    await WQ.recordAnswers({ st: a.st, a: [{ qid: qid(2), slot: 'B' }] });
    await Pulse.poll('PULSE1', { st: b.st, since: 0 }, WQ); // warms the code -> id cache
    const before = fake.calls.length;
    const out = await Pulse.poll('pulse1', { st: b.st, since: '0' }, WQ);
    expect(out).toEqual({ pulse: [{ first: 'Sara', qn: 2, at: expect.any(Number) }] });
    expect(fake.calls.length).toBe(before);
    await expect(Pulse.poll('PULSE1', { st: 'forged', since: 0 }, WQ)).rejects.toMatchObject({ status: 401 });
    // A genuine token of ANOTHER class code never reads this class's ring.
    fake.db.quiz_share_codes.push({ ...fake.db.quiz_share_codes[0], id: 'sc-other', code: 'OTHER1' });
    await expect(Pulse.poll('OTHER1', { st: b.st, since: 0 }, WQ)).rejects.toMatchObject({ status: 401 });
  });

  test('an Urdu code shows the name the page shows: the class list\'s Urdu spelling, looked up once per session', async () => {
    fake.db.quiz_share_codes[0].language = 'ur';
    const a = await play('Sara Testwala');
    const b = await play('Ali Testwala');
    fake.db.students.find((k) => k.student_name === 'Sara Testwala').student_name_urdu = 'سارہ ٹیسٹ والا';
    await WQ.recordAnswers({ st: a.st, a: [{ qid: qid(1), slot: 'B' }] });
    const reads = () => fake.calls.filter((c) => c.table === 'students' && c.op === 'select').length;
    const before = reads();
    await WQ.recordAnswers({ st: a.st, a: [{ qid: qid(2), slot: 'B' }] });
    expect(reads()).toBe(before); // the second right answer reuses the name
    const recB = await WQ.recordAnswers({ st: b.st, a: [{ qid: qid(1), slot: 'A' }], since: 0 });
    expect(recB.pulse.map((e) => e.first)).toEqual(['سارہ', 'سارہ']);
  });

  test('an English code keeps the Latin first name, with no extra read', async () => {
    const a = await play('Sara Testwala');
    const b = await play('Ali Testwala');
    fake.db.students.find((k) => k.student_name === 'Sara Testwala').student_name_urdu = 'سارہ ٹیسٹ والا';
    await WQ.recordAnswers({ st: a.st, a: [{ qid: qid(1), slot: 'B' }] });
    const recB = await WQ.recordAnswers({ st: b.st, a: [{ qid: qid(1), slot: 'A' }], since: 0 });
    expect(recB.pulse).toEqual([{ first: 'Sara', qn: 1, at: expect.any(Number) }]);
  });

  test('an invited friend shows as "a friend" (no name); the teacher preview is never a peer', async () => {
    const a = await play('Sara Testwala');
    const fin = await (async () => {
      await WQ.recordAnswers({ st: a.st, a: [1, 2, 3, 4].map((n) => ({ qid: qid(n), slot: 'B' })) });
      return WQ.finishSession({ st: a.st });
    })();
    // The DB defaults `active` to true; the fake does not.
    fake.db.quiz_share_codes.find((c) => c.code === fin.challenge_code).active = true;
    const friend = await WQ.startSession({ code: fin.challenge_code, new: { name: 'Friend Testwala', force: true } });
    const b = await play('Ali Testwala');
    Pulse._reset();
    await WQ.recordAnswers({ st: friend.st, a: [{ qid: qid(4), slot: 'B' }] });
    const p = T.signPreview({ shareCodeId: SC, teacherUserId: TEACHER });
    const teacher = await WQ.startSession({ code: 'PULSE1', p });
    await WQ.recordAnswers({ st: teacher.st, a: [{ qid: qid(1), slot: 'B' }] });
    const recB = await WQ.recordAnswers({ st: b.st, a: [{ qid: qid(1), slot: 'B' }], since: 0 });
    expect(recB.pulse).toEqual([{ first: null, invited: true, qn: 4, at: expect.any(Number) }]);
    expect(JSON.stringify(recB.pulse)).not.toMatch(/Friend|Teacher/);
  });
});

// ─── "class is live" and "you're the Nth today" (built on the pulse ring) ───

describe('live now (distinct classmates with a right answer in the last 2 minutes)', () => {
  test('the ring counts distinct sessions, and forgets them after 120 s', () => {
    let t = 5_000_000;
    Pulse._setClock(() => t);
    Pulse.push({ shareCodeId: 'c1', sessionId: 's-a', first: 'Sara', qn: 1 });
    Pulse.push({ shareCodeId: 'c1', sessionId: 's-a', first: 'Sara', qn: 2 });
    Pulse.push({ shareCodeId: 'c1', sessionId: 's-b', first: 'Ali', qn: 1, invited: true });
    expect(Pulse.liveNow('c1')).toBe(2);
    expect(Pulse.liveNow('c2')).toBe(0);
    t += 121_000;
    expect(Pulse.liveNow('c1')).toBe(0);
  });

  test('E2 carries live.now for the class code (a count only)', async () => {
    const a = await play('Sara Testwala');
    const b = await play('Ali Testwala');
    await WQ.recordAnswers({ st: a.st, a: [{ qid: qid(1), slot: 'B' }] });
    await WQ.recordAnswers({ st: b.st, a: [{ qid: qid(2), slot: 'B' }] });
    const out = await WQ.getQuiz('PULSE1');
    expect(out.live.now).toBe(2);
    expect(JSON.stringify(out.live)).not.toMatch(/Sara|Ali/);
  });
});

describe("the card's place among today's class finishers", () => {
  const finish = async (name, wrongs = 0) => {
    const k = await play(name);
    await WQ.recordAnswers({ st: k.st, a: [1, 2, 3, 4].map((n) => ({ qid: qid(n), slot: n <= wrongs ? 'A' : 'B' })) });
    return { k, fin: await WQ.finishSession({ st: k.st }) };
  };

  test('the first finisher today is 1st, the next is 2nd', async () => {
    const one = await finish('Sara Testwala');
    expect(one.fin.card.nth).toBe(1);
    const two = await finish('Ali Testwala', 1);
    expect(two.fin.card.nth).toBe(2);
  });

  test('a practice round, an invited friend and the teacher preview get no place', async () => {
    const one = await finish('Sara Testwala');
    // The same child again (a second session for the same student): practice, no place.
    const again = await WQ.startSession({ code: 'PULSE1', from_st: one.k.st });
    await WQ.recordAnswers({ st: again.st, a: [1, 2, 3, 4].map((n) => ({ qid: qid(n), slot: 'B' })) });
    const fin2 = await WQ.finishSession({ st: again.st });
    expect(fin2.counted).toBe(false);
    expect(fin2.card.nth).toBeUndefined();
    fake.db.quiz_share_codes.find((c) => c.code === one.fin.challenge_code).active = true;
    const friend = await WQ.startSession({ code: one.fin.challenge_code, new: { name: 'Friend Testwala', force: true } });
    await WQ.recordAnswers({ st: friend.st, a: [1, 2, 3, 4].map((n) => ({ qid: qid(n), slot: 'B' })) });
    expect((await WQ.finishSession({ st: friend.st })).card.nth).toBeUndefined();
    const teacher = await WQ.startSession({ code: 'PULSE1', p: T.signPreview({ shareCodeId: SC, teacherUserId: TEACHER }) });
    await WQ.recordAnswers({ st: teacher.st, a: [1, 2, 3, 4].map((n) => ({ qid: qid(n), slot: 'B' })) });
    expect((await WQ.finishSession({ st: teacher.st })).card.nth).toBeUndefined();
  });
});
