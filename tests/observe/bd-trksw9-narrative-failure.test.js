'use strict';
/**
 * bd-trksw9 — a failed narrative must not ship a hollow /observe report.
 *
 * Prod, 7 Oct 2026, session 90073b76: the narrative call ran 430s, hit 65,536
 * output tokens and returned unparseable JSON. generateReportNarrative returned
 * null, and the hero report rendered anyway — score, photos and trend, but an
 * empty strength, horizon, affirmation and moments — and that preview went to
 * the coach as if it were finished.
 *
 * The fix, end to end:
 *   1. the narrative is retried ONCE (same model, same prompt, same limits);
 *   2. a caller that needs it (the /observe preview) asks generateHeroReport to
 *      refuse rather than render without it;
 *   3. the preview then tells the coach in one line, with a Regenerate button,
 *      and sends no report image;
 *   4. the button re-queues the preview for the SAME session past the queue's
 *      1h dedupe, so the tap is never silently swallowed.
 */

const COACH_PHONE = '923333232533';
const TEACHER_PHONE = '923120004471';
const SID = 'cs-obs-1';

// ── 1. narrative retry ─────────────────────────────────────────────────────
describe('generateReportNarrative retries a failed reply once', () => {
  let create;
  let generateReportNarrative;

  beforeEach(() => {
    jest.resetModules();
    create = jest.fn();
    jest.doMock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: { chat: { completions: { create } } } }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    ({ generateReportNarrative } = require('../../bot/shared/services/coaching/report-v2/narrative.service'));
  });

  const reply = (content) => ({ choices: [{ message: { content } }] });
  const GOOD = JSON.stringify({ strength_name: 'Wait time', strength_note: 'You waited.', horizon_title: 'Name one moment', horizon_note: 'Quote it.', moments: [] });
  const analysis = { framework: 'fico', scores: {} };

  test('a runaway first reply is retried, and the good second reply is used', async () => {
    create.mockResolvedValueOnce(reply('{"strength_name": "Wait' + '\n'.repeat(500)));
    create.mockResolvedValueOnce(reply(GOOD));
    const n = await generateReportNarrative(analysis, { language: 'ur', teacherName: 'Shahana' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(n).toMatchObject({ strength_name: 'Wait time', horizon_title: 'Name one moment' });
  });

  test('a thrown first call is retried too', async () => {
    create.mockRejectedValueOnce(new Error('socket hang up'));
    create.mockResolvedValueOnce(reply(GOOD));
    const n = await generateReportNarrative(analysis, { language: 'en' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(n.strength_name).toBe('Wait time');
  });

  test('two failures return null after exactly two calls — never a loop', async () => {
    create.mockResolvedValue(reply('not json'));
    const n = await generateReportNarrative(analysis, { language: 'ur' });
    expect(n).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
  });

  test('a good first reply is one call, unchanged (same job, same request shape)', async () => {
    create.mockResolvedValueOnce(reply(GOOD));
    await generateReportNarrative(analysis, { language: 'en' });
    expect(create).toHaveBeenCalledTimes(1);
    const req = create.mock.calls[0][0];
    expect(req.job).toBe('coaching.narrative');
    expect(req.response_format).toEqual({ type: 'json_object' });
    expect(req).not.toHaveProperty('max_completion_tokens');
    expect(req).not.toHaveProperty('max_tokens');
  });
});

// ── 2. the hero report refuses to render without a narrative, when asked ──
describe('generateHeroReport({ requireNarrative })', () => {
  let htmlToImage;
  let narrative;
  let generateHeroReport;

  beforeEach(() => {
    jest.resetModules();
    htmlToImage = jest.fn(async () => Buffer.from('png'));
    narrative = jest.fn(async () => null);
    jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      ...jest.requireActual('../../bot/shared/services/coaching/report-v2/narrative.service'),
      generateReportNarrative: (...a) => narrative(...a),
    }));
    jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: (...a) => htmlToImage(...a) }));
    jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn(async () => []) }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    ({ generateHeroReport } = require('../../bot/shared/services/coaching/report-v2/hero-report.service'));
  });

  const session = { id: SID, user_id: 't-1', created_at: '2026-10-07T10:00:00Z', transcript_text: 'x' };
  const analysis = { framework: 'fico', scores: {} };

  test('no narrative + requireNarrative → NARRATIVE_UNAVAILABLE, nothing rendered', async () => {
    await expect(generateHeroReport(session, analysis, { language: 'en', requireNarrative: true }))
      .rejects.toMatchObject({ code: 'NARRATIVE_UNAVAILABLE' });
    expect(htmlToImage).not.toHaveBeenCalled();
  });

  test('without the flag the behaviour is unchanged: it still renders', async () => {
    const out = await generateHeroReport(session, analysis, { language: 'en' });
    expect(htmlToImage).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(out.png)).toBe(true);
  });
});

