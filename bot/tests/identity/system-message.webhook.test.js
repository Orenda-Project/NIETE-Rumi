'use strict';
/**
 * A WhatsApp number change reaches the identity recorder through the REAL webhook, and is still never answered.
 *
 * Meta posts a `type: "system"` message when a teacher uses WhatsApp's "Change number". The webhook's last `else`
 * sent it to unsupportedTypeReply, which returns nothing for 'system', so the change vanished. The line under test is
 * the hook in whatsapp-bot.js that hands it to identity-events.recordSystem first.
 *
 * Every row POSTs to /webhook and lets the real chain run. Only the edges are doubled: the database (a table fake),
 * Redis (an in-memory map), WhatsApp (records every send), the user lookup, the webhook dedupe, the drain tracker,
 * the resume buttons, the tutor model, the logger (recorded) and the recorder itself (the callee).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');

const PHONE = fixturePhone(941);
const NEW_PHONE = fixturePhone(942);
const TEACHER = () => ({
  id: 'a0000000-0000-4000-8000-0000000000f4', phone_number: PHONE, name: 'Amina Testwala', role: 'teacher',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
});
const UNSUPPORTED_LOG = (type) => `⚠️ Unsupported message type: ${type}`;

/** The fake database: rows by table; filters ignored beyond `eq`; writes accepted. */
function db(tables) {
  return {
    tables,
    rpc: async () => ({ data: null, error: null }),
    from(table) {
      const filters = [];
      let head = false; let write = false;
      const b = {};
      b.select = (c, o) => { head = Boolean(o && o.head); return b; };
      b.eq = (c, v) => { filters.push([c, v]); return b; };
      ['in', 'is', 'order', 'limit', 'range', 'not', 'gte', 'lte', 'gt', 'lt', 'or', 'neq', 'ilike', 'like', 'contains', 'filter', 'match']
        .forEach((m) => { b[m] = () => b; });
      ['update', 'insert', 'upsert', 'delete'].forEach((m) => { b[m] = () => { write = true; return b; }; });
      const run = () => {
        if (write) return { data: [], error: null };
        const rows = (tables[table] || []).filter((r) => filters.every(([c, v]) => String(r[c]) === String(v)));
        return head ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null };
      };
      b.maybeSingle = async () => { const r = run(); return { data: (r.data || [])[0] || null, error: null }; };
      b.single = b.maybeSingle;
      b.then = (ok, ko) => Promise.resolve(run()).then(ok, ko);
      return b;
    },
  };
}

