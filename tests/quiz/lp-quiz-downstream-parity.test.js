'use strict';
/**
 * A quiz written from the LESSON PLAN a teacher was served (lp_v8) gets
 * everything after authoring that a quiz written from a coaching RECORDING
 * (transcript) gets — the operator's words: "the report going to the teacher
 * afterwards should work … as it usually happens in the transcript quiz.
 * Student card and student leaderboard too."
 *
 * One chain, driven twice — once per source — through the REAL services, over
 * ONE stateful in-memory database (helpers/memory-supabase.js), so what one
 * step writes is what the next one reads:
 *
 *   hand-off (PDF, forwardable link, report promise, nudge queued)
 *   → the six-hour nudge
 *   → a child opens the link, gives a name and class, answers every question
 *   → the child's scorecard
 *   → the scheduled class report (PDF, objectives to reteach) + class cards
 *   → /quiz: the lesson's Resend link / Generate report, list message and Flow
 *   → the child's own /quiz and class card
 *
 * Mocked at the network boundary only: the database, WhatsApp, the queue,
 * Redis, R2, the headless browser and the OpenAI client. The send pacing
 * (sleeps between messages, the per-child rate limiter) is collapsed so eight
 * questions do not take a minute — what is sent, to whom and in what order is
 * untouched.
 */

const { createMemorySupabase } = require('./helpers/memory-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => mockDb.from(t),
  rpc: (n, a) => mockDb.rpc(n, a),
}));

const mockSent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => new Proxy({}, {
  get: (_, fn) => {
    if (fn === 'then' || fn === '__esModule') return undefined;
    return async (to, ...args) => {
      mockSent.push({ fn: String(fn), to, args });
      return String(fn).includes('ReturningId') ? `wamid.${mockSent.length}` : true;
    };
  },
}));

const mockJobs = [];
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn(async (groupId, jobType, payload, opts) => {
    mockJobs.push({ groupId, jobType, payload, opts });
    return `mid-${mockJobs.length}`;
  }),
  extendJobTimeout: jest.fn(async () => {}),
  extendQuizJobTimeout: jest.fn(async () => {}),
}));

const mockKv = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => true,
  get: async (k) => (mockKv.has(k) ? JSON.parse(JSON.stringify(mockKv.get(k))) : null),
  set: async (k, v) => { mockKv.set(k, JSON.parse(JSON.stringify(v))); return true; },
  setNX: async (k, v) => { if (mockKv.has(k)) return false; mockKv.set(k, v); return true; },
  setex: async (k, _s, v) => { mockKv.set(k, v); return true; },
  setexWithCeiling: async (k, _s, v) => { mockKv.set(k, v); return true; },
  delete: async (k) => { mockKv.delete(k); return true; },
  del: async (k) => { mockKv.delete(k); return true; },
  exists: async (k) => mockKv.has(k),
  expire: async () => true,
  incr: async (k) => { const n = (Number(mockKv.get(k)) || 0) + 1; mockKv.set(k, n); return n; },
  getTTL: async () => 60,
  acquireLock: async () => true,
  releaseLock: async () => true,
}));

const mockR2 = new Map();
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: async (buf, key) => { mockR2.set(key, buf); return `https://r2.test/${key}`; },
  uploadImageBuffer: async (buf, key) => { mockR2.set(key, buf); return `https://r2.test/${key}`; },
  downloadFromR2: async (key) => { if (!mockR2.has(key)) throw new Error('NoSuchKey'); return mockR2.get(key); },
  buildR2PublicUrl: (k) => `https://r2.test/${k}`,
  getPresignedUrl: async (k) => `https://r2.test/${k}`,
}));

const mockPdfHtml = [];
const mockImageHtml = [];
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: async (html) => { mockPdfHtml.push(html); return Buffer.from('%PDF-1.4 test'); },
  htmlToImage: async (html) => { mockImageHtml.push(html); return Buffer.from('PNG'); },
  closeBrowser: async () => {},
}));

const mockGuidancePrompts = [];
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      create: async ({ messages }) => {
        const prompt = messages[messages.length - 1].content;
        mockGuidancePrompts.push(prompt);
        const reteach = /"muddled"/.test(prompt);
        const content = reteach
          ? { muddled: 'They carry out of every column.', board: 'Write 146 + 27 on the board. Ask which column reaches ten. Carry only there.', check: 'Which column carries in 318 + 45?' }
          : { secure: 'They can add with carrying.', stretch: 'Give 318 + 245. Ask which columns carry. Let them explain.' };
        return { choices: [{ message: { content: JSON.stringify(content) } }] };
      },
    },
  },
})));

