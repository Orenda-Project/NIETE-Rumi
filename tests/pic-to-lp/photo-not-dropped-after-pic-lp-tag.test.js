/**
 * bd-zrdvmi.87 — a teacher's photo that is NOT a textbook page must get a reply.
 *
 * Live (27 Nov 2026, ICT feedback sheet, Lesson Plan tab, G8 Maths "Ni a rha"): a teacher sent
 * three photos of a maths question; each was logged "Duplicate image detected, skipping (another
 * handler active)" and she got no reply. ~890 photos in 14 days went the same way.
 *
 * Cause: handleImageMessage tags `image:<user>:<media>` = pic_lp_handled as soon as the photo is
 * queued for the pic-LP coalescer. When the coalescer then finds it is not a book page it falls
 * back to runImageAnalysis, whose SET NX on that same key fails on the handler's own tag, so the
 * photo is skipped as a duplicate.
 *
 * The existing routing test mocks setNX → true, so it never saw the clash. This one uses a small
 * in-memory Redis that behaves like the real one.
 */

let mocks;
let store;

function memRedis() {
  store = new Map();
  return {
    setNX: jest.fn(async (k, v) => (store.has(k) ? false : (store.set(k, v), true))),
    set: jest.fn(async (k, v) => (store.set(k, v), 'OK')),
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    delete: jest.fn(async (k) => store.delete(k)),
  };
}

function load() {
  jest.resetModules();
  mocks = {
    whatsapp: {
      startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
      sendMessage: jest.fn().mockResolvedValue({}),
      downloadMedia: jest.fn().mockResolvedValue(Buffer.from('img')),
    },
    vision: { analyzeWithRetry: jest.fn().mockResolvedValue({ success: true, analysis: 'Here is how to solve Q2.' }) },
    redis: memRedis(),
    coalescer: { enqueue: jest.fn() },
    classifier: { classifyImageType: jest.fn().mockResolvedValue({ type: 'WORKSHEET', confidence: 0.9 }) },
    session: { getActiveSession: jest.fn().mockResolvedValue(null), create: jest.fn() },
  };
  const supaChain = {
    insert: () => supaChain, update: () => supaChain, select: () => supaChain, eq: () => supaChain,
    single: () => Promise.resolve({ data: { id: 'req-1' }, error: null }),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => mocks.whatsapp);
  jest.doMock('../../bot/shared/services/vision.service', () => mocks.vision);
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => mocks.redis);
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => supaChain) }));
  jest.doMock('../../bot/shared/storage/r2', () => ({ uploadImageWithRetry: jest.fn().mockResolvedValue('https://r2/x.jpg') }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), runWithCorrelation: (id, fn) => fn(), generateCorrelationId: () => 'corr-1',
  }));
  jest.doMock('../../bot/shared/utils/language-cache', () => ({ getUserLanguage: jest.fn().mockResolvedValue('ur') }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    storeConversation: jest.fn().mockResolvedValue(), getOrCreateSession: jest.fn().mockResolvedValue('conv-1'),
  }));
  jest.doMock('../../bot/shared/services/app-redirect.service', () => ({ redirectIfFlagged: jest.fn().mockResolvedValue(false) }));
  // every session gate before pic-LP declines the photo
  jest.doMock('../../bot/shared/handlers/child-test.handler', () => ({ handleImage: jest.fn().mockResolvedValue(false) }));
  jest.doMock('../../bot/shared/services/coaching/media-attach.service', () => ({
    handlePhotoArrival: jest.fn().mockResolvedValue(false),
    handleLessonPlanMediaArrival: jest.fn().mockResolvedValue(false),
  }));
  jest.doMock('../../bot/shared/handlers/exam-checker.handler', () => ({ handleExamImage: jest.fn().mockResolvedValue({ handled: false }) }));
  jest.doMock('../../bot/shared/services/pic-to-lp/pic-lp-session.service', () => mocks.session);
  jest.doMock('../../bot/shared/services/pic-to-lp/page-collector.service', () => ({}));
  jest.doMock('../../bot/shared/services/pic-to-lp/image-batch-coalescer.service', () => mocks.coalescer);
  jest.doMock('../../bot/shared/services/pic-to-lp/classifier.service', () => mocks.classifier);
  return require('../../bot/shared/handlers/image-message.handler');
}

const user = { id: 'user-1', preferred_language: 'ur' };
const message = { id: 'wamid-1', image: { id: 'media-1', mime_type: 'image/jpeg', caption: '' } };

afterEach(() => jest.resetModules());

async function sendPhotoAndFlush(h) {
  await h.handleImageMessage(message, '923000000000', user);
  expect(mocks.coalescer.enqueue).toHaveBeenCalledTimes(1);
  const { image } = mocks.coalescer.enqueue.mock.calls[0][0];
  await h.handleCoalescedBatch({ user, from: '923000000000', batch: { images: [image], primary: image, caption: '' } });
}

describe('bd-zrdvmi.87 non-textbook photo after the pic-LP queue', () => {
  it('gets the picture reply, not a silent "duplicate" skip', async () => {
    const h = load();
    await sendPhotoAndFlush(h);
    expect(mocks.vision.analyzeWithRetry).toHaveBeenCalledTimes(1);
    expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('923000000000', expect.stringContaining('Q2'));
  });

  it('a real repeat of the same photo still does not get analysed twice', async () => {
    const h = load();
    await sendPhotoAndFlush(h);
    // the same media id arrives again (WhatsApp redelivery) and its batch falls back again
    mocks.coalescer.enqueue.mockClear();
    await sendPhotoAndFlush(h);
    expect(mocks.vision.analyzeWithRetry).toHaveBeenCalledTimes(1);
  });
});