function memRedis() {
  const m = new Map();
  const api = {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => { m.set(k, v); return true; },
    setex: async (k, ttl, v) => { m.set(k, v); return true; },
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

async function boot(recordSystem) {
  jest.resetModules();
  const store = db({ app_settings: [], users: [TEACHER()] });
  const sent = [];
  const logs = [];
  const works = [];
  jest.doMock('../../shared/config/supabase', () => store);
  jest.doMock('../../shared/services/cache/railway-redis.service', () => memRedis());
  jest.doMock('../../shared/utils/web-drain', () => ({
    trackWebhookWork: (w) => { const p = Promise.resolve(w); works.push(p); return p; },
    installWebDrain: () => {}, inFlightCount: () => 0, waitForIdle: async () => true,
  }));
  jest.doMock('../../shared/utils/logger', () => ({
    ...jest.requireActual('../../shared/utils/logger'),
    logToFile: jest.fn((msg, data) => { logs.push({ msg, data }); }),
  }));
  const rec = (kind) => jest.fn(async (to, p) => { sent.push({ kind, to, p }); return true; });
  jest.doMock('../../shared/services/whatsapp.service', () => ({
    sendMessage: rec('text'), sendInteractiveButtons: rec('buttons'), sendInteractiveMessage: rec('list'),
    sendFlow: rec('flow'), sendCtaUrl: rec('cta'), sendTemplate: rec('template'),
    sendImageFromBuffer: rec('image'), sendReaction: jest.fn(async () => true), showTypingIndicator: jest.fn(async () => true),
    startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })), downloadMedia: jest.fn(async () => Buffer.from('x')),
    markAsRead: jest.fn(async () => true), sendDocument: rec('doc'), sendImage: rec('image'), sendVideo: rec('video'),
  }));
  jest.doMock('../../shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn(async (phone) => ({ ...((store.tables.users || []).find((u) => u.phone_number === phone) || {}) })),
    trackChatStart: jest.fn(async () => true),
    getOrCreateSession: jest.fn(async () => 'sess-1'),
    storeConversation: jest.fn(async () => true),
  }));
  jest.doMock('../../shared/services/session.service', () => ({
    isProcessed: jest.fn(async () => false), markAsProcessed: jest.fn(async () => true), getReactionEmoji: jest.fn(() => '👍'),
  }));
  jest.doMock('../../shared/services/conversation-resume.service', () => ({ handleResumeButton: jest.fn(async () => false) }));
  jest.doMock('../../shared/services/openai.service', () => ({
    getResponseWithFormat: jest.fn(async () => 'tutor reply'), getConversationHistory: jest.fn(async () => []),
    detectIntent: jest.fn(async () => ({ intent: 'general' })),
  }));
  const recorder = jest.fn(recordSystem);
  jest.doMock('../../shared/services/identity/identity-events', () => ({
    recordSystem: recorder, deletedRowResumed: jest.fn(), checkWouldMatch: jest.fn(async () => {}),
  }));

  const { app } = require('../../whatsapp-bot');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;

  /** Posts one inbound message; waits until `done()` holds (or 5 s), then lets the turn settle. → what was sent. */
  async function post(message, done) {
    const before = sent.length;
    const payload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: 'BUSINESS', phone_number_id: '111' },
      messages: [{ from: PHONE, id: `wamid.${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
    } }] }] };
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(res.status).toBe(200);
    const deadline = Date.now() + 5000;
    await Promise.allSettled(works);
    while (!done() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      await Promise.allSettled(works);
    }
    await new Promise((r) => setTimeout(r, 80));
    await Promise.allSettled(works);
    return sent.slice(before);
  }
  const logged = (msg) => logs.some((l) => l.msg === msg);
  return { post, logs, logged, recorder, close: () => new Promise((r) => server.close(r)) };
}

const numberChange = () => ({
  type: 'system',
  system: { body: 'User A changed their number', wa_id: NEW_PHONE, type: 'user_changed_number' },
});

// Each boot loads the real webhook and its few hundred modules from scratch; on a loaded machine that alone can pass 30 s.
jest.setTimeout(120000);

describe('the webhook hands a system message to the identity recorder', () => {
  test('a number change: recorded once with the message and the teacher, nothing sent, today\'s log line kept', async () => {
    const app = await boot(async () => {});
    try {
      const out = await app.post(numberChange(), () => app.logged(UNSUPPORTED_LOG('system')));
      expect(app.recorder).toHaveBeenCalledTimes(1);
      const [arg] = app.recorder.mock.calls[0];
      expect(arg.message).toEqual(expect.objectContaining({ type: 'system', system: expect.objectContaining({ type: 'user_changed_number' }) }));
      expect(arg.user).toEqual(expect.objectContaining({ id: TEACHER().id }));
      expect(out).toHaveLength(0);
      expect(app.logs.find((l) => l.msg === UNSUPPORTED_LOG('system')).data).toEqual(expect.objectContaining({ replied: false }));
    } finally { await app.close(); }
  });

  test('the recorder failing changes nothing: no send, no 500, today\'s log line kept', async () => {
    const app = await boot(async () => { throw new Error('recorder down'); });
    try {
      const out = await app.post(numberChange(), () => app.logged(UNSUPPORTED_LOG('system')));
      expect(app.recorder).toHaveBeenCalledTimes(1);
      expect(out).toHaveLength(0);
      expect(app.logged(UNSUPPORTED_LOG('system'))).toBe(true);
    } finally { await app.close(); }
  });

  test('a sticker is not a system message: the recorder is never called', async () => {
    const app = await boot(async () => {});
    try {
      await app.post({ type: 'sticker', sticker: { id: 'st-1', mime_type: 'image/webp' } }, () => app.logged(UNSUPPORTED_LOG('sticker')));
      expect(app.logged(UNSUPPORTED_LOG('sticker'))).toBe(true);
      expect(app.recorder).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
