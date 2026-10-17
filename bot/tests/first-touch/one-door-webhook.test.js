'use strict';
/**
 * The one door through the REAL webhook (POST /webhook → getOrCreateUser → student ingress → the text handler →
 * openQuizMenu → the one door → the ledger → WhatsApp), with only the edges doubled (the table fake and the in-memory
 * Redis of the child-home webhook test; WhatsApp records every send). Per persona, switch OFF (today) vs ON:
 *  - a phone the bot has never seen: OFF 2 replies (the empty list + the registration Flow) → ON exactly 1 cta_url
 *    to /quiz/go/<token>, nothing after it;
 *  - a coach: OFF the role menu → ON 1 cta_url with the teacher words;
 *  - a known child: OFF today's "Home" reply → ON the same ONE hub link with the child words (no retired door word);
 *  - the bot's own name «جگنو» / `jugnu` is not a quiz request, ON or OFF;
 *  - the 9th /quiz with the shared 8-a-day pool spent still gets its link (its own counter) — for an unknown phone,
 *    for a known child's hub reply, and for a binder reply (STOP with nothing saved; a code that saves the child):
 *    OFF those are capped as today;
 *  - with Keep my place ON too, its way-back line is recorded once on the own counter and sent once.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-secret-one-door-webhook';
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';
process.env.STUDENT_MODE_ENABLED = 'true';
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
process.env.REGISTRATION_FLOW_ID = 'reg-flow-1';
process.env.WQ_TOMB_SALT = 'unit-salt-not-a-secret';
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');

const PHONE = fixturePhone(41);
const ROW = { registration_completed: false, registration_state: null, name: null, teacher_uuid: null, school_id: null, portal_activated: false, preferred_language: 'en' };

const { tableDouble } = require('../helpers/table-double');

/**
 * The fake database: the shared table double (filters apply, head counts, writes persist and hand back what they
 * wrote); a table may be made to fail. `writes` shows an insert's `rows` as the product passed it (the double's `raw`).
 */
function db(tables, { failTables = [] } = {}) {
  const d = tableDouble(tables, { failTables: Object.fromEntries(failTables.map((t) => [t, `${t} down`])) });
  return {
    tables, reads: d.reads, from: d.from, rpc: d.rpc,
    get writes() { return d.writes.map((w) => (w.raw !== undefined ? { ...w, rows: w.raw } : w)); },
  };
}

