/**
 * bd-x7aprz.9 (P0) — pressing Finish on the v5 registration Flow did nothing.
 *
 * Production, 2026-10-19 06:48–06:49Z (niete-logs): the final screen's data_exchange was answered
 * four times with {screen:'SUCCESS', data:{t_heading, …, school_linked}} — a reply that asks the
 * client to RENDER the SUCCESS screen. The client never did; it re-sent TEACHING each time, no
 * nfm_reply arrived, and no welcome reached the chat. The v4 reply that had worked (116
 * registration completions in the 14 days before) closes the Flow from the endpoint instead:
 * {screen:'SUCCESS', data:{extension_message_response:{params:{…}}}} — WhatsApp then closes the
 * Flow and delivers the params as the nfm_reply. This pins that contract for v5.1, and checks
 * every other v5 reply against the Flow JSON the deployment actually registers.
 */

const mockRedisStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (key) => {
    if (!mockRedisStore.has(key)) return null;
    const raw = mockRedisStore.get(key);
    try { return JSON.parse(raw); } catch { return raw; }
  }),
  set: jest.fn(async (key, value) => {
    mockRedisStore.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/language-cache', () => ({ setUserLanguage: jest.fn(async () => true) }));
jest.mock('../../bot/shared/config/branding', () => ({ portalUrl: () => 'https://portal.example.com' }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => ({ ok: true })),
  sendCtaUrl: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({}));
jest.mock('../../bot/shared/services/reading/passage-generation.service', () => ({}));
jest.mock('../../bot/shared/services/reading/auto-level-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/services/student-ingress-cache', () => ({ forget: jest.fn(async () => {}) }));

const mockUsers = new Map();
const mockSchools = [];
jest.mock('../../bot/shared/config/supabase', () => {
  const usersQuery = () => {
    const q = {
      _id: null,
      select: () => q,
      eq: (col, val) => { if (col === 'id') q._id = val; return q; },
      single: async () => ({ data: mockUsers.get(q._id) || null, error: null }),
      maybeSingle: async () => ({ data: mockUsers.get(q._id) || null, error: null }),
      update: (cols) => ({
        eq: async (col, val) => { mockUsers.set(val, { ...(mockUsers.get(val) || {}), ...cols }); return { data: null, error: null }; },
      }),
    };
    return q;
  };
  const schoolsQuery = () => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: mockSchools.slice(), error: null }).then(resolve, reject),
    };
    return q;
  };
  return { from: jest.fn((t) => (t === 'schools' ? schoolsQuery() : usersQuery())) };
});

const fs = require('fs');
const path = require('path');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const UID = '22222222-2222-4222-8222-222222222222';
const TOKEN = `${UID}:registration:1792392401964`;
const SCHOOL = { id: 'bbbbbbbb-0000-4000-8000-000000000001', name: 'IMSG (I-VIII) G-7/3-2', region: 'Urban-I', emis: '215', is_probable_test: false };

const ep = () => require('../../bot/shared/routes/registration-endpoint');

/** The Flow JSON this deployment registers for registration (flow-configs.js). */
function configuredFlow() {
  const { FLOW_CONFIGS } = require('../../bot/scripts/setup/flow-configs');
  const cfg = FLOW_CONFIGS.find((c) => c.envVar === 'REGISTRATION_FLOW_ID');
  return { file: path.basename(cfg.jsonPath), json: JSON.parse(fs.readFileSync(cfg.jsonPath, 'utf8')) };
}

/** Keys a screen binds only as a Form init-value — the client renders without them (prod 06:47:57Z, TEACHING). */
function initOnlyKeys(screen) {
  const init = new Set();
  const used = new Set();
  const walk = (node, inInit) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, inInit));
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, inInit || k === 'init-values');
      return;
    }
    if (typeof node === 'string') {
      for (const m of node.matchAll(/\$\{data\.([a-zA-Z0-9_]+)\}/g)) (inInit ? init : used).add(m[1]);
    }
  };
  walk(screen.layout, false);
  return new Set([...init].filter((k) => !used.has(k)));
}

/** Every reply must name a screen of the configured Flow and fit its declared data model. */
function expectFitsDeclared(reply) {
  const { file, json } = configuredFlow();
  const screen = json.screens.find((s) => s.id === reply.screen);
  if (!screen) throw new Error(`${file} has no screen ${reply.screen}`);
  const declared = Object.keys(screen.data || {});
  const sent = Object.keys(reply.data || {});
  const undeclared = sent.filter((k) => !declared.includes(k));
  const optional = initOnlyKeys(screen);
  const missing = declared.filter((k) => !sent.includes(k) && !optional.has(k));
  expect({ screen: reply.screen, undeclared, missing }).toEqual({ screen: reply.screen, undeclared: [], missing: [] });
}

beforeEach(() => {
  mockRedisStore.clear();
  mockUsers.clear();
  mockSchools.length = 0;
  mockSchools.push(SCHOOL);
  mockUsers.set(UID, { id: UID, name: 'Hataf Test Account', role: 'teacher', preferred_language: 'en', language_locked: true, school_id: null, organization: null });
  jest.clearAllMocks();
  require('../../bot/shared/services/schools/school-search.service')._resetCache();
});