const mockEvents = [];
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, fields) => { mockEvents.push({ name, ...(fields || {}) }); },
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));

// Pacing only: the limiter decides WHEN a send goes, never WHAT or to WHOM.
jest.mock('../../bot/shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: async () => {},
}));

const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Nudge = require('../../bot/shared/services/quiz/transcript-quiz-nudge.service');
const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
const Engine = require('../../bot/shared/services/quiz/video-quiz.service');
const Report = require('../../bot/shared/services/quiz/video-quiz-report.service');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');
const Endpoint = require('../../bot/shared/routes/transcript-quiz-flow-endpoint');
const StudentQuiz = require('../../bot/shared/services/quiz/student-quiz.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

// ── fixtures (synthetic — no real teacher, child or lesson) ─────────────────
const TEACHER = '11111111-1111-4111-8111-111111111111';
const TPHONE = '923000000011';
const CHILD = '923000000022';
const CHILD2 = '923000000033';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const LESSON_DAY = '2026-09-22';

const DIGEST = {
  topic: 'Adding with carrying', topic_as_taught: 'Adding with carrying', subject: 'maths', grade_band: '3-5',
  confidence: 0.9, taught_level: 'apply',
  slos: [
    { id: 'S1', statement: 'Add a 3-digit and a 2-digit number, carrying a ten', statement_en: 'Add a 3-digit and a 2-digit number, carrying a ten', statement_ur: 'تین ہندسی اور دو ہندسی عدد جمع کرنا، دہائی آگے لے جا کر', taught_level: 'apply' },
    { id: 'S2', statement: 'Say which column carries', statement_en: 'Say which column carries', statement_ur: 'بتانا کہ کون سا کالم آگے لے جاتا ہے', taught_level: 'understand' },
  ],
  key_terms: [], examples_used: ['146 + 27'], misconceptions_surfaced: ['Children carry out of every column once one column carries.'],
};

function questions(quizId) {
  const sums = [[146, 27], [258, 34], [317, 45], [429, 53], [136, 48], [247, 36], [318, 27], [455, 38]];
  return sums.map(([a, b], i) => ({
    id: `q-${i + 1}`,
    quiz_id: quizId,
    external_id: `tq:${quizId}:${i % 2 ? 'S2' : 'S1'}:${i + 1}`,
    question_text: `What is ${a} + ${b}?`,
    option_a: String(a + b),
    option_b: String(a + b - 10),
    option_c: String(a + b + 100),
    option_d: null,
    correct_option: 'A',
    explanation: 'The ones column made a ten, so one ten is carried.',
    distractor_misconceptions: { B: 'forgot to carry', C: 'carried into the hundreds too' },
    option_feedback: { correct: 'Right — one ten carried.', wrong: { 1: 'The ones made a ten: carry it.', 2: 'Only the ones column carried.' } },
    media: null,
    render_pattern: 'P1',
    sort_order: i,
  }));
}

function seed(source, language) {
  const isLp = source === 'lp_v8';
  const quiz = {
    id: QUIZ,
    teacher_id: TEACHER,
    quiz_source: source,
    coaching_session_id: isLp ? null : SESSION,
    lesson_plan_id: null,
    status: 'ready',
    language,
    topic: 'Adding with carrying',
    subject: 'maths',
    grade: '4',
    created_at: '2026-09-22T10:00:00.000Z',
    meta: {
      step: 'ready',
      digest: DIGEST,
      grade: '4',
      lesson_summary: 'The class added a 3-digit and a 2-digit number and carried a ten.',
      lesson_summary_short: 'Adding with carrying.',
      cost_usd: 0.01,
      ...(isLp ? {
        source: 'lp_offer',
        nudge_id: 'nudge-1',
        lesson_date: LESSON_DAY,
        class: { grade: 4, subject: 'maths' },
        lessons: [{ lesson_id: 'grade_4_math_ch1_seg1', asset_id: 'a-1', version_stamp: 'v1', content_hash: 'h1', delivered_at: `${LESSON_DAY}T04:00:00.000Z` }],
      } : {}),
    },
  };
  const teacher = {
    id: TEACHER, name: 'Test Teacher', phone_number: TPHONE, preferred_language: language, role: 'teacher',
    grades_taught: ['4'], subjects_taught: ['maths'],
  };
  return {
    quizzes: [quiz],
    quiz_questions: questions(QUIZ),
    users: [teacher],
    coaching_sessions: isLp ? [] : [{
      id: SESSION, user_id: TEACHER, status: 'completed', observation_type: null,
      transcript_text: 'x'.repeat(2000), transcript_language: language, analysis_data: { topic: 'Adding with carrying', subject: 'maths' },
      lesson_plan_excerpt: null, created_at: `${LESSON_DAY}T05:00:00.000Z`,
      users: {
        name: teacher.name, id: TEACHER, phone_number: TPHONE, preferred_language: language, grades_taught: ['4'], subjects_taught: ['maths'],
      },
    }],
    quiz_share_codes: [],
    quiz_sessions: [],
    quiz_answers: [],
    students: [],
  };
}

const realSetTimeout = global.setTimeout;
beforeAll(() => {
  // The chain sleeps between sends (paced for Meta, 0.5-5 s). Collapse those
  // waits only; anything longer is a real timeout and keeps its length.
  global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms >= 500 && ms <= 5000 ? 0 : ms, ...a);
  process.env.CLASS_CARD_ENABLED = 'true';
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  process.env.NUDGE_QUIET_HOURS_PKT = 'off';
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
  delete process.env.STUDENT_JOIN_LOCALIZED_FLOW_ID;
  delete process.env.STUDENT_JOIN_FLOW_ID;
  delete process.env.STUDENT_QUIZ_FLOW_ID;
  delete process.env.VIDEO_QUIZ_FLOW_ID;
  delete process.env.QUIZ_MULTI_FLOW_ID;
});
afterAll(() => { global.setTimeout = realSetTimeout; });

