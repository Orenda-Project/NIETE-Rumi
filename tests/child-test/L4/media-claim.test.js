/**
 * The REAL voice and image handlers hand a child-test voice note / strip photo to the child test
 * BEFORE anything else can swallow it — and only in the child test's own state.
 *
 *   voice: before routeLeaderAudio (a leader's audio while observe is awaiting_audio is taken as the
 *          lesson recording; here it is stubbed to "would swallow" so the order is what is tested)
 *   image: before handlePhotoArrival (the coaching classroom-photo claim, stubbed the same way)
 *
 * Network boundary mocked (WhatsApp, Redis, R2, Supabase, the AI services); the other lanes are
 * contract fakes through ports.
 */
const { createFakeRedis, createWhatsAppRecorder } = require('./helpers/boundary');
const { createLaneFakes } = require('./helpers/lane-fakes');

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), runWithCorrelation: (_id, fn) => fn(), generateCorrelationId: () => 'corr-1',
}));
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => require('./helpers/boundary').createFakeRedis());
jest.mock('../../../bot/shared/services/whatsapp.service', () => require('./helpers/boundary').createWhatsAppRecorder());
jest.mock('../../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn(async (b, key) => `https://r2.example/${key}`),
  uploadAudio: jest.fn(async () => 'https://r2.example/a.ogg'),
  uploadImageWithRetry: jest.fn(async () => 'https://r2.example/i.jpg'),
}));
jest.mock('../../../bot/shared/config/supabase', () => {
  const chain = {};
  for (const m of ['from', 'select', 'eq', 'neq', 'or', 'order', 'limit', 'update', 'insert', 'gte', 'lt', 'lte', 'is', 'in', 'not']) chain[m] = jest.fn(() => chain);
  chain.single = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  chain.then = (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
  return chain;
});
jest.mock('../../../bot/shared/services/openai.service', () => ({ detectIntent: jest.fn(async () => ({ type: 'general' })) }));
jest.mock('../../../bot/shared/services/audio.service', () => ({ getAudioDuration: jest.fn(async () => 30) }));
jest.mock('../../../bot/shared/services/tts', () => ({ synthesize: jest.fn() }));
jest.mock('../../../bot/shared/services/vision.service', () => ({}));
jest.mock('../../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(async () => 'chat-sess-1'), updateSessionType: jest.fn(),
  storeConversation: jest.fn(), storeAudioSession: jest.fn(), storeLessonPlan: jest.fn(),
}));
// The two claims that would otherwise swallow the media — stubbed to "yes, mine".
jest.mock('../../../bot/shared/services/observe/observe-audio-router', () => ({
  ...jest.requireActual('../../../bot/shared/services/observe/observe-audio-router'),
  routeLeaderAudio: jest.fn(async () => true),
}));
jest.mock('../../../bot/shared/services/coaching/media-attach.service', () => ({
  handlePhotoArrival: jest.fn(async () => true),
}));

const redis = require('../../../bot/shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../../bot/shared/services/whatsapp.service');
const r2 = require('../../../bot/shared/storage/r2');
const { routeLeaderAudio } = require('../../../bot/shared/services/observe/observe-audio-router');
const { handlePhotoArrival } = require('../../../bot/shared/services/coaching/media-attach.service');
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const ChildTest = require('../../../bot/shared/handlers/child-test.handler');
const { handleVoiceMessage } = require('../../../bot/shared/handlers/voice-message.handler');
const { handleImageMessage } = require('../../../bot/shared/handlers/image-message.handler');

const FROM = '923000000001';
const COACH = { id: 'coach-1', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: FROM };
const SAVED = { ...process.env };
let lanes;

const voice = (id) => ({ id: `wamid.${id}`, timestamp: String(Math.floor(Date.now() / 1000) + 5), type: 'audio', audio: { id, mime_type: 'audio/ogg; codecs=opus', voice: true } });
const image = (id) => ({ id: `wamid.${id}`, type: 'image', image: { id, mime_type: 'image/jpeg' } });

async function seedBlockState(block = 'urdu') {
  const { session } = await lanes.store.createSession({ drawId: 'd1', coachUserId: 'coach-1', visitId: 'form-1', channel: 'whatsapp' });
  await redis.set('ctst:state:coach-1', JSON.stringify({
    ctx: { visitId: 'form-1', schoolId: 'school-1' }, step: 'block', pendingPhotos: [],
    current: { drawId: 'd1', rollNumber: '1', childNo: 1, total: 5, sessionId: session.id, grade: 3, form: 'A', schoolId: 'school-1', block, promptAt: new Date().toISOString() },
  }));
  return session.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  redis.__data.clear();
  WhatsAppService.__sent.length = 0;
  process.env.CHILD_TEST_ENABLED = 'true';
  lanes = createLaneFakes();
  ports.__setForTest(lanes);
});
afterEach(() => ChildTest.__drain());
afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

describe('voice', () => {
  test('a voice note while a block waits is the child test\'s, ahead of the leader-audio router', async () => {
    const sid = await seedBlockState('urdu');
    await handleVoiceMessage(voice('v1'), FROM, COACH);
    expect(r2.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), `child-test/${process.env.RAILWAY_ENVIRONMENT_NAME || 'local'}/school-1/${sid}/urdu.ogg`, 'audio/ogg');
    expect(routeLeaderAudio).not.toHaveBeenCalled();
  });
  test('no child-test state: the leader-audio router gets it as before', async () => {
    await handleVoiceMessage(voice('v2'), FROM, COACH);
    expect(routeLeaderAudio).toHaveBeenCalled();
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
  });
  test('flag off with a stale state: not claimed', async () => {
    await seedBlockState('urdu');
    delete process.env.CHILD_TEST_ENABLED;
    await handleVoiceMessage(voice('v3'), FROM, COACH);
    expect(routeLeaderAudio).toHaveBeenCalled();
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
  });
});

describe('image', () => {
  test('a strip photo while one is pending is the child test\'s, ahead of the classroom-photo claim', async () => {
    await redis.set('ctst:state:coach-1', JSON.stringify({
      ctx: { visitId: 'form-1', schoolId: 'school-1' }, step: 'list', current: null,
      pendingPhotos: [{ sessionId: 'sess-9', rollNumber: '4', schoolId: 'school-1', grade: 3, form: 'A' }],
    }));
    await handleImageMessage(image('i1'), FROM, COACH);
    expect(r2.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), expect.stringMatching(/school-1\/sess-9\/maths-strip\.jpg$/), 'image/jpeg');
    expect(handlePhotoArrival).not.toHaveBeenCalled();
  });
  test('no strip pending: the classroom-photo claim gets it as before', async () => {
    await seedBlockState('urdu');
    await handleImageMessage(image('i2'), FROM, COACH);
    expect(handlePhotoArrival).toHaveBeenCalled();
    expect(r2.uploadBuffer).not.toHaveBeenCalled();
  });
});
