'use strict';
/**
 * bd-l6424d — a coach who SPEAKS a lesson-plan topic gets the Lesson Plans tab, as one who types it does.
 *
 * Asked whether a coach who names a topic in a lesson-plan request ("lesson plan on fractions", typed or by voice)
 * should also get the Lesson Plans tab, the operator, 23 Oct 2026: "yes to topic requests too".
 *
 * A voice note the classifier reads as a lesson-plan request asks the switch at the `voice_intent` door, BEFORE the
 * spoken answer, the loading sticker, the "lessons come from your textbook" line and the catalogue Flow. A covered coach
 * gets ONE message there: the tab button. Before this, they got all four of the others (the switch was asked again at
 * `voice_lesson_plan_intent`, inside the catalogue door, and said no there too). This suite runs with the cutover gate
 * on (LP_612_ENABLED, LP_612_ROUTE_ALL, PAKISTAN_LP_FLOW_ID), as production does.
 *
 * Drives the REAL voice handler, classifier (only fetch is stubbed), app-redirect and the minted link through the REAL
 * GET /go router. Audio download, transcription, TTS, storage, the database client, Redis, the WhatsApp send layer and
 * the observe audio router (a short note from a coach is chat, not a classroom recording) are the stubbed boundaries.
 */

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const mockWa = {
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendAudio: jest.fn(() => Promise.resolve(true)),
  sendCtaUrl: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendSticker: jest.fn(() => Promise.resolve(true)),
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
  sendSticker: (...a) => mockWa.sendSticker(...a),
  sendFeatureMenuCarousel: (...a) => mockWa.sendFeatureMenuCarousel(...a),
}));

jest.mock('../../bot/shared/services/audio.service', () => ({
  getAudioDuration: jest.fn(() => Promise.resolve(0)),
  convertToWav: jest.fn(() => Promise.resolve()),
  transcribeWithLanguagePreference: jest.fn(() => Promise.resolve({
    text: global.__LT_TRANSCRIPT, language: 'ur', engine: 'soniox',
  })),
  transcribeAudio: jest.fn(() => Promise.resolve(global.__LT_TRANSCRIPT)),
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
jest.mock('../../bot/shared/database/bot-helpers', () => ({
  getOrCreateUser: jest.fn(), getOrCreateSession: jest.fn(() => Promise.resolve('sess-1')),
  updateSessionType: jest.fn(), storeConversation: jest.fn(),
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
// The portal's own sink, for the /go router.
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush() {}, isEnabled: () => true }));

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

const http = require('http');
const express = require('express');

const REAL_FETCH = globalThis.fetch;
const PORTAL = 'https://portal.example.test';
const FROM = '923001234567';
const person = (id, role) => ({
  id, role, name: 'P', first_name: 'P', preferred_language: 'ur', phone_number: FROM,
  registration_completed: true, registration_state: 'completed',
});
const COACH = person('6a1f0c2e-1d0b-4c39-9a4e-0c8f6b2a7d11', 'coach');
const PRINCIPAL = person('7b2e1d3f-2e1c-4d4a-8b5f-1d9a7c3b8e22', 'principal');
const TEACHER = person('8c3f2e4a-3f2d-4e5b-9c6a-2eab8d4c9f33', 'teacher');

// Production on 23 Oct: the teacher link for every teacher, the leader link for coaches.
const PROD = [
  { key: 'app_redirect_lesson_plan', value: 'teachers' },
  { key: 'portal_teacher_v2', value: 'teachers' },
  { key: 'leader_app_lesson_plan', value: 'coaches' },
];
// Dummy LLM keys keep this file hermetic (bd-i26e96): the classifier's client is built for real; only fetch is faked.
const ENV = {
  OPENAI_API_KEY: 'test-openai',
  OPENROUTER_API_KEY: 'test-openrouter',
  INTERNAL_API_KEY: 'test-internal-key',
  PORTAL_URL: PORTAL,
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  PAKISTAN_LP_FLOW_ID: 'flow-lp',
  // Production's cutover gate: a spoken topic opens the catalogue, not a generated plan.
  LP_612_ENABLED: 'true',
  LP_612_ROUTE_ALL: 'true',
};
const SCRUBBED = ['LLM_JOB_MODELS', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'TRANSCRIPT_QUIZ_ENABLED', 'TRANSCRIPT_QUIZ_FLOW_ID', 'STUDENT_VIDEOS_FLOW_ID', 'E2E_CASSETTE', 'REDIS_URL',
  'LP_612_ENABLED', 'LP_612_ROUTE_ALL', 'LP_CONTEXT_V2_ENABLED', 'OBSERVE_MEWAKA_FLOW_ID', 'APP_STORE_URL'];

let classifierCalls;
let chatCalls;
const saved = {};
let handleVoiceMessage;
let me;

async function load(user, settings = PROD) {
  jest.resetModules();
  me = { ...user };
  mockDb = makeDb({
    users: [{ ...user }],
    app_settings: settings.map((r) => ({ ...r })),
    user_feature_first_use: [],
    lesson_plan_requests: [],
  });
  await require('../../bot/shared/config/model-settings').refresh();
  ({ handleVoiceMessage } = require('../../bot/shared/handlers/voice-message.handler'));
}

async function speak(transcript) {
  global.__LT_TRANSCRIPT = transcript;
  await handleVoiceMessage({ id: 'wamid.1', audio: { id: 'media-1', mime_type: 'audio/ogg' } }, FROM, { ...me });
  await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  for (const k of [...SCRUBBED, ...Object.keys(ENV)]) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, ENV);
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
      // The classifier reads the note as a lesson-plan request; any other completion is the spoken answer.
      const content = isClassifier ? 'lesson_plan' : 'یہ رہا آپ کا جواب۔';
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

// GET /go through the real router: where the link the coach was sent actually lands.
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
async function tap(url, { teacherApp = false, coachApp = false } = {}) {
  const token = url.slice(`${PORTAL}/go/`.length);
  const sessions = [];
  const a = express();
  a.use((req, _res, next) => {
    const s = { regenerate(cb) { cb(); }, save(cb) { cb(); } };
    req.session = s; sessions.push(s); next();
  });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => (id === me.id ? { id: me.id, name: 'P' } : null),
    isTeacherV2: async () => teacherApp,
    isCoachApp: async () => coachApp,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  const res = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: `/go/${token}` }, (r) => {
      r.resume(); r.on('end', () => resolve({ status: r.statusCode, location: r.headers.location }));
    }).on('error', reject);
  });
  return { ...res, session: sessions[0] };
}

