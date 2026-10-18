'use strict';
/**
 * quiz_report_send_checked: the teacher's /quiz reply after WhatsApp refused their report.
 *
 * The teacher asks for their class report from /quiz: the list's report button
 * (transcript-quiz-list.service handleActionButton) or the Flow's Generate report (transcript-quiz-flow-endpoint).
 * Both call video-quiz-report.generate() and, on a false, said "No one has finished this quiz yet". With the switch on,
 * a report WhatsApp refused is also a false — and that line then told a teacher with 20 finished children that no one
 * had finished.
 *
 * Switch on: a refusal (not "nothing to report") is told apart beside generate() (its lastRefusal()); the teacher gets
 * tqReportNotThrough with the class report page link the report had, or, with no link, the line asking them to type
 * /quiz again. generate() stays a boolean for every caller. Nothing finished: tqNoReportYet, as today.
 * Switch off: both callers exactly as today (OFF goldens recorded on the code before this change).
 *
 * Boundaries mocked: supabase (one in-memory database), WhatsApp, Redis, the queue, the PDF renderer, the model client,
 * the loggers, and the web report's gate and roster (the source of the page link). Both callers and the report run.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(),
  sendDocument: jest.fn().mockResolvedValue(false),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/services/llm-client', () => ({
  withSpendRecording: () => { throw new Error('no model in test env'); },
}));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: jest.fn(() => true),
    setNX: jest.fn(async (key, value) => { if (store.has(key)) return false; store.set(key, value); return true; }),
    set: jest.fn(async (key, value) => { store.set(key, value); return true; }),
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    delete: jest.fn(async (key) => { store.delete(key); return true; }),
    del: jest.fn(async (key) => { store.delete(key); return 1; }),
  };
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));
// The web report: on for this teacher when `linkOn`, with a page link. Its roster is not under test.
jest.mock('../../shared/services/quiz/teacher-report-gate', () => ({
  teacherReportOn: jest.fn(async () => false),
  reportUrls: jest.fn(() => ({ live: 'https://report.example/r/tok', remind: 'https://report.example/r/tok/remind', token: 'tok' })),
}));
jest.mock('../../shared/services/quiz/teacher-report.data', () => ({
  ...jest.requireActual('../../shared/services/quiz/teacher-report.data'),
  quizReport: jest.fn(async () => ({ roster: { state: 'unknown', of: null, className: null }, notPlayed: null })),
}));

process.env.WEB_QUIZ_TOKEN_SECRET = 'test-token-secret-for-the-send-check-0123456789';
process.env.WEB_QUIZ_KID_KEY = 'test-kid-key-for-the-send-check-0123456789abcdef';

const fs = require('fs');
const path = require('path');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const redis = require('../../shared/services/cache/railway-redis.service');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const { logEvent } = require('../../shared/utils/structured-logger');
const { UX_STRINGS } = require('../../shared/config/ux-strings');
const Report = require('../../shared/services/quiz/video-quiz-report.service');
const List = require('../../shared/services/quiz/transcript-quiz-list.service');
const Flow = require('../../shared/routes/transcript-quiz-flow-endpoint');
const SendCheck = require('../../shared/services/quiz/report-send-check');
const FoldFlag = require('../../shared/services/quiz/report-fold-flag');
const HomeFlag = require('../../shared/services/first-touch/teacher-home.flags');

const KEY = 'quiz_report_send_checked';
const SC = '6b1c0f0e-0000-4000-8000-0000000005d4';
const OTHER_SC = '6b1c0f0e-0000-4000-8000-0000000005d5';
const QUIZ = '7c2d1f1f-0000-4000-8000-0000000000d4';
const TEACHER = '8d3e2a2a-0000-4000-8000-0000000000d4';
const LESSON = '9e4f3b3b-0000-4000-8000-0000000000d4';
const PHONE = '92300FIXTURE4';
const TOKEN = `${TEACHER}:transcript-quiz:${1757100 * 1e6}`;
const LINK = 'https://report.example/r/tok';
const GOLDEN = path.join(__dirname, 'goldens', 'report-not-through-off.json');

const NOT_THROUGH_EN = `Your report didn't come through on WhatsApp. You can see it here: ${LINK}`;
const NOT_THROUGH_NO_LINK_EN = "Your report didn't come through on WhatsApp. Please type /quiz again in a few minutes.";
const NO_REPORT_YET_EN = UX_STRINGS.tqNoReportYet.en;

const MIN = 60 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
// Fixed times: the golden holds the report's text.
const T0 = '2026-09-01T06:00:00.000Z';
const T1 = '2026-09-01T07:00:00.000Z';
const T2 = '2026-09-01T07:30:00.000Z';

let db;

/** `finished` children who finished on the report's code; `elsewhere` finished on another code of the same quiz. */
function stubDb({ finished = 0, elsewhere = 0, setting } = {}) {
  const child = (i, code) => ({
    id: `s${code === SC ? '' : 'x'}${i}`, quiz_id: QUIZ, share_code_id: code, user_id: null, invited_by_student_id: null,
    student_id: null, student_name: `Child${i + 1} Testwala`, student_class: '4', parent_phone: null, status: 'completed',
    device_ref: null, total_questions_answered: 4, correct_answers: 2 + (i % 3), mastery_percentage: 50 + (i % 3) * 25,
    created_at: T1, completed_at: T2,
  });
  db = {
    app_settings: setting === undefined ? [] : [{ key: KEY, value: setting }],
    quiz_share_codes: [{
      id: SC, code: 'TST4CD', quiz_id: QUIZ, teacher_user_id: TEACHER, teacher_name: 'Sana Testwala',
      topic: 'Electric circuits', language: 'en', created_at: iso(20 * 60 * MIN), report_sent_at: null,
    }],
    users: [{ id: TEACHER, phone_number: PHONE, preferred_language: 'en', name: 'Sana Testwala' }],
    coaching_sessions: [{
      id: LESSON, user_id: TEACHER, status: 'completed', observation_type: null, created_at: T0,
      transcript_text: 'x'.repeat(4000), analysis_data: { topic: 'Electric circuits', subject: 'science' },
    }],
    quizzes: [{
      id: QUIZ, coaching_session_id: LESSON, teacher_id: TEACHER, quiz_source: 'transcript', status: 'sent',
      topic: 'Electric circuits', subject: 'science', grade: '4', language: 'en', created_at: T0,
      meta: { share_code_id: SC, student_message: 'forward me' },
    }],
    quiz_sessions: [
      ...Array.from({ length: finished }, (_, i) => child(i, SC)),
      ...Array.from({ length: elsewhere }, (_, i) => child(i, OTHER_SC)),
    ],
    question_attempts: [],
    story_events: [],
  };
  supabase.from.mockImplementation((table) => {
    let rows = db[table] || [];
    let patch = null;
    let orderKey = null;
    let desc = false;
    const chain = {
      select: () => chain,
      eq: (f, v) => {
        rows = rows.filter((r) => r[f] === v);
        if (patch) rows.forEach((r) => Object.assign(r, patch));
        return chain;
      },
      neq: (f, v) => { rows = rows.filter((r) => r[f] !== v); return chain; },
      is: (f, v) => { rows = rows.filter((r) => (v === null ? r[f] == null : r[f] === v)); return chain; },
      in: (f, vs) => { rows = rows.filter((r) => vs.includes(r[f])); return chain; },
      not: () => chain, or: () => chain, gte: () => chain, lte: () => chain, gt: () => chain, lt: () => chain,
      filter: () => chain, contains: () => chain,
      order: (f, opts) => { orderKey = f; desc = Boolean(opts && opts.ascending === false); return chain; },
      limit: (n) => { rows = rows.slice(0, n); return chain; },
      range: (from, to) => {
        if (orderKey) {
          rows = [...rows].sort((a, b) => {
            const av = new Date(a[orderKey]).getTime();
            const bv = new Date(b[orderKey]).getTime();
            return desc ? bv - av : av - bv;
          });
        }
        rows = rows.slice(from, to + 1);
        return chain;
      },
      update: (p) => { patch = p; return chain; },
      insert: async () => ({ data: null, error: null }),
      upsert: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: rows[0] ? { ...rows[0] } : null, error: null }),
      single: async () => ({ data: rows[0] ? { ...rows[0] } : null, error: rows[0] ? null : { message: 'none' } }),
      then: (res, rej) => Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(res, rej),
    };
    return chain;
  });
}

