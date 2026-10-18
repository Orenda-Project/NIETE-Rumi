'use strict';
/**
 * quiz_report_send_checked, the chat quiz's report (workers/quiz-job-handler handleQuizReport).
 *
 * Today the job sets `quiz_report_sent:<quizId>` (the cascade's "already fired" flag) after
 * QuizReportService.generateReport whatever WhatsApp answered, so a report WhatsApp refused is never tried again.
 *
 * Switch on (only a JSON true): generateReport answers whether WhatsApp took the report (the PDF, or the text it
 * falls back to). The flag is set only on a true. A refusal logs quiz_report_send_failed (a hash of the quiz id, the
 * teacher's tk and the try count; never a phone) and the job is queued again by the cascade's own re-queue; the third
 * refusal logs report_gave_up and nothing is queued again.
 * Switch off, absent, or anything but JSON true: today's calls exactly (the OFF golden below, recorded on the code
 * before this change), and no settings read on an accepted report.
 *
 * Boundaries mocked: supabase (one in-memory database), WhatsApp, Redis, the queue, the PDF renderer, R2, the
 * loggers. The handler and the report service run.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(),
  sendDocument: jest.fn(),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    del: jest.fn(async (k) => { store.delete(k); return 1; }),
    incr: jest.fn(async (k) => { const n = (Number(store.get(k)) || 0) + 1; store.set(k, String(n)); return n; }),
    expire: jest.fn(async () => true),
  };
});
jest.mock('../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn() }));
jest.mock('../../shared/storage/r2', () => ({ uploadReportPDF: jest.fn().mockResolvedValue('https://r2.example/report.pdf') }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

process.env.WEB_QUIZ_TOKEN_SECRET = 'test-token-secret-for-the-send-check-0123456789';
process.env.WEB_QUIZ_KID_KEY = 'test-kid-key-for-the-send-check-0123456789abcdef';

const fs = require('fs');
const path = require('path');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const Queue = require('../../shared/services/queue/sqs-queue.service');
const redis = require('../../shared/services/cache/railway-redis.service');
const { htmlToPdf } = require('../../shared/utils/html-to-pdf');
const { logEvent } = require('../../shared/utils/structured-logger');
const handler = require('../../workers/quiz-job-handler');
const QuizReportService = require('../../shared/services/quiz/quiz-report.service');
const SendCheck = require('../../shared/services/quiz/report-send-check');
const FoldFlag = require('../../shared/services/quiz/report-fold-flag');

const KEY = 'quiz_report_send_checked';
const QUIZ = '7c2d1f1f-0000-4000-8000-0000000000c7';
const TEACHER = '8d3e2a2a-0000-4000-8000-0000000000b7';
const TEACHER_PHONE = '+92300FIXTURE7';
const FLAG = `quiz_report_sent:${QUIZ}`;
const GOLDEN = path.join(__dirname, 'goldens', 'chat-quiz-report-off.json');

let db;
let calls;
let updates; // [table, patch] — kept apart from `calls`, so the OFF golden stays as recorded

function stubDb({ setting } = {}) {
  db = {
    app_settings: setting === undefined ? [] : [{ key: KEY, value: setting }],
    quizzes: [{
      id: QUIZ, teacher_id: TEACHER, list_id: null, topic: 'Fractions', grade: '4', subject: 'maths',
      created_at: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(), total_students_sent: 2, status: 'sent',
    }],
    quiz_sessions: [
      { id: 'cs1', quiz_id: QUIZ, status: 'expired', student_id: null, total_questions_answered: 0, correct_answers: 0, mastery_percentage: null },
      { id: 'cs2', quiz_id: QUIZ, status: 'expired', student_id: null, total_questions_answered: 0, correct_answers: 0, mastery_percentage: null },
    ],
    users: [{ id: TEACHER, phone_number: TEACHER_PHONE.slice(1), name: 'Sana Testwala' }],
    quiz_answers: [],
    quiz_questions: [],
  };
  supabase.from.mockImplementation((table) => {
    calls.push(['db', table]);
    let rows = db[table] || [];
    let patch = null;
    const chain = {
      select: () => chain,
      eq: (f, v) => {
        rows = rows.filter((r) => r[f] === v);
        if (patch) { updates.push([table, patch]); rows.forEach((r) => Object.assign(r, patch)); }
        return chain;
      },
      in: (f, vs) => { rows = rows.filter((r) => vs.includes(r[f])); return chain; },
      is: () => chain, neq: () => chain, lt: () => chain, gt: () => chain, gte: () => chain, lte: () => chain,
      not: () => chain, or: () => chain, order: () => chain, limit: () => chain, range: () => chain,
      update: (p) => { patch = p; return chain; },
      maybeSingle: async () => ({ data: rows[0] ? { ...rows[0] } : null, error: null }),
      single: async () => ({ data: rows[0] ? { ...rows[0] } : null, error: rows[0] ? null : { message: 'none' } }),
      then: (res, rej) => Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(res, rej),
    };
    return chain;
  });
}

/** The report goes as a PDF ('pdf') or, the renderer failing, as text ('text'); WhatsApp answers `answer`. */
function whatsapp(route, answer) {
  if (route === 'pdf') htmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4'));
  else htmlToPdf.mockRejectedValue(new Error('no renderer in test env'));
  WhatsAppService.sendDocument.mockImplementation(async (to, _p, filename) => {
    calls.push(['wa.sendDocument', to, filename]);
    return answer;
  });
  WhatsAppService.sendMessage.mockImplementation(async (to) => {
    calls.push(['wa.sendMessage', to]);
    if (answer === 'throw') throw new Error('WhatsApp 500');
    return answer;
  });
}

