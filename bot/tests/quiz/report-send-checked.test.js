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
const Group = (() => { try { return require('../../shared/services/settings-group'); } catch (_) { return null; } })();

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

function stubDb({ source, sessions, setting, settings = null, meta = null }) {
  db = {
    // `settings` = every app_settings row, in this order (a row's place in the answer); else this key's row alone
    app_settings: settings || (setting === undefined ? [] : [{ key: KEY, value: setting }]),
    quiz_share_codes: [{
      id: SC, code: 'TST7AB', quiz_id: QUIZ, teacher_user_id: TEACHER, teacher_name: 'Sana Testwala',
      topic: 'Fractions', language: 'en', created_at: iso(20 * 60 * MIN), report_sent_at: null,
    }],
    users: [{ id: TEACHER, phone_number: TEACHER_PHONE, preferred_language: 'en', name: 'Sana Testwala' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, meta: { ...(source === 'story' ? { story: { book_id: 'b1', lang: 'en' } } : {}), ...(meta || {}) }, quiz_source: source, topic: 'Fractions', language: 'en', subject: 'maths', grade: '4' }],
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

// The same with one host switch read first (as another caller in the process would), recorded on the code before the
// switch: `fold` = report-fold-flag on(), `home` = first-touch/teacher-home.flags on(), `both` = the two.
const HOSTS = ['fold', 'home', 'both'];
const warmHost = async (host) => {
  if (host !== 'home') await FoldFlag.on();
  if (host !== 'fold') await HomeFlag.on();
};
const BASE_HOST_WARM = {
  story: { fold: { app_settings: 0, quizzes: 4 }, home: { app_settings: 1, quizzes: 4 }, both: { app_settings: 0, quizzes: 4 } },
  noOne: { fold: { app_settings: 1, quizzes: 2 }, home: { app_settings: 0, quizzes: 2 }, both: { app_settings: 0, quizzes: 2 } },
  finished: { fold: { app_settings: 1, quizzes: 2 }, home: { app_settings: 1, quizzes: 2 }, both: { app_settings: 0, quizzes: 2 } },
};
// The one named extra read: a quiz nobody took (it makes no fold read, so nothing has carried this key), the fold
// switch not read by another caller within 30 s, and the switch asked (WhatsApp refused the report). This key never
// rides the teacher home switch's read, so the question reads this key alone: 1, at most once per 30 s per process.
const noFoldRead = (kind) => kind.source !== 'story' && !kind.sessions;
const namedExtra = (kind, host, answer) => (noFoldRead(kind) && host !== 'fold' && host !== 'both' && answer !== true ? 1 : 0);
// Switch on and the send refused, nothing is stamped, so a quiz report skips the stamp's teacher home read (when that
// switch is not already fresh): one read fewer than the base.
const noStampRead = (kind, host) => (kind.source !== 'story' && host !== 'home' && host !== 'both' ? 1 : 0);
const baseHostWarmOf = (kind, host) => BASE_HOST_WARM[kind.source === 'story' ? 'story' : (kind.sessions ? 'finished' : 'noOne')][host];

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
      expect(reads(cold)).toEqual({ ...base.cold, app_settings: base.cold.app_settings + namedExtra(kind, 'cold', answer) });
      // the next report (a fresh code row), the 30 s caches still warm
      stubDb({ ...kind, setting });
      whatsappAnswers(answer);
      const warm = countReads();
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
      expect(reads(warm)).toEqual(base.warm);
      expect(order).toEqual(['send', 'markSent', 'event', 'send', 'markSent', 'event']);
    });
  });

  describe('a host switch read first by another caller, this switch never read: today\'s reads, exactly', () => {
    test.each(HOSTS.flatMap((h) => [[h, 'absent', true, undefined], [h, 'absent', false, undefined], [h, 'JSON false', false, false]]))(
      '%s read first; key %s; send answers %s: reads == the base with that host warm', async (host, _n, answer, setting) => {
        stubDb({ ...kind, setting });
        whatsappAnswers(answer);
        await warmHost(host);
        const n = countReads();
        expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
        expect(order).toEqual(['send', 'markSent', 'event']);
        const base = baseHostWarmOf(kind, host);
        expect(reads(n)).toEqual({ ...base, app_settings: base.app_settings + namedExtra(kind, host, answer) });
      });

    test.each(HOSTS)('%s read first; switch on, send refused: the base\'s reads, less the stamp\'s, plus only the named one', async (host) => {
      stubDb({ ...kind, setting: true });
      whatsappAnswers(false);
      await warmHost(host);
      const n = countReads();
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
      expect(stamped()).toBeNull();
      expect(events(kind.failed)).toHaveLength(1);
      expect(reads(n).app_settings).toBe(baseHostWarmOf(kind, host).app_settings - noStampRead(kind, host) + namedExtra(kind, host, false));
    });
  });

  describe('switch off after an on period: three refusals left on the quiz row change nothing', () => {
    test.each([['absent', undefined], ['JSON false', false]])('key %s, the code holds 3 refused sends: the report is still sent and stamped, as today', async (_n, setting) => {
      stubDb({ ...kind, setting, meta: { report_send_failures: { [SC]: 3 } } });
      whatsappAnswers(true);
      const n = countReads();
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
      expect(order).toEqual(['send', 'markSent', 'event']);
      expect(stamped()).not.toBeNull();
      expect(events('video_quiz.report_suppressed')).toHaveLength(0);
      // cold: the fold read (story, finished) carries the question; a report nobody finished pays the one named read
      const base = baseReadsOf(kind).cold;
      expect(reads(n)).toEqual({ ...base, app_settings: base.app_settings + (noFoldRead(kind) ? 1 : 0) });
    });

    test('key on, the code holds 3 refused sends: nothing is sent', async () => {
      stubDb({ ...kind, setting: true, meta: { report_send_failures: { [SC]: 3 } } });
      whatsappAnswers(true);
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
      expect(teacherSends()).toBe(0);
      expect(stamped()).toBeNull();
      expect(events('video_quiz.report_suppressed')).toHaveLength(1);
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

// The fold switch's one settings read carries this key: the read itself, a prime from outside, and its failure.
describe('the fold switch\'s read carries the send check', () => {
  const FOLD = 'quiz_report_fold_by_child';
  /** app_settings queries from here on: `eq:<key>` or `in:<k1,k2>`. */
  function settingsQueries() {
    const inner = supabase.from.getMockImplementation();
    const q = [];
    supabase.from.mockImplementation((table) => {
      const b = inner(table);
      if (table !== 'app_settings') return b;
      const { eq, in: within } = b;
      b.eq = (col, v) => { if (col === 'key') q.push(`eq:${v}`); return eq.call(b, col, v); };
      b.in = (col, vs) => { if (col === 'key') q.push(`in:${[].concat(vs).join(',')}`); return within.call(b, col, vs); };
      return b;
    });
    return q;
  }
  const kindOf = (name) => KINDS.find(([n]) => n === name)[1];

  test('one query for both keys: the fold read primes the switch, which then answers with no read', async () => {
    stubDb({ ...kindOf('quiz report, nobody took it'), settings: [{ key: FOLD, value: false }, { key: KEY, value: true }] });
    const q = settingsQueries();
    expect(await FoldFlag.on()).toBe(false);
    expect(q).toEqual([`in:${FOLD},${KEY}`]);
    expect(await Flag.on()).toBe(true);
    expect(q).toHaveLength(1);
  });

  test.each([
    ['fold row first: fold true, this key false', [{ key: FOLD, value: true }, { key: KEY, value: false }], true, false],
    ['this key first: this key false, fold true', [{ key: KEY, value: false }, { key: FOLD, value: true }], true, false],
    ['fold row first: fold false, this key true', [{ key: FOLD, value: false }, { key: KEY, value: true }], false, true],
    ['this key first: this key true, fold false', [{ key: KEY, value: true }, { key: FOLD, value: false }], false, true],
  ])('each switch answers its own row, never the row in a given place (%s)', async (_n, settings, fold, mine) => {
    stubDb({ ...kindOf('quiz report, nobody took it'), settings });
    expect(await FoldFlag.on()).toBe(fold);
    expect(await Flag.on()).toBe(mine);
  });

  test('only this key\'s read fails: the fold switch\'s own answer is unchanged (true), read alone; this switch is off, held 30 s', async () => {
    stubDb({ ...kindOf('quiz report, the class finished'), settings: [{ key: FOLD, value: true }, { key: KEY, value: true }] });
    supabase.from.mockImplementation(throwOn(supabase.from.getMockImplementation(), KEY));
    const q = settingsQueries();
    expect(await FoldFlag.on()).toBe(true);
    // the fallback reads the fold key alone: no rider rides it
    expect(q).toEqual([`in:${FOLD},${KEY}`, `eq:${FOLD}`]);
    expect(await Flag.on()).toBe(false);
    expect(q).toHaveLength(2);
  });

  test('only this key\'s read fails, a refused report with the class finished: still stamped, as today; fold answered true', async () => {
    stubDb({ ...kindOf('quiz report, the class finished'), settings: [{ key: FOLD, value: true }, { key: KEY, value: true }] });
    supabase.from.mockImplementation(throwOn(supabase.from.getMockImplementation(), KEY));
    whatsappAnswers(false);
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(stamped()).not.toBeNull();
    expect(await FoldFlag.on()).toBe(true);
  });

  test('(a) a prime that asked for the whole group: the switch is seen ON with 0 reads', async () => {
    stubDb({ ...kindOf('quiz report, nobody took it') });
    const q = settingsQueries();
    const asked = Group.groupKeys(FOLD);
    expect(asked).toEqual([FOLD, KEY]);
    expect(FoldFlag.prime([{ key: KEY, value: true }], Date.now(), asked)).toBe(false);
    expect(await Flag.on()).toBe(true);
    expect(await FoldFlag.on()).toBe(false);
    expect(q).toEqual([]);
  });

  test('(a) an asked key with no row is off, with no read', async () => {
    stubDb({ ...kindOf('quiz report, nobody took it') });
    const q = settingsQueries();
    FoldFlag.prime([{ key: FOLD, value: true }], Date.now(), [FOLD, KEY]);
    expect(await Flag.on()).toBe(false);
    expect(await FoldFlag.on()).toBe(true);
    expect(q).toEqual([]);
  });

  test.each([['undefined', undefined], ['null', null], ['{}', {}], ['the fold key alone', [FOLD]], ['this key alone', [KEY]]])(
    '(b) a prime whose asked list is %s throws, and primes nothing', async (_n, asked) => {
      stubDb({ ...kindOf('quiz report, nobody took it'), setting: true });
      expect(() => FoldFlag.prime([{ key: FOLD, value: true }, { key: KEY, value: false }], Date.now(), asked)).toThrow(/every key/);
      const q = settingsQueries();
      // nothing was primed: the switch reads its own (true) row
      expect(await Flag.on()).toBe(true);
      expect(q).toEqual([`eq:${KEY}`]);
    });

  test.each([['quiz report, nobody took it'], ['quiz report, the class finished'], ['story report']])(
    '(c) %s: the fold switch fresh, this switch\'s row cold, switch on, send refused: exactly one read more, and not stamped', async (name) => {
      const kind = kindOf(name);
      stubDb({ ...kind, setting: true });
      whatsappAnswers(false);
      await FoldFlag.on();
      Flag.reset();
      const n = countReads();
      expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
      expect(stamped()).toBeNull();
      expect(reads(n).app_settings).toBe(baseHostWarmOf(kind, 'fold').app_settings - noStampRead(kind, 'fold') + 1);
    });

  test('past the 30 s edge the switch never answers from the old read: one read of its own', async () => {
    stubDb({ ...kindOf('quiz report, nobody took it'), settings: [{ key: FOLD, value: false }, { key: KEY, value: false }] });
    const t0 = Date.now();
    await FoldFlag.on(t0);
    db.app_settings = [{ key: FOLD, value: false }, { key: KEY, value: true }];
    const q = settingsQueries();
    expect(await Flag.on(t0 + 29 * 1000)).toBe(false);
    expect(q).toEqual([]);
    expect(await Flag.on(t0 + 30 * 1000)).toBe(true);
    expect(q).toEqual([`eq:${KEY}`]);
    expect(await Flag.on(t0 + 31 * 1000)).toBe(true);
    expect(q).toHaveLength(1);
  });

  test('the fold switch stale (past 30 s), this switch cold: it reads its own row and answers the fresh value', async () => {
    stubDb({ ...kindOf('quiz report, nobody took it'), settings: [{ key: FOLD, value: false }, { key: KEY, value: true }] });
    const t0 = Date.now();
    await FoldFlag.on(t0);
    db.app_settings = [{ key: FOLD, value: false }, { key: KEY, value: false }];
    const q = settingsQueries();
    expect(await Flag.on(t0 + 31 * 1000)).toBe(false);
    expect(q).toEqual([`eq:${KEY}`]);
  });

  test('a good read at t0, the shared read failing at t0 + 31 s: this switch never answers the t0 value', async () => {
    stubDb({ ...kindOf('quiz report, nobody took it'), settings: [{ key: FOLD, value: false }, { key: KEY, value: true }] });
    const t0 = Date.now();
    await FoldFlag.on(t0);
    expect(await Flag.on(t0)).toBe(true);
    supabase.from.mockImplementation(throwOn(supabase.from.getMockImplementation(), KEY));
    expect(await FoldFlag.on(t0 + 31 * 1000)).toBe(false);
    expect(await Flag.on(t0 + 31 * 1000)).toBe(false);
  });

  test.each([['the string "true"', 'true'], ['the string "\\"true\\""', '"true"'], ['1', 1], ['{enabled: true}', { enabled: true }]])(
    'on the shared read, %s is OFF', async (_n, value) => {
      stubDb({ ...kindOf('quiz report, nobody took it'), settings: [{ key: FOLD, value: false }, { key: KEY, value }] });
      const q = settingsQueries();
      await FoldFlag.on();
      expect(await Flag.on()).toBe(false);
      expect(q).toEqual([`in:${FOLD},${KEY}`]);
    });

  test('the teacher home switch\'s read never carries this key', async () => {
    stubDb({ ...kindOf('quiz report, nobody took it'), setting: true });
    const q = settingsQueries();
    await HomeFlag.on();
    expect(q).toEqual(['eq:quiz_teacher_home']);
    expect(await Flag.on()).toBe(true);
    expect(q).toEqual(['eq:quiz_teacher_home', `eq:${KEY}`]);
  });
});