/** Every WhatsApp text to the teacher answers `answer` (the report's own text among them). */
function whatsappAnswers(answer) {
  WhatsAppService.sendMessage.mockImplementation(async () => answer);
}

const teacherTexts = () => WhatsAppService.sendMessage.mock.calls.filter((c) => c[0] === PHONE).map((c) => c[1]);
const lastText = () => teacherTexts().slice(-1)[0];

async function settle() {
  for (let i = 0; i < 2000; i += 1) {
    if (logEvent.mock.calls.some((c) => c[0] === 'transcript_quiz.flow_action_done')) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('the Flow\'s report action never finished');
}

const CALLERS = {
  list: async () => { await List.handleActionButton(`${List.REPORT_PREFIX}${QUIZ}`, PHONE); },
  flow: async () => {
    const out = await Flow.handleTranscriptQuizDataExchange(TOKEN, 'LESSON', {
      step: 'action', tq_action: 'report', session_id: LESSON, quiz_id: QUIZ,
    });
    await settle();
    return out;
  },
};

/** What the teacher saw and what the caller logged, for the goldens. */
function callLog() {
  return {
    texts: teacherTexts(),
    events: logEvent.mock.calls.filter((c) => /^transcript_quiz\./.test(c[0]) && c[0] !== 'transcript_quiz.flow_payload'),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  SendCheck.reset();
  FoldFlag.reset();
  HomeFlag.reset();
  Gate.teacherReportOn.mockImplementation(async () => false);
  delete process.env.VIDEO_REPORT_SEND_CLAIM;
  delete process.env.CLASS_CARD_ENABLED;
});

// ─── switch off: both callers exactly as today ──────────────────────────────

const OFF_ROWS = [];
for (const caller of Object.keys(CALLERS)) {
  OFF_ROWS.push(
    [`${caller}: 20 finished, WhatsApp refuses the report`, caller, { finished: 20 }, false, false],
    [`${caller}: 20 finished, WhatsApp takes the report`, caller, { finished: 20 }, true, false],
    [`${caller}: 20 finished, refused, a page link known`, caller, { finished: 20 }, false, true],
    [`${caller}: nobody finished on the report's code`, caller, { elsewhere: 1 }, false, false],
  );
}

describe('switch off (absent): the OFF goldens, recorded before the change', () => {
  const golden = (() => { try { return JSON.parse(fs.readFileSync(GOLDEN, 'utf8')); } catch (_) { return {}; } })();
  const recorded = {};
  afterAll(() => {
    if (process.env.RECORD_OFF_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify(recorded, null, 2)}\n`);
    }
  });

  test.each(OFF_ROWS)('%s', async (name, caller, fixture, answer, linkOn) => {
    stubDb(fixture);
    whatsappAnswers(answer);
    Gate.teacherReportOn.mockImplementation(async () => linkOn);
    await CALLERS[caller]();
    recorded[name] = JSON.parse(JSON.stringify(callLog()));
    expect(teacherTexts()).not.toContain(NOT_THROUGH_EN);
    if (process.env.RECORD_OFF_GOLDEN !== '1') expect(recorded[name]).toEqual(golden[name]);
  });
});

// ─── switch on ──────────────────────────────────────────────────────────────

describe.each(Object.keys(CALLERS))('%s, switch on (JSON true)', (caller) => {
  test('refused, 20 finished, a page link known: "didn\'t come through", with the link — never "no one has finished"', async () => {
    stubDb({ finished: 20, setting: true });
    whatsappAnswers(false);
    Gate.teacherReportOn.mockImplementation(async () => true);
    await CALLERS[caller]();
    expect(lastText()).toBe(NOT_THROUGH_EN);
    expect(teacherTexts()).not.toContain(NO_REPORT_YET_EN);
    expect(db.quiz_share_codes[0].report_sent_at).toBeNull();
  });

  test('refused, 20 finished, no page link: "didn\'t come through", type /quiz again — never "no one has finished"', async () => {
    stubDb({ finished: 20, setting: true });
    whatsappAnswers(false);
    await CALLERS[caller]();
    expect(lastText()).toBe(NOT_THROUGH_NO_LINK_EN);
    expect(teacherTexts()).not.toContain(NO_REPORT_YET_EN);
  });

  test('refused (a throw), 20 finished: "didn\'t come through"', async () => {
    stubDb({ finished: 20, setting: true });
    WhatsAppService.sendMessage.mockImplementation(async (to, text) => {
      if (/Electric circuits/.test(String(text)) && /20/.test(String(text))) throw new Error('WhatsApp 500');
      return true;
    });
    await CALLERS[caller]();
    expect(lastText()).toBe(NOT_THROUGH_NO_LINK_EN);
  });

  test('nobody finished on the report\'s code: "no one has finished", as today', async () => {
    stubDb({ elsewhere: 1, setting: true });
    whatsappAnswers(false);
    await CALLERS[caller]();
    expect(lastText()).toBe(NO_REPORT_YET_EN);
    expect(teacherTexts()).not.toContain(NOT_THROUGH_NO_LINK_EN);
  });

  test('an earlier scheduled report refused, then the teacher asks with nobody finished: "no one has finished"', async () => {
    stubDb({ elsewhere: 1, setting: true });
    whatsappAnswers(false);
    // the morning run's "nobody opened it yet" was refused; nobody asked about it
    expect(await Report.generate(SC, { reason: 'scheduled' })).toBe(false);
    WhatsAppService.sendMessage.mockClear();
    await CALLERS[caller]();
    expect(lastText()).toBe(NO_REPORT_YET_EN);
  });

  test('accepted, 20 finished: neither line', async () => {
    stubDb({ finished: 20, setting: true });
    whatsappAnswers(true);
    await CALLERS[caller]();
    expect(teacherTexts()).not.toContain(NO_REPORT_YET_EN);
    expect(teacherTexts()).not.toContain(NOT_THROUGH_NO_LINK_EN);
    expect(db.quiz_share_codes[0].report_sent_at).not.toBeNull();
  });

  test('an Urdu teacher gets the Urdu line', async () => {
    stubDb({ finished: 20, setting: true });
    db.users[0].preferred_language = 'ur';
    whatsappAnswers(false);
    await CALLERS[caller]();
    const ur = UX_STRINGS.tqReportNotThroughNoLink && UX_STRINGS.tqReportNotThroughNoLink.ur;
    expect(typeof ur).toBe('string');
    expect(lastText()).toBe(ur);
  });
});

// ─── generate() stays a boolean; the refusal is told apart beside it ───────

describe('video-quiz-report: generate() answers a boolean, lastRefusal() tells a refusal apart', () => {
  test('refused (switch on): generate → false, lastRefusal → the page link', async () => {
    stubDb({ finished: 20, setting: true });
    whatsappAnswers(false);
    Gate.teacherReportOn.mockImplementation(async () => true);
    expect(await Report.generate(SC, { reason: 'requested', force: true })).toBe(false);
    expect(typeof Report.lastRefusal).toBe('function');
    expect(Report.lastRefusal(SC)).toEqual({ link: LINK });
    // read once: the next generate starts clean
    expect(Report.lastRefusal(SC)).toBeNull();
  });

  test('nothing to report: generate → false, no refusal', async () => {
    stubDb({ elsewhere: 1, setting: true });
    whatsappAnswers(false);
    expect(await Report.generate(SC, { reason: 'requested', force: true })).toBe(false);
    expect(typeof Report.lastRefusal).toBe('function');
    expect(Report.lastRefusal(SC)).toBeNull();
  });

  test('switch off, refused: generate → true (stamped, as today), no refusal', async () => {
    stubDb({ finished: 20 });
    whatsappAnswers(false);
    expect(await Report.generate(SC, { reason: 'requested', force: true })).toBe(true);
    expect(typeof Report.lastRefusal).toBe('function');
    expect(Report.lastRefusal(SC)).toBeNull();
  });
});
