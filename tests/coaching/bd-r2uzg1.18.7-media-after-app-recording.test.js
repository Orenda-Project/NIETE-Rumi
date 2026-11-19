'use strict';
/**
 * bd-r2uzg1.18.7 (ICT sheet, DC row) — photos and a lesson plan sent on WhatsApp AFTER a lesson sent from the
 * recording screen.
 *
 * A teacher records her lesson on the Digital Coaching screen and presses Send with no plan and no photos, then sends
 * the plan and ~10 photos here. They cannot join that lesson, and they fell to the generic picture path. Now: when her
 * LATEST own Digital Coaching session was sent from the recording screen less than 24 h ago, she gets ONE message (not
 * one per photo) that says so and to add them on the recording screen before Send next time, with the Digital Coaching
 * button the bot's app links already use. Everyone else keeps today's path.
 *
 * Drives the REAL service and the REAL image handler; the edges (Supabase, Redis, WhatsApp, R2, the vision model) are
 * doubled. The webhook's document door is pinned at the source (booting the whole bot costs too much here).
 */
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test-project.supabase.co';

const fs = require('fs');
const path = require('path');
const { tableDouble } = require('../../bot/tests/helpers/table-double');

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), runWithCorrelation: (_id, fn) => fn(), generateCorrelationId: () => 'corr-1',
  setCorrelationUser: jest.fn(),
}));

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => new Proxy({}, { get: (_t, p) => mockDb[p] }));

const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => true,
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return true; }),
  setNX: jest.fn(async (k, v) => { if (mockStore.has(k)) return false; mockStore.set(k, v); return true; }),
  delete: jest.fn(async (k) => { mockStore.delete(k); return true; }),
  del: jest.fn(async (k) => { mockStore.delete(k); return true; }),
}));

const mockWa = {
  sendMessage: jest.fn(async () => true),
  sendCtaUrl: jest.fn(async () => true),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockWa.sendMessage(...a),
  sendCtaUrl: (...a) => mockWa.sendCtaUrl(...a),
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
  downloadMedia: jest.fn(async () => Buffer.from('img')),
  sendTypingIndicator: jest.fn(),
  markAsRead: jest.fn(),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadImageWithRetry: jest.fn(async () => 'https://r2.example/i.jpg'),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
const mockVision = jest.fn(async () => ({ success: true, analysis: 'generic picture reply', usage: {} }));
jest.mock('../../bot/shared/services/vision.service', () => ({ analyzeWithRetry: (...a) => mockVision(...a) }));
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateSession: jest.fn(async () => 'chat-sess-1'), storeConversation: jest.fn(async () => true),
}));
let mockLang = 'ur';
jest.mock('../../bot/shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(async () => mockLang) }));

// The session claims that run BEFORE the generic path. Each answers "not mine" unless a case says otherwise.
const mockPhoto = jest.fn(async () => false);
const mockLpMedia = jest.fn(async () => false);
jest.mock('../../bot/shared/services/coaching/media-attach.service', () => ({
  handlePhotoArrival: (...a) => mockPhoto(...a),
  handleLessonPlanMediaArrival: (...a) => mockLpMedia(...a),
}));
const mockExam = jest.fn(async () => ({ handled: false }));
jest.mock('../../bot/shared/handlers/exam-checker.handler', () => ({ handleExamImage: (...a) => mockExam(...a) }));
jest.mock('../../bot/shared/handlers/child-test.handler', () => ({ handleImage: jest.fn(async () => false) }));
// Where the pic-to-LP route exists (staging/main): a fresh picture goes to the batch coalescer, whose not-a-book-page
// fallback is the generic path (runImageAnalysis). The double flushes each picture as its own non-book batch at once.
jest.mock('../../bot/shared/services/pic-to-lp/pic-lp-session.service', () => ({
  getActiveSession: jest.fn(async () => null), cancelActiveForUser: jest.fn(),
}), { virtual: true });
jest.mock('../../bot/shared/services/pic-to-lp/image-batch-coalescer.service', () => ({
  enqueue: ({ image, onFlush }) => { onFlush({ images: [image], primary: image, caption: image.caption || '' }); },
}), { virtual: true });
jest.mock('../../bot/shared/services/pic-to-lp/classifier.service', () => ({
  classifyImageType: jest.fn(async () => ({ type: 'CLASSROOM', confidence: 0.9 })),
}), { virtual: true });
jest.mock('../../bot/shared/services/pic-to-lp/page-collector.service', () => ({}), { virtual: true });

const { resolveUx } = require('../../bot/shared/config/ux-strings');

const PHONE = '923001112222';
const TEACHER = { id: 'u-teacher-1', role: 'teacher', phone_number: PHONE, preferred_language: 'ur' };
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-19T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
// The two shapes of coaching_sessions.audio_url (portal-coaching.service PORTAL_KEY_RX vs r2.uploadClassroomAudio).
const APP_AUDIO = 'https://r2.example/classroom_audio/u-teacher-1/2026-11/portal_3f2c9a1e-aaaa-bbbb-cccc-1234567890ab.webm';
const WA_AUDIO = 'https://r2.example/classroom_audio/sess-77_1795000000000.ogg';

const appSession = (over = {}) => ({
  id: 'cs-app-1', user_id: TEACHER.id, audio_url: APP_AUDIO, observation_type: null, status: 'completed',
  has_lesson_plan: false, created_at: iso(NOW - 2 * HOUR), ...over,
});

function seed(sessions, opts) {
  mockDb = tableDouble({ coaching_sessions: sessions, app_settings: [], users: [{ ...TEACHER }] }, opts);
}

const SERVICE = '../../bot/shared/services/coaching/app-recording-media.service';
const loadService = () => require(SERVICE);

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockLang = 'ur';
  process.env.PORTAL_URL = 'https://portal.example';
  try { require('../../bot/shared/services/app-redirect.service')._resetForTests(); } catch (_) { /* first load */ }
});

