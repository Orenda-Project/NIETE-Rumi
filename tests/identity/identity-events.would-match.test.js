'use strict';
/**
 * A finished sign-up that sits next to another live account with the same school and the same name is recorded.
 *
 * Nothing at sign-up looks for a teacher's second account: the cleanup found strong same-teacher leads and many
 * "one used, one never" pairs only after the fact. Before anyone builds "Is this you?", the bot counts how often it
 * would ask: `registration.would_match`, with the account ids that matched and whether any of them was ever used.
 *
 * A sign-up finishes in three places, and each one now fires the check without waiting for it:
 *   - the Flow endpoint's SUCCESS screen        (handleRegistrationDataExchange → markRegistrationComplete)
 *   - the terminal Flow reply                   (handleRegistrationFlow)
 *   - the typed-name reply of the quick sign-up (FeatureRegistrationService.handleNameResponse)
 *
 * The reply is never slowed or changed, a failing check is swallowed, nothing is written, and the event carries
 * account ids only: never a phone number or a name. Only the edges are doubled: the database (a table fake), Redis,
 * WhatsApp, the file logger and the heavy modules the handler pulls in. The structured event logger is real, spied.
 */
let mockRegStore = {};
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(async (key, val) => { mockRegStore[key] = val; }),
  get: jest.fn(async (key) => mockRegStore[key] || null),
  del: jest.fn(async (key) => { delete mockRegStore[key]; }),
  delete: jest.fn(async (key) => { delete mockRegStore[key]; }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/branding', () => ({ portalUrl: () => null }));
jest.mock('../../bot/shared/services/whatsapp.service', () => new Proxy({}, {
  get: (t, p) => {
    if (typeof p === 'symbol' || p === 'then' || p === '__esModule') return undefined;
    if (!t[p]) t[p] = jest.fn(async () => ({ ok: true }));
    return t[p];
  },
}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({}));
jest.mock('../../bot/shared/services/reading/passage-generation.service', () => ({}));
jest.mock('../../bot/shared/services/reading/auto-level-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/utils/language-cache', () => ({ setUserLanguage: jest.fn(async () => true) }));
jest.mock('../../bot/shared/services/student-ingress-cache', () => ({ forget: jest.fn(async () => true) }));

let mockTables = {};
const mockWrites = [];
const mockPeerRead = { gate: null, fail: false };
jest.mock('../../bot/shared/config/supabase', () => ({
  rpc: async () => ({ data: null, error: null }),
  from(table) {
    const filters = [];
    let write = null;
    const b = {};
    b.select = () => b;
    b.eq = (c, v) => { filters.push((r) => String(r[c]) === String(v)); return b; };
    b.neq = (c, v) => { filters.push((r) => String(r[c]) !== String(v)); return b; };
    b.is = (c, v) => { b._isPeerRead = c === 'deleted_at'; filters.push((r) => (r[c] == null) === (v == null)); return b; };
    ['in', 'order', 'limit', 'range', 'not', 'gte', 'lte', 'gt', 'lt', 'or', 'ilike', 'like', 'match', 'filter']
      .forEach((m) => { b[m] = () => b; });
    ['update', 'insert', 'upsert', 'delete'].forEach((m) => { b[m] = (payload) => { write = { table, m, payload }; return b; }; });
    const run = async () => {
      if (write) { mockWrites.push(write); return { data: [], error: null }; }
      if (b._isPeerRead) {
        if (mockPeerRead.fail) throw new Error('database unreachable');
        if (mockPeerRead.gate) await mockPeerRead.gate;
      }
      return { data: (mockTables[table] || []).filter((r) => filters.every((f) => f(r))), error: null };
    };
    b.maybeSingle = async () => { const r = await run(); return { data: (r.data || [])[0] || null, error: null }; };
    b.single = b.maybeSingle;
    b.then = (ok, ko) => run().then(ok, ko);
    return b;
  },
}));

// The teacher's keyed reference (tk) needs the HMAC key; a fixed test key makes it deterministic here.
process.env.WEB_QUIZ_KID_KEY = 'identity-events-test-key-0123456789abcdef';
const StructuredLogger = require('../../bot/shared/utils/structured-logger');
const { handleRegistrationDataExchange } = require('../../bot/shared/routes/registration-endpoint');
const { handleRegistrationFlow } = require('../../bot/shared/handlers/flow-response.handler');
const FeatureRegistrationService = require('../../bot/shared/services/feature-registration.service');
const { tk } = require('../../bot/shared/services/quiz/web-quiz-kid');

// A synthetic number, built from parts so the repo holds no phone-shaped literal (920000… is never a real mobile).
const fx = (n) => '92' + '000' + String(n).padStart(7, '0');
const SCHOOL = 'b0000000-0000-4000-8000-00000000a001';
const PHONE = fx(404);
// The unused import she would claim in a later step: same school, same name (spacing and case differ).
const PEER = {
  id: 'a0000000-0000-4000-8000-000000000499', phone_number: fx(499), name: '  ayesha   BANO ',
  school_id: SCHOOL, deleted_at: null, registration_completed: false, last_message_at: null,
};
const NOT_PEERS = [
  { id: 'n1', phone_number: `retired:${fx(498)}`, name: 'Ayesha Bano', school_id: SCHOOL, deleted_at: null },
  { id: 'n2', phone_number: 'merged:a0000000', name: 'Ayesha Bano', school_id: SCHOOL, deleted_at: null },
  { id: 'n3', phone_number: fx(497), name: 'Ayesha Bano', school_id: SCHOOL, deleted_at: '2026-10-01T00:00:00Z' },
  { id: 'n4', phone_number: fx(496), name: 'Ayesha Bano', school_id: 'b0000000-0000-4000-8000-00000000a002', deleted_at: null },
  { id: 'n5', phone_number: fx(495), name: 'Ayesha Khan', school_id: SCHOOL, deleted_at: null },
];
const me = (id, over = {}) => ({
  id, phone_number: PHONE, name: 'Ayesha Bano', role: 'teacher', preferred_language: 'en', school_id: SCHOOL,
  organization: 'niete', deleted_at: null, ...over,
});

let events;
beforeEach(() => {
  mockRegStore = {};
  mockWrites.length = 0;
  mockPeerRead.gate = null;
  mockPeerRead.fail = false;
  mockTables = { users: [PEER, ...NOT_PEERS] };
  events = jest.spyOn(StructuredLogger, 'logEvent').mockImplementation(() => {});
});
afterEach(() => { events.mockRestore(); });

const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };
const wouldMatch = () => events.mock.calls.filter(([name]) => name === 'registration.would_match').map(([, data]) => data);
const expectedEvent = (userId, source) => ({
  tk: tk(userId), source, matchCount: 1, matchTks: [tk(PEER.id)], matchesRegistered: 0, matchesEverMessaged: 0,
});

// The three places a sign-up finishes, each driven through its own real entry point.
const SITES = {
  flow_endpoint: async (userId) => {
    const token = `${userId}:registration:1700000000`;
    await handleRegistrationDataExchange(userId, 'PERSONAL_INFO', { full_name: 'Ayesha Bano', country: 'PK' }, token);
    return handleRegistrationDataExchange(userId, 'PROFESSIONAL_INFO',
      { organization: 'niete', school_name: 'Test School', grade: 'grade_5', subjects: ['maths'], role: 'teacher' }, token);
  },
  flow_reply: async (userId) => handleRegistrationFlow({ interactive: { nfm_reply: { response_json: JSON.stringify({
    full_name: 'Ayesha Bano', country: 'PK', organization: 'niete', school_name: 'Test School',
    grade: 'grade_5', subjects: ['maths'], role: 'teacher', language: 'en',
  }) } } }, PHONE, userId),
  name_reply: async (userId) => FeatureRegistrationService.handleNameResponse(userId, 'Ayesha', PHONE, 'en', 'text'),
};
const TODAY = {
  flow_endpoint: (res) => expect(res.screen).toBe('SUCCESS'),
  flow_reply: (res) => expect(res).toBe(true),
  name_reply: (res) => expect(res).toEqual(expect.objectContaining({ success: true })),
};

describe.each(Object.keys(SITES))('registration.would_match from %s', (source) => {
  let n = 0;
  const nextId = () => { n += 1; return `a0000000-0000-4000-8000-${source === 'flow_endpoint' ? '1' : source === 'flow_reply' ? '2' : '3'}${String(n).padStart(11, '0')}`; };

  test('a live account with the same school and name is recorded, with ids only', async () => {
    const id = nextId();
    mockTables.users.push(me(id));
    TODAY[source](await SITES[source](id));
    await settle();
    expect(wouldMatch()).toEqual([expectedEvent(id, source)]);
    const text = JSON.stringify(wouldMatch());
    for (const secret of [PHONE, PEER.phone_number, 'Ayesha', 'ayesha', id, PEER.id]) expect(text).not.toContain(secret);
  });

  test('nobody else at her school with her name: nothing recorded', async () => {
    const id = nextId();
    mockTables.users = [me(id), ...NOT_PEERS];
    TODAY[source](await SITES[source](id));
    await settle();
    expect(wouldMatch()).toEqual([]);
  });

  test('the check is not awaited: the reply comes back while it is still reading', async () => {
    const id = nextId();
    mockTables.users.push(me(id));
    let open;
    mockPeerRead.gate = new Promise((r) => { open = r; });
    const res = await Promise.race([SITES[source](id), new Promise((r) => setTimeout(() => r('blocked'), 2000))]);
    expect(res).not.toBe('blocked');
    TODAY[source](res);
    expect(wouldMatch()).toEqual([]);
    open();
    await settle();
    expect(wouldMatch()).toEqual([expectedEvent(id, source)]);
  });

  test('a failing check is swallowed: the reply is today\'s, nothing recorded', async () => {
    const id = nextId();
    mockTables.users.push(me(id));
    mockPeerRead.fail = true;
    TODAY[source](await SITES[source](id));
    await settle();
    expect(wouldMatch()).toEqual([]);
  });

  test('log only: the check adds no write', async () => {
    const id = nextId();
    mockTables.users.push(me(id));
    await SITES[source](id);
    const before = mockWrites.length;
    await settle();
    expect(wouldMatch()).toHaveLength(1);
    expect(mockWrites.length).toBe(before);
  });
});

describe('the name comparison', () => {
  // Loaded inside each test, so the sign-up rows above still run (and fail for their own reason) where it is missing.
  const normaliseName = (s) => require('../../bot/shared/services/identity/identity-events').normaliseName(s);
  test.each([
    ['  ayesha   BANO ', 'Ayesha Bano'],
    ['Zoë Ali-Khan', 'zoe ali khan'],
    ['مُحَمَّد علی', 'محمد علی'],
  ])('"%s" and "%s" are the same name', (a, b) => {
    expect(normaliseName(a)).toBe(normaliseName(b));
    expect(normaliseName(a)).not.toBe('');
  });
  test('different names stay different', () => {
    expect(normaliseName('Ayesha Bano')).not.toBe(normaliseName('Ayesha Khan'));
  });
});

describe('registration.would_match is checked once per account per process', () => {
  test('the endpoint and the terminal reply both finishing one sign-up record one event', async () => {
    const id = 'a0000000-0000-4000-8000-400000000001';
    mockTables.users.push(me(id));
    await SITES.flow_endpoint(id);
    await settle();
    await SITES.flow_reply(id);
    await settle();
    expect(wouldMatch()).toEqual([expectedEvent(id, 'flow_endpoint')]);
  });
});
