'use strict';
/**
 * quiz_report_send_checked, the send half of a report WhatsApp accepted and then failed to deliver: a teacher's
 * 12 h class report that WhatsApp accepted keeps its message id in Redis (`report_msg:<id>` → {kind, share_code_id,
 * quiz_id, at}, 48 h), so the status webhook can find the report when WhatsApp later says the message failed.
 *
 * Switch on (JSON true only): the id is kept for the storybook report, the quiz report nobody took, the quiz report's
 * text and its PDF, and the chat quiz's report (quiz-job-handler, `quiz_id`). Switch off (absent, false, the string
 * "true", "\"true\"", 1, {}): no Redis write and the sends are called exactly as today. The class report never reads
 * the switch for this (the reading it already made, report-send-check known(), decides); the chat quiz asks the 30 s
 * cached reading after an accepted send (off: at most one settings read per 30 s).
 *
 * Also the transport: WhatsAppService.sendMessage / sendDocument still answer a plain boolean; the id reaches only a
 * caller that collects it (whatsapp-sent-ids.collect).
 *
 * Boundaries mocked: supabase (one in-memory database), WhatsApp, Redis, the queue, the PDF renderer, the model
 * client, the loggers. The modules under test run.
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
jest.mock('../../shared/services/quiz/quiz-report.service', () => ({ generateReport: jest.fn() }));
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));

process.env.WEB_QUIZ_TOKEN_SECRET = 'test-token-secret-for-the-send-check-0123456789';
process.env.WEB_QUIZ_KID_KEY = 'test-kid-key-for-the-send-check-0123456789abcdef';

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const redis = require('../../shared/services/cache/railway-redis.service');
const report = require('../../shared/services/quiz/video-quiz-report.service');
const Flag = require('../../shared/services/quiz/report-send-check');
const FoldFlag = require('../../shared/services/quiz/report-fold-flag');
const HomeFlag = require('../../shared/services/first-touch/teacher-home.flags');
// absent before the change: the red run still executes every row
const SentIds = (() => { try { return require('../../shared/services/whatsapp-sent-ids'); } catch (_) { return null; } })();

const KEY = 'quiz_report_send_checked';
const SC = '6b1c0f0e-0000-4000-8000-0000000005c2';
const QUIZ = '7c2d1f1f-0000-4000-8000-0000000000a1';
const TEACHER = '8d3e2a2a-0000-4000-8000-0000000000b1';
const TEACHER_PHONE = ['+92', '300', 'FIXTURE1'].join('');
const PHONE2 = ['+92', '300', 'FIXTURE2'].join('');
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60 * 1000;
const TTL_48H = 48 * 60 * 60;

const KINDS = [
  ['story report', { source: 'story', sessions: 0, kind: 'story' }],
  ['quiz report, nobody took it', { source: 'video', sessions: 0, kind: 'quiz' }],
  ['quiz report, the class finished (text)', { source: 'video', sessions: 3, kind: 'quiz' }],
];
const OFF = [['absent', undefined], ['JSON false', false], ['the string "true"', 'true'], ['the string "\\"true\\""', '"true"'], ['1', 1], ['{}', {}]];

let db = null;
let sent = 0;

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
      eq: (f, v) => { rows = rows.filter((r) => r[f] === v); if (patch) rows.forEach((r) => Object.assign(r, patch)); return chain; },
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

/** WhatsApp accepts every send and hands back an id (as the real transport does, to a collecting caller). */
function whatsappAccepts() {
  const accept = async () => { sent += 1; if (SentIds) SentIds.report(`wamid.TEST${sent}`); return true; };
  WhatsAppService.sendMessage.mockImplementation(accept);
  return accept;
}

const reportKeys = () => [...redis._store.keys()].filter((k) => k.startsWith('report_msg:'));
const reportWrites = () => redis.set.mock.calls.filter((c) => String(c[0]).startsWith('report_msg:'));
const reads = (n) => ({ app_settings: n.app_settings || 0, quizzes: n.quizzes || 0 });
function countReads() {
  const inner = supabase.from.getMockImplementation();
  const n = {};
  supabase.from.mockImplementation((table) => { n[table] = (n[table] || 0) + 1; return inner(table); });
  return n;
}
// The reads one generate() makes with the switch off, as the report-send-check suite pins them (cold caches).
const BASE_COLD = { story: { app_settings: 1, quizzes: 4 }, noOne: { app_settings: 1, quizzes: 2 }, finished: { app_settings: 2, quizzes: 2 } };
const baseOf = (k) => BASE_COLD[k.source === 'story' ? 'story' : (k.sessions ? 'finished' : 'noOne')];

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  sent = 0;
  Flag.reset();
  FoldFlag.reset();
  HomeFlag.reset();
  WhatsAppService.sendDocument.mockResolvedValue(false);
  delete process.env.VIDEO_REPORT_SEND_CLAIM;
});

