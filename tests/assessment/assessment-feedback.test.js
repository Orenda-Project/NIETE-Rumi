/**
 * Asking the teacher whether the assessment paper was any good — and how to make it better.
 *
 * Same lifecycle as the lesson-plan surveys (lp612-feedback): 30s after delivery a 👍/👎 ask, a row
 * on `lp_feedback` per tap, and a 10-minute window that captures her next message. One difference:
 * the "how can we make it better?" ask goes out after EITHER tap, because a teacher who liked the
 * paper still knows what would make it better.
 *
 * Mocks sit at the network boundary: supabase, Redis, WhatsApp, the 🙏 reaction.
 */

const mockSendMessage = jest.fn().mockResolvedValue(true);
const mockSendInteractiveButtons = jest.fn().mockResolvedValue(true);
const mockRedisSet = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisDelete = jest.fn();
const mockReactOrSay = jest.fn().mockResolvedValue(true);

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendInteractiveButtons: (...a) => mockSendInteractiveButtons(...a),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: (...a) => mockRedisSet(...a),
  get: (...a) => mockRedisGet(...a),
  delete: (...a) => mockRedisDelete(...a),
}));
jest.mock('../../bot/shared/services/coaching/ack-reaction', () => ({
  reactOrSay: (...a) => mockReactOrSay(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), getCurrentCorrelationId: () => undefined,
}));

