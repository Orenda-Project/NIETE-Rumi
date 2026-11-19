/**
 * A photo that is NOT a textbook page gets the generic picture reply.
 *
 * The path: handleImageMessage → tryPicLpRoute enqueues the photo to the batch
 * coalescer and tags Redis `image:<uid>:<media>` = pic_lp_handled → the batch
 * flushes → handleCoalescedBatch classifies it → not a book page → falls back
 * to runImageAnalysis. runImageAnalysis's duplicate guard is a SET NX on that
 * same key, so it always failed ("🔄 Duplicate image detected, skipping") and
 * the teacher got no reply at all.
 *
 * This drives the real handler and the real coalescer over an in-memory Redis
 * that behaves like railway-redis.service (setNX/set/get with JSON parse/
 * delete). Only the edges are doubled: WhatsApp, vision, R2, DB, the session
 * claims that come before pic-to-LP, and the classifier.
 *
 * Also pinned: a true duplicate (the same media arriving again, a webhook
 * retry) is still skipped, a book page is untouched, and Redis being down
 * means a reply, never silence.
 */

const H = '../../bot/shared/handlers/image-message.handler';
const COALESCER = '../../bot/shared/services/pic-to-lp/image-batch-coalescer.service';

const SKIP_LINE = '🔄 Duplicate image detected, skipping (another handler active)';

let mocks;
let redisStore;
let redisDown;

function fakeRedis() {
  return {
    isAvailable: () => !redisDown,
    setNX: jest.fn(async (key, value) => {
      if (redisDown) return true; // the real service: down → "claimed", never drop the work
      if (redisStore.has(key)) return false;
      redisStore.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    }),
    set: jest.fn(async (key, value) => {
      if (redisDown) return false;
      redisStore.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    }),
    // The real get() JSON-parses what it finds (string fallback).
    get: jest.fn(async (key) => {
      if (redisDown || !redisStore.has(key)) return null;
      const raw = redisStore.get(key);
      try { return JSON.parse(raw); } catch (e) { return raw; }
    }),
    delete: jest.fn(async (key) => {
      if (redisDown) return false;
      redisStore.delete(key);
      return true;
    }),
  };
}

