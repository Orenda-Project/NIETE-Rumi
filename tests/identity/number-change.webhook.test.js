'use strict';
/**
 * A WhatsApp number change reaches the move through the REAL webhook: after the recorder, carrying the request's own
 * signature verdict, and the bot still answers nothing.
 *
 * Meta posts a `type: "system"` message when a teacher uses WhatsApp's "Change number". The webhook's last `else`
 * hands it to identity-events.recordSystem (log only), then to number-change.applyNumberChange with
 * `signatureOk: req.webhookSignatureOk === true`, the verdict webhook-signature recorded on this request. Both are
 * awaited (the ack has already gone) so a deploy's drain waits for a move in flight, and neither can change the reply.
 *
 * Every row POSTs a body to /webhook, signed (or not) the way Meta signs it, and lets the real chain run. Only the
 * edges are doubled: the database (a table fake), Redis (an in-memory map), WhatsApp (records every send), the user
 * lookup, the webhook dedupe, the drain tracker, the resume buttons, the tutor model, the logger (recorded), and the
 * two callees, which record the order they ran in.
 */
const crypto = require('crypto');
const { fixturePhone } = require('../../bot/tests/quiz/web-quiz/fixture-phone');

const SECRET = 'number-change-webhook-test-secret';
const PHONE = fixturePhone(951);
const NEW_PHONE = fixturePhone(952);
const TEACHER = () => ({
  id: 'a0000000-0000-4000-8000-0000000000f5', phone_number: PHONE, name: 'Amina Testwala', role: 'teacher',
  preferred_language: 'en', registration_completed: true, registration_state: 'completed',
});
const UNSUPPORTED_LOG = (type) => `⚠️ Unsupported message type: ${type}`;
const sign = (raw, secret) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

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

/**
 * Loads the real webhook with the signature check in `mode` and the App Secret set (or not). `record` and `move` are
 * what the two callees do; both are recorded with the order they ran in.
 */