const ctas = () => mockWa.sendCtaUrl.mock.calls;
const lpFlows = () => mockWa.sendFlow.mock.calls.filter(([, o]) => o && o.flowId === 'flow-lp');
const linkTarget = (url) => require('../../bot/shared/services/app-login-link').verifyAppLink(url.slice(`${PORTAL}/go/`.length)).f;
const funnelRows = (name) => require('../../bot/shared/utils/logger').logToFile.mock.calls.filter(([n]) => n === name).map(([, p]) => p);
const TOPIC = 'mujhe fractions par lesson plan chahiye';
const textbookLine = () => require('../../bot/shared/config/ux-strings').resolveUx('lp612RouteRedirect', { language: 'ur' });
const texts = () => mockWa.sendMessage.mock.calls.map(([, t]) => t);

describe('a coach under "coaches" who speaks a topic', () => {
  test('ONE message: the Lesson Plans tab button, in Urdu. No spoken answer, no sticker, no catalogue Flow', async () => {
    await load(COACH);
    await speak(TOPIC);
    expect(classifierCalls).toHaveLength(1);
    expect(ctas()).toHaveLength(1);
    const [to, { body, buttonText, url }] = ctas()[0];
    expect(to).toBe(FROM);
    expect(body).toBe('وہ لیسن پلان پڑھیں جو آپ کے اساتذہ کو ملتے ہیں۔');
    expect(buttonText).toBe('لیسن پلان');
    expect(linkTarget(url)).toBe('leader_lessons');
    expect(chatCalls).toHaveLength(0);
    expect(mockWa.sendAudio).not.toHaveBeenCalled();
    expect(mockWa.sendSticker).not.toHaveBeenCalled();
    expect(mockWa.sendFlow).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).not.toHaveBeenCalled();

    const res = await tap(url, { coachApp: true });
    expect(res.status).toBe(303);
    expect(res.location).toBe('/portal/teacher/lessons');
    expect(res.session).toEqual(expect.objectContaining({ portalUserId: COACH.id, isPortalAuth: true }));

    // ONE funnel journey, lesson_plan@leader, through the voice door.
    const cmds = funnelRows('app_funnel.command');
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toEqual(expect.objectContaining({ feature: 'lesson_plan', door: 'voice_intent', verdict: 'link', audience: 'leader' }));
    expect(funnelRows('app_funnel.link_sent')).toEqual([expect.objectContaining({ audience: 'leader', via: 'cta_url' })]);
    expect(res.session.appJourney).toEqual(expect.objectContaining({ id: cmds[0].journeyId, feature: 'leader_lessons' }));
  });

  test('an analytics-only coach keeps today\'s path: the spoken answer, the textbook line, then the catalogue Flow, no link', async () => {
    await load(COACH, [...PROD, { key: 'portal_analytics_only', value: [COACH.id] }]);
    await speak(TOPIC);
    expect(ctas()).toHaveLength(0);
    expect(chatCalls.length).toBeGreaterThan(0);
    expect(texts()).toContain(textbookLine());
    expect(lpFlows()).toHaveLength(1);
    expect(require('../../bot/shared/utils/logger').logToFile).toHaveBeenCalledWith(
      expect.stringMatching(/Leader app link: not for this user/), expect.objectContaining({ why: 'analytics_only' }));
  });
});

describe('who speaks a topic and is not a covered coach: exactly as before', () => {
  test('a principal under "coaches": the spoken answer, the sticker, the textbook line, then the catalogue Flow, no link', async () => {
    await load(PRINCIPAL);
    await speak(TOPIC);
    expect(ctas()).toHaveLength(0);
    expect(chatCalls.length).toBeGreaterThan(0);
    expect(mockWa.sendAudio).toHaveBeenCalled();
    expect(mockWa.sendSticker).toHaveBeenCalled();
    expect(texts()).toContain(textbookLine());
    expect(lpFlows()).toHaveLength(1);
  });

  test('a teacher: the teacher link to her own lesson plans, nothing else', async () => {
    await load(TEACHER);
    await speak(TOPIC);
    expect(ctas()).toHaveLength(1);
    const [, { body, url }] = ctas()[0];
    expect(body).toBe('اپنے لیسن پلان کھولیں۔');
    expect(linkTarget(url)).toBe('lesson_plan');
    expect(chatCalls).toHaveLength(0);
    expect(lpFlows()).toHaveLength(0);
    expect(funnelRows('app_funnel.command')).toEqual([
      expect.objectContaining({ feature: 'lesson_plan', door: 'voice_intent', verdict: 'link', audience: 'teacher' }),
    ]);
  });
});