const sends = () => mockWa.sendCtaUrl.mock.calls.length + mockWa.sendMessage.mock.calls.length;

describe('the service: photos after a lesson sent from the recording screen', () => {
  test('ten photos in a burst → ONE message with the Digital Coaching button; every photo is taken', async () => {
    seed([appSession()]);
    const { answerMediaAfterAppRecording } = loadService();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, kind: 'image', now: NOW + i * 1000 })));
    expect(results).toEqual(Array(10).fill(true));
    expect(mockWa.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
    const [to, { body, buttonText, url }] = mockWa.sendCtaUrl.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(body).toBe(resolveUx('dcMediaAfterAppRecording', { language: 'ur' }));
    expect(buttonText).toBe(resolveUx('appLinkButtonCoachingSaved', { language: 'ur' }));
    expect(url).toMatch(/^https:\/\/portal\.example\/go\/[A-Za-z0-9_-]+$/);
  });

  test('the lesson plan sent as a document in the same burst is taken silently too', async () => {
    seed([appSession()]);
    const { answerMediaAfterAppRecording } = loadService();
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, kind: 'document', now: NOW })).toBe(true);
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, kind: 'image', now: NOW + 30 * 1000 })).toBe(true);
    expect(sends()).toBe(1);
  });

  test('she keeps sending: each within the burst of the last is taken; after a quiet spell, today\'s path again', async () => {
    seed([appSession()]);
    const { answerMediaAfterAppRecording, BURST_MS } = loadService();
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, now: NOW })).toBe(true);
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, now: NOW + BURST_MS - 1000 })).toBe(true);
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, now: NOW + 2 * BURST_MS - 2000 })).toBe(true);
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, now: NOW + 4 * BURST_MS })).toBe(false);
    expect(sends()).toBe(1);
  });

  test('English for an English teacher; the plain line when no link can be made', async () => {
    seed([appSession()]);
    mockLang = 'en';
    delete process.env.PORTAL_URL;
    const { answerMediaAfterAppRecording } = loadService();
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, now: NOW })).toBe(true);
    expect(mockWa.sendCtaUrl).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockWa.sendMessage.mock.calls[0][1]).toBe(resolveUx('dcMediaAfterAppRecording', { language: 'en' }));
  });

  test('nothing could be sent → today\'s path, and the next photo tries again', async () => {
    seed([appSession()]);
    mockWa.sendCtaUrl.mockResolvedValueOnce(false);
    mockWa.sendMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    const { answerMediaAfterAppRecording } = loadService();
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, now: NOW })).toBe(false);
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, now: NOW + 1000 })).toBe(true);
    expect(mockWa.sendCtaUrl).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['her latest session is a WhatsApp recording', [appSession({ created_at: iso(NOW - 5 * HOUR) }),
      { ...appSession(), id: 'cs-wa', audio_url: WA_AUDIO, created_at: iso(NOW - HOUR) }]],
    ['the lesson from the recording screen is over 24 h old', [appSession({ created_at: iso(NOW - 25 * HOUR) })]],
    ['it is an observation made in the app, not her own lesson', [appSession({ observation_type: 'leader_observation' })]],
    ['she has no Digital Coaching session', []],
  ])('no message when %s', async (_why, sessions) => {
    seed(sessions);
    const { answerMediaAfterAppRecording } = loadService();
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, now: NOW })).toBe(false);
    expect(sends()).toBe(0);
  });

  test('a failed read is today\'s path, never silence', async () => {
    seed([appSession()], { failTables: { coaching_sessions: 'boom' } });
    const { answerMediaAfterAppRecording } = loadService();
    expect(await answerMediaAfterAppRecording({ user: TEACHER, from: PHONE, now: NOW })).toBe(false);
    expect(sends()).toBe(0);
  });

  test('the words: short, en + ur, never "app"; the button fits Meta\'s 20', () => {
    for (const language of ['en', 'ur']) {
      const body = resolveUx('dcMediaAfterAppRecording', { language });
      expect(body).not.toMatch(/\bapps?\b/i);
      expect(body).not.toMatch(/ایپ/);
      expect([...body].length).toBeLessThanOrEqual(220);
      expect(body).toMatch(language === 'ur' ? /[؀-ۿ]/ : /recording screen/);
      expect([...resolveUx('appLinkButtonCoachingSaved', { language })].length).toBeLessThanOrEqual(20);
    }
  });
});

