/**
 * FEAT-106 #2 (bd-2371) — image de-dup on the coaching branches.
 *
 * WhatsApp delivers media webhooks AT-LEAST-ONCE. The LP-as-image branch and
 * the classroom-photo branch used to process + queue analysis and `return`
 * WITHOUT stamping the Redis `image:<user>:<imageId>` idempotency key (unlike
 * the pic-to-LP and generic-vision paths). A redelivery of the same image then
 * re-ran the branch → duplicate "got your plan" acks + double-queued analysis
 * (Sana Nawaz, ICT, 2026-07-21: three duplicate acks).
 *
 * Red-first: with the pre-fix handler, the second (redelivered) webhook calls
 * handleLessonPlanUpload a SECOND time. After the fix, the setNX guard makes the
 * redelivery a no-op.
 */

let mocks;

function load() {
  jest.resetModules();
  const seen = new Set(); // models Redis SET NX atomicity across redeliveries

  mocks = {
    seen,
    whatsapp: {
      startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
      sendMessage: jest.fn().mockResolvedValue({}),
      sendInteractiveButtons: jest.fn().mockResolvedValue({}),
      downloadMedia: jest.fn().mockResolvedValue(Buffer.from('img')),
    },
    redis: {
      setNX: jest.fn(async (key) => { if (seen.has(key)) return false; seen.add(key); return true; }),
      set: jest.fn(async (key) => { seen.add(key); return 'OK'; }),
      get: jest.fn().mockResolvedValue(null),
    },
    lpProcessor: { handleLessonPlanUpload: jest.fn().mockResolvedValue() },
    jobQueue: { queueAnalysis: jest.fn().mockResolvedValue({}), queueReport: jest.fn().mockResolvedValue({}) },
    sessionSvc: { updateStatus: jest.fn().mockResolvedValue({}) },
    examChecker: { handleExamImage: jest.fn().mockResolvedValue({ handled: false }) },
  };

  // Chainable supabase stub keyed on the .eq('status', X) value so only the
  // awaiting_lesson_plan query resolves a session.
  const sessionsByStatus = { awaiting_lesson_plan: { id: 'sess-lp', conversation_state: {} } };
  const supa = {
    from: () => {
      let status = null;
      const chain = {
        select: () => chain,
        eq: (col, val) => { if (col === 'status') status = val; return chain; },
        order: () => chain,
        limit: () => chain,
        update: () => chain,
        single: () => Promise.resolve({ data: sessionsByStatus[status] || null, error: null }),
        maybeSingle: () => Promise.resolve({ data: sessionsByStatus[status] || null, error: null }),
        then: (resolve) => resolve({ data: null, error: null }),
      };
      return chain;
    },
  };

  jest.doMock('../../bot/shared/services/whatsapp.service', () => mocks.whatsapp);
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => mocks.redis);
  jest.doMock('../../bot/shared/config/supabase', () => supa);
  jest.doMock('../../bot/shared/services/vision.service', () => ({ analyzeWithRetry: jest.fn() }));
  jest.doMock('../../bot/shared/storage/r2', () => ({ uploadImageWithRetry: jest.fn() }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(),
    runWithCorrelation: (id, fn) => fn(),
    generateCorrelationId: () => 'corr-1',
  }));
  jest.doMock('../../bot/shared/utils/language-cache', () => ({ getUserLanguage: jest.fn().mockResolvedValue('en') }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    storeConversation: jest.fn().mockResolvedValue(),
    getOrCreateSession: jest.fn().mockResolvedValue('conv-1'),
  }));
  jest.doMock('../../bot/shared/services/coaching/lesson-plan-processor.service', () => mocks.lpProcessor);
  jest.doMock('../../bot/shared/services/coaching/coaching-job-queue.service', () => mocks.jobQueue);
  jest.doMock('../../bot/shared/services/coaching/coaching-session.service', () => mocks.sessionSvc);
  jest.doMock('../../bot/shared/handlers/exam-checker.handler', () => mocks.examChecker);

  return require('../../bot/shared/handlers/image-message.handler');
}

afterEach(() => jest.resetModules());

const user = { id: 'user-1', preferred_language: 'en' };
const message = { id: 'wamid-1', image: { id: 'img-lp-1', mime_type: 'image/jpeg' } };

describe('FEAT-106 #2 — LP-as-image idempotency', () => {
  it('processes the lesson-plan image once and de-dups an at-least-once redelivery', async () => {
    const h = load();

    // First webhook delivery
    await h.handleImageMessage(message, '123', user);
    // Redelivery of the SAME image (same media id) — WhatsApp at-least-once
    await h.handleImageMessage(message, '123', user);

    expect(mocks.lpProcessor.handleLessonPlanUpload).toHaveBeenCalledTimes(1);
    expect(mocks.jobQueue.queueAnalysis).toHaveBeenCalledTimes(1);
    // The idempotency key must have been claimed for this image.
    expect(mocks.redis.setNX).toHaveBeenCalledWith(
      'image:user-1:img-lp-1', expect.anything(), expect.anything(),
    );
  });
});
