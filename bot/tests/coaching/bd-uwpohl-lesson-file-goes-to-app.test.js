'use strict';
/**
 * bd-uwpohl — a lesson recording sent on WhatsApp as a FILE (audio document) is a coaching request, so it goes
 * through the same app redirect as a voice note: a teacher on the app is sent the link, never the WhatsApp
 * coaching flow. Phones share a 30-minute lesson as a file (voice notes cap at 16 MB), so this is the common door.
 *
 * Drives the REAL webhook (POST /webhook → handleDocumentMessage) with only the edges doubled; the redirect
 * switch is the dial. Short audio files and a school leader's /observe recording are left as they were.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const { tableDouble } = require('../helpers/table-double');

const PHONE = '923001234567';
const TEACHER = { id: 'u-t', phone_number: PHONE, role: 'teacher', name: 'Test Teacher', registration_completed: true, preferred_language: 'ur' };

function memRedis() {
  const m = new Map();
  const api = {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => { m.set(k, v); return true; },
    setex: async (k, _t, v) => { m.set(k, v); return true; },
    setNX: async (k, v) => { if (m.has(k)) return false; m.set(k, v); return true; },
    delete: async (k) => { m.delete(k); return true; },
    del: async (k) => { m.delete(k); return true; },
    exists: async (k) => m.has(k),
    incr: async (k) => { const n = (Number(m.get(k)) || 0) + 1; m.set(k, n); return n; },
    expire: async () => true,
    isAvailable: () => true,
    checkRateLimit: async () => ({ allowed: true, count: 1 }),
  };
  return new Proxy(api, { get: (t, p) => (p in t ? t[p] : async () => null) });
}

async function boot({ redirects, seconds, leaderTakesIt = false }) {
  jest.resetModules();
  const works = [];
  const redirect = jest.fn(async () => redirects);
  const initiate = jest.fn(async () => true);
  const leader = jest.fn(async () => leaderTakesIt);
  const voice = jest.fn(async () => true);
  jest.doMock('../../shared/config/supabase', () => tableDouble({ users: [TEACHER], app_settings: [] }));
  jest.doMock('../../shared/services/cache/railway-redis.service', () => memRedis());
  jest.doMock('../../shared/utils/web-drain', () => ({
    trackWebhookWork: (w) => { const p = Promise.resolve(w); works.push(p); return p; },
    installWebDrain: () => {}, inFlightCount: () => 0, waitForIdle: async () => true,
  }));
  jest.doMock('../../shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
    sendInteractiveMessage: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true),
    sendReaction: jest.fn(async () => true), showTypingIndicator: jest.fn(async () => true),
    startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })), markAsRead: jest.fn(async () => true),
    getMediaInfo: jest.fn(async () => ({ file_size: 30 * 1024 * 1024 })),
    downloadMedia: jest.fn(async () => Buffer.from('audio-bytes')),
  }));
  jest.doMock('../../shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn(async () => ({ ...TEACHER })),
    trackChatStart: jest.fn(async () => true),
    getOrCreateSession: jest.fn(async () => 'sess-1'),
    storeConversation: jest.fn(async () => true),
  }));
  jest.doMock('../../shared/services/session.service', () => ({
    isProcessed: jest.fn(async () => false), markAsProcessed: jest.fn(async () => true), getReactionEmoji: jest.fn(() => '👍'),
  }));
  jest.doMock('../../shared/services/conversation-resume.service', () => ({ handleResumeButton: jest.fn(async () => false) }));
  jest.doMock('../../shared/services/audio.service', () => ({ getAudioDuration: jest.fn(async () => seconds) }));
  jest.doMock('../../shared/services/app-redirect.service', () => ({
    ...jest.requireActual('../../shared/services/app-redirect.service'),
    redirectIfFlagged: redirect,
  }));
  jest.doMock('../../shared/services/coaching-orchestrator.service', () => ({ initiateCoachingSession: initiate }));
  jest.doMock('../../shared/services/observe/observe-audio-router', () => ({
    ...jest.requireActual('../../shared/services/observe/observe-audio-router'),
    routeLeaderAudio: leader,
  }));
  jest.doMock('../../shared/handlers/voice-message.handler', () => ({
    ...jest.requireActual('../../shared/handlers/voice-message.handler'),
    handleVoiceMessage: voice,
  }));
  const { app } = require('../../whatsapp-bot');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  async function sendFile() {
    const payload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: '111' },
      messages: [{ from: PHONE, id: `wamid.${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'document', document: { id: 'media-doc-1', mime_type: 'audio/mp4', filename: 'lesson.m4a' } }],
    } }] }] };
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(res.status).toBe(200);
    const deadline = Date.now() + 8000;
    const settled = () => initiate.mock.calls.length || leader.mock.calls.length || voice.mock.calls.length
      || redirect.mock.calls.some((c) => c[0] === 'ai_coaching');
    while (!settled() && Date.now() < deadline) {
      await Promise.allSettled(works);
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 60));
    await Promise.allSettled(works);
  }
  return { sendFile, redirect, initiate, leader, voice, close: () => new Promise((r) => server.close(r)) };
}

jest.setTimeout(180000);   // each row boots the whole bot

describe('a 30-minute lesson sent as a file', () => {
  test('a teacher the redirect covers is sent to the app; nothing is analysed on WhatsApp', async () => {
    const bot = await boot({ redirects: true, seconds: 1800 });
    try {
      await bot.sendFile();
      expect(bot.redirect).toHaveBeenCalledWith('ai_coaching', expect.objectContaining({ userId: 'u-t', from: PHONE, reason: 'classroom_audio_document' }));
      expect(bot.initiate).not.toHaveBeenCalled();
    } finally { await bot.close(); }
  });

  test('redirect off for her: analysed on WhatsApp, as today', async () => {
    const bot = await boot({ redirects: false, seconds: 1800 });
    try {
      await bot.sendFile();
      expect(bot.initiate).toHaveBeenCalledWith('u-t', 'sess-1', 'media-doc-1', PHONE, 1800);
    } finally { await bot.close(); }
  });

  test('a school leader\'s /observe recording still goes to /observe, never redirected', async () => {
    const bot = await boot({ redirects: true, seconds: 1800, leaderTakesIt: true });
    try {
      await bot.sendFile();
      expect(bot.leader).toHaveBeenCalled();
      expect(bot.redirect).not.toHaveBeenCalledWith('ai_coaching', expect.anything());
      expect(bot.initiate).not.toHaveBeenCalled();
    } finally { await bot.close(); }
  });
});

describe('a short audio file is not a lesson', () => {
  test('a 2-minute file is never redirected to coaching', async () => {
    const bot = await boot({ redirects: true, seconds: 120 });
    try {
      await bot.sendFile();
      expect(bot.redirect).not.toHaveBeenCalledWith('ai_coaching', expect.anything());
      expect(bot.initiate).not.toHaveBeenCalled();
    } finally { await bot.close(); }
  });
});