/** Column defaults as `information_schema.columns` reports them (staging, 24 Sep 2026). */
const DEFAULTS = {
  quiz_share_codes: { active: true, uses_count: 0, language: 'en' },
  quiz_sessions: {
    status: 'invited', total_questions_answered: 0, correct_answers: 0, current_difficulty: 3, idle_reminder_sent: false, source: 'roster',
  },
  students: { is_active: true, status: 'active' },
};

function reset(source, language) {
  mockDb = createMemorySupabase(seed(source, language), {
    defaults: DEFAULTS,
    rpc: {
      increment_share_code_uses: ({ code_id: id }, { table }) => {
        const sc = table('quiz_share_codes').find((r) => r.id === id);
        if (sc) sc.uses_count = (sc.uses_count || 0) + 1;
        return { data: null, error: null };
      },
    },
  });
  mockSent.length = 0; mockJobs.length = 0; mockKv.clear(); mockR2.clear();
  mockPdfHtml.length = 0; mockImageHtml.length = 0; mockGuidancePrompts.length = 0; mockEvents.length = 0;
}

const quizRow = () => mockDb.table('quizzes').find((q) => q.id === QUIZ);
const to = (phone) => mockSent.filter((m) => m.to === phone);
const textOf = (m) => (typeof m.args[0] === 'string' ? m.args[0] : JSON.stringify(m.args[0]));

/** Answer every question the engine sends the child, first option each time. */
async function answerAll(phone) {
  for (let guard = 0; guard < 20; guard += 1) {
    const state = mockKv.get(`videoquiz:${phone}:active`);
    if (!state || !state.currentQuestionId) return;
    // Two right, one wrong, repeating — a class report with something to
    // reteach. The tap carries the STORED option index (A = 0, the key here).
    const idx = state.index % 3 === 2 ? 1 : 0;
    // eslint-disable-next-line no-await-in-loop
    await Engine.handleAnswer(phone, `vq_${state.currentQuestionId}_${idx}`);
  }
}

/**
 * The whole chain, for one source and language. Returns what each step
 * produced so the two sources can be compared step for step.
 */