const dbCalls = [];
const dbResults = [];
function mockBuilder(table) {
  const state = { table, op: 'select', payload: null, filters: [] };
  const settle = () => {
    dbCalls.push({ ...state });
    return Promise.resolve(dbResults.length ? dbResults.shift() : { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    limit: () => b,
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const { resolveUx } = require('../../bot/shared/config/ux-strings');
const Feedback = require('../../bot/shared/services/assessment/assessment-feedback.service');

const PAPER = '11111111-2222-3333-4444-555555555555';
const PHONE = '920000000000';

beforeEach(() => {
  dbCalls.length = 0; dbResults.length = 0;
  jest.clearAllMocks();
  mockSendInteractiveButtons.mockResolvedValue(true);
  mockSendMessage.mockResolvedValue(true);
  mockReactOrSay.mockResolvedValue(true);
});

describe('the ask is scheduled after delivery', () => {
  afterEach(() => jest.useRealTimers());

  test('30s after delivery she gets 👍/👎 buttons keyed to the paper', async () => {
    jest.useFakeTimers();
    dbResults.push({ data: { preferred_language: 'en' }, error: null }); // her voice
    dbResults.push({ data: null, error: null });                         // not answered yet
    Feedback.scheduleAssessmentFeedback({ paperId: PAPER, userId: 'u1', phone: PHONE });
    expect(mockSendInteractiveButtons).not.toHaveBeenCalled();
    jest.advanceTimersByTime(Feedback.FEEDBACK_DELAY_MS);
    jest.useRealTimers();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(mockSendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [to, msg] = mockSendInteractiveButtons.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(msg.body).toBe(resolveUx('assessmentFeedbackAsk', { language: 'en' }));
    expect(msg.buttons.map((b) => b.id)).toEqual([`asmt_fb_yes_${PAPER}`, `asmt_fb_no_${PAPER}`]);
  });

  test('nothing is scheduled without a paper, a teacher or a phone', () => {
    jest.useFakeTimers();
    Feedback.scheduleAssessmentFeedback({ paperId: PAPER, userId: 'u1' });
    Feedback.scheduleAssessmentFeedback({ userId: 'u1', phone: PHONE });
    Feedback.scheduleAssessmentFeedback({ paperId: PAPER, phone: PHONE });
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('the ask is catalog copy, in her language', () => {
  test('an Urdu teacher is asked in Urdu', async () => {
    dbResults.push({ data: { preferred_language: 'ur' }, error: null });
    dbResults.push({ data: null, error: null });
    await Feedback.sendAssessmentFeedbackPrompt({ paperId: PAPER, userId: 'u1', phone: PHONE });
    const msg = mockSendInteractiveButtons.mock.calls[0][1];
    expect(msg.body).toBe(resolveUx('assessmentFeedbackAsk', { language: 'ur' }));
    expect(msg.buttons[0].title).toBe(resolveUx('assessmentFeedbackYes', { language: 'ur' }));
    expect(msg.buttons[1].title).toBe(resolveUx('assessmentFeedbackNo', { language: 'ur' }));
  });

  test('a paper she already rated is not asked about again', async () => {
    dbResults.push({ data: { preferred_language: 'en' }, error: null });
    dbResults.push({ data: { id: 'fb-old' }, error: null });
    await Feedback.sendAssessmentFeedbackPrompt({ paperId: PAPER, userId: 'u1', phone: PHONE });
    expect(mockSendInteractiveButtons).not.toHaveBeenCalled();
    const check = dbCalls.find((c) => c.table === 'lp_feedback');
    expect(check.filters).toEqual(expect.arrayContaining([['user_id', 'u1'], ['assessment_paper_id', PAPER]]));
  });

  test('every string fits WhatsApp: button ≤ 20 code points, body ≤ 1024', () => {
    for (const language of ['en', 'ur']) {
      for (const k of ['assessmentFeedbackYes', 'assessmentFeedbackNo']) {
        expect([...resolveUx(k, { language })].length).toBeLessThanOrEqual(20);
      }
      for (const k of ['assessmentFeedbackAsk', 'assessmentFeedbackAskImprove', 'assessmentFeedbackReasonThanks']) {
        const s = resolveUx(k, { language });
        expect(s).toBeTruthy();
        expect([...s].length).toBeLessThanOrEqual(1024);
      }
    }
  });
});

function tapSetup({ lang = 'en', existing = null, insert = { data: { id: 'fb-1' }, error: null } } = {}) {
  dbResults.push({ data: { id: 'u1', preferred_language: lang }, error: null }); // phone → user
  dbResults.push({ data: { request_id: 'req-1' }, error: null });               // paper → request
  dbResults.push({ data: { grade_code: '4', subject_code: 'maths', chapter_number: 3 }, error: null });
  dbResults.push({ data: existing, error: null });                               // existing row?
  if (!existing) dbResults.push(insert);
}

describe('a tap records one row on lp_feedback and asks how to improve', () => {
  test('👍 inserts the verdict with the paper, then asks how to make it better', async () => {
    tapSetup();
    const owned = await Feedback.handleAssessmentFeedbackButton(`asmt_fb_yes_${PAPER}`, PHONE);
    expect(owned).toBe(true);

    const ins = dbCalls.find((c) => c.table === 'lp_feedback' && c.op === 'insert');
    expect(ins.payload).toEqual(expect.objectContaining({
      user_id: 'u1', assessment_paper_id: PAPER, useful: true,
      lp_variant: 'assessment_en', trigger_mode: 'after_pdf_only',
      grade: 4, subject: 'maths', chapter_number: 3,
    }));
    expect(mockRedisSet).toHaveBeenCalledWith(
      'assessment_feedback_pending:u1',
      expect.objectContaining({ feedbackId: 'fb-1', paperId: PAPER, polarity: 'liked' }),
      600,
    );
    expect(mockSendMessage).toHaveBeenCalledWith(PHONE, resolveUx('assessmentFeedbackAskImprove', { language: 'en' }));
  });

  test('👎 arms the same window with polarity disliked, in Urdu for an Urdu teacher', async () => {
    tapSetup({ lang: 'ur' });
    await Feedback.handleAssessmentFeedbackButton(`asmt_fb_no_${PAPER}`, PHONE);
    const ins = dbCalls.find((c) => c.table === 'lp_feedback' && c.op === 'insert');
    expect(ins.payload.useful).toBe(false);
    expect(ins.payload.lp_variant).toBe('assessment_ur');
    expect(mockRedisSet.mock.calls[0][1].polarity).toBe('disliked');
    expect(mockSendMessage).toHaveBeenCalledWith(PHONE, resolveUx('assessmentFeedbackAskImprove', { language: 'ur' }));
  });

  test('a second tap updates the verdict instead of writing a second row', async () => {
    tapSetup({ existing: { id: 'fb-1', useful: true } });
    await Feedback.handleAssessmentFeedbackButton(`asmt_fb_no_${PAPER}`, PHONE);
    expect(dbCalls.some((c) => c.table === 'lp_feedback' && c.op === 'insert')).toBe(false);
    const upd = dbCalls.find((c) => c.table === 'lp_feedback' && c.op === 'update');
    expect(upd.payload).toEqual({ useful: false });
  });

  test('a failed insert still asks her, on the orphan sentinel', async () => {
    tapSetup({ insert: { data: null, error: { message: 'boom' } } });
    await Feedback.handleAssessmentFeedbackButton(`asmt_fb_yes_${PAPER}`, PHONE);
    expect(mockRedisSet.mock.calls[0][1].feedbackId).toBe('__orphan__');
    expect(mockSendMessage).toHaveBeenCalled();
  });

  test('a button id from another survey is declined', async () => {
    expect(await Feedback.handleAssessmentFeedbackButton('lp612_fb_yes_en_x', PHONE)).toBe(false);
    expect(await Feedback.handleAssessmentFeedbackButton('asmt_fb_maybe_x', PHONE)).toBe(false);
    expect(dbCalls).toHaveLength(0);
  });
});

describe('her answer to "how can we make it better?"', () => {
  test('the next message lands on the row she rated, with the tap\'s polarity', async () => {
    mockRedisGet.mockResolvedValue({ feedbackId: 'fb-1', paperId: PAPER, polarity: 'liked' });
    const consumed = await Feedback.consumeReasonIfPending('u1', PHONE, '  Add more MCQs  ', { messageId: 'wamid.1' });
    expect(consumed).toBe(true);
    expect(mockRedisDelete).toHaveBeenCalledWith('assessment_feedback_pending:u1');
    const upd = dbCalls.find((c) => c.table === 'lp_feedback' && c.op === 'update');
    expect(upd.payload).toEqual(expect.objectContaining({
      reason_text: 'Add more MCQs', reason_language: 'en', reason_polarity: 'liked',
    }));
    expect(upd.filters).toEqual([['id', 'fb-1']]);
    expect(mockReactOrSay).toHaveBeenCalledWith(expect.objectContaining({ to: PHONE, messageId: 'wamid.1', emoji: '🙏' }));
  });

  test('an Urdu answer is recorded as Urdu', async () => {
    mockRedisGet.mockResolvedValue({ feedbackId: 'fb-1', paperId: PAPER, polarity: 'disliked' });
    await Feedback.consumeReasonIfPending('u1', PHONE, 'سوال مشکل تھے');
    const upd = dbCalls.find((c) => c.op === 'update');
    expect(upd.payload.reason_language).toBe('ur');
    expect(upd.payload.reason_polarity).toBe('disliked');
  });

  test('a slash command is left for the router and the window stays armed', async () => {
    mockRedisGet.mockResolvedValue({ feedbackId: 'fb-1', polarity: 'liked' });
    expect(await Feedback.consumeReasonIfPending('u1', PHONE, '/menu')).toBe(false);
    expect(mockRedisDelete).not.toHaveBeenCalled();
  });

  test('no open window leaves the message alone', async () => {
    mockRedisGet.mockResolvedValue(null);
    expect(await Feedback.consumeReasonIfPending('u1', PHONE, 'hello')).toBe(false);
    expect(dbCalls).toHaveLength(0);
  });

  test('an orphaned window thanks her without writing', async () => {
    mockRedisGet.mockResolvedValue({ feedbackId: '__orphan__', polarity: 'liked' });
    dbResults.push({ data: { preferred_language: 'en' }, error: null });
    expect(await Feedback.consumeReasonIfPending('u1', PHONE, 'fine')).toBe(true);
    expect(dbCalls.some((c) => c.op === 'update')).toBe(false);
    expect(mockReactOrSay).toHaveBeenCalled();
  });
});
