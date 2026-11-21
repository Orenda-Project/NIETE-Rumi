'use strict';
/**
 * Children who finish after the teacher's class report still reach the teacher.
 *
 * One automatic report goes 12 h after a class code's first join. On production (web era) a third of the children with
 * a finish first finished AFTER it, and a late finish never sent anything again: the scheduled run on a reported code
 * stands down ("already_reported"), a finish asks for a follow-up that is always suppressed. A teacher's own /quiz ask
 * also wrote report_sent_at, so an ask before the 12 h mark cancelled the automatic report and every child after it.
 *
 *   1. A teacher's /quiz ask never writes report_sent_at (no switch: a pure fix). The automatic report still goes, and
 *      its baseline is the last AUTOMATIC report, never the teacher's ask.
 *   2. app_settings `video_quiz_late_report` (off unless JSON true or an object; `{ k, cap_per_day }`): a reported code
 *      with activity arms one check at the next 07:00 PKT; it sends the report again only when at least K children
 *      first-finished since the last automatic report, at most once per code per day.
 *   3. isReportableShareCode: an evening-round code (quizzes.meta.source 'evening_round') never schedules or sends a
 *      12 h report.
 *
 * Drives the REAL worker (executeJob) and the REAL report service; mocked at the boundaries only: AWS SQS, supabase
 * (one in-memory database), Redis, WhatsApp, the PDF renderer, the model client, the loggers.
 */
const mockSqsSend = jest.fn(() => ({ promise: () => Promise.resolve({ MessageId: 'm' }) }));
jest.mock('aws-sdk', () => {
  class SQS {
    constructor() {
      this.changeMessageVisibility = jest.fn(() => ({ promise: () => Promise.resolve({}) }));
      this.sendMessage = (...a) => mockSqsSend(...a);
      this.receiveMessage = jest.fn(() => ({ promise: () => Promise.resolve({ Messages: [] }) }));
      this.deleteMessage = jest.fn(() => ({ promise: () => Promise.resolve({}) }));
      this.getQueueAttributes = jest.fn(() => ({ promise: () => Promise.resolve({ Attributes: {} }) }));
      this.purgeQueue = jest.fn(() => ({ promise: () => Promise.resolve({}) }));
    }
  }
  return { config: { update: jest.fn() }, SQS };
});
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(false),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/services/llm-client', () => ({
  ...jest.requireActual('../../shared/services/llm-client'),
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
  };
});
jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn(),
  generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-not-used';
process.env.SQS_QUEUE_URL = process.env.SQS_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/000000000000/test-queue.fifo';
process.env.SQS_QUIZ_QUEUE_URL = process.env.SQS_QUIZ_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/000000000000/test-quiz';
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-token-secret-for-the-late-report-0123456789';
process.env.WEB_QUIZ_KID_KEY = 'test-kid-key-for-the-late-report-0123456789abcdef';

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const report = require('../../shared/services/quiz/video-quiz-report.service');
const { SQSCoachingWorker } = require('../../workers/sqs-worker');
// absent before the change: the red run still executes every row
const LateFlag = (() => { try { return require('../../shared/services/quiz/late-report-flag'); } catch (_) { return null; } })();

const KEY = 'video_quiz_late_report';
const SC = '6b1c0f0e-0000-4000-8000-0000000001a7';
const QUIZ = '7c2d1f1f-0000-4000-8000-0000000001a7';
const TEACHER = '8d3e2a2a-0000-4000-8000-0000000001b7';
const TEACHER_PHONE = '+92300FIXTURE7';
const H = 60 * 60 * 1000;
// 14:30 PKT on Fri 20 Nov 2026; the next 07:00 PKT is 02:00 UTC on 21 Nov.
const NOW = new Date('2026-11-20T09:30:00Z');
const NEXT_0700_PKT = '2026-11-21T02:00:00.000Z';
const iso = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();

let db = null;
let shareCodeWrites = [];

/**
 * `reportedAgo`: ms since the last automatic report (null = none yet). `early`: children who finished before it,
 * `late`: children who first finished after it, `playing`: started `playingAgo`, not finished.
 */
