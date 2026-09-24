'use strict';
/**
 * The class report is sent ONCE per share code, however many callers race for it.
 *
 * generate() reads quiz_share_codes.report_sent_at, spends 35-80 s building the
 * report, sends it, and only then stamps report_sent_at. Nothing held the share
 * code in between, so two calls that both read "not sent yet" both sent: the
 * legacy per-join chains all firing at 07:00 PKT, an SQS redelivery, or a teacher's
 * /quiz tap landing while the scheduled run is mid-build.
 *
 * The send is now single-flight behind a Redis SET NX claim. A missing report is
 * worse than a duplicate, so the claim is released whenever the call did not send,
 * and Redis being down sends anyway.
 *
 * And the operator's rule (15 Sep 2026): one automatic report per quiz. A
 * scheduled run on a share code that already has its report sends nothing more;
 * only the teacher's own ask from /quiz can.
 *
 * Boundaries mocked: supabase, WhatsApp, Redis (an in-memory store with real SET NX
 * semantics), the PDF renderer, the model client, the logger. The module under test runs.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(),
  sendDocument: jest.fn().mockResolvedValue(true),
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
    setNX: jest.fn(async (key, value) => {
      await new Promise((r) => setImmediate(r));   // a network hop, so racing callers interleave
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    }),
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    delete: jest.fn(async (key) => { store.delete(key); return true; }),
  };
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const redis = require('../../shared/services/cache/railway-redis.service');
const { logToFile } = require('../../shared/utils/logger');
const { logEvent } = require('../../shared/utils/structured-logger');
const report = require('../../shared/services/quiz/video-quiz-report.service');

const SC = '6b1c0f0e-0000-4000-8000-0000000005c1';
const CLAIM_KEY = `vq:report:sending:${SC}`;
const TEACHER_PHONE = '920000000001';
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60 * 1000;

/** One in-memory database: an UPDATE really changes the row the next read sees. */
function stubDb({ reportSentAt = null } = {}) {
  const db = {
    quiz_share_codes: [{
      id: SC, code: 'T3ST1', quiz_id: 'q1', teacher_user_id: 'u1', teacher_name: 'Teacher',
      topic: 'Fractions', language: 'en', created_at: iso(20 * 60 * MIN), report_sent_at: reportSentAt,
    }],
    users: [{ id: 'u1', phone_number: TEACHER_PHONE, preferred_language: 'en', name: 'Teacher' }],
    quizzes: [{ id: 'q1', meta: {}, quiz_source: 'video', language: 'en', subject: 'maths', grade: '4' }],
    quiz_sessions: [1, 2, 3, 4, 5].map((i) => ({
      id: `s${i}`, share_code_id: SC, user_id: null, invited_by_student_id: null, student_id: `st-${i}`,
      student_name: `Child ${i}`, student_class: '4', parent_phone: null, status: 'completed',
      total_questions_answered: 8, correct_answers: i, mastery_percentage: Math.round((100 * i) / 8),
      // finished AFTER any earlier report, so the old follow-up rule would send
      created_at: iso(40 * MIN), completed_at: iso(30 * MIN),
    })),
    question_attempts: [],
  };
  supabase.from.mockImplementation((table) => {
    let rows = db[table] || [];
    let patch = null;
    const chain = {
      select: () => chain,
      eq: (f, v) => {
        rows = rows.filter((r) => r[f] === v);
        if (patch) rows.forEach((r) => Object.assign(r, patch));
        return chain;
      },
      is: (f, v) => { rows = rows.filter((r) => (v === null ? r[f] == null : r[f] === v)); return chain; },
      in: (f, vs) => { rows = rows.filter((r) => vs.includes(r[f])); return chain; },
      order: () => chain,
      limit: () => chain,
      update: (p) => { patch = p; return chain; },
      maybeSingle: async () => ({ data: rows[0] ? { ...rows[0] } : null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(res, rej),
    };
    return chain;
  });
  return db;
}

const teacherSends = () => WhatsAppService.sendMessage.mock.calls.filter((c) => c[0] === TEACHER_PHONE).length
  + WhatsAppService.sendDocument.mock.calls.filter((c) => c[0] === TEACHER_PHONE).length;
// A report is a results message ("Quiz results — …") that was DELIVERED; a send that
// threw delivered nothing. The guidance message rides with it and is not counted.
let delivered = [];
const reportsSent = () => delivered
  .filter(([to, body]) => to === TEACHER_PHONE && /Quiz results/.test(String(body))).length;

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  redis.isAvailable.mockReturnValue(true);
  delivered = [];
  WhatsAppService.sendMessage.mockImplementation(async (to, body) => {
    await new Promise((r) => setTimeout(r, 5));    // a send takes time; the race lives here
    delivered.push([to, body]);
    return true;
  });
  delete process.env.VIDEO_REPORT_SEND_CLAIM;
  delete process.env.VIDEO_REPORT_SCHEDULED_FOLLOWUP;
  delete process.env.CLASS_CARD_ENABLED;
  if (report._sendClaimTiming) {                    // absent before the fix; the red run still executes every test
    report._sendClaimTiming.pollMs = 5;
    report._sendClaimTiming.forceWaitMs = 400;
  }
});