describe('the image handler: the generic path asks it, after every session claim', () => {
  const image = (id) => ({ id: `wamid.${id}`, type: 'image', image: { id, mime_type: 'image/jpeg' } });
  const send = async (n) => {
    const { handleImageMessage } = require('../../bot/shared/handlers/image-message.handler');
    await Promise.all(Array.from({ length: n }, (_, i) => handleImageMessage(image(`media-${i}`), PHONE, { ...TEACHER })));
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  };
  const appSessionNow = () => appSession({ created_at: iso(Date.now() - 2 * HOUR) });

  test('ten photos after a lesson sent from the recording screen → one message, no generic picture reply', async () => {
    seed([appSessionNow()]);
    await send(10);
    expect(mockWa.sendCtaUrl).toHaveBeenCalledTimes(1);
    expect(mockVision).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
  });

  test('no recent lesson from the recording screen → the generic picture reply, as today', async () => {
    seed([appSession({ created_at: iso(Date.now() - 30 * HOUR) })]);
    await send(1);
    expect(mockWa.sendCtaUrl).not.toHaveBeenCalled();
    expect(mockVision).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['the photo step (a coach observing, or her own WhatsApp lesson)', () => mockPhoto.mockResolvedValue(true)],
    ['the lesson-plan step', () => mockLpMedia.mockResolvedValue(true)],
    ['the exam checker', () => mockExam.mockResolvedValue({ handled: true })],
  ])('%s still claims the photo first — no message', async (_door, arm) => {
    seed([appSessionNow()]);
    arm();
    try {
      await send(1);
      expect(mockWa.sendCtaUrl).not.toHaveBeenCalled();
      expect(mockVision).not.toHaveBeenCalled();
    } finally {
      mockPhoto.mockReset().mockResolvedValue(false);
      mockLpMedia.mockReset().mockResolvedValue(false);
      mockExam.mockReset().mockResolvedValue({ handled: false });
    }
  });
});

describe('the webhook\'s document door (pinned at the source)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const at = src.indexOf('async function handleDocumentMessage(');
  const fn = src.slice(at, src.indexOf('\n}\n', at));

  test('after the lesson-plan step and before "I received your document", a non-audio file asks the service', () => {
    expect(at).toBeGreaterThan(-1);
    const lp = fn.indexOf('await handleLessonPlanMediaArrival(');
    const ask = fn.indexOf('answerMediaAfterAppRecording(');
    const generic = fn.indexOf('I received your document');
    expect(lp).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(lp);
    expect(generic).toBeGreaterThan(ask);
    expect(fn.slice(ask - 400, ask)).toMatch(/route_to_audio_pipeline/);
    expect(fn.slice(ask, ask + 200)).toMatch(/kind: 'document'/);
  });
});
