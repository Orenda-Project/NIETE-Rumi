'use strict';
/**
 * The children's quiz sends fewer bubbles — and the child reads the same words,
 * in the same order.
 *
 * From 1 Oct 2026 Meta bills every message we send to a Pakistani number, and
 * the children's quiz was ~43% of NIETE's sends. Four places sent a line as a
 * bubble of its own when the very next bubble could carry it:
 *
 *   NQ1  the verdict ("✅ Correct! The answer is …") before the next question
 *        — folded into that question when it OPENS WITH TEXT (buttons with no
 *        picture header, a list, the listen line). A question that opens with a
 *        picture keeps today's separate verdict: putting the verdict under the
 *        next question's picture is a product decision (D1), not a fold. The
 *        child's own tap also gets a free ✅/❌ reaction.
 *   NQ2  the greeting / "let's begin" and "Here we go — n questions" before
 *        question 1 — one bubble with question 1 when it opens with text; one
 *        text instead of two when it opens with a picture.
 *   NQ3  a double tap re-sent the question already waiting on screen.
 *   NQ4  the scorecard image and the "invite a friend" buttons — one message,
 *        the scorecard as the header.
 *   NQ5  the greeting and the lesson-video note — one text before the upload.
 *
 * Driven through the REAL video-quiz service, render, sender, share, invite and
 * scorecard services, against one stateful in-memory database. Only the network
 * (WhatsApp, the queue), Redis, the picture renderer and the logs are stand-ins.
 */

jest.mock('uuid', () => ({ v4: () => 'stub-uuid' }), { virtual: true });

const { createMemorySupabase } = require('./helpers/memory-supabase');

let mockDb;
// quiz_answers carries UNIQUE(session_id, question_id) in production; a second
// insert for the same pair is the 23505 the double-tap path runs on.
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => {
    const b = mockDb.from(t);
    if (t !== 'quiz_answers') return b;
    const insert = b.insert.bind(b);
    b.insert = (row) => {
      const dup = mockDb.table('quiz_answers')
        .some((a) => a.session_id === row.session_id && a.question_id === row.question_id);
      if (dup) {
        return { then: (res, rej) => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }).then(res, rej) };
      }
      return insert(row);
    };
    return b;
  },
  rpc: (n, a) => mockDb.rpc(n, a),
}));

const mockKv = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (k) => (mockKv.has(k) ? JSON.parse(mockKv.get(k)) : null)),
  set: jest.fn(async (k, v) => { mockKv.set(k, JSON.stringify(v)); return true; }),
  setNX: jest.fn(async (k, v) => { if (mockKv.has(k)) return false; mockKv.set(k, JSON.stringify(v)); return true; }),
  delete: jest.fn(async (k) => { mockKv.delete(k); return true; }),
}));