describe('A · one send per share code, however many callers race', () => {
  test('two scheduled runs at once for one share code send ONE report', async () => {
    stubDb();
    const results = await Promise.all([
      report.generate(SC, { reason: 'scheduled' }),
      report.generate(SC, { reason: 'scheduled' }),
    ]);
    expect(reportsSent()).toBe(1);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(logEvent).toHaveBeenCalledWith('video_quiz.report_suppressed',
      expect.objectContaining({ shareCodeId: SC, reason: 'scheduled', why: 'send_in_progress' }));
  });

  test('a burst of legacy chains (10 at once) still sends ONE report', async () => {
    stubDb();
    await Promise.all(Array.from({ length: 10 }, () => report.generate(SC, { reason: 'scheduled' })));
    expect(reportsSent()).toBe(1);
  });

  test('the suppression log names no one', async () => {
    stubDb();
    await Promise.all([report.generate(SC, { reason: 'scheduled' }), report.generate(SC, { reason: 'scheduled' })]);
    const suppressed = logEvent.mock.calls.filter((c) => c[0] === 'video_quiz.report_suppressed');
    expect(JSON.stringify(suppressed)).not.toMatch(/Child|Teacher|92000/);
  });

  test('switch off (VIDEO_REPORT_SEND_CLAIM=off) is the old behaviour: both send', async () => {
    process.env.VIDEO_REPORT_SEND_CLAIM = 'off';
    stubDb();
    await Promise.all([report.generate(SC, { reason: 'scheduled' }), report.generate(SC, { reason: 'scheduled' })]);
    expect(reportsSent()).toBe(2);
    expect(redis.setNX).not.toHaveBeenCalled();
  });

  test('Redis throwing fails OPEN: the report is sent, and the failure is logged at error level', async () => {
    redis.setNX.mockRejectedValueOnce(new Error('ECONNRESET'));
    stubDb();
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(reportsSent()).toBe(1);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/send claim/), expect.anything(), 'error');
  });

  test('Redis unavailable fails OPEN too, and says so at error level', async () => {
    redis.isAvailable.mockReturnValue(false);
    redis.setNX.mockResolvedValueOnce(true);          // the real service answers "claimed" when it has no client
    stubDb();
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(reportsSent()).toBe(1);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/send claim/), expect.anything(), 'error');
  });

  test('a caller that loses the claim releases nothing it does not own', async () => {
    stubDb();
    redis._store.set(CLAIM_KEY, 'another-callers-token');
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
    expect(reportsSent()).toBe(0);
    expect(redis._store.get(CLAIM_KEY)).toBe('another-callers-token');
    expect(redis.delete).not.toHaveBeenCalled();
  });

  test('a failing send releases the claim, so the retry sends', async () => {
    stubDb();
    WhatsAppService.sendMessage.mockRejectedValueOnce(new Error('WhatsApp 500'));
    await expect(report.generate(SC, { reason: 'scheduled' })).rejects.toThrow('WhatsApp 500');
    expect(redis._store.has(CLAIM_KEY)).toBe(false);
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(reportsSent()).toBe(1);
  });

  test('a claim taken after the winner finished sees its stamp and sends nothing', async () => {
    stubDb();
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    // the winner stamped report_sent_at and gave the key back
    expect(redis._store.has(CLAIM_KEY)).toBe(false);
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
    expect(reportsSent()).toBe(1);
  });

  test('a stamp that fails keeps the claim, so a racing chain cannot send a second copy', async () => {
    const db = stubDb();
    const realFrom = supabase.from.getMockImplementation();
    supabase.from.mockImplementation((table) => {
      const chain = realFrom(table);
      if (table !== 'quiz_share_codes') return chain;
      const update = chain.update;
      chain.update = (p) => { update(p); return { eq: async () => ({ data: null, error: { message: 'timeout' } }) }; };
      return chain;
    });
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(db.quiz_share_codes[0].report_sent_at).toBeNull();
    expect(redis._store.has(CLAIM_KEY)).toBe(true);
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
    expect(reportsSent()).toBe(1);
  });
});