function load() {
  jest.resetModules();
  redisStore = new Map();
  redisDown = false;
  mocks = {
    whatsapp: {
      startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
      sendMessage: jest.fn().mockResolvedValue({}),
      sendInteractiveButtons: jest.fn().mockResolvedValue({}),
      downloadMedia: jest.fn().mockResolvedValue(Buffer.from('img')),
    },
    vision: {
      analyzeWithRetry: jest.fn().mockResolvedValue({ success: true, analysis: 'A tidy classroom. Try group seating.' }),
    },
    redis: fakeRedis(),
    r2: { uploadImageWithRetry: jest.fn().mockResolvedValue('https://r2.example/x.jpg') },
    logger: { logToFile: jest.fn() },
    session: {
      getActiveSession: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'piclp-sess-1' }),
      appendPage: jest.fn().mockResolvedValue({}),
      cancelActiveForUser: jest.fn().mockResolvedValue(),
    },
    collector: {
      appendPageAndPrompt: jest.fn().mockResolvedValue({ autoComplete: false, pageCount: 2 }),
      onComplete: jest.fn().mockResolvedValue(),
      promptIntent: jest.fn().mockResolvedValue(),
      startCollectingFromIntent: jest.fn().mockResolvedValue(),
    },
    classifier: { classifyImageType: jest.fn().mockResolvedValue({ type: 'CLASSROOM', confidence: 0.95 }) },
    redirect: { redirectIfFlagged: jest.fn().mockResolvedValue(false) },
  };

  jest.doMock('../../bot/shared/services/whatsapp.service', () => mocks.whatsapp);
  jest.doMock('../../bot/shared/services/vision.service', () => mocks.vision);
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => mocks.redis);
  const supaChain = {
    insert: () => supaChain,
    update: () => supaChain,
    select: () => supaChain,
    eq: () => supaChain,
    order: () => supaChain,
    limit: () => supaChain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => Promise.resolve({ data: { id: 'req-1' }, error: null }),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => supaChain) }));
  jest.doMock('../../bot/shared/storage/r2', () => mocks.r2);
  jest.doMock('../../bot/shared/utils/logger', () => mocks.logger);
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(),
    runWithCorrelation: (id, fn) => fn(),
    generateCorrelationId: () => 'corr-test',
  }));
  jest.doMock('../../bot/shared/utils/language-cache', () => ({ getUserLanguage: jest.fn().mockResolvedValue('en') }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    storeConversation: jest.fn().mockResolvedValue(),
    getOrCreateSession: jest.fn().mockResolvedValue('conv-1'),
  }));
  jest.doMock('../../bot/shared/services/app-redirect.service', () => mocks.redirect);
  // The session claims that come before pic-to-LP: none of them wants this photo.
  jest.doMock('../../bot/shared/handlers/child-test.handler', () => ({ handleImage: jest.fn().mockResolvedValue(false) }));
  jest.doMock('../../bot/shared/services/coaching/media-attach.service', () => ({
    handlePhotoArrival: jest.fn().mockResolvedValue(false),
    handleLessonPlanMediaArrival: jest.fn().mockResolvedValue(false),
  }));
  jest.doMock('../../bot/shared/handlers/exam-checker.handler', () => ({
    handleExamImage: jest.fn().mockResolvedValue({ handled: false }),
  }));
  jest.doMock('../../bot/shared/services/pic-to-lp/pic-lp-session.service', () => mocks.session);
  jest.doMock('../../bot/shared/services/pic-to-lp/page-collector.service', () => mocks.collector);
  jest.doMock('../../bot/shared/services/pic-to-lp/classifier.service', () => mocks.classifier);
  // The coalescer is the REAL one (flushNow fires the batch at once).

  return { h: require(H), coalescer: require(COALESCER) };
}

const user = { id: 'user-test-1', preferred_language: 'en' };
const FROM = '920000000001';

function photo(mediaId, caption) {
  return { id: `wamid.${mediaId}`, type: 'image', image: { id: mediaId, mime_type: 'image/jpeg', ...(caption ? { caption } : {}) } };
}

// handleCoalescedBatch runs fire-and-forget from the coalescer's onFlush:
// let its promise chain finish (every double resolves at once).
async function settle() {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
}

// Webhooks for `mediaIds`, then the batch window closes.
async function sendPhotos(h, coalescer, mediaIds) {
  for (const m of mediaIds) await h.handleImageMessage(photo(m), FROM, user);
  coalescer.flushNow(user.id);
  await settle();
}

function skipLogged() {
  return mocks.logger.logToFile.mock.calls.some(([msg]) => msg === SKIP_LINE);
}

afterEach(() => {
  try { require(COALESCER).__resetForTest(); } catch (e) { /* module reset */ }
  jest.resetModules();
});