async function runChain(source, language) {
  reset(source, language);
  const out = {};

  // 1. hand-off (the generate job on a quiz whose questions are written)
  const r = await Gen.process(QUIZ, { phone: TPHONE });
  out.generate = r;
  out.afterHandoff = { status: quizRow().status, shareCode: quizRow().meta.share_code, step: quizRow().meta.step };
  out.handoffMessages = to(TPHONE).map((m) => m.fn);
  out.forwardable = quizRow().meta.student_message;
  out.handoffCaption = (to(TPHONE).find((m) => m.fn === 'sendDocument') || { args: [] }).args[2];
  out.reportPromise = to(TPHONE).some((m) => m.fn === 'sendMessage'
    && textOf(m) === resolveUx('tqReportPromise', { language }));
  out.nudgeQueued = mockJobs.some((j) => j.jobType === 'quiz_nudge_teacher' && j.payload.quizId === QUIZ);
  out.shareCodeRow = mockDb.table('quiz_share_codes')[0];

  // 2. the nudge, with nobody started
  mockSent.length = 0;
  out.nudge = await Nudge.process(QUIZ);
  out.nudgeText = to(TPHONE).map(textOf).join('\n');

  // 3. two children open the forwarded link, join in chat and answer every
  //    question (the same slips, so the class report has something to reteach)
  mockSent.length = 0;
  for (const [phone, name] of [[CHILD, 'Test Child'], [CHILD2, 'Second Child']]) {
    // eslint-disable-next-line no-await-in-loop
    await Share.beginFromCode(phone, out.afterHandoff.shareCode);
    // eslint-disable-next-line no-await-in-loop
    await Share.consumeJoinReply(phone, name);
    // eslint-disable-next-line no-await-in-loop
    await Share.consumeJoinReply(phone, '4');
    // eslint-disable-next-line no-await-in-loop
    await answerAll(phone);
  }
  out.reportScheduled = mockJobs.some((j) => j.jobType === 'quiz_video_report');
  const sess = mockDb.table('quiz_sessions').find((s) => s.student_name === 'Test Child') || {};
  out.childSession = {
    status: sess.status, answered: sess.total_questions_answered, correct: sess.correct_answers, pct: sess.mastery_percentage,
  };
  out.childQuestions = to(CHILD).filter((m) => /Interactive|Buttons|List/.test(m.fn)).length;
  out.scorecard = to(CHILD).some((m) => m.fn === 'sendImageFromBuffer');
  out.scorecardEvent = mockEvents.find((e) => e.name === 'video_quiz.scorecard_sent') || null;

  // 4. the scheduled class report
  mockSent.length = 0; mockPdfHtml.length = 0; mockImageHtml.length = 0;
  out.report = await Report.generate(out.shareCodeRow.id, { reason: 'scheduled' });
  out.reportDoc = to(TPHONE).find((m) => m.fn === 'sendDocument') || null;
  out.reportHtml = mockPdfHtml[0] || '';
  out.reportHasObjective = out.reportHtml.includes(language === 'ur' ? DIGEST.slos[0].statement_ur : DIGEST.slos[0].statement_en);
  out.statusAfterReport = quizRow().status;
  out.classCard = to(CHILD).some((m) => m.fn === 'sendImageFromBuffer');
  out.guidancePrompt = mockGuidancePrompts[0] || '';

  // 5. /quiz — the list message: the lesson row, its three buttons, both actions
  mockSent.length = 0;
  const user = { id: TEACHER, preferred_language: language };
  const pickId = source === 'lp_v8' ? `tq_pick_lp_${QUIZ}` : `tq_pick_${SESSION}`;
  await List.showList(user, TPHONE, language, 1);
  const listMsg = to(TPHONE).find((m) => m.fn === 'sendInteractiveMessage');
  out.listRowIds = listMsg ? listMsg.args[0].action.sections[0].rows.map((row) => row.id) : [];
  mockSent.length = 0;
  await List.handleListPick(pickId, TPHONE, user);
  const buttons = to(TPHONE).find((m) => m.fn === 'sendInteractiveButtons');
  out.lessonButtons = buttons ? buttons.args[0].buttons.map((b) => b.id.replace(QUIZ, '<q>')) : [];
  mockSent.length = 0; mockPdfHtml.length = 0;
  await List.handleActionButton(`tq_report_${QUIZ}`, TPHONE);
  out.requestedReport = to(TPHONE).some((m) => m.fn === 'sendDocument');
  mockSent.length = 0;
  await List.handleActionButton(`tq_link_${QUIZ}`, TPHONE);
  out.resend = {
    forwardable: to(TPHONE).some((m) => m.fn === 'sendMessage' && textOf(m) === quizRow().meta.student_message),
    sameCode: quizRow().meta.share_code === out.afterHandoff.shareCode,
    codes: mockDb.table('quiz_share_codes').length,
  };

  // 6. /quiz — the Flow's LESSON screen
  const token = `${TEACHER}:flow`;
  const key = source === 'lp_v8' ? `lp_${QUIZ}` : SESSION;
  const lesson = await Endpoint.handleTranscriptQuizDataExchange(token, 'LESSONS', { step: 'lesson', session_id: key });
  out.flowScreen = lesson.screen;
  out.flowActions = ((lesson.data && lesson.data.actions) || []).map((a) => a.id);

  // 7. the child's own /quiz and class card
  mockSent.length = 0; mockImageHtml.length = 0;
  await StudentQuiz.open(CHILD, { language });
  await StudentQuiz.handleButton(StudentQuiz.CARD_ID, CHILD);
  out.childCard = to(CHILD).some((m) => m.fn === 'sendImageFromBuffer');
  return out;
}

