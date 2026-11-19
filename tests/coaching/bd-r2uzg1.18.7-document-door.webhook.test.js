'use strict';
/**
 * bd-r2uzg1.18.7 — the webhook's DOCUMENT door, driven for real (POST /webhook → handleDocumentMessage).
 *
 * A teacher sent her lesson from the recording screen without a plan; then she sends the plan here as a PDF. No session
 * is waiting for it (the lesson-plan step is a WhatsApp lesson's), so it used to get "I received your document … send
 * me a classroom audio recording first". Now it gets the one message with the Digital Coaching button. A teacher whose
 * latest lesson was a WhatsApp recording keeps today's reply.
 *
 * Only the edges are doubled (Supabase as a table double, Redis in memory, WhatsApp sends recorded); the media-attach
 * resolver, the audio-document router and the service run for real. Each case boots the whole bot, so there are two.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-key';

const { tableDouble } = require('../../bot/tests/helpers/table-double');

// No model is called on this path. The provider factory is stubbed whole, so the suite does not need the model SDKs
// installed (a checkout without @anthropic-ai/sdk fails on the moduleNameMapper before any mock of the SDK applies).
jest.mock('../../bot/shared/services/llm-client', () => new Proxy({}, {
  get: (_t, p) => (p === '__esModule' ? false : () => ({ chat: { completions: { create: async () => { throw new Error('not used'); } } } })),
}));

const PHONE = '923001239876';
const TEACHER = {
  id: 'u-doc-1', phone_number: PHONE, role: 'teacher', name: 'Test Teacher', first_name: 'Test',
  registration_completed: true, registration_state: 'completed', preferred_language: 'en',
};
const HOUR = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const APP_AUDIO = 'https://r2.example/classroom_audio/u-doc-1/2026-11/portal_9a8b7c6d-1111-2222-3333-444455556666.webm';
const WA_AUDIO = 'https://r2.example/classroom_audio/sess-9_1795000000000.ogg';

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

async function boot(sessions) {
  jest.resetModules();
  process.env.PORTAL_URL = 'https://portal.example';
  const works = [];
  const wa = {
    sendMessage: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true),
    sendInteractiveButtons: jest.fn(async () => true), sendInteractiveMessage: jest.fn(async () => true),
  };
  jest.doMock('../../bot/shared/config/supabase', () => tableDouble({
    users: [{ ...TEACHER }], app_settings: [], coaching_sessions: sessions,
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => memRedis());
  jest.doMock('../../bot/shared/utils/web-drain', () => ({
    trackWebhookWork: (w) => { const p = Promise.resolve(w); works.push(p); return p; },
    installWebDrain: () => {}, inFlightCount: () => 0, waitForIdle: async () => true,
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: wa.sendMessage, sendCtaUrl: wa.sendCtaUrl,
    sendInteractiveButtons: wa.sendInteractiveButtons, sendInteractiveMessage: wa.sendInteractiveMessage,
    sendReaction: jest.fn(async () => true), showTypingIndicator: jest.fn(async () => true),
    startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })), markAsRead: jest.fn(async () => true),
    getMediaInfo: jest.fn(async () => ({ file_size: 200 * 1024 })),
    downloadMedia: jest.fn(async () => Buffer.from('%PDF-1.4')),
  }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn(async () => ({ ...TEACHER })),
    trackChatStart: jest.fn(async () => true),
    getOrCreateSession: jest.fn(async () => 'sess-1'),
    storeConversation: jest.fn(async () => true),
  }));
  jest.doMock('../../bot/shared/services/session.service', () => ({
    isProcessed: jest.fn(async () => false), markAsProcessed: jest.fn(async () => true), getReactionEmoji: jest.fn(() => '👍'),
  }));
  jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({ handleResumeButton: jest.fn(async () => false) }));
  jest.doMock('../../bot/shared/utils/language-cache', () => ({
    ...jest.requireActual('../../bot/shared/utils/language-cache'),
    getUserLanguage: jest.fn(async () => 'en'),
  }));
  const { app } = require('../../bot/whatsapp-bot');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  async function sendPdf() {
    const payload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: '111' },
      messages: [{ from: PHONE, id: `wamid.${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'document', document: { id: 'media-pdf-1', mime_type: 'application/pdf', filename: 'lesson-plan.pdf' } }],
    } }] }] };
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(res.status).toBe(200);
    const deadline = Date.now() + 8000;
    const settled = () => wa.sendCtaUrl.mock.calls.length || wa.sendMessage.mock.calls.length;
    while (!settled() && Date.now() < deadline) {
      await Promise.allSettled(works);
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 60));
    await Promise.allSettled(works);
  }
  return { sendPdf, wa, close: () => new Promise((r) => server.close(r)) };
}

jest.setTimeout(180000); // each case boots the whole bot

const RECEIVED = /I received your document/;

test('a plan sent as a PDF after a lesson sent from the recording screen → the one message with the button', async () => {
  const bot = await boot([{ id: 'cs-app-9', user_id: TEACHER.id, audio_url: APP_AUDIO, observation_type: null,
    status: 'completed', created_at: iso(Date.now() - 3 * HOUR) }]);
  try {
    await bot.sendPdf();
    expect(bot.wa.sendCtaUrl).toHaveBeenCalledTimes(1);
    const [to, { body, url }] = bot.wa.sendCtaUrl.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(body).toMatch(/recording screen/);
    expect(url).toMatch(/^https:\/\/portal\.example\/go\//);
    expect(bot.wa.sendMessage.mock.calls.filter(([, b]) => RECEIVED.test(String(b)))).toHaveLength(0);
  } finally { await bot.close(); }
});

test('her latest lesson was a WhatsApp recording → today\'s reply, no button', async () => {
  const bot = await boot([{ id: 'cs-wa-9', user_id: TEACHER.id, audio_url: WA_AUDIO, observation_type: null,
    status: 'completed', created_at: iso(Date.now() - 3 * HOUR) }]);
  try {
    await bot.sendPdf();
    expect(bot.wa.sendCtaUrl).not.toHaveBeenCalled();
    expect(bot.wa.sendMessage.mock.calls.filter(([, b]) => RECEIVED.test(String(b)))).toHaveLength(1);
  } finally { await bot.close(); }
});
