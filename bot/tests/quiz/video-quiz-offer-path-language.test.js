'use strict';
/**
 * The /video quiz offer path speaks the language of its run — including after
 * the run's own state has gone.
 *
 * A child (or a teacher) who picks a video from the library is offered its quiz
 * in the run's language, and four lines around that offer were hardcoded
 * English:
 *   - "No problem — enjoy the video!"                  (declining the offer — the common one)
 *   - "That quiz offer has expired — …"                 (tapping an offer after it lapsed)
 *   - "Sorry — I couldn't start that quiz. …"           (the session could not be created)
 *   - "That quiz has finished. Pick another video …"    (tapping an answer after the quiz ended)
 *
 * The last two of those four fire exactly when the run's state is gone (the
 * offer's hour is up, or the quiz finished), so the language has to outlive
 * it: the run remembers its language per phone when it starts, and the
 * orphaned taps read it back.
 *
 * Only the network is replaced: Supabase, Redis (an in-memory map), WhatsApp,
 * the send throttle and the video survey scheduler. video-quiz.service runs
 * for real — offerAfterVideo → sendOffer, handleOfferButton, startSession,
 * handleAnswer.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    __store: store,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveList: jest.fn().mockResolvedValue(true),
  sendImage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
  WINDOW_MS: 300000,
}));
jest.mock('../../shared/services/student-video-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const vq = require('../../shared/services/quiz/video-quiz.service');

const PHONE = '923001234567';
const QUIZ = { id: 'q1', topic: 'واحد اور جمع', grade: '3', subject: 'urdu' };
const QUESTION = {
  id: 'qa', external_id: 'leg:1', question_text: 'Which one?', option_a: 'A1', option_b: 'B1',
  option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null,
  media: {}, render_pattern: 'P1',
};
const EN = {
  declined: 'No problem — enjoy the video!',
  expired: "That quiz offer has expired — pick the video again and I'll offer it fresh.",
  startFailed: "Sorry — I couldn't start that quiz. Please try again in a moment.",
  finished: "That quiz has finished. Pick another video and I'll offer you a fresh one!",
};
const ENGLISH = /No problem|enjoy the video|has expired|couldn't start|has finished|Pick another video/;
// Gendered stems that would address a child as a boy or a girl.
const GENDERED = /(کرتی ہیں|چاہتی ہیں|کریں گی|رہی ہوں گی|سکتی ہیں|رہی ہوں|چاہیں گی|کرتے ہیں|چاہتے ہیں|سکتے ہیں|کریں گے|رہے ہوں گے|آئیں گی|آئیں گے)/;

/** A supabase chain that answers every call; `insertFails` breaks the session insert. */
function stubDb({ insertFails = false } = {}) {
  supabase.from.mockImplementation((table) => {
    const rows = table === 'quiz_questions' ? [{ id: 'qa', external_id: 'leg:1', sort_order: 1 }] : [];
    const handlers = {
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
      maybeSingle: async () => ({
        data: table === 'quizzes' ? QUIZ : (table === 'users' ? { name: 'Miss Ayesha' } : null), error: null,
      }),
      single: async () => {
        if (table === 'quiz_sessions') {
          return insertFails ? { data: null, error: { message: 'insert failed' } } : { data: { id: 'sess-1' }, error: null };
        }
        if (table === 'quiz_questions') return { data: QUESTION, error: null };
        return { data: null, error: null };
      },
    };
    const proxy = new Proxy({}, {
      get: (_, prop) => (prop in handlers ? handlers[prop] : () => proxy),
    });
    return proxy;
  });
}

const texts = () => WhatsAppService.sendMessage.mock.calls.filter((c) => c[0] === PHONE).map((c) => c[1]);

/** The offer exactly as a run sends it: offerAfterVideo → (3 s) → sendOffer. */
async function offer(language) {
  jest.useFakeTimers();
  await vq.offerAfterVideo({ userId: 'u1', phone: PHONE, video: { id: 'v1', clean_title: 'Video' }, language });
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  // let sendOffer's awaits settle
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  jest.clearAllMocks();
  redis.__store.clear();
  stubDb();
});