function stubDb({ setting, reportedAgo = 13 * H, early = 3, late = 5, playing = 0, meta = {}, playingAgo = 1 * H } = {}) {
  const session = (i, status, createdAgo, completedAgo) => ({
    id: `s${i}`, share_code_id: SC, user_id: null, invited_by_student_id: null, student_id: `st-${i}`,
    student_name: `Child${i} Testwala`, student_class: '4', parent_phone: null, status, device_ref: null,
    total_questions_answered: 4, correct_answers: 3, mastery_percentage: 75,
    created_at: iso(createdAgo), completed_at: completedAgo === null ? null : iso(completedAgo),
  });
  const sessions = [];
  let i = 0;
  for (let n = 0; n < early; n += 1) { i += 1; sessions.push(session(i, 'completed', 15 * H, 14 * H)); }
  for (let n = 0; n < late; n += 1) { i += 1; sessions.push(session(i, 'completed', 3 * H, 2 * H)); }
  for (let n = 0; n < playing; n += 1) { i += 1; sessions.push(session(i, 'in_progress', playingAgo, null)); }
  db = {
    app_settings: setting === undefined ? [] : [{ key: KEY, value: setting }],
    quiz_share_codes: [{
      id: SC, code: 'TST7LA', quiz_id: QUIZ, teacher_user_id: TEACHER, teacher_name: 'Sana Testwala',
      topic: 'Fractions', language: 'en', created_at: iso(30 * H),
      report_sent_at: reportedAgo === null ? null : iso(reportedAgo),
    }],
    users: [{ id: TEACHER, phone_number: TEACHER_PHONE, preferred_language: 'en', name: 'Sana Testwala' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, meta: { ...meta }, quiz_source: 'video', topic: 'Fractions', language: 'en', subject: 'maths', grade: '4' }],
    quiz_sessions: sessions,
    question_attempts: [],
  };
  supabase.from.mockImplementation((table) => {
    let rows = db[table] || [];
    let patch = null;
    const chain = {
      select: () => chain,
      eq: (f, v) => {
        rows = rows.filter((r) => r[f] === v);
        if (patch) {
          rows.forEach((r) => Object.assign(r, patch));
          if (table === 'quiz_share_codes') shareCodeWrites.push(patch);
        }
        return chain;
      },
      is: (f, v) => { rows = rows.filter((r) => (v === null ? r[f] == null : r[f] === v)); return chain; },
      in: (f, vs) => { rows = rows.filter((r) => vs.includes(r[f])); return chain; },
      neq: () => chain, not: () => chain, or: () => chain, gte: () => chain, lte: () => chain, gt: () => chain, lt: () => chain,
      filter: () => chain, order: () => chain, limit: () => chain, range: () => chain,
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

const teacherGotReport = () => WhatsAppService.sendMessage.mock.calls.some((c) => c[0] === TEACHER_PHONE)
  || WhatsAppService.sendDocument.mock.calls.some((c) => c[0] === TEACHER_PHONE);
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const queued = () => mockSqsSend.mock.calls.map((c) => JSON.parse(c[0].MessageBody))
  .filter((b) => b.jobType === 'quiz_video_report');
const stampedAt = () => db.quiz_share_codes[0].report_sent_at;

/** The worker takes a due quiz_video_report job for the code, exactly as SQS hands it over. */
async function workerRuns() {
  const worker = new SQSCoachingWorker('test-worker');
  const payload = { shareCodeId: SC, targetAt: iso(60 * 1000) };
  await worker.executeJob(SC, 'quiz_video_report', payload, 'receipt', 'quiz',
    { groupId: SC, jobType: 'quiz_video_report', payload });
}

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'nextTick', 'queueMicrotask'] });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  shareCodeWrites = [];
  if (LateFlag) LateFlag.reset();
  delete process.env.VIDEO_REPORT_SCHEDULED_FOLLOWUP;
});