describe('(a) Finish closes the Flow — the endpoint completion contract', () => {
  it('the TEACHING reply carries extension_message_response.params, every param a string', async () => {
    await ep().handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'Hataf Test Account', language: 'en' }, TOKEN);
    await ep().handleRegistrationDataExchange(UID, 'SCHOOL_PICK', { school_id: SCHOOL.id }, TOKEN);
    const r = await ep().handleRegistrationDataExchange(UID, 'TEACHING', { grade: ['grade_1'], subjects: ['urdu'] }, TOKEN);
    expect(r.screen).toBe('SUCCESS');
    const params = r.data && r.data.extension_message_response && r.data.extension_message_response.params;
    expect(params).toEqual({
      registration_action: 'complete',
      flow_token: TOKEN,
      full_name: 'Hataf Test Account',
      language: 'en',
      school_linked: 'yes',
    });
    for (const v of Object.values(params)) expect(typeof v).toBe('string');
  });

  it('the configured Flow JSON is v5.1 and its SUCCESS declares extension_message_response.properties.params', () => {
    const { file, json } = configuredFlow();
    expect(file).toBe('registration-flow-v5.1.json');
    const success = json.screens.find((s) => s.id === 'SUCCESS');
    expect(success.terminal).toBe(true);
    const emr = success.data && success.data.extension_message_response;
    expect(emr && emr.properties && emr.properties.params).toBeTruthy();
  });
});

describe('(b) every v5 reply fits the screen it names, in the configured Flow JSON', () => {
  it('INIT', async () => {
    expectFitsDeclared(await ep().handleRegistrationInit(UID));
  });

  it('PERSONAL_INFO → ROLE_SCHOOL, for a teacher and for an admin-set coach', async () => {
    expectFitsDeclared(await ep().handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'A B', language: 'ur' }, TOKEN));
    mockUsers.set(UID, { ...mockUsers.get(UID), role: 'coach', school_id: SCHOOL.id });
    expectFitsDeclared(await ep().handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'A B', language: 'en' }, TOKEN));
  });

  it('ROLE_SCHOOL → SCHOOL_PICK, with matches, with her own school, and with none', async () => {
    expectFitsDeclared(await ep().handleRegistrationDataExchange(UID, 'ROLE_SCHOOL', { role: 'teacher', school_query: '215' }, TOKEN));
    mockUsers.set(UID, { ...mockUsers.get(UID), school_id: SCHOOL.id });
    expectFitsDeclared(await ep().handleRegistrationDataExchange(UID, 'ROLE_SCHOOL', { role: 'teacher', school_query: 'G-7/3' }, TOKEN));
    expectFitsDeclared(await ep().handleRegistrationDataExchange(UID, 'ROLE_SCHOOL', { role: 'teacher', school_query: 'zzqx nothing' }, TOKEN));
  });

  it('SCHOOL_PICK → TEACHING, picked and none, with and without grades on her row', async () => {
    expectFitsDeclared(await ep().handleRegistrationDataExchange(UID, 'SCHOOL_PICK', { school_id: 'none' }, TOKEN));
    mockUsers.set(UID, { ...mockUsers.get(UID), grades_taught: '["grade_2"]', subjects_taught: ['maths'] });
    expectFitsDeclared(await ep().handleRegistrationDataExchange(UID, 'SCHOOL_PICK', { school_id: SCHOOL.id }, TOKEN));
  });

  it('TEACHING → SUCCESS', async () => {
    await ep().handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'A B', language: 'en' }, TOKEN);
    expectFitsDeclared(await ep().handleRegistrationDataExchange(UID, 'TEACHING', { grade: [], subjects: [] }, TOKEN));
  });

  it('BACK from any v5 screen', async () => {
    for (const screen of ['ROLE_SCHOOL', 'SCHOOL_PICK', 'TEACHING']) {
      expectFitsDeclared(await ep().handleRegistrationBack(UID, screen, TOKEN));
    }
  });
});

describe('(c) the nfm_reply the close delivers → exactly one welcome with the /go button', () => {
  const nfm = (obj) => ({ interactive: { nfm_reply: { response_json: JSON.stringify(obj) } } });
  const params = { registration_action: 'complete', flow_token: TOKEN, full_name: 'Hataf Test Account', language: 'en', school_linked: 'yes' };

  beforeEach(() => {
    process.env.INTERNAL_API_KEY = 'test-internal-key';
    process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  });

  for (const [label, body] of [
    ['flat, as the endpoint close delivers it', { ...params }],
    ['nested, as a SUCCESS screen footer would post it', { extension_message_response: { params }, flow_token: TOKEN }],
  ]) {
    it(label, async () => {
      const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');
      expect(detectFlowType(body)).toBe('registration');
      const { routeRegistrationSubmission } = require('../../bot/shared/handlers/flow-response.handler');
      const ok = await routeRegistrationSubmission(nfm(body), '923000000000', UID);
      expect(ok).toBe(true);
      expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
      expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
      expect(WhatsAppService.sendCtaUrl.mock.calls[0][1].url).toMatch(/^https:\/\/portal\.example\.com\/go\//);
      expect(WhatsAppService.sendCtaUrl.mock.calls[0][1].body).toContain('Hataf');
    });
  }
});
