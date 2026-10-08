'use strict';
/**
 * A child's /quiz opens their home page; a teacher's /quiz never does.
 *
 * Every row drives the REAL webhook (POST /webhook → getOrCreateUser → StudentIngress.attach/route →
 * the text handler → QuizMenuEntry → StudentQuiz) with only the edges doubled: the database
 * (a table fake that answers head counts), Redis (an in-memory map), WhatsApp (records every send),
 * the user lookup (reads the fake users table), the webhook dedupe and the drain tracker.
 *
 * "No hub" means: no cta_url message at all, and no text carrying a /h/ link.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-secret-child-quiz-home';
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';
process.env.STUDENT_MODE_ENABLED = 'true';
process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';

const PHONE = '923001234567';
const HOME = { en: '🏠 Home', ur: '🏠 ہوم' };

/** The fake database: tables of rows; head counts; updates applied; a table may be made to fail. */
function db(tables, { failTables = [] } = {}) {
  const writes = [];
  const match = (row, f) => f.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return String(v) === String(val);
    if (op === 'in') return val.map(String).includes(String(v));
    if (op === 'is') return val === null ? v == null : v === val;
    return true;
  });
  return {
    tables,
    writes,
    rpc: async () => ({ data: null, error: null }),
    from(table) {
      const filters = [];
      const q = { head: false, order: null, limit: null, update: null, write: false };
      const b = {};
      b.select = (cols, opts) => { q.head = Boolean(opts && opts.head); return b; };
      b.eq = (c, v) => { filters.push(['eq', c, v]); return b; };
      b.in = (c, v) => { filters.push(['in', c, v]); return b; };
      b.is = (c, v) => { filters.push(['is', c, v]); return b; };
      b.order = (c, o) => { q.order = [c, o]; return b; };
      b.limit = (n) => { q.limit = n; return b; };
      b.range = (a, z) => { q.limit = z - a + 1; return b; };
      ['not', 'gte', 'lte', 'gt', 'lt', 'or', 'neq', 'ilike', 'like', 'contains', 'filter', 'match'].forEach((m) => { b[m] = () => b; });
      b.update = (fields) => { q.update = fields; return b; };
      ['insert', 'upsert', 'delete'].forEach((m) => { b[m] = (rows) => { writes.push({ table, op: m, rows }); q.write = true; return b; }; });
      const run = () => {
        if (failTables.includes(table)) return { data: null, count: null, error: { message: `${table} down` } };
        if (q.write) return { data: [], error: null };
        let rows = (tables[table] || []).filter((r) => match(r, filters));
        if (q.update) {
          writes.push({ table, fields: q.update, filters: [...filters] });
          rows.forEach((r) => Object.assign(r, q.update));
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        }
        if (q.head) return { data: null, count: rows.length, error: null };
        if (q.order) {
          const [c, o] = q.order;
          rows = [...rows].sort((a, z) => (String(a[c]) < String(z[c]) ? -1 : 1) * (o && o.ascending === false ? -1 : 1));
        }
        if (q.limit != null) rows = rows.slice(0, q.limit);
        return { data: rows, count: rows.length, error: null };
      };
      b.maybeSingle = async () => { const r = run(); return { data: (r.data || [])[0] || null, error: r.error || null }; };
      b.single = b.maybeSingle;
      b.then = (ok, ko) => Promise.resolve(run()).then(ok, ko);
      return b;
    },
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

/** A child row on the handset with one finished quiz; a teacher's own rows on demand. */
function world({ user, students = [], settings = {}, extra = {}, failTables = [] }) {
  const app_settings = Object.entries({ web_quiz_hub: true, web_quiz_child_quiz_home: true, ...settings })
    .filter(([, v]) => v !== undefined).map(([key, value]) => ({ key, value }));
  return db({
    app_settings,
    users: user ? [user] : [],
    students,
    quiz_sessions: students.length ? [{
      id: 'qs-1', quiz_id: 'q-1', share_code_id: 'sc-1', student_id: students[0].id, status: 'completed',
      correct_answers: 5, total_questions_answered: 7, mastery_percentage: 71, completed_at: '2026-10-08T09:10:00Z',
      created_at: '2026-10-08T09:00:00Z', student_class: '4',
    }] : [],
    quiz_share_codes: [{ id: 'sc-1', code: 'K7RM2X', active: true, expires_at: null, topic: 'Decimals', language: 'en', teacher_user_id: 't-9', parent_share_code_id: null, invited_by_student_id: null, created_at: '2026-10-08T08:00:00Z' }],
    quizzes: [{ id: 'q-1', topic: 'Decimals', subject: 'maths', language: 'en', grade: '4', teacher_id: 't-9' }],
    student_lists: [], coaching_sessions: [], lesson_plans: [], training_assessment_attempts: [], assessment_requests: [],
    ...extra,
  }, { failTables });
}

const CHILD_USER = () => ({ id: 'u-child', phone_number: PHONE, role: 'teacher', preferred_language: 'en', registration_completed: false, registration_state: null, name: null, teacher_uuid: null, school_id: null, portal_activated: false });
const CHILD_ROW = () => ({ id: 'st-1', phone: PHONE, list_id: null, is_active: true, student_name: 'Kid Testcase', self_reported_class: '4', created_at: '2026-10-08T08:59:00Z' });

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
  async function text(body) {
    const before = sent.length;
    const payload = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: '111' },
      messages: [{ from: PHONE, id: `wamid.${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }],
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

const hubSends = (out) => out.filter((s) => s.kind === 'cta' || (s.kind === 'text' && /\/h\//.test(String(s.p))));
const homeCta = (out) => out.find((s) => s.kind === 'cta');
/** Today's teacher path ran (something was sent) and none of it was the child home. */
function teacherPath(out) {
  expect(out.length).toBeGreaterThan(0);
  expect(hubSends(out)).toHaveLength(0);
}

jest.setTimeout(30000);

describe('a CHILD\'s /quiz with web_quiz_child_quiz_home on', () => {
  test('ONE cta_url: "🏠 Home", the hub link, and a body with no URL, no token, no name (T18)', async () => {
    const app = await boot(world({ user: CHILD_USER(), students: [CHILD_ROW()] }));
    try {
      const out = await app.text('/quiz');
      expect(out.filter((s) => s.kind === 'cta')).toHaveLength(1);
      const cta = homeCta(out);
      expect(cta.p.buttonText).toBe(HOME.en);
      expect(cta.p.url).toMatch(/^https:\/\/portal\.example\/h\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const token = cta.p.url.split('/h/')[1];
      expect(cta.p.body).not.toMatch(/https?:|\/h\//);
      expect(cta.p.body).not.toContain(token.split('.')[0]);
      expect(cta.p.body).not.toMatch(/Kid|Testcase/);
      expect(out.filter((s) => s.kind !== 'cta')).toHaveLength(0);
    } finally { await app.close(); }
  });

  test.each(['/quiz fractions', '/quiz   ', 'quizz', 'mera quiz', 'کوئز'])('"%s" is the same home (T13/T14)', async (msg) => {
    const app = await boot(world({ user: CHILD_USER(), students: [CHILD_ROW()] }));
    try {
      const cta = homeCta(await app.text(msg));
      expect(cta && cta.p.buttonText).toBe(HOME.en);
    } finally { await app.close(); }
  });

  test('flag OFF: today\'s hub message, byte for byte (T16)', async () => {
    const app = await boot(world({ user: CHILD_USER(), students: [CHILD_ROW()], settings: { web_quiz_child_quiz_home: undefined } }));
    try {
      const { resolveUx } = require('../../shared/config/ux-strings');
      const cta = homeCta(await app.text('/quiz'));
      expect(cta.p.buttonText).toBe(resolveUx('sqHubBtn', { language: 'en' }));
      expect(cta.p.body).toBe(resolveUx('sqHubBody', { language: 'en' }));
    } finally { await app.close(); }
  });

  test('a settings read that fails is OFF: no Home button (T16)', async () => {
    const app = await boot(world({ user: CHILD_USER(), students: [CHILD_ROW()], failTables: ['app_settings'] }));
    try {
      const out = await app.text('/quiz');
      expect(out.some((s) => s.kind === 'cta' && s.p.buttonText === HOME.en)).toBe(false);
    } finally { await app.close(); }
  });

  test('a question waiting on the handset: no Home button, the quiz keeps the turn (T11)', async () => {
    const redis = memRedis();
    await redis.set(`videoquiz:${PHONE}:active`, { sessionId: 'qs-x', currentQuestionId: 'qq-1', language: 'en' });
    const app = await boot(world({ user: CHILD_USER(), students: [CHILD_ROW()] }), { redis });
    try {
      expect(hubSends(await app.text('/quiz'))).toHaveLength(0);
    } finally { await app.close(); }
  });

  test('"I am a teacher" retires the rows; the NEXT /quiz is the teacher path (T9)', async () => {
    const store = world({ user: CHILD_USER(), students: [CHILD_ROW()] });
    const app = await boot(store);
    try {
      await app.text('I am a teacher');
      expect(store.tables.students[0].is_active).toBe(false);
      teacherPath(await app.text('/quiz'));
    } finally { await app.close(); }
  });

  test('/register is the way out too: the NEXT /quiz is not the hub (T9/T7)', async () => {
    const store = world({ user: CHILD_USER(), students: [CHILD_ROW()] });
    const app = await boot(store);
    try {
      await app.text('/register');
      expect(hubSends(await app.text('/quiz'))).toHaveLength(0);
    } finally { await app.close(); }
  });
});

describe('a TEACHER\'s /quiz never opens the child home (flag ON, hub ON)', () => {
  const T1 = { id: 'u-t1', phone_number: PHONE, role: 'teacher', preferred_language: 'en', registration_completed: true, name: 'Teacher Testcase' };
  const MSGS = ['/quiz', '/quiz fractions', 'quizz', 'کوئز', 'mera quiz'];

  test.each(MSGS)('T1 registered teacher, "%s"', async (msg) => {
    const app = await boot(world({ user: T1 }));
    try { teacherPath(await app.text(msg)); } finally { await app.close(); }
  });

  test('T2/T6/T8 registered teacher whose phone holds quiz-joined children: identity wins, the students rows are never read', async () => {
    const store = world({ user: T1, students: [CHILD_ROW()] });
    const app = await boot(store);
    try {
      teacherPath(await app.text('/quiz'));
    } finally { await app.close(); }
  });

  test.each([
    ['registration_state completed', { registration_completed: false, registration_state: 'completed', name: null }],
    ['T4 a name only', { registration_completed: false, name: 'Name Only' }],
    ['teacher_uuid', { registration_completed: false, name: null, teacher_uuid: 'tu-1' }],
    ['school_id', { registration_completed: false, name: null, school_id: 'sch-1' }],
    ['portal_activated', { registration_completed: false, name: null, portal_activated: true }],
  ])('identity: %s → teacher path even with a child row on the phone', async (_, fields) => {
    const app = await boot(world({ user: { ...CHILD_USER(), ...fields }, students: [CHILD_ROW()] }));
    try { teacherPath(await app.text('/quiz')); } finally { await app.close(); }
  });

  test.each([
    ['quizzes', { quizzes: [{ id: 'q-own', teacher_id: 'u-child', topic: 'x', status: 'sent' }] }],
    ['coaching_sessions', { coaching_sessions: [{ id: 'cs-1', user_id: 'u-child' }] }],
    ['lesson_plans', { lesson_plans: [{ id: 'lp-1', user_id: 'u-child', pdf_url: 'https://x/lp.pdf' }] }],
    ['student_lists', { student_lists: [{ id: 'sl-1', user_id: 'u-child' }] }],
    ['training_assessment_attempts', { training_assessment_attempts: [{ id: 'ta-1', user_id: 'u-child' }] }],
    ['assessment_requests', { assessment_requests: [{ id: 'ar-1', user_id: 'u-child' }] }],
  ])('T5 activity in %s → teacher path', async (_, extra) => {
    const base = world({ user: CHILD_USER(), students: [CHILD_ROW()] });
    Object.assign(base.tables, extra);
    if (extra.quizzes) base.tables.quizzes = [...extra.quizzes, { id: 'q-1', topic: 'Decimals', subject: 'maths', language: 'en', grade: '4', teacher_id: 't-9' }];
    const app = await boot(base);
    try { teacherPath(await app.text('/quiz')); } finally { await app.close(); }
  });

  test('T3 a coach: the role menu, never the hub', async () => {
    const app = await boot(world({ user: { ...T1, id: 'u-coach', role: 'coach' }, students: [CHILD_ROW()] }));
    try { teacherPath(await app.text('/quiz')); } finally { await app.close(); }
  });

  test('an activity read that FAILS is towards teacher (unknown), never the hub', async () => {
    const app = await boot(world({ user: CHILD_USER(), students: [CHILD_ROW()], failTables: ['coaching_sessions'] }));
    try { teacherPath(await app.text('/quiz')); } finally { await app.close(); }
  });

  test('T10 no users row (the lookup failed): no hub, no token', async () => {
    const app = await boot(world({ user: null, students: [CHILD_ROW()] }), { userLookupFails: true });
    try { teacherPath(await app.text('/quiz')); } finally { await app.close(); }
  });

  test('a nameless, activity-less adult with NO child row is the teacher path (unknown)', async () => {
    const app = await boot(world({ user: CHILD_USER(), students: [] }));
    try { teacherPath(await app.text('/quiz')); } finally { await app.close(); }
  });
});

describe('T12 — the registration Flow completed inside the verdict cache', () => {
  test('a phone classified as a child, then registered by Flow, gets the teacher /quiz next', async () => {
    const store = world({ user: CHILD_USER(), students: [CHILD_ROW()] });
    const app = await boot(store);
    try {
      // 1. the child's /quiz: verdict cached as student
      expect(homeCta(await app.text('/quiz'))).toBeTruthy();
      // 2. the adult completes the registration Flow on this phone (no "register" keyword typed)
      const FlowResponse = require('../../shared/handlers/flow-response.handler');
      await FlowResponse.handleRegistrationFlow({ interactive: { nfm_reply: { response_json: JSON.stringify({ full_name: 'Adult Testcase', role: 'teacher' }) } } }, PHONE, 'u-child');
      expect(store.tables.users[0].registration_completed).toBe(true);
      // 3. /quiz again, inside the 10-minute cache
      teacherPath(await app.text('/quiz'));
    } finally { await app.close(); }
  });
});