describe('1 · a teacher\'s /quiz ask never moves report_sent_at (pure fix, no switch)', () => {
  test('an ask BEFORE the 12 h report: the teacher gets it, report_sent_at stays empty, and the automatic report still goes', async () => {
    stubDb({ reportedAgo: null, early: 2, late: 0 });
    expect(await report.generate(SC, { reason: 'requested', force: true })).toBe(true);
    expect(teacherGotReport()).toBe(true);
    expect(stampedAt()).toBeNull();
    expect(shareCodeWrites.filter((p) => 'report_sent_at' in p)).toEqual([]);
    // "Report sent" on the teacher's /quiz row is still true: the quiz row is stamped
    expect(db.quizzes[0].status).toBe('report_sent');
    // the ask gave its send claim back: the scheduled run is not told "send in progress"
    expect(redis._store.has(`vq:report:sending:${SC}`)).toBe(false);

    WhatsAppService.sendMessage.mockClear();
    await workerRuns();
    expect(teacherGotReport()).toBe(true);
    expect(stampedAt()).not.toBeNull();
    expect(events('video_quiz.report_suppressed').filter((e) => e.why === 'already_reported')).toEqual([]);
    expect(events('video_quiz.report_sent').map((e) => e.trigger)).toEqual(['teacher_request', 'auto_12h']);
  });

  test('an ask AFTER the automatic report: the baseline stays the automatic report\'s time', async () => {
    stubDb({ reportedAgo: 13 * H });
    const before = stampedAt();
    expect(await report.generate(SC, { reason: 'requested', force: true })).toBe(true);
    expect(teacherGotReport()).toBe(true);
    expect(stampedAt()).toBe(before);
  });

  test('a second tap while the first ask is mid-send is answered by that send, never a duplicate', async () => {
    stubDb({ reportedAgo: null, early: 2, late: 0 });
    const saved = report._sendClaimTiming.pollMs;
    report._sendClaimTiming.pollMs = 5;
    redis._store.set(`vq:report:sending:${SC}`, 'first-ask');
    const second = report.generate(SC, { reason: 'requested', force: true });
    await new Promise((r) => setTimeout(r, 20));
    // the first ask's send went out; it marks the ask answered and gives the claim back
    let err = null;
    try { await report._markAsked(SC); } catch (e) { err = e; }
    redis._store.delete(`vq:report:sending:${SC}`);
    const answered = await second;
    report._sendClaimTiming.pollMs = saved;
    expect(err).toBeNull();
    expect(answered).toBe(true);
    expect(teacherGotReport()).toBe(false);
  });
});