// ── 3 + 4. the /observe preview and the Regenerate button ─────────────────
describe('/observe preview when the narrative is unavailable', () => {
  let mockTables;
  let mockUpdates;
  let mockWa;
  let Queue;
  let Hero;
  let Send;
  let observeStrings;

  function sessionRow(over = {}) {
    return {
      id: SID, user_id: 'teacher-1', observer_user_id: 'coach-1', observation_type: 'leader_observation',
      status: 'observer_review_complete', debrief_status: 'done',
      created_at: '2026-10-07T04:00:00Z', updated_at: '2026-10-07T05:00:00Z',
      analysis_data: { framework: 'fico' },
      users: { name: 'Shahana Bibi', phone_number: TEACHER_PHONE, preferred_language: 'ur' },
      ...over,
    };
  }
  const COACH = { id: 'coach-1', name: 'Sana Malik', phone_number: COACH_PHONE, preferred_language: 'en' };
  const withDelivery = (td) => {
    mockTables.coaching_sessions = () => sessionRow({ analysis_data: { framework: 'fico', teacher_delivery: td } });
  };
  const merged = () => mockUpdates
    .filter((u) => u.table === 'coaching_sessions' && u.payload && u.payload.analysis_data && u.payload.analysis_data.teacher_delivery)
    .map((u) => u.payload.analysis_data.teacher_delivery);
  const unavailable = () => Object.assign(new Error('narrative unavailable'), { code: 'NARRATIVE_UNAVAILABLE' });

  beforeEach(() => {
    jest.resetModules();
    mockUpdates = [];
    mockTables = { coaching_sessions: () => sessionRow(), users: () => COACH };
    jest.doMock('../../bot/shared/config/supabase', () => {
      const { chain } = require('../quiz/helpers/supabase-chain');
      return {
        from: jest.fn((table) => {
          const c = chain(() => ({ data: (mockTables[table] || (() => null))(), error: null }));
          const record = (op) => (payload) => { mockUpdates.push({ table, op, payload }); return c; };
          return new Proxy(c, { get(t, p) { return (p === 'update' || p === 'insert' || p === 'upsert') ? record(p) : t[p]; } });
        }),
        rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      get: jest.fn(async () => null), set: jest.fn(async () => true), setexWithCeiling: jest.fn(async () => true),
      delete: jest.fn(async () => true), del: jest.fn(async () => true), setNX: jest.fn().mockResolvedValue(true), isAvailable: () => true,
    }));
    mockWa = {
      sendMessage: jest.fn().mockResolvedValue(true),
      sendInteractiveButtons: jest.fn().mockResolvedValue(true),
      sendImageFromBuffer: jest.fn().mockResolvedValue(true),
      sendTemplate: jest.fn().mockResolvedValue(true),
    };
    jest.doMock('../../bot/shared/services/whatsapp.service', () => mockWa);
    jest.doMock('../../bot/shared/services/observe/observe-state.service', () => ({
      getState: jest.fn().mockResolvedValue(null), setState: jest.fn().mockResolvedValue(true), clearState: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../bot/shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn() }));
    jest.doMock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
      queueObserveTeacherReport: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../bot/shared/storage/r2', () => ({
      downloadFromR2: jest.fn(async () => Buffer.from('x')), uploadImageBuffer: jest.fn(async (_p, key) => key),
    }));
    jest.doMock('../../bot/shared/services/coaching/report-v2/hero-report.service', () => ({
      generateHeroReport: jest.fn(async () => ({ png: Buffer.from('report'), caption: 'cap' })),
    }));
    process.env.OBSERVE_FRAMEWORK = 'fico';
    Queue = require('../../bot/shared/services/coaching/coaching-job-queue.service');
    Hero = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    Send = require('../../bot/shared/services/observe/observe-send.service');
    ({ observeStrings } = require('../../bot/shared/services/observe/observe-strings'));
  });

  test('the preview asks the hero report to require a narrative', async () => {
    withDelivery({ teacher_name: 'Shahana Bibi', teacher_phone: TEACHER_PHONE, status: 'previewing' });
    await Send.processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview' });
    expect(Hero.generateHeroReport.mock.calls[0][2]).toMatchObject({ requireNarrative: true });
  });

  test('WhatsApp: no report image; one message with a Regenerate button; send_failed recorded; no throw', async () => {
    Hero.generateHeroReport.mockRejectedValueOnce(unavailable());
    withDelivery({ teacher_name: 'Shahana Bibi', teacher_phone: TEACHER_PHONE, status: 'previewing' });
    await expect(Send.processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview' })).resolves.toBeUndefined();

    expect(mockWa.sendImageFromBuffer).not.toHaveBeenCalled();
    expect(mockWa.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [to, payload] = mockWa.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe(COACH_PHONE);
    expect(payload.buttons).toEqual([{ id: `observe_send_retry_${SID}`, title: observeStrings('en').btn_regenerate_report }]);
    expect(payload.body).toContain('Shahana Bibi');

    const td = merged().pop();
    expect(td).toMatchObject({ status: 'send_failed', failure_reason: 'narrative_unavailable' });
    expect(typeof td.preview_failed_at).toBe('string');
  });

  test('portal: the same status, and nothing to WhatsApp (the portal shows Try again)', async () => {
    Hero.generateHeroReport.mockRejectedValueOnce(unavailable());
    withDelivery({ teacher_name: 'Shahana Bibi', teacher_phone: TEACHER_PHONE, status: 'previewing', channel: 'portal' });
    await Send.processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview', channel: 'portal' });
    expect(merged().pop()).toMatchObject({ status: 'send_failed', failure_reason: 'narrative_unavailable', channel: 'portal' });
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
    expect(mockWa.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(mockWa.sendImageFromBuffer).not.toHaveBeenCalled();
  });

  test('any OTHER render error still throws, as before (SQS redelivery owns it)', async () => {
    Hero.generateHeroReport.mockRejectedValueOnce(new Error('chromium crashed'));
    withDelivery({ teacher_name: 'Shahana Bibi', teacher_phone: TEACHER_PHONE, status: 'previewing' });
    await expect(Send.processTeacherReport(SID, { from: COACH_PHONE, phase: 'preview' })).rejects.toThrow('chromium crashed');
  });

  test('the Regenerate button id parses to the retry action', () => {
    expect(Send.parseSendButtonId(`observe_send_retry_${SID}`)).toEqual({ action: 'retry', sessionId: SID });
  });

  test('tapping Regenerate re-queues the preview for the same teacher, marked as a retry', async () => {
    withDelivery({ teacher_name: 'Shahana Bibi', teacher_phone: TEACHER_PHONE, status: 'send_failed', preview_failed_at: '2026-10-07T10:38:40Z', failure_reason: 'narrative_unavailable' });
    await Send.handleSendRetry(SID, COACH_PHONE, COACH);
    expect(merged().pop()).toMatchObject({ status: 'previewing' });
    expect(Queue.queueObserveTeacherReport).toHaveBeenCalledTimes(1);
    const [sid, meta] = Queue.queueObserveTeacherReport.mock.calls[0];
    expect(sid).toBe(SID);
    expect(meta).toMatchObject({ from: COACH_PHONE, phase: 'preview', teacherPhone: TEACHER_PHONE });
    expect(meta.retryNonce).toBeTruthy();
    expect(mockWa.sendMessage.mock.calls.some(([to]) => to === COACH_PHONE)).toBe(true);
  });

  test('a stale Regenerate tap after the report was sent queues nothing', async () => {
    withDelivery({ teacher_name: 'Shahana Bibi', teacher_phone: TEACHER_PHONE, status: 'sent' });
    await Send.handleSendRetry(SID, COACH_PHONE, COACH);
    expect(Queue.queueObserveTeacherReport).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).toHaveBeenCalledWith(COACH_PHONE, observeStrings('en').send_already_sent);
  });

  test('someone else\'s Regenerate tap is refused', async () => {
    withDelivery({ teacher_name: 'Shahana Bibi', teacher_phone: TEACHER_PHONE, status: 'send_failed', preview_failed_at: 'x' });
    await Send.handleSendRetry(SID, '923000000000', { ...COACH, id: 'someone-else' });
    expect(Queue.queueObserveTeacherReport).not.toHaveBeenCalled();
  });
});