function memRedis() {
  const m = new Map();
  const api = {
    _map: m,
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


/** The world: users, chat-joined rows, app settings (the child-home switches on, as on sandbox). */
function worldOf({ users = [], students = [], settings = {}, extra = {}, failTables = [] }) {
  const app_settings = Object.entries({ web_quiz_hub: true, web_quiz_child_quiz_home: true, ...settings })
    .filter(([, v]) => v !== undefined).map(([key, value]) => ({ key, value }));
  return db({
    app_settings,
    users,
    students,
    quiz_sessions: students.length ? [{
      id: 'qs-1', quiz_id: 'q-1', share_code_id: 'sc-1', student_id: students[0].id, status: 'completed',
      correct_answers: 5, total_questions_answered: 7, mastery_percentage: 71, completed_at: '2026-10-08T09:10:00Z',
      created_at: '2026-10-08T09:00:00Z', student_class: '4',
    }] : [],
    quiz_share_codes: [{ id: 'sc-1', code: 'K7RM2X', active: true, expires_at: null, topic: 'Decimals', language: 'en', teacher_user_id: 't-9', parent_share_code_id: null, invited_by_student_id: null, created_at: '2026-10-08T08:00:00Z' }],
    quizzes: [{ id: 'q-1', topic: 'Decimals', subject: 'maths', language: 'en', grade: '4', teacher_id: 't-9' }],
    student_lists: [], coaching_sessions: [], lesson_plans: [], training_assessment_attempts: [], assessment_requests: [],
    user_feature_first_use: [], child_phone_bindings: [],
    ...extra,
  }, { failTables });
}

async function boot(store, { userLookupFails = false, redis = memRedis() } = {}) {
  jest.resetModules();
  const sent = [];
  const works = [];
  jest.doMock('../../shared/config/supabase', () => store);
  jest.doMock('../../shared/services/cache/railway-redis.service', () => redis);
  jest.doMock('../../shared/utils/web-drain', () => ({
    trackWebhookWork: (w) => { const p = Promise.resolve(w); works.push(p); return p; },
    installWebDrain: () => {}, inFlightCount: () => 0, waitForIdle: async () => true,
  }));
  const rec = (kind) => jest.fn(async (to, p) => { sent.push({ kind, to, p }); return true; });
  jest.doMock('../../shared/services/whatsapp.service', () => ({
    sendMessage: rec('text'), sendInteractiveButtons: rec('buttons'), sendInteractiveMessage: rec('list'),
    sendFlow: rec('flow'), sendCtaUrl: rec('cta'), sendTemplate: jest.fn(async () => true),
    sendImageFromBuffer: rec('image'), sendReaction: jest.fn(async () => true), showTypingIndicator: jest.fn(async () => true),
    startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })), downloadMedia: jest.fn(async () => Buffer.from('x')),
    markAsRead: jest.fn(async () => true), sendDocument: rec('doc'), sendImage: rec('image'), sendVideo: rec('video'),
  }));
  jest.doMock('../../shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn(async (phone) => {
      if (userLookupFails) throw new Error('db down');
      return { ...((store.tables.users || []).find((u) => u.phone_number === phone) || {}) };
    }),
    trackChatStart: jest.fn(async () => true),
    getOrCreateSession: jest.fn(async () => 'sess-1'),
    storeConversation: jest.fn(async () => true),
  }));
  jest.doMock('../../shared/services/session.service', () => ({
    isProcessed: jest.fn(async () => false), markAsProcessed: jest.fn(async () => true), getReactionEmoji: jest.fn(() => '👍'),
  }));
  jest.doMock('../../shared/services/conversation-resume.service', () => ({ handleResumeButton: jest.fn(async () => false) }));
  // A child's school question would reach the tutor model: never in these rows, but never the network either.
  jest.doMock('../../shared/services/openai.service', () => ({
    getResponseWithFormat: jest.fn(async () => 'tutor reply'), getConversationHistory: jest.fn(async () => []),
    detectIntent: jest.fn(async () => ({ intent: 'general' })),
  }));
  const { app } = require('../../whatsapp-bot');
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  async function text(body, phone = PHONE) {
    const before = sent.length;
    const payload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: '111' },
      messages: [{ from: phone, id: `wamid.${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }],
    } }] }] };
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(res.status).toBe(200);
    await Promise.allSettled(works);
    const deadline = Date.now() + 8000;
    while (sent.length === before && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
      await Promise.allSettled(works);
    }
    await new Promise((r) => setTimeout(r, 60));
    await Promise.allSettled(works);
    return sent.slice(before);
  }
  return { sent, text, redis, close: () => new Promise((r) => server.close(r)) };
}

const ctas = (out) => out.filter((s) => s.kind === 'cta');
const goLink = (s) => /^https:\/\/portal\.example\/quiz\/go\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/.test(String(s && s.p && s.p.url));
const ON = { quiz_one_door: true };

jest.setTimeout(180000);   // each row boots the whole bot; generous for a loaded CI machine

describe('a phone the bot has never seen', () => {
  const NEW_USER = () => ({ id: 'u-new', phone_number: PHONE, role: null, ...ROW });

  test('OFF: today — the empty lesson list, then the registration Flow (2 replies)', async () => {
    const app = await boot(worldOf({ users: [NEW_USER()] }));
    try {
      const out = await app.text('/quiz');
      expect(out.map((s) => s.kind)).toEqual(['text', 'flow']);
      expect(ctas(out)).toHaveLength(0);
    } finally { await app.close(); }
  });

  test('ON: exactly ONE cta_url to /quiz/go/<token> (the one question), nothing after it', async () => {
    const app = await boot(worldOf({ users: [NEW_USER()], settings: ON }));
    try {
      const out = await app.text('/quiz');
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe('cta');
      expect(goLink(out[0])).toBe(true);
      expect(out[0].p.body).toContain("Jugnu's quiz");
      expect(out[0].p.url).not.toContain(PHONE);
    } finally { await app.close(); }
  });

  test.each(['jugnu', 'جگنو'])('ON: %s (the bot\'s own name) is not a quiz request — no door link', async (word) => {
    const app = await boot(worldOf({ users: [NEW_USER()], settings: ON }));
    try {
      const out = await app.text(word);
      expect(out.filter(goLink)).toHaveLength(0);
    } finally { await app.close(); }
  });

  test('ON: the 9th /quiz of the day with the shared 8-a-day pool already spent still gets its ONE link', async () => {
    const app = await boot(worldOf({ users: [NEW_USER()], settings: ON }));
    try {
      const Ledger = require('../../shared/services/quiz/message-ledger');
      for (let i = 0; i < 8; i += 1) await Ledger.record({ trigger: 'home_reply', phone: PHONE, reason: 'home' });
      expect(await Ledger.record({ trigger: 'home_reply', phone: PHONE, reason: 'home' })).toBe(false);
      const out = await app.text('/quiz');
      expect(ctas(out)).toHaveLength(1);
      expect(goLink(out[0])).toBe(true);
    } finally { await app.close(); }
  });
});

describe('a coach (the role with no quiz menu row)', () => {
  const COACH = () => ({ id: 'u-coach', phone_number: PHONE, role: 'coach', ...ROW, name: 'Coach Testwala' });

  test('OFF: today — the coach\'s feature menu, no link', async () => {
    const app = await boot(worldOf({ users: [COACH()] }));
    try {
      const out = await app.text('/quiz');
      expect(out.length).toBeGreaterThan(0);
      expect(out.filter(goLink)).toHaveLength(0);
      // the feature menu (a list, or its text form when the list cannot be drawn)
      expect(out.some((s) => s.kind === 'list' || s.kind === 'buttons' || /I can help you with/.test(String(s.p)))).toBe(true);
    } finally { await app.close(); }
  });

  test('ON: ONE cta_url with the teacher words, never the menu', async () => {
    const app = await boot(worldOf({ users: [COACH()], settings: ON }));
    try {
      const out = await app.text('/quiz');
      expect(out).toHaveLength(1);
      expect(goLink(out[0])).toBe(true);
      expect(out[0].p.body).toContain('Your quiz home');
      expect(out[0].p.buttonText).toBe('Open · کھولیں');
    } finally { await app.close(); }
  });
});

describe('a known child (a chat-joined row on this phone)', () => {
  const CHILD_USER = () => ({ id: 'u-child', phone_number: PHONE, role: 'teacher', ...ROW });
  const CHILD_ROW = () => ({ id: 'st-1', phone: PHONE, list_id: null, is_active: true, student_name: 'Kid Testwala', self_reported_class: '4', created_at: '2026-10-08T08:59:00Z' });

  test('OFF: today\'s ONE "Home" reply to the hub', async () => {
    const app = await boot(worldOf({ users: [CHILD_USER()], students: [CHILD_ROW()] }));
    try {
      const out = await app.text('/quiz');
      expect(ctas(out)).toHaveLength(1);
      expect(out[0].p.buttonText).toBe('🏠 Home');
      expect(out[0].p.url).toMatch(/\/h\//);
    } finally { await app.close(); }
  });

  test('ON: the same ONE hub link, with the child words (stories, videos and quizzes — no retired door word)', async () => {
    const app = await boot(worldOf({ users: [CHILD_USER()], students: [CHILD_ROW()], settings: ON }));
    try {
      const out = await app.text('/quiz');
      expect(ctas(out)).toHaveLength(1);
      expect(out[0].p.url).toMatch(/^https:\/\/portal\.example\/h\//);
      expect(out[0].p.body).toBe('Your stories, videos and quizzes are here.');
      expect(out[0].p.buttonText).toBe('Open');
    } finally { await app.close(); }
  });
});

describe('replies to a person\'s own message ride their own counter (the shared 8-a-day pool already spent)', () => {
  const CHILD_USER = () => ({ id: 'u-child', phone_number: PHONE, role: 'teacher', ...ROW });
  const CHILD_ROW = () => ({ id: 'st-1', phone: PHONE, list_id: null, is_active: true, student_name: 'Kid Testwala', self_reported_class: '4', created_at: '2026-10-08T08:59:00Z' });
  const BIND = { web_quiz_identity_canon: true, web_quiz_phone_bind: true };
  async function spendPool() {
    const Ledger = require('../../shared/services/quiz/message-ledger');
    for (let i = 0; i < 8; i += 1) await Ledger.record({ trigger: 'class_link', phone: PHONE, reason: 'home', recipient: 'family' });
    expect(await Ledger.record({ trigger: 'class_link', phone: PHONE, reason: 'home' })).toBe(false);
  }

  test.each([['OFF', {}, 0], ['ON', ON, 1]])('a known child\'s /quiz (the hub reply, counted with the phone): %s → %s reply', async (_n, extra, n) => {
    const app = await boot(worldOf({ users: [CHILD_USER()], students: [CHILD_ROW()], settings: { ...BIND, ...extra } }));
    try {
      await spendPool();
      const out = await app.text('/quiz');
      expect(ctas(out)).toHaveLength(n);
    } finally { await app.close(); }
  });

  test.each([['OFF', {}, 0], ['ON', ON, 1]])('a child\'s STOP with nothing saved (a binder reply): %s → %s reply', async (_n, extra, n) => {
    const app = await boot(worldOf({ users: [CHILD_USER()], students: [CHILD_ROW()], settings: { ...BIND, ...extra } }));
    try {
      await spendPool();
      const out = await app.text('STOP');
      expect(out.filter((s) => s.kind === 'text')).toHaveLength(n);
    } finally { await app.close(); }
  });

  // Keep my place (web_quiz_bind_way_back) and the one door on the same reply path: the way back's line for a code the
  // bot does not know is recorded ONCE, on the person's own counter (ownReply), and sent once; the binder's own records
  // beneath it never run. One door OFF → the shared pool applies as today (capped, silent).
  test.each([['OFF', {}, 0], ['ON', ON, 1]])('Keep my place ON, a code the bot does not know (the way back\'s line): one door %s → %s reply, ONE ledger record', async (_n, extra, n) => {
    const app = await boot(worldOf({ users: [CHILD_USER()], students: [CHILD_ROW()], settings: { ...BIND, web_quiz_bind_way_back: true, ...extra } }));
    try {
      await spendPool();
      const Ledger = require('../../shared/services/quiz/message-ledger');
      const records = [];
      const real = Ledger.record.bind(Ledger);
      jest.spyOn(Ledger, 'record').mockImplementation(async (args) => { const ok = await real(args); records.push({ ...args, ok }); return ok; });
      const out = await app.text('JUGNU-ZZ9ZZ');
      expect(out.filter((s) => s.kind === 'text')).toHaveLength(n);
      expect(out.filter((s) => s.kind !== 'text')).toHaveLength(0);
      expect(records.map((r) => [r.trigger, r.reason, r.ownReply, r.ok])).toEqual([['bind_reply', 'code_unknown', true, n === 1]]);
    } finally { await app.close(); }
  });

  // The merged line itself (web-quiz-bind.service.js, a phone already holding four children): the way back answers
  // first and the binder's own record beneath it never runs — one record, own counter, one reply.
  test.each([['OFF', {}, 0], ['ON', ON, 1]])('Keep my place ON, a fifth child on a full phone (max_kids): one door %s → %s reply, ONE ledger record', async (_n, extra, n) => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const minted = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const fifth = { id: 'st-5', phone: null, list_id: null, is_active: true, student_name: 'Fifth Testwala', self_reported_class: '4', created_at: '2026-10-08T08:59:00Z' };
    // the phone's four children, as the real read finds them: four live bindings (the chat child among them) and
    // their four active student rows
    const kin = ['k-2', 'k-3', 'k-4'].map((id, i) => ({ id, phone: null, list_id: null, is_active: true, student_name: `Kin${i + 2} Testwala`, self_reported_class: '4', created_at: '2026-10-08T08:59:00Z' }));
    const norm = require('../../shared/services/quiz/student-identity.service').normalisePhone(PHONE);
    const bindings = ['st-1', 'k-2', 'k-3', 'k-4'].map((id, i) => ({ id: `b-${i + 1}`, canonical_id: id, phone_norm: norm, via: 'save', bound_at: `2026-10-0${i + 1}T08:00:00Z`, expires_at: soon, revoked_at: null }));
    const app = await boot(worldOf({
      users: [CHILD_USER()], students: [CHILD_ROW(), ...kin, fifth], settings: { ...BIND, web_quiz_bind_way_back: true, ...extra },
      extra: { child_phone_bindings: bindings, child_bind_codes: [{ code: 'JUGNU-AB2CD', canonical_id: 'st-5', minted_at: minted, expires_at: soon, used_at: null, outcome: null }] },
    }));
    try {
      await spendPool();
      const Ledger = require('../../shared/services/quiz/message-ledger');
      const BindRepo = require('../../shared/services/quiz/child-phone-bindings.repo');
      expect((await BindRepo.childrenForPhone(PHONE)).map((k) => k.id).sort()).toEqual(['k-2', 'k-3', 'k-4', 'st-1']);
      expect(4).toBe(require('../../shared/services/quiz/web-quiz-token').HUB_MAX_KIDS);
      const records = [];
      const real = Ledger.record.bind(Ledger);
      jest.spyOn(Ledger, 'record').mockImplementation(async (args) => { const ok = await real(args); records.push({ ...args, ok }); return ok; });
      const out = await app.text('JUGNU-AB2CD');
      // the way back's reply: the full line WITH the button to the child's page (the binder's own line has none)
      expect(out.map((s) => s.kind)).toEqual(n ? ['cta'] : []);
      expect(records.map((r) => [r.trigger, r.reason, r.ownReply, r.ok])).toEqual([['bind_reply', 'max_kids', true, n === 1]]);
    } finally { await app.close(); }
  });

  // The binder's own replies (Keep my place OFF): a code that saves the child answers with ONE link to the children's
  // page, on the person's own counter. One door OFF → the shared pool applies as today (capped, silent; still saved).
  test.each([['OFF', {}, 0], ['ON', ON, 1]])('a code that saves the child (the binder\'s own reply): one door %s → %s reply, ONE ledger record', async (_n, extra, n) => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const minted = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const sib = { id: 'st-2', phone: null, list_id: null, is_active: true, student_name: 'Sib Testwala', self_reported_class: '4', created_at: '2026-10-08T08:59:00Z' };
    const app = await boot(worldOf({
      users: [CHILD_USER()], students: [CHILD_ROW(), sib], settings: { ...BIND, ...extra },
      extra: { child_bind_codes: [{ code: 'JUGNU-EF3GH', canonical_id: 'st-2', minted_at: minted, expires_at: soon, used_at: null, outcome: null }] },
    }));
    try {
      await spendPool();
      const Ledger = require('../../shared/services/quiz/message-ledger');
      const records = [];
      const real = Ledger.record.bind(Ledger);
      jest.spyOn(Ledger, 'record').mockImplementation(async (args) => { const ok = await real(args); records.push({ ...args, ok }); return ok; });
      const store = require('../../shared/config/supabase');
      const out = await app.text('JUGNU-EF3GH');
      // the binding is written either way (the save is not a reply); only the reply rides the counter
      expect(store.writes.filter((w) => w.table === 'child_phone_bindings' && w.op === 'insert').map((w) => w.rows.canonical_id)).toEqual(['st-2']);
      expect(out.map((s) => s.kind)).toEqual(n ? ['cta'] : []);
      if (n) expect(out[0].p.url).toMatch(/^https:\/\/portal\.example\/h\//);
      expect(records.map((r) => [r.trigger, r.reason, r.ownReply, r.ok])).toEqual([['bind_reply', 'bind', true, n === 1]]);
    } finally { await app.close(); }
  });

  // The binder's own line for a full phone (Keep my place OFF, so no way back answers first): a fifth child's code on a
  // phone already holding four answers with the one plain line, on the person's own counter.
  test.each([['OFF', {}, 0], ['ON', ON, 1]])('a fifth child on a full phone (the binder\'s own line): one door %s → %s reply, ONE ledger record', async (_n, extra, n) => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const minted = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const fifth = { id: 'st-5', phone: null, list_id: null, is_active: true, student_name: 'Fifth Testwala', self_reported_class: '4', created_at: '2026-10-08T08:59:00Z' };
    const kin = ['k-2', 'k-3', 'k-4'].map((id, i) => ({ id, phone: null, list_id: null, is_active: true, student_name: `Kin${i + 2} Testwala`, self_reported_class: '4', created_at: '2026-10-08T08:59:00Z' }));
    const norm = require('../../shared/services/quiz/student-identity.service').normalisePhone(PHONE);
    const bindings = ['st-1', 'k-2', 'k-3', 'k-4'].map((id, i) => ({ id: `b-${i + 1}`, canonical_id: id, phone_norm: norm, via: 'save', bound_at: `2026-10-0${i + 1}T08:00:00Z`, expires_at: soon, revoked_at: null }));
    const app = await boot(worldOf({
      users: [CHILD_USER()], students: [CHILD_ROW(), ...kin, fifth], settings: { ...BIND, ...extra },
      extra: { child_phone_bindings: bindings, child_bind_codes: [{ code: 'JUGNU-JK4LM', canonical_id: 'st-5', minted_at: minted, expires_at: soon, used_at: null, outcome: null }] },
    }));
    try {
      await spendPool();
      const Ledger = require('../../shared/services/quiz/message-ledger');
      const records = [];
      const real = Ledger.record.bind(Ledger);
      jest.spyOn(Ledger, 'record').mockImplementation(async (args) => { const ok = await real(args); records.push({ ...args, ok }); return ok; });
      const out = await app.text('JUGNU-JK4LM');
      expect(out.map((s) => s.kind)).toEqual(n ? ['text'] : []);
      expect(records.map((r) => [r.trigger, r.reason, r.ownReply, r.ok])).toEqual([['bind_reply', 'max_kids', true, n === 1]]);
    } finally { await app.close(); }
  });

  // A teacher's phone sending a child's code: refused with the one teacher line, on the person's own counter.
  test.each([['OFF', {}, 0], ['ON', ON, 1]])('a teacher\'s phone sends a child\'s code (the binder\'s refusal): one door %s → %s reply, ONE ledger record', async (_n, extra, n) => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const minted = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const TEACHER = { id: 'u-teacher', phone_number: PHONE, role: 'teacher', ...ROW, registration_completed: true, registration_state: 'completed', name: 'Teacher Testwala', teacher_uuid: 'tu-1', school_id: 'sch-1' };
    const app = await boot(worldOf({
      users: [TEACHER], settings: { ...BIND, ...extra },
      extra: { child_bind_codes: [{ code: 'JUGNU-NP5QR', canonical_id: 'st-1', minted_at: minted, expires_at: soon, used_at: null, outcome: null }] },
    }));
    try {
      await spendPool();
      const Ledger = require('../../shared/services/quiz/message-ledger');
      const records = [];
      const real = Ledger.record.bind(Ledger);
      jest.spyOn(Ledger, 'record').mockImplementation(async (args) => { const ok = await real(args); records.push({ ...args, ok }); return ok; });
      const out = await app.text('JUGNU-NP5QR');
      expect(out.map((s) => s.kind)).toEqual(n ? ['text'] : []);
      expect(records.map((r) => [r.trigger, r.reason, r.ownReply, r.ok])).toEqual([['teacher_refusal', 'teacher_phone', true, n === 1]]);
    } finally { await app.close(); }
  });
});