describe('A · the teacher asking from /quiz is never silently dropped', () => {
  test('an ask that lands mid-send waits and answers true: the teacher gets exactly one report', async () => {
    stubDb();
    const [scheduled, asked] = await Promise.all([
      report.generate(SC, { reason: 'scheduled' }),
      report.generate(SC, { reason: 'requested', force: true }),
    ]);
    expect(reportsSent()).toBe(1);
    // true on both sides: a false would make /quiz tell the teacher "no child has finished yet"
    expect(scheduled).toBe(true);
    expect(asked).toBe(true);
    expect(logEvent).toHaveBeenCalledWith('video_quiz.report_suppressed',
      expect.objectContaining({ shareCodeId: SC, reason: 'requested', why: 'send_in_progress', delivered: true }));
  });

  test('an ask whose holder dies without sending takes the claim and sends', async () => {
    stubDb();
    redis._store.set(CLAIM_KEY, 'a-holder-that-will-fail');
    setTimeout(() => redis._store.delete(CLAIM_KEY), 30);
    expect(await report.generate(SC, { reason: 'requested', force: true })).toBe(true);
    expect(reportsSent()).toBe(1);
  });

  test('an ask held past the wait still sends — a duplicate beats silence', async () => {
    stubDb();
    redis._store.set(CLAIM_KEY, 'a-stuck-holder');
    expect(await report.generate(SC, { reason: 'requested', force: true })).toBe(true);
    expect(reportsSent()).toBe(1);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/send claim/), expect.anything(), 'error');
    expect(redis._store.get(CLAIM_KEY)).toBe('a-stuck-holder');
  });
});

describe('B · one automatic report per quiz (operator, 15 Sep 2026)', () => {
  test('a scheduled run on a share code already reported sends nothing', async () => {
    stubDb({ reportSentAt: iso(10 * 60 * MIN) });
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
    expect(teacherSends()).toBe(0);
    expect(logEvent).toHaveBeenCalledWith('video_quiz.report_suppressed',
      expect.objectContaining({ shareCodeId: SC, reason: 'scheduled', why: 'already_reported' }));
    expect(logEvent).not.toHaveBeenCalledWith('video_quiz.report_followup', expect.anything());
  });

  test('the teacher asking from /quiz still gets a fresh report', async () => {
    stubDb({ reportSentAt: iso(10 * 60 * MIN) });
    expect(await report.generate(SC, { reason: 'requested', force: true })).toBe(true);
    expect(reportsSent()).toBe(1);
  });

  test('VIDEO_REPORT_SCHEDULED_FOLLOWUP=on restores the follow-up send', async () => {
    process.env.VIDEO_REPORT_SCHEDULED_FOLLOWUP = 'on';
    stubDb({ reportSentAt: iso(10 * 60 * MIN) });
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(logEvent).toHaveBeenCalledWith('video_quiz.report_followup', expect.objectContaining({ shareCodeId: SC }));
    expect(reportsSent()).toBe(1);
  });
});
