'use strict';
/**
 * quiz_report_send_checked: a teacher's class report is stamped "sent" only when WhatsApp accepted it.
 *
 * Three sends stamp a report (video-quiz-report.buildAndSend): the storybook report (story-teacher-report.sendReport),
 * the quiz report nobody took ("no one opened it yet") and the quiz report itself (its text, when the PDF did not go).
 * Today each stamps report_sent_at and logs report_sent whatever the send answered.
 *
 * Switch on (only a JSON true): a send WhatsApp did not accept (false, or a throw) is not stamped and logs
 * story_report_send_failed / quiz_report_send_failed (a hash of the code and the teacher's tk, never a phone); the
 * report is tried again; the third failure logs report_gave_up and nothing tries again (the web report stays).
 * Switch off, absent, or anything but JSON true: today's sends, stamps and their order, exactly.
 *
 * Boundaries mocked: supabase (one in-memory database), WhatsApp, Redis, the queue, the PDF renderer, the model client,
 * the loggers. The modules under test run.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(),
  sendDocument: jest.fn().mockResolvedValue(false),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
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
  };
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));

process.env.WEB_QUIZ_TOKEN_SECRET = 'test-token-secret-for-the-send-check-0123456789';
process.env.WEB_QUIZ_KID_KEY = 'test-kid-key-for-the-send-check-0123456789abcdef';

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const Queue = require('../../shared/services/queue/sqs-queue.service');
const redis = require('../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const report = require('../../shared/services/quiz/video-quiz-report.service');
// absent before the change: the red run still executes every row
const Flag = (() => { try { return require('../../shared/services/quiz/report-send-check'); } catch (_) { return null; } })();
const FoldFlag = require('../../shared/services/quiz/report-fold-flag');
const HomeFlag = require('../../shared/services/first-touch/teacher-home.flags');
const { throwOn } = require('../helpers/switch-off-matrix');

const KEY = 'quiz_report_send_checked';
const SC = '6b1c0f0e-0000-4000-8000-0000000005c2';
const QUIZ = '7c2d1f1f-0000-4000-8000-0000000000a1';
const TEACHER = '8d3e2a2a-0000-4000-8000-0000000000b1';
const TEACHER_PHONE = '+92300FIXTURE1';
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60 * 1000;

// Three report kinds: a storybook (nobody yet), a quiz nobody took, a quiz the class finished (its text report).
const KINDS = [
  ['story report', { source: 'story', sessions: 0, failed: 'story_report_send_failed' }],
  ['quiz report, nobody took it', { source: 'video', sessions: 0, failed: 'quiz_report_send_failed' }],
  ['quiz report, the class finished', { source: 'video', sessions: 3, failed: 'quiz_report_send_failed' }],
];

let order = [];
let db = null;

function stubDb({ source, sessions, setting }) {
  db = {
    app_settings: setting === undefined ? [] : [{ key: KEY, value: setting }],
    quiz_share_codes: [{
      id: SC, code: 'TST7AB', quiz_id: QUIZ, teacher_user_id: TEACHER, teacher_name: 'Sana Testwala',
      topic: 'Fractions', language: 'en', created_at: iso(20 * 60 * MIN), report_sent_at: null,
    }],
    users: [{ id: TEACHER, phone_number: TEACHER_PHONE, preferred_language: 'en', name: 'Sana Testwala' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, meta: source === 'story' ? { story: { book_id: 'b1', lang: 'en' } } : {}, quiz_source: source, topic: 'Fractions', language: 'en', subject: 'maths', grade: '4' }],
    quiz_sessions: Array.from({ length: sessions }, (_, i) => ({
      id: `s${i}`, share_code_id: SC, user_id: null, invited_by_student_id: null, student_id: null,
      student_name: `Child${i + 1} Testwala`, student_class: '4', parent_phone: null, status: 'completed', device_ref: null,
      total_questions_answered: 4, correct_answers: 2, mastery_percentage: 50, created_at: iso(40 * MIN), completed_at: iso(30 * MIN),
    })),
    question_attempts: [],
    story_events: [],
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
          if (table === 'quiz_share_codes' && 'report_sent_at' in patch) order.push('markSent');
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
  return db;
}

/** The teacher's sends answer `answer` (true, false, or 'throw'). */
function whatsappAnswers(answer) {
  WhatsAppService.sendMessage.mockImplementation(async (to) => {
    if (to === TEACHER_PHONE) order.push('send');
    if (answer === 'throw') throw new Error('WhatsApp 500');
    return answer;
  });
}