describe('a photo that is not a textbook page gets the generic picture reply', () => {
  it.each([
    ['CLASSROOM', 0.95],
    ['STUDENT_WORK', 0.9],
    ['OTHER', 0.9],
    ['EXAM', 0.9],
    ['BOOK_PAGE below the 0.5 confidence bar', 0.4],
  ])('%s → the vision reply is sent', async (label, confidence) => {
    const { h, coalescer } = load();
    mocks.classifier.classifyImageType.mockResolvedValue({ type: label.split(' ')[0], confidence });

    await sendPhotos(h, coalescer, ['media-1']);

    expect(redisStore.has('image:user-test-1:media-1')).toBe(true); // pic-to-LP did tag it
    expect(mocks.vision.analyzeWithRetry).toHaveBeenCalledTimes(1);
    expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith(FROM, 'A tidy classroom. Try group seating.');
    expect(skipLogged()).toBe(false);
  });

  it('three classroom photos in one batch → ONE reply, about the primary photo', async () => {
    const { h, coalescer } = load();
    await sendPhotos(h, coalescer, ['media-1', 'media-2', 'media-3']);

    expect(mocks.classifier.classifyImageType).toHaveBeenCalledTimes(1);
    expect(mocks.vision.analyzeWithRetry).toHaveBeenCalledTimes(1);
    expect(mocks.whatsapp.downloadMedia).toHaveBeenCalledWith('media-1');
    expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('the reply is cached on the image key, as the guard expects', async () => {
    const { h, coalescer } = load();
    await sendPhotos(h, coalescer, ['media-1']);
    expect(JSON.parse(redisStore.get('image:user-test-1:media-1')).response).toBe('A tidy classroom. Try group seating.');
  });

  it('Redis down → still a reply, never silence', async () => {
    const { h, coalescer } = load();
    redisDown = true;
    await sendPhotos(h, coalescer, ['media-1']);
    expect(mocks.vision.analyzeWithRetry).toHaveBeenCalledTimes(1);
    expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('the duplicate guard still holds for a real duplicate', () => {
  it('the same photo arriving again (a webhook retry) after its batch was answered → no second reply', async () => {
    const { h, coalescer } = load();
    await sendPhotos(h, coalescer, ['media-1']);
    await sendPhotos(h, coalescer, ['media-1']);

    expect(mocks.vision.analyzeWithRetry).toHaveBeenCalledTimes(1);
    expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('a retry of a non-primary photo of an answered batch → no second reply', async () => {
    const { h, coalescer } = load();
    await sendPhotos(h, coalescer, ['media-1', 'media-2']);
    await sendPhotos(h, coalescer, ['media-2']);

    expect(mocks.vision.analyzeWithRetry).toHaveBeenCalledTimes(1);
    expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('a new photo after an answered batch → its own reply', async () => {
    const { h, coalescer } = load();
    await sendPhotos(h, coalescer, ['media-1']);
    await sendPhotos(h, coalescer, ['media-9']);

    expect(mocks.vision.analyzeWithRetry).toHaveBeenCalledTimes(2);
    expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('a photo pic-to-LP tagged, coming back on the direct path (an LP is being made) → skipped, as before', async () => {
    const { h, coalescer } = load();
    // First arrival: a book page → LP session, the image keeps its pic_lp_handled tag.
    mocks.classifier.classifyImageType.mockResolvedValue({ type: 'BOOK_PAGE', confidence: 0.95 });
    await sendPhotos(h, coalescer, ['media-1']);
    // The retry lands while that LP is generating: pic-to-LP declines, the direct path runs.
    mocks.session.getActiveSession.mockResolvedValue({ id: 'piclp-sess-1', status: 'generating', created_at: new Date().toISOString() });
    await h.handleImageMessage(photo('media-1'), FROM, user);
    await settle();

    expect(mocks.vision.analyzeWithRetry).not.toHaveBeenCalled();
    expect(mocks.whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(skipLogged()).toBe(true);
  });
});

describe('a book page is untouched', () => {
  it('BOOK_PAGE → LP session + intent prompt, no vision reply, the pic-to-LP tag stays', async () => {
    const { h, coalescer } = load();
    mocks.classifier.classifyImageType.mockResolvedValue({ type: 'BOOK_PAGE', confidence: 0.95 });
    await sendPhotos(h, coalescer, ['media-1', 'media-2']);

    expect(mocks.session.create).toHaveBeenCalledTimes(1);
    expect(mocks.session.appendPage).toHaveBeenCalledTimes(1);
    expect(mocks.collector.promptIntent).toHaveBeenCalledTimes(1);
    expect(mocks.vision.analyzeWithRetry).not.toHaveBeenCalled();
    expect(mocks.whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(JSON.parse(redisStore.get('image:user-test-1:media-1')).status).toBe('pic_lp_handled');
    expect(mocks.redis.delete).not.toHaveBeenCalled();
  });
});