describe.each(KINDS)('%s', (_, kind) => {
  test('switch on, WhatsApp accepted: the report keeps its message id for 48 h', async () => {
    stubDb({ ...kind, setting: true });
    whatsappAccepts();
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(db.quiz_share_codes[0].report_sent_at).not.toBeNull();
    expect(reportKeys()).toEqual(['report_msg:wamid.TEST1']);
    const [key, value, ttl] = reportWrites()[0];
    expect(key).toBe('report_msg:wamid.TEST1');
    expect(ttl).toBe(TTL_48H);
    expect(value).toMatchObject({ kind: kind.kind, share_code_id: SC, at: expect.any(String) });
    expect(JSON.stringify(value)).not.toMatch(/FIXTURE|TST7AB|Testwala/);
  });

  test.each(OFF)('switch off (%s): no Redis write, the sends called as today, the reads as today', async (_n, setting) => {
    stubDb({ ...kind, setting });
    whatsappAccepts();
    const n = countReads();
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(reportWrites()).toHaveLength(0);
    expect(reportKeys()).toHaveLength(0);
    expect(reads(n)).toEqual(baseOf(kind));
    // each send exactly as today: (phone, text), nothing added
    for (const c of WhatsAppService.sendMessage.mock.calls) expect(c).toHaveLength(2);
  });

  test('switch on, WhatsApp refused: no id kept (nothing went out)', async () => {
    stubDb({ ...kind, setting: true });
    WhatsAppService.sendMessage.mockResolvedValue(false);
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
    expect(reportKeys()).toHaveLength(0);
  });
});

test('switch on, the quiz report went as a PDF: the PDF\'s id is kept', async () => {
  stubDb({ source: 'video', sessions: 3, setting: true });
  whatsappAccepts();
  // a rendered PDF: sendAsPdf's renderer is mocked away, so the document send is reached through the stub below
  const htmlToPdf = require('../../shared/utils/html-to-pdf');
  htmlToPdf.htmlToPdf.mockResolvedValueOnce(Buffer.from('%PDF-1.4 test'));
  WhatsAppService.sendDocument.mockImplementationOnce(async () => { if (SentIds) SentIds.report('wamid.PDF1'); return true; });
  expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
  expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(1);
  expect(reportKeys()).toEqual(['report_msg:wamid.PDF1']);
});

describe('the transport: the id reaches only a caller that collects it', () => {
  const Real = jest.requireActual('../../shared/services/whatsapp.service');
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  test('sendMessage still answers a plain true; inside collect() the id is handed over', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.REAL1' }] }) }));
    expect(await Real.sendMessage(PHONE2, 'hi')).toBe(true);
    expect(SentIds).not.toBeNull();
    const { result, ids } = await SentIds.collect(() => Real.sendMessage(PHONE2, 'hi'));
    expect(result).toBe(true);
    expect(ids).toEqual(['wamid.REAL1']);
  });

  test('a refused sendMessage hands over no id and still answers false', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'bad' } }) }));
    expect(SentIds).not.toBeNull();
    const { result, ids } = await SentIds.collect(() => Real.sendMessage(PHONE2, 'hi'));
    expect(result).toBe(false);
    expect(ids).toEqual([]);
  });

  test('remember() with the switch off, or with no id, writes nothing', async () => {
    const Delivery = (() => { try { return require('../../shared/services/quiz/report-delivery'); } catch (_) { return null; } })();
    expect(Delivery).not.toBeNull();
    stubDb({ source: 'video', sessions: 0, setting: false });
    await Flag.on();
    await Delivery.remember(['wamid.X'], { kind: 'quiz', share_code_id: SC });
    stubDb({ source: 'video', sessions: 0, setting: true });
    Flag.reset();
    await Flag.on();
    await Delivery.remember([], { kind: 'quiz', share_code_id: SC });
    await Delivery.remember([null], { kind: 'quiz', share_code_id: SC });
    expect(reportWrites()).toHaveLength(0);
    await Delivery.remember(['wamid.Y'], { kind: 'quiz', share_code_id: SC });
    expect(reportKeys()).toEqual(['report_msg:wamid.Y']);
  });

  test('remember() with no reading of the switch in this process: nothing read, nothing written', async () => {
    const Delivery = (() => { try { return require('../../shared/services/quiz/report-delivery'); } catch (_) { return null; } })();
    expect(Delivery).not.toBeNull();
    stubDb({ source: 'video', sessions: 0, setting: true });
    const n = countReads();
    await Delivery.remember(['wamid.Z'], { kind: 'quiz', share_code_id: SC });
    expect(n.app_settings || 0).toBe(0);
    expect(reportWrites()).toHaveLength(0);
  });
});