describe.each([['en'], ['ur']])('an lp_v8 quiz gets the transcript quiz’s whole downstream chain (%s)', (language) => {
  let transcript;
  let lp;
  beforeAll(async () => {
    transcript = await runChain('transcript', language);
    lp = await runChain('lp_v8', language);
  });

  test('hand-off: PDF, the forwardable link, the report promise; status sent; the nudge queued', () => {
    for (const run of [transcript, lp]) {
      expect(run.generate).toEqual(expect.objectContaining({ ok: true }));
      expect(run.afterHandoff).toEqual(expect.objectContaining({ status: 'sent', step: 'sent' }));
      expect(run.handoffMessages).toEqual(['sendDocument', 'sendMessage', 'sendMessage']);
      expect(run.reportPromise).toBe(true);
      expect(run.nudgeQueued).toBe(true);
      expect(run.forwardable).toContain(`QUIZ-${run.afterHandoff.shareCode}`);
    }
  });

  test('the share code carries the quiz’s language and topic, whichever way the quiz was born', () => {
    for (const run of [transcript, lp]) {
      expect(run.shareCodeRow).toEqual(expect.objectContaining({
        quiz_id: QUIZ, teacher_user_id: TEACHER, language, topic: 'Adding with carrying', video_id: null,
      }));
    }
  });

  test('the forwardable message dates the quiz by the lesson it was made for', () => {
    // Both fixtures teach on the same school day, so both messages carry it.
    const { formatLessonDate } = require('../../bot/shared/services/quiz/transcript-quiz-language');
    const day = formatLessonDate(`${LESSON_DAY}T12:00:00+05:00`, language);
    expect(transcript.forwardable).toContain(day);
    expect(lp.forwardable).toContain(day);
  });

  test('the six-hour nudge reaches the teacher of either kind of quiz', () => {
    expect(transcript.nudge).toEqual(expect.objectContaining({ ok: true, started: 0 }));
    expect(lp.nudge).toEqual(expect.objectContaining({ ok: true, started: 0 }));
    expect(lp.nudgeText).toBe(transcript.nudgeText);
  });

  test('a child joins, is asked every question, finishes, and gets a scorecard', () => {
    for (const run of [transcript, lp]) {
      expect(run.reportScheduled).toBe(true);
      expect(run.childSession).toEqual({ status: 'completed', answered: 8, correct: expect.any(Number), pct: expect.any(Number) });
      expect(run.scorecard).toBe(true);
      expect(run.scorecardEvent).toEqual(expect.objectContaining({ ok: true, fallback: false }));
    }
    expect(lp.childSession).toEqual(transcript.childSession);
    expect(lp.childQuestions).toBe(transcript.childQuestions);
  });

  test('the scheduled class report: a PDF to the teacher, the objectives to reteach, report_sent, the class card', () => {
    for (const run of [transcript, lp]) {
      expect(run.report).toBe(true);
      expect(run.reportDoc).not.toBeNull();
      expect(run.reportHasObjective).toBe(true);
      expect(run.statusAfterReport).toBe('report_sent');
      expect(run.classCard).toBe(true);
    }
  });

  test('/quiz lists the lesson and offers Resend link / Generate report / Back; both actions work on the same code', () => {
    expect(lp.listRowIds).toEqual([`tq_pick_lp_${QUIZ}`]);
    expect(transcript.listRowIds).toEqual([`tq_pick_${SESSION}`]);
    expect(lp.lessonButtons).toEqual(transcript.lessonButtons);
    expect(lp.lessonButtons).toEqual(['tq_link_<q>', 'tq_report_<q>', 'tq_back_<q>']);
    for (const run of [transcript, lp]) {
      expect(run.requestedReport).toBe(true);
      expect(run.resend).toEqual({ forwardable: true, sameCode: true, codes: 1 });
    }
  });

  test('the /quiz Flow LESSON screen offers the same actions for either kind of quiz', () => {
    expect(lp.flowScreen).toBe('LESSON');
    expect(lp.flowActions).toEqual(transcript.flowActions);
    expect(lp.flowActions).toEqual(['report', 'link']);
  });

  test('the child’s own /quiz shows the class card for a lesson-plan quiz too', () => {
    expect(transcript.childCard).toBe(true);
    expect(lp.childCard).toBe(true);
  });
});