describe('2 · late finishers, video_quiz_late_report ON: one more report at K, through the worker', () => {
  test('5 children first-finished after the report (K=5): the 07:00 run sends the report again', async () => {
    stubDb({ setting: { k: 5, cap_per_day: 1 }, early: 3, late: 5 });
    const before = stampedAt();
    await workerRuns();
    expect(teacherGotReport()).toBe(true);
    expect(events('video_quiz.report_followup')).toEqual([
      expect.objectContaining({ shareCodeId: SC, n_late: 5, k: 5, mode: 'second_report', reportedOn: 3 }),
    ]);
    expect(events('video_quiz.report_sent')).toEqual([expect.objectContaining({ trigger: 'followup', completed: 8 })]);
    // the follow-up is an automatic report: it is the new baseline, and today's cap is spent
    expect(stampedAt()).not.toBe(before);
    expect(db.quizzes[0].meta.report_followups[SC]).toBe(NOW.toISOString());
  });

  test('4 late children (below K): nothing to the teacher; they stay on the live page', async () => {
    stubDb({ setting: { k: 5 }, early: 3, late: 4 });
    await workerRuns();
    expect(teacherGotReport()).toBe(false);
    expect(events('video_quiz.report_suppressed')).toEqual([
      expect.objectContaining({ shareCodeId: SC, why: 'below_k', n_late: 4, k: 5 }),
    ]);
  });

  test('one late report per code per day: a follow-up 2 h ago holds today\'s', async () => {
    stubDb({ setting: { k: 5 }, early: 3, late: 6, meta: { report_followups: { [SC]: iso(2 * H) } } });
    await workerRuns();
    expect(teacherGotReport()).toBe(false);
    expect(events('video_quiz.report_suppressed')).toEqual([expect.objectContaining({ why: 'followup_today' })]);
  });

  test('a follow-up 30 h ago does not: a second day can carry a second late report', async () => {
    stubDb({ setting: { k: 5 }, early: 3, late: 6, meta: { report_followups: { [SC]: iso(30 * H) } } });
    await workerRuns();
    expect(teacherGotReport()).toBe(true);
  });

  test('JSON true is on with the defaults (K=5)', async () => {
    stubDb({ setting: true, early: 3, late: 5 });
    await workerRuns();
    expect(teacherGotReport()).toBe(true);
  });

  test('below K with a child still playing: tomorrow\'s 07:00 check is armed, once', async () => {
    stubDb({ setting: { k: 5 }, early: 3, late: 2, playing: 1 });
    await workerRuns();
    expect(teacherGotReport()).toBe(false);
    const q = queued();
    expect(q).toHaveLength(1);
    expect(q[0].payload).toEqual({ shareCodeId: SC, targetAt: NEXT_0700_PKT });
  });

  test('below K and nobody active in the last day: no check is armed (no daily chain for a quiet code)', async () => {
    stubDb({ setting: { k: 5 }, early: 3, late: 0, playing: 1, playingAgo: 40 * H });
    await workerRuns();
    expect(queued()).toEqual([]);
  });

  test('the automatic report with a child still playing arms the next 07:00 check', async () => {
    stubDb({ setting: { k: 5 }, reportedAgo: null, early: 3, late: 0, playing: 2 });
    await workerRuns();
    expect(teacherGotReport()).toBe(true);
    expect(queued().map((b) => b.payload.targetAt)).toEqual([NEXT_0700_PKT]);
  });

  test('a child joining a reported code arms the next 07:00 check (not a fresh 12 h chain), once a day', async () => {
    stubDb({ setting: { k: 5 }, early: 3, late: 0 });
    await report.scheduleForShareCode(SC);
    await report.scheduleForShareCode(SC);
    expect(queued().map((b) => b.payload.targetAt)).toEqual([NEXT_0700_PKT]);
    expect(events('video_quiz.report_scheduled')).toEqual([expect.objectContaining({ kind: 'late_check', targetAt: NEXT_0700_PKT })]);
  });
});

describe('3 · switch OFF (no row, false, a string): today\'s behaviour exactly', () => {
  test.each([['no row', undefined], ['false', false], ['the string "true"', 'true']])('%s: a scheduled run on a reported code stands down', async (_l, setting) => {
    stubDb({ setting, early: 3, late: 8, playing: 1 });
    await workerRuns();
    expect(teacherGotReport()).toBe(false);
    expect(events('video_quiz.report_suppressed')).toEqual([expect.objectContaining({ why: 'already_reported' })]);
    expect(queued()).toEqual([]);
  });

  test('off: a join on a reported code schedules as today (a fresh 12 h chain, no late check)', async () => {
    stubDb({ early: 3, late: 0 });
    await report.scheduleForShareCode(SC);
    expect(queued()).toHaveLength(1);
    expect(events('video_quiz.report_scheduled')).toHaveLength(1);
    expect(events('video_quiz.report_scheduled')[0].kind).toBeUndefined();
  });
});

describe('4 · isReportableShareCode: an evening round never schedules a 12 h report', () => {
  test('meta.source evening_round → false; any other quiz → true', async () => {
    stubDb({ reportedAgo: null, meta: { source: 'evening_round' } });
    expect(typeof report.isReportableShareCode).toBe('function');
    expect(await report.isReportableShareCode(SC)).toBe(false);
    db.quizzes[0].meta = {};
    expect(await report.isReportableShareCode(SC)).toBe(true);
  });

  test('a child joining an evening-round code queues nothing', async () => {
    stubDb({ reportedAgo: null, meta: { source: 'evening_round' } });
    await report.scheduleForShareCode(SC);
    expect(queued()).toEqual([]);
    expect(events('video_quiz.report_schedule_skipped')).toEqual([expect.objectContaining({ why: 'not_reportable' })]);
  });
});
