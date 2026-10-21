'use strict';
/**
 * A WhatsApp user who has adopted a username writes to the bot for the first time (or after 30 quiet days).
 * Meta then sends the message with NO phone number: `messages[0].from` and `contacts[0].wa_id` are omitted and only
 * the business-scoped user id (`from_user_id`, "KE.…") is set. Before this fix the bot read `from` only, so:
 *  - getOrCreateUser(undefined) missed, tried to INSERT a row with a null phone, and Postgres refused it (23502);
 *  - the catch logged "database unreachable" although the database was up;
 *  - every reply went out with no `to` and Meta refused it, so the user got silence.
 * A sender whose phone IS in the webhook (+254 here, a row that exists) is matched as before — the control rows.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');

// Synthetic numbers, built at runtime (no phone-shaped literal in the repo): a Kenyan-shaped one and a Pakistani one.
const KE_PHONE = '254' + '000' + '000041';
const PK_PHONE = fixturePhone(42);
const BSUID = 'KE.' + 'TESTBSUID' + '41';

function webhookBody({ from, userId = BSUID, waId, body = 'Hi' } = {}) {
  const message = { id: 'wamid.test', timestamp: '1700000000', type: 'text', text: { body } };
  if (from) message.from = from;
  if (userId) message.from_user_id = userId;
  const contact = { profile: { name: 'Coach Testwala' } };
  if (waId) contact.wa_id = waId;
  if (userId) contact.user_id = userId;
  return { entry: [{ changes: [{ value: { metadata: { phone_number_id: '111' }, contacts: [contact], messages: [message] } }] }] };
}

describe('validateWebhookMessage: the sender of a username user', () => {
  const { validateWebhookMessage } = require('../../shared/utils/validators');

  test('no phone in the webhook: from is empty and the business-scoped id is carried', () => {
    const v = validateWebhookMessage({ body: webhookBody() });
    expect(v.from).toBeUndefined();
    expect(v.fromUserId).toBe(BSUID);
  });

  test('messages[].from absent but contacts[].wa_id present: the phone is taken from the contact', () => {
    const v = validateWebhookMessage({ body: webhookBody({ waId: KE_PHONE }) });
    expect(v.from).toBe(KE_PHONE);
    expect(v.fromUserId).toBe(BSUID);
  });

  test('control: a phone in messages[].from is used as before', () => {
    const v = validateWebhookMessage({ body: webhookBody({ from: PK_PHONE, userId: null }) });
    expect(v.from).toBe(PK_PHONE);
    expect(v.fromUserId).toBeNull();
  });
});

describe('getOrCreateUser', () => {
  // `lateRows`: rows another request wrote between this lookup and this insert (the first-message race): invisible to
  // the first read, a unique-key clash on insert, found by any read after it.
  function supabaseWith(rows, lateRows = []) {
    const inserts = [];
    let reads = 0;
    const from = jest.fn(() => {
      let match;
      const q = {
        select: () => q,
        eq: (col, val) => { reads += 1; match = [...rows, ...(reads > 1 ? lateRows : [])].find((r) => r[col] === val); return q; },
        single: async () => (match ? { data: match, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }),
        update: () => ({ eq: async () => ({ error: null }) }),
        insert: (row) => {
          inserts.push(row);
          return { select: () => ({ single: async () => (row.phone_number == null
            ? { data: null, error: { code: '23502', message: 'null value in column "phone_number" of relation "users" violates not-null constraint' } }
            : lateRows.some((r) => r.phone_number === row.phone_number)
              ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "users_phone_number_key"' } }
              : { data: { id: 'u-new', ...row }, error: null }) }) };
        },
      };
      return q;
    });
    return { from, inserts };
  }

  function load(rows, lateRows) {
    jest.resetModules();
    const db = supabaseWith(rows, lateRows);
    jest.doMock('../../shared/config/supabase', () => db);
    return { ...require('../../shared/database/bot-helpers'), db };
  }

  test('no phone: refuses with NO_PHONE and never tries to insert a row', async () => {
    const { getOrCreateUser, db } = load([]);
    await expect(getOrCreateUser(undefined)).rejects.toMatchObject({ code: 'NO_PHONE' });
    expect(db.inserts).toHaveLength(0);
  });

  test('control: a +254 coach whose row exists is matched, nothing is created', async () => {
    const { getOrCreateUser, db } = load([{ id: 'u-ke', phone_number: KE_PHONE, role: 'coach' }]);
    const user = await getOrCreateUser(KE_PHONE);
    expect(user.id).toBe('u-ke');
    expect(db.inserts).toHaveLength(0);
  });

  test('a duplicate phone on create (another request made the row first) re-reads and returns that row', async () => {
    const { getOrCreateUser, db } = load([], [{ id: 'u-raced', phone_number: KE_PHONE, role: 'coach' }]);
    const user = await getOrCreateUser(KE_PHONE);
    expect(user.id).toBe('u-raced');
    expect(db.inserts).toHaveLength(1);
  });

  test('control: a Pakistani phone with no row is created as before', async () => {
    const { getOrCreateUser, db } = load([]);
    const user = await getOrCreateUser(PK_PHONE);
    expect(user.id).toBe('u-new');
    expect(db.inserts).toEqual([expect.objectContaining({ phone_number: PK_PHONE })]);
  });
});

describe('describeLookupFailure: the log names the real state', () => {
  const { describeLookupFailure } = require('../../shared/services/phoneless-inbound');

  test.each([
    [{ code: 'NO_PHONE' }, /no phone number in the webhook/],
    [{ code: '23502' }, /not-null/],
    [{ code: '23505' }, /unique-key clash/],
    [{ code: 'PGRST301' }, /database unreachable/],
    [new Error('fetch failed'), /database unreachable/],
  ])('%j', (err, rx) => {
    expect(describeLookupFailure(err)).toMatch(rx);
  });
});

describe('the phoneless door (switch whatsapp_bsuid_reply)', () => {
  function load(switchValue) {
    jest.resetModules();
    const logs = [];
    const sends = [];
    jest.doMock('../../shared/config/supabase', () => ({
      from: () => ({ select: () => ({ eq: async () => ({ data: switchValue === undefined ? [] : [{ key: 'whatsapp_bsuid_reply', value: switchValue }], error: null }) }) }),
    }));
    jest.doMock('../../shared/utils/logger', () => ({
      logToFile: (m, d) => logs.push({ level: 'info', m, d }),
      logError: (m, d) => logs.push({ level: 'error', m, d }),
    }));
    const wa = { sendTextToUserId: jest.fn(async (id, text) => { sends.push({ id, text }); return true; }) };
    const door = require('../../shared/services/phoneless-inbound');
    return { door, wa, logs, sends };
  }

  test('OFF (absent): handled — no lookup, no reply, one honest log line', async () => {
    const { door, wa, logs } = load(undefined);
    const handled = await door.handlePhonelessInbound({ from: undefined, fromUserId: BSUID, messageType: 'text' }, { WhatsAppService: wa });
    expect(handled).toBe(true);
    expect(wa.sendTextToUserId).not.toHaveBeenCalled();
    expect(logs.map((l) => l.m).join(' ')).toMatch(/no phone number/);
    expect(logs.map((l) => l.m).join(' ')).not.toMatch(/database unreachable/);
    expect(JSON.stringify(logs)).not.toContain(BSUID);   // the id is never logged whole
  });

  test('ON: ONE reply addressed to the business-scoped id, in Urdu and English', async () => {
    const { door, wa, sends } = load(true);
    await door.handlePhonelessInbound({ from: undefined, fromUserId: BSUID, messageType: 'text' }, { WhatsAppService: wa });
    expect(sends).toHaveLength(1);
    expect(sends[0].id).toBe(BSUID);
    expect(sends[0].text).toMatch(/[؀-ۿ]/);
    expect(sends[0].text).toMatch(/send your message again/i);
    expect(sends[0].text.length).toBeLessThan(1024);
  });

  test('a webhook with a phone is not this door', async () => {
    const { door, wa } = load(true);
    expect(await door.handlePhonelessInbound({ from: KE_PHONE, fromUserId: BSUID }, { WhatsAppService: wa })).toBe(false);
    expect(wa.sendTextToUserId).not.toHaveBeenCalled();
  });
});

describe('WhatsAppService.sendTextToUserId', () => {
  test('posts `recipient` (the business-scoped id) and no `to`', async () => {
    jest.resetModules();
    jest.dontMock('../../shared/utils/logger');
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = jest.fn(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.out' }] }) }; });
    try {
      const WA = require('../../shared/services/whatsapp.service');
      expect(await WA.sendTextToUserId(BSUID, 'hello')).toBe(true);
      const sent = calls.find((c) => /\/messages$/.test(c.url));
      expect(sent.body).toMatchObject({ messaging_product: 'whatsapp', recipient: BSUID, type: 'text', text: { body: 'hello' } });
      expect(sent.body).not.toHaveProperty('to');
    } finally { globalThis.fetch = real; }
  });
});

describe('the real webhook (POST /webhook), edges doubled', () => {
  jest.setTimeout(120000);   // boots the whole bot

  async function boot({ users = [], switchOn = false } = {}) {
    jest.resetModules();
    jest.dontMock('../../shared/utils/logger');
    const { tableDouble } = require('../helpers/table-double');
    const store = tableDouble({ users, app_settings: switchOn ? [{ key: 'whatsapp_bsuid_reply', value: true }] : [] });
    const sent = [];
    const works = [];
    const lookups = [];
    const rec = (kind) => jest.fn(async (to, p) => { sent.push({ kind, to, p }); return true; });
    jest.doMock('../../shared/config/supabase', () => store);
    jest.doMock('../../shared/services/cache/railway-redis.service', () => new Proxy({ checkRateLimit: async () => ({ allowed: true, count: 1 }), isAvailable: () => true }, { get: (t, k) => (k in t ? t[k] : async () => null) }));
    jest.doMock('../../shared/utils/web-drain', () => ({
      trackWebhookWork: (w) => { const p = Promise.resolve(w); works.push(p); return p; },
      installWebDrain: () => {}, inFlightCount: () => 0, waitForIdle: async () => true,
    }));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: rec('text'), sendTextToUserId: rec('to_user_id'), sendInteractiveButtons: rec('buttons'), sendInteractiveMessage: rec('list'),
      sendFlow: rec('flow'), sendCtaUrl: rec('cta'), sendTemplate: jest.fn(async () => true), sendReaction: jest.fn(async () => true),
      showTypingIndicator: jest.fn(async () => true), startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
      markAsRead: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/database/bot-helpers', () => ({
      getOrCreateUser: jest.fn(async (phone) => { lookups.push(phone); return { ...(users.find((u) => u.phone_number === phone) || { id: 'u-new', phone_number: phone }) }; }),
      trackChatStart: jest.fn(async () => true), getOrCreateSession: jest.fn(async () => 'sess-1'), storeConversation: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/session.service', () => ({
      isProcessed: jest.fn(async () => false), markAsProcessed: jest.fn(async () => true), getReactionEmoji: jest.fn(() => '👍'),
    }));
    jest.doMock('../../shared/services/openai.service', () => ({
      getResponseWithFormat: jest.fn(async () => 'a reply'), getConversationHistory: jest.fn(async () => []),
      detectIntent: jest.fn(async () => ({ intent: 'general' })),
    }));
    const { app } = require('../../whatsapp-bot');
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const post = async (payload) => {
      const before = sent.length;
      const res = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      expect(res.status).toBe(200);
      const deadline = Date.now() + 8000;
      do { await new Promise((r) => setTimeout(r, 40)); await Promise.allSettled(works); } while (sent.length === before && Date.now() < deadline);
      await new Promise((r) => setTimeout(r, 60));
      return sent.slice(before);
    };
    return { post, lookups, close: () => new Promise((r) => server.close(r)) };
  }

  const payload = (opts) => {
    const b = webhookBody(opts);
    b.object = 'whatsapp_business_account';
    b.entry[0].id = '1';
    b.entry[0].changes[0].field = 'messages';
    b.entry[0].changes[0].value.messaging_product = 'whatsapp';
    b.entry[0].changes[0].value.messages[0].id = `wamid.${Math.random().toString(36).slice(2)}`;
    b.entry[0].changes[0].value.messages[0].timestamp = String(Math.floor(Date.now() / 1000));
    return b;
  };

  test('phoneless, switch OFF: no user lookup, nothing sent to an undefined number', async () => {
    const bot = await boot();
    try {
      const out = await bot.post(payload({ body: '/menu' }));
      expect(bot.lookups).toHaveLength(0);
      expect(out.filter((s) => s.to === undefined)).toHaveLength(0);
      expect(out).toHaveLength(0);
    } finally { await bot.close(); }
  });

  test('phoneless, switch ON: ONE reply to the business-scoped id', async () => {
    const bot = await boot({ switchOn: true });
    try {
      const out = await bot.post(payload({ body: 'Hi' }));
      expect(bot.lookups).toHaveLength(0);
      expect(out).toEqual([expect.objectContaining({ kind: 'to_user_id', to: BSUID })]);
    } finally { await bot.close(); }
  });

  test('control: the same +254 coach WITH a phone in the webhook is matched and answered by phone', async () => {
    const coach = { id: 'u-ke', phone_number: KE_PHONE, role: 'coach', name: 'Coach Testwala', registration_completed: true, preferred_language: 'en' };
    const bot = await boot({ users: [coach], switchOn: true });
    try {
      const out = await bot.post(payload({ from: KE_PHONE, body: '/menu' }));
      expect(bot.lookups[0]).toBe(KE_PHONE);
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((s) => s.to === KE_PHONE)).toBe(true);
    } finally { await bot.close(); }
  });
});