// Every WhatsApp call is recorded, whatever its name — a send this suite did not
// anticipate still shows up in the count.
const mockSent = [];
const mockFail = new Set();
const mockFailOnce = new Set();
jest.mock('../../bot/shared/services/whatsapp.service', () => new Proxy({}, {
  get: (_, fn) => (fn === 'then' || typeof fn === 'symbol' ? undefined : async (to, ...args) => {
    mockSent.push({ fn: String(fn), to, args });
    if (mockFailOnce.delete(String(fn))) return false;
    return !mockFail.has(String(fn));
  }),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined), WINDOW_MS: 300000,
}));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn().mockResolvedValue('job-1') }));
let mockPng = Buffer.from('PNG-scorecard');
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToImage: jest.fn(async () => mockPng),
  htmlToPdf: jest.fn(async () => Buffer.from('%PDF')),
}));
// The teacher-side effects of a finish are not under test here; the order they
// run in relative to the child's messages is.
const mockReportCalls = [];
jest.mock('../../bot/shared/services/quiz/video-quiz-report.service', () => ({
  ...jest.requireActual('../../bot/shared/services/quiz/video-quiz-report.service'),
  maybeSendFollowUp: jest.fn(async () => { mockReportCalls.push('followUp'); return null; }),
  sendLateClassCards: jest.fn(async () => { mockReportCalls.push({ lateClassCards: mockSent.length }); return { sent: 0 }; }),
  scheduleForShareCode: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

// Pacing is real code but not under test: run every timer at once.
const realSetTimeout = global.setTimeout;
beforeAll(() => {
  global.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);
});
afterAll(() => { global.setTimeout = realSetTimeout; });

const { resolveUx } = require('../../bot/shared/config/ux-strings');
const VQ = require('../../bot/shared/services/quiz/video-quiz.service');
const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
const { normalisePhone } = require('../../bot/shared/services/quiz/student-identity.service');

const PHONE = '923001112233';
const ux = (key, language, params) => resolveUx(key, { language, params });

/** A text question: three short options, so its picker is plain buttons with no picture. */
const textQ = (n, over = {}) => ({
  id: `q-${n}`, quiz_id: 'quiz-1', external_id: `tq:quiz-1:S1:${n}`, sort_order: n,
  question_text: `What is ${n} + ${n}?`, option_a: `${2 * n}`, option_b: `${2 * n + 1}`, option_c: `${2 * n + 2}`,
  option_d: null, correct_option: 'A', explanation: `${n} and ${n} make ${2 * n}.`,
  option_feedback: null, media: { display_order: [0, 1, 2] }, render_pattern: 'P1', ...over,
});
/** A question CARD: the whole question is a picture, riding as the buttons' header. */
const cardQ = (n) => textQ(n, { media: { question_card: `https://cdn.example/card-${n}.png`, display_order: [0, 1, 2] } });

/** What Meta bills: every send except a reaction or a typing indicator. */
const billed = () => mockSent.filter((s) => !/Reaction|Typing/i.test(s.fn));
const reactions = () => mockSent.filter((s) => s.fn === 'sendReaction');
/** The text a child reads on a send, whatever its kind. */
function bodyOf(s) {
  switch (s.fn) {
    case 'sendMessage': case 'sendTextReturningId': return s.args[0];
    case 'sendInteractiveButtons': return s.args[0].body;
    case 'sendInteractiveMessage': return s.args[0].body.text;
    case 'sendImageWithButtons': return s.args[1];
    case 'sendImageBufferWithButtons': return s.args[1];
    case 'sendImageFromUrl': case 'sendImageFromBuffer': return s.args[1];
    case 'sendVideoFromUrl': return s.args[1];
    case 'sendFlow': return s.args[0].body;
    default: return '';
  }
}

function seed({ questions, extra = {} } = {}) {
  mockDb = createMemorySupabase({
    quiz_questions: questions,
    quizzes: [{ id: 'quiz-1', topic: 'Addition', grade: '4', subject: 'Maths', quiz_source: 'transcript' }],
    quiz_sessions: [{ id: 'sess-1', quiz_id: 'quiz-1', status: 'in_progress', total_questions_answered: 0, correct_answers: 0 }],
    quiz_answers: [],
    ...extra,
  });
}

/** A session mid-quiz: question `index` was sent and is waiting for its answer. */
function midQuiz({ index = 0, n = 3, language = 'en', over = {} } = {}) {
  const ids = Array.from({ length: n }, (_, k) => `q-${k + 1}`);
  mockKv.set(VQ.STATE_KEY(PHONE), JSON.stringify({
    sessionId: 'sess-1', quizId: 'quiz-1', videoId: null, userId: null, language, source: 'share_link',
    shareCodeId: null, studentId: null, takerName: 'Ali', questionIds: ids,
    index, correct: 0, answered: index, currentQuestionId: ids[index], sentAt: Date.now(), ...over,
  }));
}

beforeEach(() => {
  mockSent.length = 0;
  mockFail.clear();
  mockFailOnce.clear();
  mockKv.clear();
  mockReportCalls.length = 0;
  mockPng = Buffer.from('PNG-scorecard');
  delete process.env.CLASS_CARD_ENABLED;
  delete process.env.STUDENT_JOIN_LOCALIZED_FLOW_ID;
  delete process.env.STUDENT_JOIN_FLOW_ID;
});

// ─── NQ1 — the verdict rides on the next question when it opens with text ────
describe('NQ1 — the verdict rides on the next question when that one opens with text', () => {
  test('right answer, next question is text: ONE bubble — the verdict, then the counter, then the question; ✅ on the tap', async () => {
    seed({ questions: [textQ(1), textQ(2), textQ(3)] });
    midQuiz({ index: 0 });

    await VQ.handleAnswer(PHONE, 'vq_q-1_0', { messageId: 'wamid.tap-1' });

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendInteractiveButtons']);
    expect(bodyOf(sends[0])).toBe(
      '✅ Correct! The answer is 2.\n\n1 and 1 make 2.\n\n*Question 2 of 3*\n\nWhat is 2 + 2?',
    );
    expect(sends[0].args[0].buttons.map((b) => b.title)).toEqual(['4', '5', '6']);
    expect(reactions()).toEqual([{ fn: 'sendReaction', to: PHONE, args: ['wamid.tap-1', '✅'] }]);
  });

  test('wrong answer: ❌ on the tap, and the whole "Not quite … Keep going" verdict sits above question 2', async () => {
    seed({ questions: [textQ(1), textQ(2), textQ(3)] });
    midQuiz({ index: 0 });

    await VQ.handleAnswer(PHONE, 'vq_q-1_1', { messageId: 'wamid.tap-2' });

    const sends = billed();
    expect(sends).toHaveLength(1);
    expect(bodyOf(sends[0])).toBe('❌ Not quite — the answer is 2.\n\n1 and 1 make 2.\n\n'
      + 'Keep going, mistakes help you learn!\n\n*Question 2 of 3*\n\nWhat is 2 + 2?');
    expect(reactions().map((r) => r.args[1])).toEqual(['❌']);
  });

  test('the listen line opens the next question: the verdict rides on THAT text, the clip and picker follow', async () => {
    seed({ questions: [textQ(1), textQ(2, { media: { question_audio: ['https://cdn.example/q2.mp3'], display_order: [0, 1, 2] } })] });
    midQuiz({ index: 0, n: 2 });

    await VQ.handleAnswer(PHONE, 'vq_q-1_0', { messageId: 'wamid.tap-3' });

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendAudioFromUrlReturningId', 'sendInteractiveButtons']);
    expect(bodyOf(sends[0])).toBe('✅ Correct! The answer is 2.\n\n1 and 1 make 2.\n\n'
      + '*Question 2 of 2*\n\n🎧 What is 2 + 2?\nListen, then choose your answer.');
  });

  test('no inbound message id: no reaction is attempted, and the verdict still rides on the question', async () => {
    seed({ questions: [textQ(1), textQ(2)] });
    midQuiz({ index: 0, n: 2 });

    await VQ.handleAnswer(PHONE, 'vq_q-1_0');

    expect(reactions()).toEqual([]);
    expect(billed()).toHaveLength(1);
    expect(bodyOf(billed()[0]).startsWith('✅ Correct! The answer is 2.')).toBe(true);
  });

  test('D1 boundary — the next question opens with a PICTURE: the verdict keeps its own bubble, sent first', async () => {
    seed({ questions: [textQ(1), cardQ(2)] });
    midQuiz({ index: 0, n: 2 });

    await VQ.handleAnswer(PHONE, 'vq_q-1_0', { messageId: 'wamid.tap-4' });

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendImageWithButtons']);
    expect(bodyOf(sends[0])).toBe('✅ Correct! The answer is 2.\n\n1 and 1 make 2.');
    expect(bodyOf(sends[1])).not.toContain('Correct');
    // The free reaction still lands at once on the tap.
    expect(reactions().map((r) => r.args[1])).toEqual(['✅']);
  });

  test('an answer that carries media (an explanation picture) keeps its verdict bubble — a picture cannot be folded', async () => {
    seed({ questions: [textQ(1, { media: { explanation_image: 'https://cdn.example/why.png', display_order: [0, 1, 2] } }), textQ(2)] });
    midQuiz({ index: 0, n: 2 });

    await VQ.handleAnswer(PHONE, 'vq_q-1_0', { messageId: 'wamid.tap-5' });

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendImageFromUrl', 'sendInteractiveButtons']);
    expect(bodyOf(sends[2]).startsWith('*Question 2 of 2*')).toBe(true);
  });

  test('over Meta\'s 1,024 body cap when merged: today\'s two bubbles, verdict first', async () => {
    const long = `${'Read the passage carefully. '.repeat(34)}Which word is a noun?`;
    seed({ questions: [textQ(1), textQ(2, { question_text: long })] });
    midQuiz({ index: 0, n: 2 });

    await VQ.handleAnswer(PHONE, 'vq_q-1_0', { messageId: 'wamid.tap-6' });

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendInteractiveButtons']);
    expect(bodyOf(sends[0])).toBe('✅ Correct! The answer is 2.\n\n1 and 1 make 2.');
    expect([...bodyOf(sends[1])].length).toBeLessThanOrEqual(1024);
  });

  test('the bubble carrying the verdict fails to send: the verdict goes on its own, then the question is retried', async () => {
    seed({ questions: [textQ(1), textQ(2)] });
    midQuiz({ index: 0, n: 2 });
    mockFailOnce.add('sendInteractiveButtons');

    await VQ.handleAnswer(PHONE, 'vq_q-1_0', { messageId: 'wamid.tap-9' });

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendInteractiveButtons', 'sendMessage', 'sendInteractiveButtons']);
    expect(bodyOf(sends[1])).toBe('✅ Correct! The answer is 2.\n\n1 and 1 make 2.');
    expect(bodyOf(sends[2])).toBe('*Question 2 of 2*\n\nWhat is 2 + 2?');
  });

  test('the LAST answer: the verdict keeps its bubble ahead of the result', async () => {
    seed({ questions: [textQ(1), textQ(2)] });
    mockPng = null;   // the scorecard picture cannot be drawn: the result is plain text
    midQuiz({ index: 1, n: 2 });
    mockDb.table('quiz_answers').push({ session_id: 'sess-1', question_id: 'q-1', selected_option: 'A', is_correct: true });

    await VQ.handleAnswer(PHONE, 'vq_q-2_0', { messageId: 'wamid.tap-7' });

    const sends = billed();
    expect(bodyOf(sends[0])).toBe('✅ Correct! The answer is 4.\n\n2 and 2 make 4.');
    expect(bodyOf(sends[1])).toContain('All done!');
  });

  test('Urdu quiz: the chrome around the folded verdict is Urdu', async () => {
    seed({ questions: [textQ(1, { option_feedback: { correct: 'شاباش! 1 اور 1 مل کر 2 بنتے ہیں۔' } }), textQ(2, { question_text: '2 اور 2 کتنے ہوتے ہیں؟' })] });
    midQuiz({ index: 0, n: 2, language: 'ur' });

    await VQ.handleAnswer(PHONE, 'vq_q-1_0', { messageId: 'wamid.tap-8' });

    const sends = billed();
    expect(sends).toHaveLength(1);
    expect(bodyOf(sends[0])).toBe('✅ شاباش! 1 اور 1 مل کر 2 بنتے ہیں۔\n\n*سوال 2 از 2*\n\n2 اور 2 کتنے ہوتے ہیں؟');
  });
});

// ─── NQ3 — a double tap does not re-send the question already on screen ─────
describe('NQ3 — a double tap no longer re-sends the question already on screen', () => {
  function answeredFirstSentSecond(over = {}) {
    seed({ questions: [textQ(1), textQ(2), textQ(3)] });
    mockDb.table('quiz_answers').push({ session_id: 'sess-1', question_id: 'q-1', selected_option: 'A', is_correct: true });
    midQuiz({ index: 1, over: { answered: 1, correct: 1, ...over } });
  }

  test('the same answer tapped again seconds later: nothing is sent', async () => {
    answeredFirstSentSecond();
    await VQ.handleAnswer(PHONE, 'vq_q-1_0', { messageId: 'wamid.dup-1' });
    expect(billed()).toEqual([]);
    // The question is still the one waiting.
    expect(JSON.parse(mockKv.get(VQ.STATE_KEY(PHONE))).currentQuestionId).toBe('q-2');
  });

  test('a re-tap long after the question went out still re-sends it (the child may have lost it)', async () => {
    answeredFirstSentSecond({ sentAt: Date.now() - 3 * 60 * 1000 });
    await VQ.handleAnswer(PHONE, 'vq_q-1_0');
    expect(billed().map((s) => s.fn)).toEqual(['sendInteractiveButtons']);
    expect(bodyOf(billed()[0])).toBe('*Question 2 of 3*\n\nWhat is 2 + 2?');
  });

  test('the answer was stored but the next question never went out (a deploy mid-answer): it is sent', async () => {
    answeredFirstSentSecond({ currentQuestionId: 'q-1', index: 0 });
    await VQ.handleAnswer(PHONE, 'vq_q-1_0');
    expect(billed().map((s) => s.fn)).toEqual(['sendInteractiveButtons']);
    expect(bodyOf(billed()[0])).toBe('*Question 2 of 3*\n\nWhat is 2 + 2?');
  });
});

// ─── NQ2 / NQ5 — the opening lines ride with what follows them ──────────────
describe('NQ2 / NQ5 — greeting, "Here we go" and the lesson note', () => {
  function seedJoin({ language = 'en', q1 = textQ(1), videoId = null } = {}) {
    seed({
      questions: [q1, textQ(2), textQ(3)],
      extra: {
        quiz_sessions: [],
        quiz_share_codes: [{
          id: 'sc-1', code: 'K7RM2P', quiz_id: 'quiz-1', video_id: videoId, teacher_user_id: 't-1',
          teacher_name: 'Amna', topic: 'Addition', language, active: true, expires_at: null,
          invited_by_student_id: null, parent_share_code_id: null,
        }],
        users: [{ id: 't-1', phone_number: '923339999999', name: 'Amna' }],
        students: [{ id: 'st-1', phone: normalisePhone(PHONE), is_active: true, student_name: 'Ali', self_reported_class: '4', created_at: '2026-09-01T00:00:00Z' }],
        student_videos: [{ id: 'v-1', grade: '4', subject: 'Maths', clean_title: 'Adding small numbers', r2_url: 'https://cdn.example/v1.mp4', migration_status: 'done' }],
      },
    });
  }
  const greetingEn = () => `${ux('vqGreeting', 'en', { teacher: 'Amna', topic: 'Addition' })}\n\n${ux('vqWelcomeBack', 'en', { name: 'Ali' })}`;

  test('a known child, question 1 opens with text: greeting + welcome back + "Here we go" + question 1 are ONE bubble', async () => {
    seedJoin();
    await Share.beginFromCode(PHONE, 'K7RM2P');

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendInteractiveButtons']);
    expect(bodyOf(sends[0])).toBe(`${greetingEn()}\n\nHere we go — 3 questions. Take your time!\n\n*Question 1 of 3*\n\nWhat is 1 + 1?`);
  });

  test('a known child, question 1 opens with a PICTURE: the greeting and "Here we go" are one text, the card follows', async () => {
    seedJoin({ q1: cardQ(1) });
    await Share.beginFromCode(PHONE, 'K7RM2P');

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendImageWithButtons']);
    expect(bodyOf(sends[0])).toBe(`${greetingEn()}\n\nHere we go — 3 questions. Take your time!`);
    expect(bodyOf(sends[1])).toBe('The question is in the picture above. Tap A, B or C.');
  });

  test('a known child, Urdu: the same one bubble, in Urdu', async () => {
    seedJoin({ language: 'ur' });
    await Share.beginFromCode(PHONE, 'K7RM2P');

    const sends = billed();
    expect(sends).toHaveLength(1);
    const body = bodyOf(sends[0]);
    expect(body.startsWith(ux('vqGreeting', 'ur', { teacher: 'Amna', topic: 'Addition' }))).toBe(true);
    expect(body).toContain(ux('vqWelcomeBack', 'ur', { name: 'Ali' }));
    expect(body).toContain(`${ux('vqHereWeGo', 'ur', { n: 3 })}\n\n*سوال 1 از 3*\n\nWhat is 1 + 1?`);
  });

  test('NQ5 — a lesson goes first: the greeting and the lesson note are ONE text before the upload; "Here we go" rides on question 1', async () => {
    seedJoin({ videoId: 'v-1' });
    await Share.beginFromCode(PHONE, 'K7RM2P');

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendVideoFromUrl', 'sendInteractiveButtons']);
    expect(bodyOf(sends[0])).toBe(`${greetingEn()}\n\n🎬 First, here is the lesson. Watch it, then I will ask you about it.`);
    expect(bodyOf(sends[1])).toBe('📚 Grade 4 · Maths\nAdding small numbers');
    expect(bodyOf(sends[2])).toBe('Here we go — 3 questions. Take your time!\n\n*Question 1 of 3*\n\nWhat is 1 + 1?');
  });

  test('a new child answering in chat: "Great — Ali, 4. Let\'s begin!" rides with "Here we go" on question 1', async () => {
    seedJoin();
    mockDb.table('students').length = 0;
    await Share.beginFromCode(PHONE, 'K7RM2P');           // asks the name (no Flow configured)
    await Share.consumeJoinReply(PHONE, 'Ali');           // asks the class
    mockSent.length = 0;
    await Share.consumeJoinReply(PHONE, '4');

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendInteractiveButtons']);
    expect(bodyOf(sends[0]).startsWith(`${ux('vqLetsBegin', 'en', { who: ux('vqWhoNameClass', 'en', { name: 'Ali', cls: '4' }) })}\n\nHere we go — 3 questions.`)).toBe(true);
  });

  test('the quiz cannot start (no questions): the greeting is not lost — it rides on the apology', async () => {
    seedJoin();
    mockDb.table('quiz_questions').length = 0;
    await Share.beginFromCode(PHONE, 'K7RM2P');

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage']);
    expect(bodyOf(sends[0])).toBe(`${greetingEn()}\n\n${ux('vqNoQuestions', 'en')}`);
  });

  test('a teacher taking the quiz after a video (no greeting): "Here we go" rides on question 1', async () => {
    seed({ questions: [textQ(1), textQ(2)], extra: { quiz_sessions: [], users: [{ id: 'u-1', name: 'Amna' }] } });
    await VQ.startSession({ phone: PHONE, userId: 'u-1', quizId: 'quiz-1', videoId: 'v-9', language: 'en', source: 'video_solo' });

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendInteractiveButtons']);
    expect(bodyOf(sends[0])).toBe('Here we go — 2 questions. Take your time!\n\n*Question 1 of 2*\n\nWhat is 1 + 1?');
  });
});

// ─── NQ4 — the scorecard rides as the header of the invite ──────────────────
describe('NQ4 — the scorecard image is the header of the "invite a friend" message', () => {
  function lastAnswerPending(over = {}) {
    seed({ questions: [textQ(1), textQ(2)], extra: { quiz_share_codes: [{ id: 'sc-1', report_sent_at: null }] } });
    mockDb.table('quiz_answers').push({ session_id: 'sess-1', question_id: 'q-1', selected_option: 'A', is_correct: true });
    midQuiz({ index: 1, n: 2, over: { shareCodeId: 'sc-1', studentId: 'st-1', ...over } });
  }
  const askEn = () => ux('vqInviteAsk', 'en');

  test('one message: the scorecard picture as the header, its caption + the invite question as the body, the two buttons', async () => {
    lastAnswerPending();
    await VQ.handleAnswer(PHONE, 'vq_q-2_0', { messageId: 'wamid.last' });

    const sends = billed();
    // the verdict, then ONE result message
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendImageBufferWithButtons']);
    const [, png, body, buttons] = [null, ...sends[1].args];
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(body.startsWith('🎉 All done!\n\nYou got *2 out of 2* right (100%).')).toBe(true);
    expect(body.endsWith(`\n\n${askEn()}`)).toBe(true);
    expect(buttons.map((b) => [b.id, b.title])).toEqual([['vq_invite_yes', 'Invite a friend'], ['vq_invite_no', 'No thanks']]);
    // The invite is still armed: the silence job is queued and the taps resolve.
    expect(mockKv.has('videoquiz:923001112233:invite')).toBe(true);
  });

  test('the picture could not be drawn: the text result and the invite question are one buttons message', async () => {
    lastAnswerPending();
    mockPng = null;
    await VQ.handleAnswer(PHONE, 'vq_q-2_0');

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendInteractiveButtons']);
    expect(bodyOf(sends[1]).startsWith('🎉 All done!')).toBe(true);
    expect(bodyOf(sends[1]).endsWith(`\n\n${askEn()}`)).toBe(true);
  });

  test('the combined send fails: the scorecard is never lost — today\'s two messages go instead', async () => {
    lastAnswerPending();
    mockFail.add('sendImageBufferWithButtons');
    await VQ.handleAnswer(PHONE, 'vq_q-2_0');

    const fns = billed().map((s) => s.fn);
    expect(fns).toEqual(['sendMessage', 'sendImageBufferWithButtons', 'sendImageFromBuffer', 'sendInteractiveButtons']);
    expect(bodyOf(billed()[3])).toBe(askEn());
  });

  test('the invite cannot even be set up (Redis throws): the scorecard still reaches the child, on its own', async () => {
    lastAnswerPending();
    const redis = require('../../bot/shared/services/cache/railway-redis.service');
    const realSet = redis.set.getMockImplementation();
    redis.set.mockImplementation(async (k, v) => {
      if (/:invite$/.test(k)) throw new Error('redis down');
      return realSet(k, v);
    });
    try {
      await VQ.handleAnswer(PHONE, 'vq_q-2_0');
    } finally {
      redis.set.mockImplementation(realSet);
    }

    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendImageFromBuffer']);
    expect(bodyOf(sends[1]).startsWith('🎉 All done!')).toBe(true);
  });

  test('a late finisher whose class card goes now keeps today\'s order: scorecard, class card, then the invite', async () => {
    lastAnswerPending();
    process.env.CLASS_CARD_ENABLED = 'true';
    mockDb.table('quiz_share_codes')[0].report_sent_at = '2026-10-01T02:00:00Z';
    await VQ.handleAnswer(PHONE, 'vq_q-2_0');

    const fns = billed().map((s) => s.fn);
    expect(fns).toEqual(['sendMessage', 'sendImageFromBuffer', 'sendInteractiveButtons']);
    // the class-card step ran after the scorecard and before the invite
    const cardStep = mockReportCalls.find((c) => c && c.lateClassCards !== undefined);
    expect(cardStep.lateClassCards).toBe(mockSent.findIndex((s) => s.fn === 'sendImageFromBuffer') + 1);
  });

  test('no invite to offer (no student record): the scorecard is sent exactly as before', async () => {
    lastAnswerPending({ studentId: null });
    await VQ.handleAnswer(PHONE, 'vq_q-2_0');
    expect(billed().map((s) => s.fn)).toEqual(['sendMessage', 'sendImageFromBuffer']);
  });
});

// ─── NQ5 — a watch-more child gets one note before the lesson video ────────
describe('NQ5 — a child picking a video from the library: one note before it, not two', () => {
  const Endpoint = require('../../bot/shared/routes/student-videos-endpoint');
  const ChildFlowToken = require('../../bot/shared/services/quiz/child-flow-token');
  const settle = async () => { for (let i = 0; i < 50; i += 1) await new Promise((r) => realSetTimeout(r, 0)); };

  function seedLibrary({ withQuiz = true } = {}) {
    seed({
      questions: [textQ(1), textQ(2)],
      extra: {
        quizzes: withQuiz ? [{ id: 'quiz-1', video_id: 'v-1', quiz_source: 'video', topic: 'Addition' }] : [],
        quiz_sessions: [],
        students: [{ id: 'st-1', student_name: 'Ali', self_reported_class: '4' }],
        student_videos: [{ id: 'v-1', grade: '4', subject: 'Maths', clean_chapter: 'Numbers', clean_title: 'Adding small numbers', r2_url: 'https://cdn.example/v1.mp4', migration_status: 'done' }],
      },
    });
  }
  const pick = () => Endpoint.handleStudentVideosDataExchange(
    ChildFlowToken.build({ phone: PHONE, shareCodeId: 'sc-1', studentId: 'st-1', language: 'en' }),
    'SELECT_TOPIC', { grade: '4', subject: 'Maths', video: 'v-1' },
  );

  test('the video has a quiz: no "Sending your video" ack — the lesson note is the one note, then the video, then question 1', async () => {
    seedLibrary();
    const screen = await pick();
    expect(screen.screen).toBe('SUCCESS');   // the Flow still says it is on its way
    await settle();

    const sends = billed();
    expect(sends.some((s) => /Sending your video/.test(bodyOf(s)))).toBe(false);
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendVideoFromUrl', 'sendInteractiveButtons']);
    expect(bodyOf(sends[0])).toBe('🎬 First, here is the lesson. Watch it, then I will ask you about it.');
  });

  test('a video with no quiz has no lesson note, so it keeps its ack', async () => {
    seedLibrary({ withQuiz: false });
    await pick();
    await settle();
    const sends = billed();
    expect(sends.map((s) => s.fn)).toEqual(['sendMessage', 'sendVideoFromUrl']);
    expect(bodyOf(sends[0])).toMatch(/^🎬 Sending your video: Grade 4 Maths — Adding small numbers/);
  });
});