// ── 4b. the retry nonce reaches the dedupe ─────────────────────────────────
describe('queueObserveTeacherReport: a retry is not the same job as the first preview', () => {
  test('a retryNonce gives a different dedupNonce from the plain preview for the same teacher', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    const Q = jest.requireActual('../../bot/shared/services/coaching/coaching-job-queue.service');
    const spy = jest.spyOn(Q, 'queueJob').mockResolvedValue('m');
    await Q.queueObserveTeacherReport(SID, { phase: 'preview', teacherPhone: TEACHER_PHONE });
    await Q.queueObserveTeacherReport(SID, { phase: 'preview', teacherPhone: TEACHER_PHONE, retryNonce: 'r1' });
    await Q.queueObserveTeacherReport(SID, { phase: 'preview', teacherPhone: TEACHER_PHONE, retryNonce: 'r2' });
    const nonces = spy.mock.calls.map(([, , p]) => p.dedupNonce);
    expect(nonces.every(Boolean)).toBe(true);
    expect(new Set(nonces).size).toBe(3);
  });
});

// ── 5. the copy fits WhatsApp ──────────────────────────────────────────────
describe('Regenerate copy fits the WhatsApp caps in every observe language', () => {
  const { observeStrings } = jest.requireActual('../../bot/shared/services/observe/observe-strings');
  test.each(['sw', 'ur', 'en'])('%s', (lang) => {
    const S = observeStrings(lang);
    expect(typeof S.btn_regenerate_report).toBe('string');
    expect(typeof S.send_preview_failed_fo).toBe('string');
    expect(S.send_preview_failed_fo).toContain('{name}');
    expect([...S.btn_regenerate_report].length).toBeLessThanOrEqual(20);
    expect([...S.send_preview_failed_fo].length).toBeLessThanOrEqual(1024);
  });
  test('each language has its own copy (no silent English fallback)', () => {
    const en = observeStrings('en').btn_regenerate_report;
    expect(observeStrings('ur').btn_regenerate_report).not.toBe(en);
    expect(observeStrings('sw').btn_regenerate_report).not.toBe(en);
  });
});
