'use strict';
/**
 * bd-xw56ed — a voice note is read against the same live menu as typed words.
 *
 * The voice path asks the same classifier. A voice note that asks for one of her menu rows now opens that row (the
 * in-app button when she is on the app), one that asks for a feature we cannot tell gets the not-sure line and the
 * menu, and everything else is answered aloud exactly as before. Presentations are no longer generated from a voice
 * note (operator, 20 Oct 2026).
 *
 * Drives the REAL voice handler, classifier (only fetch is stubbed), menu router and app-redirect. Audio download,
 * transcription, TTS, storage, the database client, Redis and the WhatsApp send layer are the stubbed boundaries.
 */

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const mockWa = {
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendAudio: jest.fn(() => Promise.resolve(true)),
  sendCtaUrl: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendFeatureMenuCarousel: jest.fn(() => Promise.resolve(true)),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  startContinuousTypingIndicator: () => ({ stop: jest.fn() }),
  getMediaInfo: jest.fn(() => Promise.resolve({ mime_type: 'audio/ogg', file_size: 30_000 })),
  downloadMedia: jest.fn(() => Promise.resolve(Buffer.from('audio-bytes'))),
  sendMessage: (...a) => mockWa.sendMessage(...a),
  sendAudio: (...a) => mockWa.sendAudio(...a),
  sendCtaUrl: (...a) => mockWa.sendCtaUrl(...a),
  sendFlow: (...a) => mockWa.sendFlow(...a),
  sendFeatureMenuCarousel: (...a) => mockWa.sendFeatureMenuCarousel(...a),
  sendSticker: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../bot/shared/services/audio.service', () => ({
  getAudioDuration: jest.fn(() => Promise.resolve(0)),
  convertToWav: jest.fn(() => Promise.resolve()),
  transcribeWithLanguagePreference: jest.fn(() => Promise.resolve({
    text: global.__VR_TRANSCRIPT, language: 'ur', engine: 'soniox',
  })),
  transcribeAudio: jest.fn(() => Promise.resolve(global.__VR_TRANSCRIPT)),
  generateSpeechForLanguage: jest.fn(() => Promise.resolve(Buffer.from('mp3'))),
  getASREngine: jest.fn(() => 'soniox'),
}));
jest.mock('../../bot/shared/services/tts', () => ({
  synthesize: jest.fn(() => Promise.resolve({ audio: Buffer.from('OggS'), mimeType: 'audio/ogg', extension: 'ogg', durationSec: 1 })),
}));
jest.mock('fs', () => ({
  writeFileSync: jest.fn(), unlinkSync: jest.fn(), existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(), mkdtempSync: jest.fn((prefix) => `${prefix}test`), rmSync: jest.fn(),
  readFileSync: jest.requireActual('fs').readFileSync,
  readdirSync: jest.requireActual('fs').readdirSync,
  statSync: jest.requireActual('fs').statSync,
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadAudio: jest.fn(() => Promise.resolve('https://r2.example/a.ogg')),
}));
const mockUpdateSessionType = jest.fn();
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(() => Promise.resolve('sess-1')),
  updateSessionType: (...a) => mockUpdateSessionType(...a), storeConversation: jest.fn(),
  storeAudioSession: jest.fn(), storeLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/services/observe/observe-audio-router', () => {
  const actual = jest.requireActual('../../bot/shared/services/observe/observe-audio-router');
  return { ...actual, routeLeaderAudio: jest.fn(() => Promise.resolve(false)) };
});
jest.mock('../../bot/shared/services/feature-registration.service', () => ({
  isPendingName: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)), clearState: jest.fn(), setState: jest.fn(),
}));
jest.mock('../../bot/shared/services/language-detector.service', () => ({
  getConfirmedLanguage: jest.fn(() => Promise.resolve('ur')),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(() => Promise.resolve('ur')),
  setUserLanguage: jest.fn(),
  DEFAULT_LANGUAGE: 'en',
}));
jest.mock('../../bot/shared/services/lp-context.service', () => ({
  injectLpContext: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../bot/shared/services/coaching-orchestrator.service', () => ({
  handleReflectiveResponse: jest.fn(), initiateCoachingSession: jest.fn(),
}));

const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  redis: { get: jest.fn(async () => null), set: jest.fn(async () => 'OK'), del: jest.fn(async () => 1) },
  get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  set: jest.fn(async (k, v) => { mockStore.set(k, v); return true; }),
  setexWithCeiling: jest.fn(async () => true),
  setNX: jest.fn(async () => true),
  delete: jest.fn(async (k) => { mockStore.delete(k); return true; }),
  del: jest.fn(async (k) => { mockStore.delete(k); return true; }),
}));

const { makeDb } = require('../quiz/helpers/memory-db');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));

const { resolveUx } = require('../../bot/shared/config/ux-strings');

