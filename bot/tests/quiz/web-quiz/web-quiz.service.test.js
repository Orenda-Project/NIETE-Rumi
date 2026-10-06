'use strict';
/**
 * The web child quiz service (E2-E10). Supabase, the SQS queue, Redis and the
 * WhatsApp sender are the boundaries and are faked; every first-party module
 * on the path — scoring, one-attempt, self-test exclusion, the report's class
 * loader and its scheduler — runs for real.
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
        topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
      { id: 'sc-old', code: 'OLD111', quiz_id: QUIZ, teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: ago(1), invited_by_student_id: null, parent_share_code_id: null, created_at: ago(800) },
    ],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: questions,
    quiz_sessions: [
      // KID_A played on WhatsApp earlier today (has a phone row): a chip, and today's one finisher.
      { id: 's-a1', quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, student_name: 'Zara Example', user_id: null,
        status: 'completed', correct_answers: 3, total_questions_answered: 4, mastery_percentage: 75,
        completed_at: todayPkt(), created_at: todayPkt(), invited_by_student_id: null, device_ref: null, parent_phone: '0000', source: 'share_link' },
      // The teacher's own run — never a chip, never on the board.
      { id: 's-t', quiz_id: QUIZ, share_code_id: SC, student_id: null, student_name: 'Ms Example Teacher', user_id: TEACHER,
        status: 'completed', correct_answers: 4, total_questions_answered: 4, mastery_percentage: 100,
        completed_at: ago(19), created_at: ago(19), invited_by_student_id: null },
    ],
    students: [{ id: KID_A, student_name: 'Zara Example', self_reported_class: '3', phone: '0000' }],
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
  seed();
});
afterAll(() => { process.env = SAVED; });

const chipOf = (studentId) => T.chipId(SC, studentId);

describe('fail closed', () => {
  test('no secret: every endpoint answers 503 web_quiz_off', async () => {
    delete process.env.INTERNAL_API_KEY;
    await expect(WQ.getQuiz('AB12CD')).rejects.toMatchObject({ status: 503, body: { error: 'web_quiz_off' } });
    await expect(WQ.startSession({ code: 'AB12CD', chip: 'x' })).rejects.toMatchObject({ status: 503 });
  });
});

describe('E2 GET quiz', () => {
  test('a wrong option\'s stored WhatsApp feedback reaches the page cleaned: no letters, no "correct answer", no praise', async () => {
    fake.db.quiz_questions[1].option_feedback = { wrong: { 0: 'A) Good try! Roots hold the plant. The correct answer is B) Leaf, because leaves make food. Keep going!' } };
    const out = await WQ.getQuiz('AB12CD');
    const root = out.quiz.questions[1].options.find((o) => o.slot === 'A');
    expect(root.fb).toBe('Roots hold the plant. Leaves make food.');
  });

  test('opening the page asks for the quiz\'s read-aloud clips (published once, in the background, never awaited)', async () => {
    const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
    Publish.requestQuizAudio.mockImplementationOnce(() => new Promise(() => {})); // never settles: E2 must not wait
    const out = await WQ.getQuiz('AB12CD');
    expect(out.quiz.id).toBe(QUIZ);
    expect(Publish.requestQuizAudio).toHaveBeenCalledWith(QUIZ, expect.objectContaining({ meta: { web_arm: 'web' } }));
  });

  test('questions with options, correct slot, why, feedback and media links; chips; live counts', async () => {
    const out = await WQ.getQuiz('ab12cd');
    expect(out.quiz).toMatchObject({ id: QUIZ, code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', n: 4 });
    const q1 = out.quiz.questions[0];
    expect(q1).toMatchObject({ qid: qid(1), i: 1, text: 'Question 1', correct_slot: 'B', why: 'Because 1', pattern: 'P1' });
    // The WhatsApp quiz's own order (displayOrder); each option keeps its stored slot.
    expect([...q1.options.map((o) => o.slot)].sort()).toEqual(['A', 'B', 'C']);
    expect(q1.options.find((o) => o.slot === 'A')).toMatchObject({ fb: 'Roots hold the plant.', img: `/api/wq/media/AB12CD/${qid(1)}?k=A` });
    expect(q1.img).toBe(`/api/wq/media/AB12CD/${qid(1)}?k=q`);
    expect(out.cls.chips).toEqual([{ chip: chipOf(KID_A), first: 'Zara', animal: T.animalFor(KID_A) }]);
    expect(out.live).toEqual({ class_today: 1, ict_today_floor: 1 });
    expect(out.video).toBeNull();
    expect(out.preview).toBe(false);
    // The teacher is named as the forwarded WhatsApp text names them; the parent's phone never leaves.
    expect(out.cls.teacher).toBe('Teacher Ms Example Teacher');
    expect(JSON.stringify(out)).not.toMatch(/0000/);
  });

  test('unknown code 404, expired code 410 with the language', async () => {
    await expect(WQ.getQuiz('ZZZZZZ')).rejects.toMatchObject({ status: 404 });
    await expect(WQ.getQuiz('OLD111')).rejects.toMatchObject({ status: 410, body: { error: 'expired', lang: 'en' } });
    await expect(WQ.getQuiz('bad code!')).rejects.toMatchObject({ status: 404 });
  });

  test('the payload names the deployment brand: the code default, then the app_settings row', async () => {
    require('../../../shared/config/web-quiz-brand')._resetCache();
    expect((await WQ.getQuiz('AB12CD')).brand).toBe('niete');
    fake.db.app_settings = [{ key: 'web_quiz_brand', value: 'rumi' }];
    require('../../../shared/config/web-quiz-brand')._resetCache();
    expect((await WQ.getQuiz('AB12CD')).brand).toBe('rumi');
    require('../../../shared/config/web-quiz-brand')._resetCache();
  });

  test('a valid preview token marks the payload as preview', async () => {
    const p = T.signPreview({ shareCodeId: SC, teacherUserId: TEACHER });
    expect((await WQ.getQuiz('AB12CD', { p })).preview).toBe(true);
    expect((await WQ.getQuiz('AB12CD', { p: 'forged.token' })).preview).toBe(false);
  });
});

describe('E3 POST session', () => {
  test('a returning child by chip: share_link session, no phone, device_ref, uses counted, report scheduled once', async () => {
    const out = await WQ.startSession({ code: 'AB12CD', chip: chipOf(KID_A) });
    const row = fake.db.quiz_sessions.find((s) => s.device_ref === out.device_ref);
    expect(row).toMatchObject({ source: 'share_link', parent_phone: null, student_id: KID_A, share_code_id: SC, user_id: null, status: 'in_progress' });
    expect(out.device_ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(T.verify(out.st, 's')).toMatchObject({ sid: row.id, d: out.device_ref, sc: SC });
    expect(fake.db.quiz_share_codes[0].uses_count).toBe(1);
    // already finished on WhatsApp (another handset) -> practice
    expect(out).toMatchObject({ counted: false, reason: 'finished_elsewhere' });
    // the first web session schedules the teacher's 12-hour report, like a WhatsApp join
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
    expect(SQS.queueJob.mock.calls[0][0]).toBe(SC);
    expect(SQS.queueJob.mock.calls[0][1]).toBe('quiz_video_report');
    await WQ.startSession({ code: 'AB12CD', chip: chipOf(KID_A) });
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith('video_quiz.report_schedule_skipped', expect.objectContaining({ why: 'already_scheduled' }));
    expect(logEvent).toHaveBeenCalledWith('quiz_funnel.child_joined', expect.objectContaining({ channel: 'web', share_code_id: SC }));
    expect(WhatsApp.sendMessage).not.toHaveBeenCalled();
  });

  test('a new child: students row with phone NULL; a matching first name asks "is this you?"', async () => {
    await expect(WQ.startSession({ code: 'AB12CD', new: { name: 'Zara Other', cls: '3' } }))
      .rejects.toMatchObject({ status: 409, body: { error: 'maybe_you', candidates: [{ chip: chipOf(KID_A), first: 'Zara' }] } });
    const out = await WQ.startSession({ code: 'AB12CD', new: { name: 'Zara Other', cls: '3', force: true } });
    const kid = fake.db.students.find((s) => s.student_name === 'Zara Other');
    expect(kid).toMatchObject({ phone: null, list_id: null, enrolled_by_user_id: TEACHER, self_reported_class: '3' });
    expect(out).toMatchObject({ counted: true, child: { first: 'Zara', chip: chipOf(kid.id) } });
    expect(out.reason).toBeUndefined();
  });

  test('the same device that already finished gets already_finished', async () => {
    const a = await WQ.startSession({ code: 'AB12CD', new: { name: 'Bilal Example', force: true } });
    const sid = T.verify(a.st, 's').sid;
    Object.assign(fake.db.quiz_sessions.find((s) => s.id === sid), { status: 'completed', completed_at: ago(0.1) });
    const kid = fake.db.students.find((s) => s.student_name === 'Bilal Example');
    const b = await WQ.startSession({ code: 'AB12CD', chip: chipOf(kid.id), device_ref: a.device_ref });
    expect(b).toMatchObject({ counted: false, reason: 'already_finished', device_ref: a.device_ref });
  });

  test('teacher preview: stored with user_id = teacher (the self-test marker), never counted', async () => {
    const p = T.signPreview({ shareCodeId: SC, teacherUserId: TEACHER });
    const out = await WQ.startSession({ code: 'AB12CD', p });
    expect(out).toMatchObject({ counted: false, reason: 'preview', child: null });
    const row = fake.db.quiz_sessions.find((s) => s.id === T.verify(out.st, 's').sid);
    expect(row).toMatchObject({ user_id: TEACHER, student_id: null });
    await expect(WQ.startSession({ code: 'AB12CD', p: T.signPreview({ shareCodeId: SC, teacherUserId: KID_A }) }))
      .rejects.toMatchObject({ status: 401 });
  });

  test('resume_st returns the open session and what was answered', async () => {
    const a = await WQ.startSession({ code: 'AB12CD', new: { name: 'Kiran Example', force: true } });
    await WQ.recordAnswers({ st: a.st, a: [{ qid: qid(1), slot: 'B', ms: 4000 }] });
    const n = fake.db.quiz_sessions.length;
    const b = await WQ.startSession({ code: 'AB12CD', resume_st: a.st });
    expect(b.st).toBe(a.st);
    expect(b.resume.answered).toEqual([qid(1)]);
    expect(fake.db.quiz_sessions.length).toBe(n);
  });

  test("a remembered child opens the same teacher's NEXT quiz: the chip saved from the first code still starts a session", async () => {
    // The phone stored the chip it was given on code AB12CD; the teacher then sends a new quiz (code EF34GH).
    const SC2 = '66666666-6666-4666-8666-666666666666';
    fake.db.quiz_share_codes.push({ id: SC2, code: 'EF34GH', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER,
      teacher_name: 'Ms Example Teacher', topic: 'Parts of a plant', language: 'en', active: true, expires_at: future,
      invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, created_at: ago(2) });
    const out = await WQ.startSession({ code: 'EF34GH', chip: chipOf(KID_A) });
    expect(out.child).toEqual({ chip: T.chipId(SC2, KID_A), first: 'Zara', animal: T.animalFor(KID_A) });
    expect(fake.db.quiz_sessions.filter((s) => s.share_code_id === SC2 && s.student_id === KID_A)).toHaveLength(1);
    // a chip minted for a child this teacher never had is still unknown
    await expect(WQ.startSession({ code: 'EF34GH', chip: T.chipId(SC, KID_B) })).rejects.toMatchObject({ status: 404, body: { error: 'chip_unknown' } });
  });

  test('unknown chip 404; nobody named 400', async () => {
    await expect(WQ.startSession({ code: 'AB12CD', chip: 'ffffffffffffffff' })).rejects.toMatchObject({ status: 404, body: { error: 'chip_unknown' } });
    await expect(WQ.startSession({ code: 'AB12CD' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('E4 POST answers + E5 POST finish', () => {
  async function play(name, picks) {
    const s = await WQ.startSession({ code: 'AB12CD', new: { name, force: true } });
    const a = picks.map((slot, i) => ({ qid: qid(i + 1), slot, ms: 3000, seq: i + 1 }));
    return { s, rec: await WQ.recordAnswers({ st: s.st, a }) };
  }

  test('answers are recorded once; a re-sent batch is dup; a foreign qid is unknown', async () => {
    const { s, rec } = await play('Ali Example', ['B', 'A']);
    expect(rec).toEqual({ recorded: [qid(1), qid(2)], dup: [], unknown: [] });
    const sid = T.verify(s.st, 's').sid;
    expect(fake.db.quiz_answers.filter((r) => r.session_id === sid).map((r) => [r.selected_option, r.is_correct, r.response_time_seconds]))
      .toEqual([['B', true, 3], ['A', false, 3]]);
    const again = await WQ.recordAnswers({ st: s.st, a: [{ qid: qid(1), slot: 'C' }, { qid: 'nope', slot: 'A' }] });
    expect(again).toEqual({ recorded: [], dup: [qid(1)], unknown: ['nope'] });
    expect(fake.db.quiz_answers.find((r) => r.session_id === sid && r.question_id === qid(1)).selected_option).toBe('B');
    await expect(WQ.recordAnswers({ st: 'forged', a: [] })).rejects.toMatchObject({ status: 401 });
  });

  test('finish scores from the answers table, returns card with one star per right answer, review, challenge code', async () => {
    const { s } = await play('Sana Example', ['B', 'B', 'A', 'B']);
    const out = await WQ.finishSession({ st: s.st });
    expect(out.score).toEqual({ correct: 3, total: 4, pct: 75, level: 'developing' });
    expect(out.card).toEqual({ first: 'Sana', animal: expect.any(String), correct: 3, total: 4, stars: 3 });
    expect(out.counted).toBe(true);
    expect(out.review[2]).toMatchObject({ qid: qid(3), picked: 'A', correct_slot: 'B', ok: false, why: 'Because 3' });
    expect(out.challenge_code).toMatch(/^[A-Z0-9]{6}$/);
    const minted = fake.db.quiz_share_codes.find((c) => c.code === out.challenge_code);
    expect(minted).toMatchObject({ parent_share_code_id: SC, quiz_id: QUIZ, teacher_user_id: TEACHER });
    const row = fake.db.quiz_sessions.find((r) => r.id === T.verify(s.st, 's').sid);
    expect(row).toMatchObject({ status: 'completed', correct_answers: 3, total_questions_answered: 4, mastery_percentage: 75, mastery_level: 'developing' });
    expect(logEvent).toHaveBeenCalledWith('quiz_funnel.child_completed', expect.objectContaining({ channel: 'web', pct: 75 }));
    // finishing twice is the same result and the same challenge code, no second completion event
    logEvent.mockClear();
    const again = await WQ.finishSession({ st: s.st });
    expect(again.score).toEqual(out.score);
    expect(again.challenge_code).toBe(out.challenge_code);
    expect(logEvent).not.toHaveBeenCalledWith('quiz_funnel.child_completed', expect.anything());
    // a late answer after finishing changes nothing
    expect(await WQ.recordAnswers({ st: s.st, a: [{ qid: qid(4), slot: 'A' }] })).toMatchObject({ closed: true });
    expect(WhatsApp.sendMessage).not.toHaveBeenCalled();
    expect(WhatsApp.sendImageFromBuffer).not.toHaveBeenCalled();
  });

  test('fewer than half the questions answered is not a score (409), as on WhatsApp', async () => {
    const { s } = await play('Omar Example', ['B']);
    await expect(WQ.finishSession({ st: s.st })).rejects.toMatchObject({ status: 409, body: { error: 'too_few_answered', answered: 1, need: 2 } });
  });

  test('a second finish of the same child on another phone is practice: counted false', async () => {
    const first = await play('Hira Example', ['B', 'B', 'B', 'B']);
    await WQ.finishSession({ st: first.s.st });
    const kid = fake.db.students.find((s) => s.student_name === 'Hira Example');
    const s2 = await WQ.startSession({ code: 'AB12CD', chip: chipOf(kid.id) });
    expect(s2).toMatchObject({ counted: false, reason: 'finished_elsewhere' });
    await WQ.recordAnswers({ st: s2.st, a: [1, 2, 3, 4].map((n) => ({ qid: qid(n), slot: 'A' })) });
    const out = await WQ.finishSession({ st: s2.st });
    expect(out).toMatchObject({ counted: false, reason: 'finished_elsewhere' });
  });
});

describe('SCHEMA_v2 web items (media.web) in E2 and in grading', () => {
  const ORDER = {
    v: 2, type: 'order', stem: 'Put the growth of a plant in order.',
    options: [{ slot: 'A', text: 'leaves come', name: 'leaves come' }, { slot: 'B', text: 'seed is planted', name: 'seed is planted' },
      { slot: 'C', text: 'roots grow', name: 'roots grow' }, { slot: 'D', text: 'a shoot comes out', name: 'a shoot comes out' }],
    key: 'B,C,D,A', why: 'A plant grows from the seed up.', fb_right: 'Yes, seed first and leaves last.',
    read: { stem: 'Put the growth of a plant in order.', opts: ['leaves come', 'seed is planted', 'roots grow', 'a shoot comes out'] },
    source: { kind: 'transcript', quote: 'first the seed is planted then it grows roots', ok: true, at: '[07:05]' }, wa: { from: 'projected' },
  };
  beforeEach(() => { fake.db.quiz_questions[1].media = { web: ORDER }; });

  test('E2 sends the web item (type, its own options and ordered key) and never the source quote', async () => {
    const q2 = (await WQ.getQuiz('AB12CD')).quiz.questions[1];
    expect(q2).toMatchObject({ type: 'order', text: 'Put the growth of a plant in order.', correct_slot: 'B,C,D,A', source: { at: '[07:05]' } });
    expect(q2.options.map((o) => o.text)).toEqual(['leaves come', 'seed is planted', 'roots grow', 'a shoot comes out']);
    expect(JSON.stringify(q2)).not.toMatch(/grows roots/);
  });

  test('an order answer is graded IN ORDER against the web key, and the review shows the ordered key', async () => {
    const s = await WQ.startSession({ code: 'AB12CD', new: { name: 'Order Example', force: true } });
    const rec = await WQ.recordAnswers({ st: s.st, a: [{ qid: qid(1), slot: 'B' }, { qid: qid(2), slot: 'B,C,D,A' }, { qid: qid(3), slot: 'B' }] });
    expect(rec.recorded).toHaveLength(3);
    const sid = T.verify(s.st, 's').sid;
    expect(fake.db.quiz_answers.find((r) => r.session_id === sid && r.question_id === qid(2)).is_correct).toBe(true);
    const out = await WQ.finishSession({ st: s.st });
    expect(out.review[1]).toMatchObject({ correct_slot: 'B,C,D,A', ok: true });
    const s2 = await WQ.startSession({ code: 'AB12CD', new: { name: 'Sorted Example', force: true } });
    await WQ.recordAnswers({ st: s2.st, a: [{ qid: qid(2), slot: 'A,B,C,D' }] });
    const sid2 = T.verify(s2.st, 's').sid;
    expect(fake.db.quiz_answers.find((r) => r.session_id === sid2 && r.question_id === qid(2)).is_correct).toBe(false);
  });
});

describe('E6 GET board (the class league table)', () => {
  const done = (id, student, name, correct, total, hoursAgo, extra = {}) => ({
    id, quiz_id: QUIZ, share_code_id: SC, student_id: student, student_name: name, user_id: null, status: 'completed',
    correct_answers: correct, total_questions_answered: total, mastery_percentage: Math.round((100 * correct) / total),
    completed_at: ago(hoursAgo), created_at: ago(hoursAgo + 0.1), invited_by_student_id: null,
    device_ref: `dev-${id}`, // played on the web page: the class code's own sessions choose the first-finish rule
    ...extra,
  });

  test('ranked, ties share a place, top 7 then more_n, average, no teacher, no invited friend, first finish for a web quiz', () => {
    const kids = Array.from({ length: 9 }, (_, i) => `aaaaaaa${i}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
    fake.db.quiz_sessions.push(
      done('b0', kids[0], 'Amna One', 4, 4, 5), done('b1', kids[1], 'Bano Two', 4, 4, 5),
      done('b2', kids[2], 'Chand Three', 3, 4, 5), done('b3', kids[3], 'Dua Four', 2, 4, 5),
      done('b4', kids[4], 'Eman Five', 2, 4, 5), done('b5', kids[5], 'Faiz Six', 1, 4, 5),
      done('b6', kids[6], 'Gul Seven', 1, 4, 5), done('b7', kids[7], 'Huma Eight', 0, 4, 5),
      // kids[0] replayed later and got less — web arm keeps the FIRST finish (4/4)
      done('b0r', kids[0], 'Amna One', 1, 4, 1),
      // an invited friend is not this class
      done('f1', kids[8], 'Friend Nine', 4, 4, 2, { invited_by_student_id: kids[0] }),
    );
    return WQ.board('AB12CD').then((out) => {
      // KID_A (3/4 from seed) + 8 kids; teacher run excluded
      expect(out.finishers_n).toBe(9);
      expect(out.rows).toHaveLength(7);
      expect(out.more_n).toBe(2);
      expect(out.rows.slice(0, 3)).toEqual([
        { place: 1, first: 'Amna', animal: T.animalFor(kids[0]), correct: 4, total: 4 },
        { place: 1, first: 'Bano', animal: T.animalFor(kids[1]), correct: 4, total: 4 },
        expect.objectContaining({ place: 3, correct: 3 }),
      ]);
      expect(out.rows[3]).toMatchObject({ place: 3, correct: 3 });
      expect(out.rows.map((r) => r.first)).not.toContain('Ms');
      expect(out.rows.map((r) => r.first)).not.toContain('Friend');
      // (100+100+75+75+50+50+25+25+0)/9 = 55.6
      expect(out.class_avg_pct).toBe(56);
      expect(out.you).toBeUndefined();
    });
  });

  test('"you" is the child\'s own row when the session token is given', async () => {
    const s = await WQ.startSession({ code: 'AB12CD', new: { name: 'Iqra Example', force: true } });
    await WQ.recordAnswers({ st: s.st, a: [1, 2, 3, 4].map((n) => ({ qid: qid(n), slot: 'B' })) });
    await WQ.finishSession({ st: s.st });
    const out = await WQ.board('AB12CD', { st: s.st });
    expect(out.you).toEqual({ place: 1, correct: 4, total: 4, pct: 100 });
  });

  test('rankRows is competition ranking (1,1,3)', () => {
    const r = WQ.rankRows([{ first: 'a', pct: 50, correct: 2 }, { first: 'b', pct: 100, correct: 4 }, { first: 'c', pct: 100, correct: 4 }]);
    expect(r.map((x) => [x.first, x.place])).toEqual([['b', 1], ['c', 1], ['a', 3]]);
  });
});

describe('E7 POST me', () => {
  test('history of this phone\'s children and friends who finished their challenge', async () => {
    fake.db.quiz_sessions.push({ id: 'fr', quiz_id: QUIZ, share_code_id: SC, student_id: 'kid-friend', student_name: 'Rida Friend',
      status: 'completed', correct_answers: 2, total_questions_answered: 4, completed_at: ago(1), created_at: ago(1.1), invited_by_student_id: KID_A });
    const out = await WQ.me({ code: 'AB12CD', chips: [chipOf(KID_A)] });
    expect(out.history).toEqual([{ chip: chipOf(KID_A), topic: 'Parts of a plant', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), correct: 3, total: 4, pct: 75 }]);
    expect(out.friends_finished).toEqual([{ chip: chipOf(KID_A), first: 'Rida', topic: 'Parts of a plant', correct: 2, total: 4, outcome: 'lose' }]);
    expect(await WQ.me({ code: 'AB12CD', chips: ['0000000000000000'] })).toEqual({ history: [], friends_finished: [] });
  });
});

describe('E8 POST e', () => {
  test('only allow-listed props of the right shape reach the log: no names, no phones, no free text', () => {
    WQ.events({ events: [
      { n: 'q_answered', code: 'AB12CD', qid: qid(1), slot: 'B', ms: 4200, ok: true, name: 'Zara Example', phone: '920000000000' },
      { n: 'Bad Name!', code: 'AB12CD' },
      { n: 'm3_view', reason: 'free text with spaces', lang: 'ur' },
    ] });
    expect(logEvent).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenNthCalledWith(1, 'web_quiz.q_answered', { code: 'AB12CD', qid: qid(1), slot: 'B', ms: 4200, ok: true });
    expect(logEvent).toHaveBeenNthCalledWith(2, 'web_quiz.m3_view', { lang: 'ur' });
  });
});

describe('E8 iab: the in-app-browser flag the page sends on page_open', () => {
  test('iab 1/0 (what wq.js sends) reaches the log as 0/1; anything else is dropped', () => {
    WQ.events({ events: [
      { n: 'page_open', iab: 1, store: 1 },
      { n: 'page_open', iab: 0 },
      { n: 'page_open', iab: true },
      { n: 'page_open', iab: 7 },
      { n: 'page_open', iab: '1' },
    ] });
    const calls = logEvent.mock.calls;
    expect(calls[0]).toEqual(['web_quiz.page_open', { iab: 1, store: 1 }]);
    expect(calls[1]).toEqual(['web_quiz.page_open', { iab: 0 }]);
    expect(calls[2]).toEqual(['web_quiz.page_open', { iab: 1 }]);
    expect(calls[3]).toEqual(['web_quiz.page_open', {}]);
    expect(calls[4]).toEqual(['web_quiz.page_open', {}]);
  });
});

describe('E8 page props the edge needs (probe, ua, store, path, audio_fallback)', () => {
  test('ua capped at 300, store 0/1, path from a fixed set; probe carries a flat object under 4 KB', () => {
    WQ.events({ events: [
      { n: 'share_done', path: 'wa', store: 1, ua: 'x'.repeat(400) },
      { n: 'share_done', path: 'somewhere-else', store: 7 },
      { n: 'probe', probe: { storage: 'ok', share: 'no', iab: 'wa_android', nested: { no: 1 }, n: 3 } },
      { n: 'probe', probe: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'y'.repeat(150)])) },
      { n: 'audio_fallback', reason: 'stalled', qid: qid(1) },
    ] });
    const calls = logEvent.mock.calls;
    expect(calls[0]).toEqual(['web_quiz.share_done', { path: 'wa', store: 1, ua: 'x'.repeat(300) }]);
    expect(calls[1]).toEqual(['web_quiz.share_done', {}]);
    expect(calls[2]).toEqual(['web_quiz.probe', { probe: { storage: 'ok', share: 'no', iab: 'wa_android', n: 3 } }]);
    expect(calls[3]).toEqual(['web_quiz.probe', {}]);
    expect(calls[4]).toEqual(['web_quiz.audio_fallback', { reason: 'stalled', qid: qid(1) }]);
  });
});

describe('E10 GET media', () => {
  test('a URL picture redirects; an inline option picture is served as bytes; unknown is 404', async () => {
    expect(await WQ.media('AB12CD', qid(1), { k: 'q' })).toEqual({ redirect: 'https://example.org/q1.png' });
    const opt = await WQ.media('AB12CD', qid(1), { k: 'A' });
    expect(opt.contentType).toBe('image/jpeg');
    expect(opt.bytes.toString()).toBe('jpegbytes');
    await expect(WQ.media('AB12CD', qid(2), { k: 'q' })).rejects.toMatchObject({ status: 404 });
    await expect(WQ.media('AB12CD', 'video')).rejects.toMatchObject({ status: 404 });
  });
});

describe('a stem that points at a picture it does not have is never served (E2 guard)', () => {
  const pointless = (n, text) => Object.assign(fake.db.quiz_questions.find((q) => q.id === qid(n)), { question_text: text, media: {} });

  test('E2 leaves it out; n counts only playable questions; a picture-pointing stem WITH its picture still plays', async () => {
    fake.db.quiz_questions.find((q) => q.id === qid(1)).question_text = 'Look at the picture. Which part takes in water?';
    pointless(3, 'Look at the pictures. Which one is a LEAF?');
    const out = await WQ.getQuiz('AB12CD');
    expect(out.quiz.n).toBe(3);
    expect(out.quiz.questions.map((q) => q.qid)).toEqual([qid(1), qid(2), qid(4)]);
    expect(out.quiz.questions.map((q) => q.i)).toEqual([1, 2, 3]);
    expect(out.quiz.questions[0].img).toBeTruthy();
    expect(logEvent).toHaveBeenCalledWith('web_quiz.unplayable_skipped', expect.objectContaining({ quizId: QUIZ, n: 1, qids: [qid(3)] }));
  });

  test('the score and the half-answered floor count only playable questions; its qid is not an answer', async () => {
    pointless(3, 'تصویریں دیکھیں۔ ان میں پتا کون سا ہے؟');
    const s = await WQ.startSession({ code: 'AB12CD', new: { name: 'Hina Example', force: true } });
    const rec = await WQ.recordAnswers({ st: s.st, a: [{ qid: qid(1), slot: 'B' }, { qid: qid(3), slot: 'B' }] });
    expect(rec.unknown).toEqual([qid(3)]);
    // 1 of 3 playable answered: under half of 3 (need 2), so not yet a score
    await expect(WQ.finishSession({ st: s.st })).rejects.toMatchObject({ status: 409, body: { need: 2 } });
    await WQ.recordAnswers({ st: s.st, a: [{ qid: qid(2), slot: 'B' }, { qid: qid(4), slot: 'A' }] });
    const out = await WQ.finishSession({ st: s.st });
    expect(out.score).toMatchObject({ correct: 2, total: 3 });
  });

  test('emoji options ARE the pictures (today\'s WhatsApp picture question): served in English and Urdu', async () => {
    Object.assign(fake.db.quiz_questions.find((q) => q.id === qid(2)), {
      question_text: 'Look at the pictures. Which one is a LEAF?', option_a: '\u{1F338}', option_b: '\u{1F343}', option_c: '\u{1F330}', option_d: '\u{1F955}', media: {},
    });
    Object.assign(fake.db.quiz_questions.find((q) => q.id === qid(3)), {
      question_text: 'تصویریں دیکھیں۔ ان میں پتا کون سا ہے؟', option_a: '\u{1F338}', option_b: '\u{1F343}', option_c: '\u{1F330}', option_d: null, media: [],
    });
    const out = await WQ.getQuiz('AB12CD');
    expect(out.quiz.n).toBe(4);
  });

  test('words that only mention a picture, a quoted sentence, or a picture carried by the options still play', async () => {
    pointless(2, 'Why is a convex mirror image called virtual?');
    pointless(3, '“اس تصویر کو دیوار پر لٹکائیں” میں “لٹکائیں” کی جگہ کون سا لفظ آیا؟');
    Object.assign(fake.db.quiz_questions.find((q) => q.id === qid(4)), {
      question_text: 'Which picture shows a leaf?',
      media: { web: { v: 2, type: 'picture', key: 'B', stem: 'Which picture shows a leaf?',
        options: [{ slot: 'A', text: 'Root', pic: { kind: 'pictogram', name: 'root' } }, { slot: 'B', text: 'Leaf', pic: { kind: 'pictogram', name: 'leaf' } }, { slot: 'C', text: 'Stem', pic: { kind: 'pictogram', name: 'stem' } }] } },
    });
    const out = await WQ.getQuiz('AB12CD');
    expect(out.quiz.n).toBe(4);
  });
});

describe('E2 guard and the figure the page draws', () => {
  test('a picture-pointing stem with a figure spec that draws is served WITH the figure; one that cannot draw is left out', async () => {
    Object.assign(fake.db.quiz_questions.find((q) => q.id === qid(2)), {
      question_text: 'Look at the diagram. How many parts are shaded?',
      media: { figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 1 }] }, language: 'en' },
    });
    Object.assign(fake.db.quiz_questions.find((q) => q.id === qid(3)), {
      question_text: 'Look at the diagram. Which part is the root?',
      media: { figure: { type: 'no_such_figure_type' } },
    });
    const out = await WQ.getQuiz('AB12CD');
    const ids = out.quiz.questions.map((q) => q.qid);
    expect(ids).not.toContain(qid(3));
    const two = out.quiz.questions.find((q) => q.qid === qid(2));
    expect(two && two.figure && two.figure.svg).toBeTruthy();
  });
});