describe('the chat quiz report (quiz-job-handler): the id kept beside its sent flag', () => {
  const QUIZ_REPORT = require('../../shared/services/quiz/quiz-report.service');
  const Handler = require('../../workers/quiz-job-handler');
  const chatDb = (setting) => {
    stubDb({ source: 'video', sessions: 0, setting });
    db.quizzes[0].created_at = iso(13 * 60 * MIN);
    db.quizzes[0].status = 'sent';
    db.quiz_sessions = [{ quiz_id: QUIZ, status: 'completed' }];
  };
  beforeEach(() => {
    QUIZ_REPORT.generateReport.mockImplementation(async () => {
      if (SentIds) SentIds.report('wamid.CHAT1');
      return true;   // WhatsApp took it (generateReport answers the send)
    });
  });

  test('switch on, cold cache, the report accepted: report_msg:<id> -> {kind: chat_quiz, quiz_id}, 48 h', async () => {
    chatDb(true);
    const r = await Handler.handleQuizReport({ groupId: QUIZ, payload: { teacherPhone: TEACHER_PHONE } });
    expect(r).toEqual({ ok: true });
    expect(redis._store.get(`quiz_report_sent:${QUIZ}`)).toBe('1');
    expect(reportKeys()).toEqual(['report_msg:wamid.CHAT1']);
    const [, value, ttl] = reportWrites()[0];
    expect(ttl).toBe(TTL_48H);
    expect(value).toMatchObject({ kind: 'chat_quiz', quiz_id: QUIZ, at: expect.any(String) });
    expect(JSON.stringify(value)).not.toMatch(/FIXTURE/);
  });

  test.each(OFF)('switch off (%s), cold cache: no write, the handler as today', async (_n, setting) => {
    chatDb(setting);
    const r = await Handler.handleQuizReport({ groupId: QUIZ, payload: { teacherPhone: TEACHER_PHONE } });
    expect(r).toEqual({ ok: true });
    expect(reportWrites()).toHaveLength(0);
    expect(redis._store.get(`quiz_report_sent:${QUIZ}`)).toBe('1');
    expect(QUIZ_REPORT.generateReport).toHaveBeenCalledWith(QUIZ, { teacherPhone: TEACHER_PHONE });
  });

  test('switch off: one settings read on an accepted report, then none for 30 s; none when nothing was accepted', async () => {
    chatDb(false);
    const n = countReads();
    await Handler.handleQuizReport({ groupId: QUIZ, payload: { teacherPhone: TEACHER_PHONE } });
    expect(n.app_settings || 0).toBe(1);
    redis._store.delete(`quiz_report_sent:${QUIZ}`);
    await Handler.handleQuizReport({ groupId: QUIZ, payload: { teacherPhone: TEACHER_PHONE } });
    expect(n.app_settings || 0).toBe(1);   // the 30 s cache
    // an accepted report with no id to keep: no read at all
    Flag.reset();
    redis._store.delete(`quiz_report_sent:${QUIZ}`);
    QUIZ_REPORT.generateReport.mockImplementation(async () => true);
    await Handler.handleQuizReport({ groupId: QUIZ, payload: { teacherPhone: TEACHER_PHONE } });
    expect(n.app_settings || 0).toBe(1);
    expect(reportWrites()).toHaveLength(0);
  });
});