const job = () => handler.handleQuizReport({ groupId: QUIZ, payload: { language: 'en' } });
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name);
const retries = () => Queue.queueJob.mock.calls.filter((c) => /retry/.test(String((c[3] || {}).deduplicationId)));
const settingsReads = () => calls.filter((c) => c[0] === 'db' && c[1] === 'app_settings').length;
/** Every call but the switch's own settings reads (pinned separately, below). */
const callLog = () => calls.filter((c) => !(c[0] === 'db' && c[1] === 'app_settings'));

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  calls = [];
  updates = [];
  SendCheck.reset();
  FoldFlag.reset();
  for (const m of ['get', 'set', 'del', 'incr', 'expire']) {
    const impl = redis[m].getMockImplementation();
    redis[m].mockImplementation(async (...a) => { calls.push([`redis.${m}`, ...a]); return impl(...a); });
  }
  Queue.queueJob.mockImplementation(async (...a) => { calls.push(['queue', a[0], a[1], a[3]]); return { MessageId: 'm1' }; });
  logEvent.mockImplementation((name, fields) => { calls.push(['event', name, fields]); });
});

// ─── switch off: today's calls, byte for byte ───────────────────────────────

const OFF_ROWS = [
  ['pdf accepted', 'pdf', true],
  ['pdf refused', 'pdf', false],
  ['text accepted', 'text', true],
  ['text refused', 'text', false],
];