const REAL_FETCH = globalThis.fetch;
const PORTAL = 'https://portal.example.test';
const FROM = '923001234567';
const TEACHER = {
  id: '60530046-7ac3-4ea3-a976-b43c37c23213', role: 'teacher', name: 'T', preferred_language: 'ur',
  registration_completed: true, registration_state: 'completed',
};
const ENV = {
  TEACHER_TRAINING_FLOW_ID: 'flow-training',
  ASSESSMENT_GEN_FLOW_ID: 'flow-assess',
  OPENAI_API_KEY: 'test-openai',
  OPENROUTER_API_KEY: 'test-openrouter',
  INTERNAL_API_KEY: 'test-internal-key',
  PORTAL_URL: PORTAL,
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
};
const SCRUBBED = ['LLM_JOB_MODELS', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'TRANSCRIPT_QUIZ_ENABLED', 'TRANSCRIPT_QUIZ_FLOW_ID', 'STUDENT_VIDEOS_FLOW_ID', 'E2E_CASSETTE', 'REDIS_URL'];
const IAB_ON = ['menu', 'lesson_plan', 'assessment_generator', 'ai_coaching', 'teacher_training', 'attendance', 'classes']
  .map((f) => ({ key: `app_redirect_${f}`, value: 'teachers' }))
  .concat([{ key: 'portal_teacher_v2', value: 'teachers' }]);

let classifierSays;
let classifierCalls;
let chatCalls;
const saved = {};
let handleVoiceMessage;

async function load(settings) {
  jest.resetModules();
  mockDb = makeDb({
    users: [{ ...TEACHER }],
    app_settings: [{ key: 'assessment_generator_enabled', value: true }, ...settings],
    user_feature_first_use: [],
    lesson_plan_requests: [],
  });
  await require('../../bot/shared/config/model-settings').refresh();
  ({ handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler'));
}

async function speak(transcript) {
  global.__VR_TRANSCRIPT = transcript;
  await handleVoiceMessage({ id: 'wamid.1', audio: { id: 'media-1', mime_type: 'audio/ogg' } }, FROM, { ...TEACHER });
  await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  for (const k of [...SCRUBBED, ...Object.keys(ENV)]) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, ENV);
  classifierSays = 'general';
  classifierCalls = [];
  chatCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/chat\/completions/.test(url)) {
      const system = ((body && body.messages) || []).find((m) => m.role === 'system');
      const isClassifier = Boolean(system && /You are an intent classifier/.test(system.content));
      (isClassifier ? classifierCalls : chatCalls).push(body);
      const content = isClassifier ? classifierSays : 'یہ آپ کے سوال کا جواب ہے۔';
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: (body && body.model) || 'x',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 },
      });
    }
    return json({ ok: true });
  };
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  for (const k of [...SCRUBBED, ...Object.keys(ENV)]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const ctaLinks = () => mockWa.sendCtaUrl.mock.calls.map(([, opts]) => opts.url);
const linkFeature = (url) => require('../../bot/shared/services/app-login-link').verifyAppLink(url.slice(`${PORTAL}/go/`.length)).f;

test('the classifier is asked with her live menu', async () => {
  await load(IAB_ON);
  await speak('mujhe test paper banana hai');
  expect(classifierCalls).toHaveLength(1);
  const prompt = classifierCalls[0].messages.find((m) => m.role === 'system').content;
  expect(prompt).toContain('"assessment"');
  expect(prompt).not.toMatch(/presentation/i);
});

test('a voice note that asks for one of her menu rows → that IAB button, not a spoken answer', async () => {
  await load(IAB_ON);
  classifierSays = 'assessment';
  await speak('mujhe test paper banana hai');
  expect(ctaLinks()).toHaveLength(1);
  expect(linkFeature(ctaLinks()[0])).toBe('assessment_generator');
  expect(chatCalls).toHaveLength(0);
  expect(mockWa.sendAudio).not.toHaveBeenCalled();
});

test('a voice note asking for a feature we cannot tell → the not-sure line, then the IAB menu', async () => {
  await load(IAB_ON);
  classifierSays = 'unsure';
  await speak('woh wala kholein');
  expect(mockWa.sendMessage.mock.calls.map(([, t]) => t)).toEqual([resolveUx('menuMatchUnsure', { language: 'ur' })]);
  expect(linkFeature(ctaLinks()[0])).toBe('menu');
  expect(chatCalls).toHaveLength(0);
});

test('a voice note asking for the menu → the IAB Home button, no not-sure line', async () => {
  await load(IAB_ON);
  classifierSays = 'menu';
  await speak('menu dikhayein');
  expect(mockWa.sendMessage).not.toHaveBeenCalled();
  expect(linkFeature(ctaLinks()[0])).toBe('menu');
});

test('a question is still answered aloud, as before', async () => {
  await load(IAB_ON);
  classifierSays = 'general';
  await speak('bachon ko fractions kaise samjhaun?');
  expect(chatCalls.length).toBeGreaterThan(0);
  expect(mockWa.sendCtaUrl).not.toHaveBeenCalled();
});

test('"presentation" no longer generates a presentation from a voice note', async () => {
  await load(IAB_ON);
  classifierSays = 'presentation';
  await speak('water cycle par slides bana dein');
  expect(mockDb.tables.lesson_plan_requests).toHaveLength(0);
  for (const [, type] of mockUpdateSessionType.mock.calls) expect(type).not.toBe('presentation');
});
