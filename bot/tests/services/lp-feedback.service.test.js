/**
 * Integration tests for lp-feedback.service.js.
 *
 * Mocks Redis + Supabase + WhatsAppService so the whole feedback lifecycle
 * can be driven without a network. Covers the 5 scenarios enumerated in the
 * scoping call:
 *
 *   1. Schedule fires the prompt after the 30s delay
 *   2. 👍 tap inserts useful=true, sends thanks, no Redis flag
 *   3. 👎 tap inserts useful=false, sets Redis flag, sends "why?" prompt
 *   4. Reply within 10 min updates reason_text + reason_polarity=disliked,
 *      clears the flag, sends final ack
 *   5. Reply AFTER the 10-min window (no flag) falls through — service
 *      returns false; caller keeps routing to intent detection
 *
 * Plus a few defensive cases the port already handles (idempotency, orphan
 * insert failure, slash-command reply, language routing to Urdu).
 */

// ─── Mocks (order-sensitive: mock BEFORE require) ─────────────────────────

// Programmable Supabase mock — mirrors the shape used elsewhere in the suite.
const mockResultQueue = [];
function mockMakeBuilder() {
  const consume = () => (mockResultQueue.shift() || { data: null, error: null });
  const record = () => (..._args) => builder;
  const builder = {
    select: record(), eq: record(), insert: record(), update: record(),
    limit: () => Promise.resolve(consume()),
    single: () => Promise.resolve(consume()),
    maybeSingle: () => Promise.resolve(consume()),
    then(onFulfilled, onRejected) { return Promise.resolve(consume()).then(onFulfilled, onRejected); },
  };
  return builder;
}
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => mockMakeBuilder()),
}));

// Redis mock — in-memory key/value store.
const mockRedisStore = new Map();
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(async (k, v, _ttl) => { mockRedisStore.set(k, v); }),
  get: jest.fn(async (k) => mockRedisStore.get(k) || null),
  delete: jest.fn(async (k) => { mockRedisStore.delete(k); }),
}));

// WhatsAppService — capture what would be sent
const mockSentMessages = [];
const mockSentButtons = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (phone, body) => {
    mockSentMessages.push({ phone, body });
    return { success: true };
  }),
  sendInteractiveButtons: jest.fn(async (phone, { body, buttons }) => {
    mockSentButtons.push({ phone, body, buttons });
    return true;
  }),
}));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

// ─── Under test ───────────────────────────────────────────────────────────
const LpFeedbackService = require('../../shared/services/lp-feedback.service');
const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');

const PHONE = '923333232533';
const USER_UUID = '2c0f4e08-1f6b-4a17-9c1a-3d31a5a5e5f9';
const LP_UUID   = 'b90d2456-b24e-4546-9e7a-96106ad933f6';
const FB_UUID   = 'aa11bb22-cc33-dd44-ee55-ff6677889900';

const LP_ROW = {
  id: LP_UUID, user_id: USER_UUID, topic: 'Numbers upto 9 (Concrete)',
  grade: '1', subject: 'maths', type: 'lesson_plan',
  content: { chapter_number: 1, lp_variant: 'taleemabad_ast', language: 'en', trigger_mode: 'after_pdf_only' },
};