describe('switch off (absent): the OFF golden, recorded before the change', () => {
  const golden = (() => { try { return JSON.parse(fs.readFileSync(GOLDEN, 'utf8')); } catch (_) { return {}; } })();
  const recorded = {};
  afterAll(() => {
    if (process.env.RECORD_OFF_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify(recorded, null, 2)}\n`);
    }
  });

  test.each(OFF_ROWS)('%s: the same calls, in the same order, and the flag is set', async (name, route, answer) => {
    stubDb();
    whatsapp(route, answer);
    const out = await job();
    recorded[name] = { out, calls: JSON.parse(JSON.stringify(callLog())) };
    expect(out).toEqual({ ok: true });
    expect(redis._store.get(FLAG)).toBe('1');
    if (process.env.RECORD_OFF_GOLDEN !== '1') expect(recorded[name]).toEqual(golden[name]);
  });

  test('a text send that throws still throws, as today: no flag', async () => {
    stubDb();
    whatsapp('text', 'throw');
    await expect(job()).rejects.toThrow('WhatsApp 500');
    expect(redis._store.has(FLAG)).toBe(false);
    expect(events('quiz_report_send_failed')).toHaveLength(0);
  });

  test.each([['JSON false', false], ['the string "true"', 'true'], ['{enabled: true}', { enabled: true }], ['1', 1]])(
    '%s is OFF: a refused report still sets the flag, as today', async (_n, value) => {
      stubDb({ setting: value });
      whatsapp('pdf', false);
      expect(await job()).toEqual({ ok: true });
      expect(redis._store.get(FLAG)).toBe('1');
      expect(events('quiz_report_send_failed')).toHaveLength(0);
      expect(retries()).toHaveLength(0);
    },
  );
});

describe('switch off: settings reads pinned', () => {
  test('an accepted report reads no settings (today: none)', async () => {
    stubDb();
    whatsapp('pdf', true);
    await job();
    expect(settingsReads()).toBe(0);
  });

  test('a refused report asks the switch once, cold; the next refusal within 30 s reads nothing', async () => {
    stubDb();
    whatsapp('pdf', false);
    await job();
    expect(settingsReads()).toBe(1);
    redis._store.clear();
    calls = [];
    await job();
    expect(settingsReads()).toBe(0);
  });
});

// ─── switch on ──────────────────────────────────────────────────────────────

describe('switch on (JSON true)', () => {
  test.each([['pdf'], ['text']])('%s accepted (true): the flag is set, as today', async (route) => {
    stubDb({ setting: true });
    whatsapp(route, true);
    expect(await job()).toEqual({ ok: true });
    expect(redis._store.get(FLAG)).toBe('1');
    expect(events('quiz_report_send_failed')).toHaveLength(0);
    expect(retries()).toHaveLength(0);
  });

  test.each([['pdf', false], ['text', false], ['text', 'throw']])('%s refused (%s): no flag, the failure logged without a phone, queued again', async (route, answer) => {
    stubDb({ setting: true });
    whatsapp(route, answer);
    const out = await job();
    expect(out).toMatchObject({ skipped: true, reason: 'send_failed', tries: 1 });
    expect(redis._store.has(FLAG)).toBe(false);
    expect(events('quiz.report.fired')).toHaveLength(0);
    const failed = events('quiz_report_send_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0][1]).toEqual({ quiz_h: expect.stringMatching(/^[0-9a-f]{12}$/), tk: expect.stringMatching(/^[0-9a-f]{16}$/), tries: 1 });
    expect(JSON.stringify(failed)).not.toMatch(/FIXTURE|Testwala|92300/);
    expect(JSON.stringify(failed)).not.toContain(QUIZ);
    expect(retries()).toHaveLength(1);
    expect(retries()[0].slice(0, 2)).toEqual([QUIZ, 'quiz_report']);
    expect(retries()[0][3]).toEqual({ delaySeconds: 900, deduplicationId: `${QUIZ}-quiz_report-retry-1` });
  });

  test('the third refusal: report_gave_up, and nothing is queued again', async () => {
    stubDb({ setting: true });
    whatsapp('pdf', false);
    for (let i = 0; i < 3; i++) await job();
    expect(events('quiz_report_send_failed').map((c) => c[1].tries)).toEqual([1, 2, 3]);
    const gaveUp = events('report_gave_up');
    expect(gaveUp).toHaveLength(1);
    expect(gaveUp[0][1]).toMatchObject({ quiz_h: expect.stringMatching(/^[0-9a-f]{12}$/), tries: 3 });
    expect(JSON.stringify(gaveUp)).not.toMatch(/FIXTURE|92300/);
    expect(retries()).toHaveLength(2);
    // never marked fired (the give-up is recorded in the same key, as 'gave_up', never '1')
    expect(redis._store.get(FLAG)).not.toBe('1');
  });

  test('given up, then a stray cascade message: nothing is sent, skipped_gave_up logged without a phone, nothing queued', async () => {
    stubDb({ setting: true });
    whatsapp('pdf', false);
    for (let i = 0; i < 3; i++) await job();
    const sendsBefore = WhatsAppService.sendDocument.mock.calls.length + WhatsAppService.sendMessage.mock.calls.length;
    const queuedBefore = Queue.queueJob.mock.calls.length;
    whatsapp('pdf', true);
    const out = await job();
    expect(out).toMatchObject({ skipped: true, reason: 'gave_up' });
    expect(WhatsAppService.sendDocument.mock.calls.length + WhatsAppService.sendMessage.mock.calls.length).toBe(sendsBefore);
    expect(Queue.queueJob.mock.calls.length).toBe(queuedBefore);
    const skipped = events('quiz_report_send_skipped_gave_up');
    expect(skipped).toHaveLength(1);
    expect(skipped[0][1]).toEqual({ quiz_h: expect.stringMatching(/^[0-9a-f]{12}$/), tk: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(JSON.stringify(skipped)).not.toMatch(/FIXTURE|92300|Testwala/);
    expect(redis._store.get(FLAG)).not.toBe('1');
  });

  test('a refusal, then an accepted retry: the flag is set', async () => {
    stubDb({ setting: true });
    whatsapp('pdf', false);
    await job();
    whatsapp('pdf', true);
    expect(await job()).toEqual({ ok: true });
    expect(redis._store.get(FLAG)).toBe('1');
    expect(retries()).toHaveLength(1);
  });

  test('the switch unreadable is OFF: a refused report sets the flag, as today', async () => {
    stubDb({ setting: true });
    const inner = supabase.from.getMockImplementation();
    supabase.from.mockImplementation((t) => {
      const b = inner(t);
      if (t === 'app_settings') b.maybeSingle = async () => ({ data: null, error: { message: 'settings down' } });
      return b;
    });
    whatsapp('pdf', false);
    expect(await job()).toEqual({ ok: true });
    expect(redis._store.get(FLAG)).toBe('1');
  });
});

// ─── the report's settings read is shared ───────────────────────────────────

describe('the switch rides the fold switch\'s read (settings-group)', () => {
  test('host warm, rider cold: the refusal reads the switch itself, once, and it decides (on)', async () => {
    stubDb({ setting: true });
    await FoldFlag.on(); // the fold switch read, carrying this switch
    SendCheck.reset(); // this switch's reading gone, the fold switch's still fresh
    calls = [];
    whatsapp('pdf', false);
    const out = await job();
    expect(settingsReads()).toBe(1);
    expect(out).toMatchObject({ reason: 'send_failed' });
    expect(redis._store.has(FLAG)).toBe(false);
  });

  test('host warm, rider warm (primed by the same read): the refusal reads nothing, and the switch decides', async () => {
    stubDb({ setting: true });
    await FoldFlag.on();
    calls = [];
    whatsapp('pdf', false);
    const out = await job();
    expect(settingsReads()).toBe(0);
    expect(out).toMatchObject({ reason: 'send_failed' });
  });
});

// ─── generateReport's answer ────────────────────────────────────────────────

describe('the quiz row is marked report_sent only when WhatsApp took the report (switch on)', () => {
  const quizUpdates = () => updates.filter(([t, p]) => t === 'quizzes' && p.status === 'report_sent');

  test.each([['pdf'], ['text']])('on, %s refused: the quiz row is left exactly as it was', async (route) => {
    stubDb({ setting: true });
    const before = { ...db.quizzes[0] };
    whatsapp(route, false);
    await job();
    expect(quizUpdates()).toHaveLength(0);
    expect(db.quizzes[0]).toEqual(before);
  });

  test('on, accepted: the quiz row is marked report_sent', async () => {
    stubDb({ setting: true });
    whatsapp('pdf', true);
    await job();
    expect(quizUpdates()).toHaveLength(1);
    expect(db.quizzes[0].status).toBe('report_sent');
  });

  test.each([[true], [false]])('off, WhatsApp answers %s: the quiz row is marked report_sent, as today', async (answer) => {
    stubDb();
    whatsapp('pdf', answer);
    await job();
    expect(quizUpdates()).toHaveLength(1);
    expect(db.quizzes[0].status).toBe('report_sent');
  });
});

describe('generateReport answers whether WhatsApp took the report', () => {
  test.each([
    ['pdf', true, true], ['pdf', false, false], ['text', true, true], ['text', false, false],
  ])('%s, WhatsApp answers %s → %s', async (route, answer, expected) => {
    stubDb();
    whatsapp(route, answer);
    expect(await QuizReportService.generateReport(QUIZ, { teacherPhone: TEACHER_PHONE })).toBe(expected);
  });
});