/** Count supabase.from(table) calls from here on, per table. */
function countReads() {
  const inner = supabase.from.getMockImplementation();
  const n = {};
  supabase.from.mockImplementation((table) => { n[table] = (n[table] || 0) + 1; return inner(table); });
  return n;
}

// The reads one generate() makes with the switch off, recorded on the code before the switch existed: `cold` with
// every settings cache empty, `warm` for the next report within the 30 s caches. Off must read exactly these.
const BASE_READS = {
  story: { cold: { app_settings: 1, quizzes: 4 }, warm: { app_settings: 0, quizzes: 4 } },
  noOne: { cold: { app_settings: 1, quizzes: 2 }, warm: { app_settings: 0, quizzes: 2 } },
  finished: { cold: { app_settings: 2, quizzes: 2 }, warm: { app_settings: 0, quizzes: 2 } },
};
const baseReadsOf = (kind) => BASE_READS[kind.source === 'story' ? 'story' : (kind.sessions ? 'finished' : 'noOne')];
const reads = (n) => ({ app_settings: n.app_settings || 0, quizzes: n.quizzes || 0 });

const stamped = () => db.quiz_share_codes[0].report_sent_at;
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name);
const retries = () => Queue.queueJob.mock.calls.filter((c) => /retry/.test(String((c[3] || {}).deduplicationId)));
const teacherSends = () => WhatsAppService.sendMessage.mock.calls.filter((c) => c[0] === TEACHER_PHONE).length;

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  order = [];
  if (Flag && Flag.reset) Flag.reset();
  FoldFlag.reset();
  HomeFlag.reset();
  logEvent.mockImplementation((name) => { if (name === 'quiz_funnel.report_sent') order.push('event'); });
  delete process.env.VIDEO_REPORT_SEND_CLAIM;
  delete process.env.CLASS_CARD_ENABLED;
});