async function boot({ mode = 'log', secret = SECRET, record = async () => {}, move = async () => {} } = {}) {
  jest.resetModules();
  process.env.WHATSAPP_WEBHOOK_SIGNATURE_MODE = mode;
  if (secret) process.env.WHATSAPP_APP_SECRET = secret;
  else delete process.env.WHATSAPP_APP_SECRET;
  const store = db({ app_settings: [], users: [TEACHER()] });
  const sent = [];
  const logs = [];
  const works = [];
  const order = [];
  jest.doMock('../../bot/shared/config/supabase', () => store);
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => memRedis());
  jest.doMock('../../bot/shared/utils/web-drain', () => ({
    trackWebhookWork: (w) => { const p = Promise.resolve(w); works.push(p); return p; },
    installWebDrain: () => {}, inFlightCount: () => 0, waitForIdle: async () => true,
  }));
  jest.doMock('../../bot/shared/utils/logger', () => ({
    ...jest.requireActual('../../bot/shared/utils/logger'),
    logToFile: jest.fn((msg, data) => { logs.push({ msg, data }); }),
  }));
  const rec = (kind) => jest.fn(async (to, p) => { sent.push({ kind, to, p }); return true; });
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: rec('text'), sendInteractiveButtons: rec('buttons'), sendInteractiveMessage: rec('list'),
    sendFlow: rec('flow'), sendCtaUrl: rec('cta'), sendTemplate: rec('template'),
    sendImageFromBuffer: rec('image'), sendReaction: jest.fn(async () => true), showTypingIndicator: jest.fn(async () => true),
    startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })), downloadMedia: jest.fn(async () => Buffer.from('x')),
    markAsRead: jest.fn(async () => true), sendDocument: rec('doc'), sendImage: rec('image'), sendVideo: rec('video'),
  }));
  jest.doMock('../../bot/shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn(async (phone) => ({ ...((store.tables.users || []).find((u) => u.phone_number === phone) || {}) })),
    trackChatStart: jest.fn(async () => true),
    getOrCreateSession: jest.fn(async () => 'sess-1'),
    storeConversation: jest.fn(async () => true),
  }));
  jest.doMock('../../bot/shared/services/session.service', () => ({
    isProcessed: jest.fn(async () => false), markAsProcessed: jest.fn(async () => true), getReactionEmoji: jest.fn(() => '👍'),
  }));
  jest.doMock('../../bot/shared/services/conversation-resume.service', () => ({ handleResumeButton: jest.fn(async () => false) }));
  jest.doMock('../../bot/shared/services/openai.service', () => ({
    getResponseWithFormat: jest.fn(async () => 'tutor reply'), getConversationHistory: jest.fn(async () => []),
    detectIntent: jest.fn(async () => ({ intent: 'general' })),
  }));
  const recorder = jest.fn(async (arg) => { order.push('record'); await record(arg); order.push('recorded'); });
  jest.doMock('../../bot/shared/services/identity/identity-events', () => ({
    recordSystem: recorder, deletedRowResumed: jest.fn(), checkWouldMatch: jest.fn(async () => {}),
  }));
  const mover = jest.fn(async (arg) => { order.push('move'); return move(arg); });
  jest.doMock('../../bot/shared/services/identity/number-change', () => ({ applyNumberChange: mover }));

  const { app } = require('../../bot/whatsapp-bot');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;

  /** Posts one inbound message, signed `signature` ('valid' | 'other' | 'none'); waits until `done()` holds (or 5 s). */
  async function post(message, { signature = 'valid', done }) {
    const before = sent.length;
    const payload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: 'BUSINESS', phone_number_id: '111' },
      messages: [{ from: PHONE, id: `wamid.${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
    } }] }] };
    const raw = JSON.stringify(payload);
    const headers = { 'content-type': 'application/json' };
    if (signature === 'valid') headers['x-hub-signature-256'] = sign(raw, SECRET);
    if (signature === 'other') headers['x-hub-signature-256'] = sign(raw, 'not-the-app-secret');
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', headers, body: raw });
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
  return { post, logs, logged, recorder, mover, order, close: () => new Promise((r) => server.close(r)) };
}

const numberChange = () => ({
  type: 'system',
  system: { body: 'User A changed their number', wa_id: NEW_PHONE, type: 'user_changed_number' },
});
const systemDone = (app) => () => app.logged(UNSUPPORTED_LOG('system'));

// Each boot loads the real webhook and its few hundred modules from scratch; on a loaded machine that alone can pass 30 s.
jest.setTimeout(120000);

afterEach(() => {
  delete process.env.WHATSAPP_WEBHOOK_SIGNATURE_MODE;
  delete process.env.WHATSAPP_APP_SECRET;
});

describe('the webhook hands a number change to the move, after the recorder, with this request\'s signature verdict', () => {
  test('signed by Meta: recorded, then moved with signatureOk true; nothing sent; today\'s log line kept', async () => {
    const app = await boot();
    try {
      const out = await app.post(numberChange(), { done: systemDone(app) });
      expect(app.recorder).toHaveBeenCalledTimes(1);
      expect(app.mover).toHaveBeenCalledTimes(1);
      expect(app.mover.mock.calls[0][0]).toEqual({
        message: expect.objectContaining({ type: 'system', system: expect.objectContaining({ type: 'user_changed_number', wa_id: NEW_PHONE }) }),
        user: expect.objectContaining({ id: TEACHER().id }),
        signatureOk: true,
      });
      expect(app.order).toEqual(['record', 'recorded', 'move']);
      expect(out).toHaveLength(0);
      expect(app.logs.find((l) => l.msg === UNSUPPORTED_LOG('system')).data).toEqual(expect.objectContaining({ replied: false }));
    } finally { await app.close(); }
  });

  test('enforce mode, signed: signatureOk true', async () => {
    const app = await boot({ mode: 'enforce' });
    try {
      await app.post(numberChange(), { done: systemDone(app) });
      expect(app.mover).toHaveBeenCalledTimes(1);
      expect(app.mover.mock.calls[0][0].signatureOk).toBe(true);
    } finally { await app.close(); }
  });

  test('unsigned (log mode lets it through): handed over with signatureOk false', async () => {
    const app = await boot();
    try {
      await app.post(numberChange(), { signature: 'none', done: systemDone(app) });
      expect(app.mover).toHaveBeenCalledTimes(1);
      expect(app.mover.mock.calls[0][0].signatureOk).toBe(false);
    } finally { await app.close(); }
  });

  test('signed with some other secret: signatureOk false', async () => {
    const app = await boot();
    try {
      await app.post(numberChange(), { signature: 'other', done: systemDone(app) });
      expect(app.mover.mock.calls[0][0].signatureOk).toBe(false);
    } finally { await app.close(); }
  });

  test('the check switched off (no verdict at all): signatureOk false, never true', async () => {
    const app = await boot({ mode: 'off' });
    try {
      await app.post(numberChange(), { done: systemDone(app) });
      expect(app.mover.mock.calls[0][0].signatureOk).toBe(false);
    } finally { await app.close(); }
  });

  test('no App Secret on the service (log mode, nothing checked): signatureOk false', async () => {
    const app = await boot({ secret: null });
    try {
      await app.post(numberChange(), { done: systemDone(app) });
      expect(app.mover.mock.calls[0][0].signatureOk).toBe(false);
    } finally { await app.close(); }
  });

  test('the recorder failing does not stop the move being asked, after it', async () => {
    const app = await boot({ record: async () => { throw new Error('recorder down'); } });
    try {
      const out = await app.post(numberChange(), { done: systemDone(app) });
      expect(app.order).toEqual(['record', 'move']);
      expect(app.mover.mock.calls[0][0].signatureOk).toBe(true);
      expect(out).toHaveLength(0);
    } finally { await app.close(); }
  });

  test('the move failing changes nothing: no send, no 500, today\'s log line kept', async () => {
    const app = await boot({ move: async () => { throw new Error('move down'); } });
    try {
      const out = await app.post(numberChange(), { done: systemDone(app) });
      expect(app.mover).toHaveBeenCalledTimes(1);
      expect(out).toHaveLength(0);
      expect(app.logged(UNSUPPORTED_LOG('system'))).toBe(true);
    } finally { await app.close(); }
  });

  test('a sticker is not a system message: neither the recorder nor the move is called', async () => {
    const app = await boot();
    try {
      await app.post({ type: 'sticker', sticker: { id: 'st-1', mime_type: 'image/webp' } }, { done: () => app.logged(UNSUPPORTED_LOG('sticker')) });
      expect(app.logged(UNSUPPORTED_LOG('sticker'))).toBe(true);
      expect(app.recorder).not.toHaveBeenCalled();
      expect(app.mover).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