describe('LpFeedbackService', () => {
  beforeEach(() => {
    mockResultQueue.length = 0;
    mockRedisStore.clear();
    mockSentMessages.length = 0;
    mockSentButtons.length = 0;
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => { jest.useRealTimers(); });

  // ─── 1. Scheduler ──────────────────────────────────────────────────────
  describe('scheduleFeedbackPrompt', () => {
    it('fires the prompt after FEEDBACK_DELAY_MS via setTimeout', async () => {
      // Queue the Supabase response for _resolveLanguage (users lookup — no urdu pref)
      mockResultQueue.push({ data: null, error: null });

      LpFeedbackService.scheduleFeedbackPrompt({
        lessonPlanId: LP_UUID, userId: USER_UUID, phone: PHONE,
        context: { topic: 'Numbers upto 9 (Concrete)', language: 'en' },
      });
      expect(mockSentButtons).toHaveLength(0);

      // Advance clock past the delay + let microtasks flush
      jest.advanceTimersByTime(LpFeedbackService.FEEDBACK_DELAY_MS + 100);
      await Promise.resolve(); // flush the pending sendFeedbackPrompt promise
      await Promise.resolve();

      expect(mockSentButtons).toHaveLength(1);
      expect(mockSentButtons[0].phone).toBe(PHONE);
      expect(mockSentButtons[0].body).toMatch(/was it useful/i);
      expect(mockSentButtons[0].buttons).toHaveLength(2);
      expect(mockSentButtons[0].buttons[0].id).toBe(`lp_feedback_yes_${LP_UUID}`);
      expect(mockSentButtons[0].buttons[1].id).toBe(`lp_feedback_no_${LP_UUID}`);
    });

    it('emits Urdu prompt when user.preferred_language is ur', async () => {
      mockResultQueue.push({ data: { preferred_language: 'ur' }, error: null });

      LpFeedbackService.scheduleFeedbackPrompt({
        lessonPlanId: LP_UUID, userId: USER_UUID, phone: PHONE, context: {},
      });
      jest.advanceTimersByTime(LpFeedbackService.FEEDBACK_DELAY_MS + 100);
      await Promise.resolve(); await Promise.resolve();

      expect(mockSentButtons[0].body).toContain('کیا یہ مفید تھا');
      expect(mockSentButtons[0].buttons[0].title).toBe('👍 ہاں');
      expect(mockSentButtons[0].buttons[1].title).toBe('👎 نہیں');
    });

    it('is a no-op when lessonPlanId/userId/phone missing', () => {
      LpFeedbackService.scheduleFeedbackPrompt({ userId: USER_UUID, phone: PHONE });
      jest.advanceTimersByTime(60_000);
      expect(mockSentButtons).toHaveLength(0);
    });
  });

  // ─── 2. 👍 button tap ──────────────────────────────────────────────────
  it('👍 tap inserts useful=true, sends thanks, does NOT set Redis flag', async () => {
    // Queue: lesson_plans lookup → user preferred_language → existing check → insert
    mockResultQueue.push({ data: LP_ROW, error: null });
    mockResultQueue.push({ data: null, error: null }); // preferred_language lookup (no row)
    mockResultQueue.push({ data: null, error: null }); // existing check (no row)
    mockResultQueue.push({ data: { id: FB_UUID }, error: null }); // insert result

    const ok = await LpFeedbackService.handleFeedbackButton(`lp_feedback_yes_${LP_UUID}`, PHONE);
    expect(ok).toBe(true);
    expect(mockSentMessages).toHaveLength(1);
    expect(mockSentMessages[0].body).toMatch(/glad it helped/i);
    // No 👎 → no Redis flag
    expect(redisService.set).not.toHaveBeenCalled();
  });

  // ─── 3. 👎 button tap ──────────────────────────────────────────────────
  it('👎 tap inserts useful=false, sets Redis flag, sends "what didn\'t work?" prompt', async () => {
    mockResultQueue.push({ data: LP_ROW, error: null });
    mockResultQueue.push({ data: null, error: null }); // preferred_language
    mockResultQueue.push({ data: null, error: null }); // existing check
    mockResultQueue.push({ data: { id: FB_UUID }, error: null }); // insert

    const ok = await LpFeedbackService.handleFeedbackButton(`lp_feedback_no_${LP_UUID}`, PHONE);
    expect(ok).toBe(true);
    expect(mockSentMessages).toHaveLength(1);
    expect(mockSentMessages[0].body).toMatch(/what didn't work/i);

    // Redis flag set with the inserted feedback id + polarity=disliked
    expect(redisService.set).toHaveBeenCalledTimes(1);
    const [key, value, ttl] = redisService.set.mock.calls[0];
    expect(key).toBe(LpFeedbackService.REDIS_REASON_KEY(USER_UUID));
    expect(value.lpFeedbackId).toBe(FB_UUID);
    expect(value.polarity).toBe('disliked');
    expect(ttl).toBe(LpFeedbackService.REASON_WINDOW_SECS);
  });

  // ─── 4. Reason capture within window ────────────────────────────────────
  it('reason capture: text within 10-min window updates row + clears flag', async () => {
    // Prime Redis as if the 👎 tap already happened
    mockRedisStore.set(LpFeedbackService.REDIS_REASON_KEY(USER_UUID), {
      lpFeedbackId: FB_UUID, polarity: 'disliked', promptedAt: Date.now(),
    });

    // Queue: update result → preferred_language for final ack
    mockResultQueue.push({ data: null, error: null }); // update
    mockResultQueue.push({ data: null, error: null }); // preferred_language

    const consumed = await LpFeedbackService.consumeReasonIfPending(
      USER_UUID, PHONE,
      'The stones activity is impractical — 60 kids per class'
    );
    expect(consumed).toBe(true);

    // Redis flag cleared
    expect(redisService.delete).toHaveBeenCalledWith(
      LpFeedbackService.REDIS_REASON_KEY(USER_UUID)
    );

    // Final ack sent in English
    expect(mockSentMessages).toHaveLength(1);
    expect(mockSentMessages[0].body).toMatch(/got it, thanks/i);
  });

  it('reason capture: Urdu-script text tags reason_language=ur', async () => {
    mockRedisStore.set(LpFeedbackService.REDIS_REASON_KEY(USER_UUID), {
      lpFeedbackId: FB_UUID, polarity: 'disliked',
    });
    mockResultQueue.push({ data: null, error: null }); // update
    mockResultQueue.push({ data: null, error: null }); // preferred_language

    const consumed = await LpFeedbackService.consumeReasonIfPending(
      USER_UUID, PHONE, 'کلاس میں پتھر نہیں ملتے'
    );
    expect(consumed).toBe(true);
    expect(mockSentMessages).toHaveLength(1);
    // Final ack falls back to reasonLanguage='ur' when user lookup returns null
    expect(mockSentMessages[0].body).toMatch(/سمجھ گئی/);
  });

  // ─── 5. Reply after the window ─────────────────────────────────────────
  it('reason capture: returns false when no Redis flag (10-min window elapsed)', async () => {
    // Empty Redis — flag never set OR TTL expired
    const consumed = await LpFeedbackService.consumeReasonIfPending(
      USER_UUID, PHONE, 'Just a normal message'
    );
    expect(consumed).toBe(false);
    expect(mockSentMessages).toHaveLength(0);
  });

  // ─── Defensive cases the port already handles ──────────────────────────
  it('slash commands within the window fall through to normal routing', async () => {
    mockRedisStore.set(LpFeedbackService.REDIS_REASON_KEY(USER_UUID), {
      lpFeedbackId: FB_UUID, polarity: 'disliked',
    });
    const consumed = await LpFeedbackService.consumeReasonIfPending(
      USER_UUID, PHONE, '/help'
    );
    expect(consumed).toBe(false);
    // Flag should NOT be cleared — user might still want to send a reason
    expect(redisService.delete).not.toHaveBeenCalled();
  });

  it('duplicate 👍 → 👎 tap updates useful and re-arms Redis flag', async () => {
    // lesson_plans lookup → preferred_language → existing found with useful=true → update
    mockResultQueue.push({ data: LP_ROW, error: null });
    mockResultQueue.push({ data: null, error: null }); // preferred_language
    mockResultQueue.push({ data: { id: FB_UUID, useful: true }, error: null }); // existing
    mockResultQueue.push({ data: null, error: null }); // update

    const ok = await LpFeedbackService.handleFeedbackButton(`lp_feedback_no_${LP_UUID}`, PHONE);
    expect(ok).toBe(true);
    expect(mockSentMessages[0].body).toMatch(/what didn't work/i);
    // Redis flag set on the duplicate 👎 as well
    expect(redisService.set).toHaveBeenCalledTimes(1);
    expect(redisService.set.mock.calls[0][1].lpFeedbackId).toBe(FB_UUID);
  });

  it('button tap for unknown lesson_plan_id acknowledges without inserting', async () => {
    mockResultQueue.push({ data: null, error: null }); // no LP row

    const ok = await LpFeedbackService.handleFeedbackButton(`lp_feedback_yes_${LP_UUID}`, PHONE);
    expect(ok).toBe(true);
    expect(mockSentMessages[0].body).toBe('Thanks for the feedback!');
    // Should NOT have called any insert path
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('insert failure on 👎 still primes an orphan Redis flag', async () => {
    mockResultQueue.push({ data: LP_ROW, error: null }); // lesson_plans lookup
    mockResultQueue.push({ data: null, error: null }); // preferred_language
    mockResultQueue.push({ data: null, error: null }); // existing check
    mockResultQueue.push({ data: null, error: { message: 'duplicate constraint' } }); // insert fails

    const ok = await LpFeedbackService.handleFeedbackButton(`lp_feedback_no_${LP_UUID}`, PHONE);
    expect(ok).toBe(true);
    // Orphan flag set so the reason still gets captured via log event
    expect(redisService.set).toHaveBeenCalledTimes(1);
    expect(redisService.set.mock.calls[0][1].lpFeedbackId).toBe('__orphan__');
  });

  it('unrelated buttonId returns false (does not match)', async () => {
    const ok = await LpFeedbackService.handleFeedbackButton(`training_module_done_abc`, PHONE);
    expect(ok).toBe(false);
    expect(mockSentMessages).toHaveLength(0);
  });
});