describe.each(KINDS)('%s', (_, kind) => {
  describe('switch off (absent): today exactly — the golden order', () => {
    test.each([[true], [false]])('send answers %s: send, then markSent, then report_sent; stamped', async (answer) => {
      stubDb(kind);
      whatsappAnswers(answer);
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
      expect(order).toEqual(['send', 'markSent', 'event']);
      expect(stamped()).not.toBeNull();
      expect(events(kind.failed)).toHaveLength(0);
    });

    test('a send that throws still throws, as today: nothing stamped, no report_sent', async () => {
      stubDb(kind);
      whatsappAnswers('throw');
      await expect(report.generate(SC, { reason: 'scheduled' })).rejects.toThrow('WhatsApp 500');
      expect(order).toEqual(['send']);
      expect(stamped()).toBeNull();
      expect(events(kind.failed)).toHaveLength(0);
    });

    test('switch JSON false: today exactly', async () => {
      stubDb({ ...kind, setting: false });
      whatsappAnswers(false);
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
      expect(order).toEqual(['send', 'markSent', 'event']);
    });
  });

  describe('switch off: the settings and quiz reads are today\'s, exactly', () => {
    test.each([
      ['absent', true, undefined], ['absent', false, undefined], ['JSON false', true, false], ['JSON false', false, false],
      ['the string "true"', false, 'true'],
    ])('%s, send answers %s: reads per report == the recorded base, cold then warm', async (_n, answer, setting) => {
      stubDb({ ...kind, setting });
      whatsappAnswers(answer);
      const base = baseReadsOf(kind);
      const cold = countReads();
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
      expect(reads(cold)).toEqual(base.cold);
      // the next report (a fresh code row), the 30 s caches still warm
      stubDb({ ...kind, setting });
      whatsappAnswers(answer);
      const warm = countReads();
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
      expect(reads(warm)).toEqual(base.warm);
      expect(order).toEqual(['send', 'markSent', 'event', 'send', 'markSent', 'event']);
    });
  });

  describe('strict key: only JSON true is on', () => {
    test.each([['the string "true"', 'true'], ['{enabled: true}', { enabled: true }], ['1', 1], ['"on"', 'on']])('%s is OFF: a refused send is still stamped as today', async (_n, value) => {
      stubDb({ ...kind, setting: value });
      whatsappAnswers(false);
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
      expect(order).toEqual(['send', 'markSent', 'event']);
      expect(stamped()).not.toBeNull();
      expect(events(kind.failed)).toHaveLength(0);
    });
  });

  describe('switch on (JSON true)', () => {
    test('send accepted (true): marked and report_sent, as today', async () => {
      stubDb({ ...kind, setting: true });
      whatsappAnswers(true);
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
      expect(order).toEqual(['send', 'markSent', 'event']);
      expect(stamped()).not.toBeNull();
      expect(events(kind.failed)).toHaveLength(0);
      expect(retries()).toHaveLength(0);
    });

    test('send refused (false): not marked, the failure logged without a phone, no report_sent, tried again', async () => {
      stubDb({ ...kind, setting: true });
      whatsappAnswers(false);
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
      expect(stamped()).toBeNull();
      expect(order).toEqual(['send']);
      expect(events('quiz_funnel.report_sent')).toHaveLength(0);
      const failed = events(kind.failed);
      expect(failed).toHaveLength(1);
      expect(failed[0][1]).toMatchObject({ code_h: expect.stringMatching(/^[0-9a-f]{12}$/), tk: expect.stringMatching(/^[0-9a-f]{16}$/), tries: 1 });
      expect(JSON.stringify(failed)).not.toMatch(/FIXTURE|TST7AB|Testwala/);
      expect(retries()).toHaveLength(1);
      expect(retries()[0][1]).toBe('quiz_video_report');
      // tried again in 15 minutes, once per try
      expect(retries()[0][3].delaySeconds).toBe(900);
      expect(retries()[0][3].deduplicationId).toBe(`${SC}-quiz_video_report-retry-1`);
      expect(db.quizzes[0].meta.report_send_failures).toEqual({ [SC]: 1 });
      // the send claim is given back, so the retry can take it
      expect(redis._store.has(`vq:report:sending:${SC}`)).toBe(false);
    });

    test('the switch unreadable (a failed read) is OFF: a refused send is still stamped, as today', async () => {
      stubDb({ ...kind, setting: true });
      supabase.from.mockImplementation(throwOn(supabase.from.getMockImplementation(), KEY));
      whatsappAnswers(false);
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
      expect(order).toEqual(['send', 'markSent', 'event']);
      expect(stamped()).not.toBeNull();
      expect(events(kind.failed)).toHaveLength(0);
      expect(retries()).toHaveLength(0);
    });

    test('send throws: treated as refused, not as a crash', async () => {
      stubDb({ ...kind, setting: true });
      whatsappAnswers('throw');
      await expect(report.generate(SC, { reason: 'scheduled' })).resolves.toBe(false);
      expect(stamped()).toBeNull();
      expect(events(kind.failed)).toHaveLength(1);
      expect(events('quiz_funnel.report_sent')).toHaveLength(0);
    });

    test('third refusal: report_gave_up, and nothing tries again', async () => {
      stubDb({ ...kind, setting: true });
      whatsappAnswers(false);
      for (let i = 0; i < 3; i++) expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
      expect(events(kind.failed).map((c) => c[1].tries)).toEqual([1, 2, 3]);
      const gaveUp = events('report_gave_up');
      expect(gaveUp).toHaveLength(1);
      expect(gaveUp[0][1]).toMatchObject({ code_h: expect.stringMatching(/^[0-9a-f]{12}$/), tries: 3 });
      expect(JSON.stringify(gaveUp)).not.toMatch(/FIXTURE/);
      expect(retries()).toHaveLength(2);
      const before = teacherSends();
      // the next scheduled run (an old chain, a redelivery) sends nothing
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
      expect(teacherSends()).toBe(before);
      expect(retries()).toHaveLength(2);
      expect(stamped()).toBeNull();
    });

    test('after giving up, the teacher\'s own ask from /quiz still tries', async () => {
      stubDb({ ...kind, setting: true });
      whatsappAnswers(false);
      for (let i = 0; i < 3; i++) await report.generate(SC, { reason: 'scheduled' });
      whatsappAnswers(true);
      // force = the teacher's ask (a class nobody finished is answered only on the scheduled reason, as today)
      expect(await report.generate(SC, { reason: 'scheduled', force: true })).toBe(true);
      expect(stamped()).not.toBeNull();
    });

    test('a refusal then an accepted retry: marked once', async () => {
      stubDb({ ...kind, setting: true });
      whatsappAnswers(false);
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
      whatsappAnswers(true);
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
      expect(stamped()).not.toBeNull();
      expect(events('quiz_funnel.report_sent')).toHaveLength(1);
    });
  });
});