describe('declining the offer', () => {
  test('Urdu run: answered in Urdu', async () => {
    await offer('ur');
    await vq.handleOfferButton(vq.OFFER_NO, PHONE);
    expect(texts()).toEqual(['کوئی بات نہیں — ویڈیو دیکھنے کا لطف اٹھائیں!']);
  });

  test('English run: exactly as before', async () => {
    await offer('en');
    await vq.handleOfferButton(vq.OFFER_NO, PHONE);
    expect(texts()).toEqual([EN.declined]);
  });
});

describe('tapping an offer after it lapsed', () => {
  test('answered in the language of the run that made the offer, though the offer itself is gone', async () => {
    await offer('ur');
    await redis.delete(vq.OFFER_KEY(PHONE));          // the offer's hour is up
    await vq.handleOfferButton(vq.OFFER_YES, PHONE);
    const [msg] = texts();
    expect(msg).toContain('پیشکش ختم ہو چکی ہے');
    expect(msg).not.toMatch(ENGLISH);
  });

  test('a phone with no run on record gets the floor (English), exactly as before', async () => {
    await vq.handleOfferButton(vq.OFFER_YES, PHONE);
    expect(texts()).toEqual([EN.expired]);
  });
});

describe('a quiz that cannot start', () => {
  test('Urdu run: apologised for in Urdu', async () => {
    stubDb({ insertFails: true });
    await vq.startSession({ phone: PHONE, userId: 'u1', quizId: 'q1', videoId: 'v1', language: 'ur', source: 'video_solo' });
    const [msg] = texts();
    expect(msg).toBe('معذرت — ابھی یہ quiz شروع نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔');
  });

  test('English run: exactly as before', async () => {
    stubDb({ insertFails: true });
    await vq.startSession({ phone: PHONE, userId: 'u1', quizId: 'q1', videoId: 'v1', language: 'en', source: 'video_solo' });
    expect(texts()).toEqual([EN.startFailed]);
  });
});

describe('tapping an answer after the quiz finished', () => {
  test('a child whose Urdu run (from a class link — no offer at all) has ended is answered in Urdu', async () => {
    await vq.startSession({
      phone: PHONE, userId: null, quizId: 'q1', videoId: 'v1', language: 'ur',
      source: 'share_link', studentName: 'اختر', shareCodeId: 'sc-1', studentId: 'stu-1',
    });
    await redis.delete(vq.STATE_KEY(PHONE));           // the quiz finished
    WhatsAppService.sendMessage.mockClear();

    await vq.handleAnswer(PHONE, 'vq_qa_0');

    const [msg] = texts();
    expect(msg).toBe('یہ quiz ختم ہو چکا ہے۔ کوئی اور ویڈیو چنیں، اس کے ساتھ نیا quiz ملے گا!');
  });

  test('with no run on record: English, exactly as before', async () => {
    await vq.handleAnswer(PHONE, 'vq_qa_0');
    expect(texts()).toEqual([EN.finished]);
  });
});

describe('the Urdu copy', () => {
  test('addresses a child without a gendered verb, and every line is Urdu', async () => {
    const { UX_STRINGS } = require('../../shared/config/ux-strings');
    for (const key of ['vqOfferDeclined', 'vqOfferExpired', 'vqStartFailed', 'vqQuizFinished']) {
      expect(UX_STRINGS[key]).toBeDefined();
      expect(UX_STRINGS[key].ur).not.toMatch(GENDERED);
      expect(UX_STRINGS[key].ur).not.toMatch(ENGLISH);
      expect(UX_STRINGS[key].en).toBe(EN[{
        vqOfferDeclined: 'declined', vqOfferExpired: 'expired', vqStartFailed: 'startFailed', vqQuizFinished: 'finished',
      }[key]]);
    }
  });
});
