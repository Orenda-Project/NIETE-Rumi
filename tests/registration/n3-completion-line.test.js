'use strict';
/**
 * "Is this you?": the welcome after Finish says what happened (plan N3, section 5.6). The endpoint's close carries a
 * SUCCESS param `identity`; the welcome appends one line for "claimed" (her number now opens her existing account) or
 * "review" (someone will check the account she named), in her language. Anything else, or no param, is today's
 * welcome exactly.
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
jest.mock('../../bot/shared/config/supabase', () => {
  const q = () => {
    const b = {
      _id: null,
      select: () => b,
      eq: (col, val) => { if (col === 'id') b._id = val; return b; },
      single: async () => ({ data: mockUsers.get(b._id) || null, error: null }),
      maybeSingle: async () => ({ data: mockUsers.get(b._id) || null, error: null }),
      update: (cols) => ({ eq: async (col, val) => { mockUsers.set(val, { ...(mockUsers.get(val) || {}), ...cols }); return { data: null, error: null }; } }),
      then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    return b;
  };
  return { from: jest.fn(() => q()), rpc: async () => ({ data: null, error: null }) };
});

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { routeRegistrationSubmission } = require('../../bot/shared/handlers/flow-response.handler');

const UID = '22222222-2222-4222-8222-222222222222';
const TOKEN = `${UID}:registration:1763600000000`;
const nfm = (obj) => ({ interactive: { nfm_reply: { response_json: JSON.stringify(obj) } } });
const params = (o = {}) => ({ registration_action: 'complete', flow_token: TOKEN, full_name: 'Ayesha Siddiqa', language: 'en', school_linked: 'yes', ...o });

async function welcome(p) {
  WhatsAppService.sendCtaUrl.mockClear();
  WhatsAppService.sendMessage.mockClear();
  const ok = await routeRegistrationSubmission(nfm(p), '923000000000', UID);
  expect(ok).toBe(true);
  expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
  return WhatsAppService.sendCtaUrl.mock.calls[0][1].body;
}

beforeEach(() => {
  process.env.INTERNAL_API_KEY = 'test-internal-key';
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  mockUsers.set(UID, { id: UID, name: 'Ayesha Siddiqa', role: 'teacher', school_id: 'aaaaaaaa-0000-4000-8000-000000000003' });
});

test.each(['en', 'ur'])('L1: identity "claimed" ends the welcome with the claimed line, in %s', async (language) => {
  const body = await welcome(params({ identity: 'claimed', language }));
  expect(body.endsWith(`\n\n${resolveUx('regDoneClaimed', { language })}`)).toBe(true);
});

test.each(['en', 'ur'])('L2: identity "review" ends the welcome with the review line, in %s', async (language) => {
  const body = await welcome(params({ identity: 'review', language }));
  expect(body.endsWith(`\n\n${resolveUx('regDoneReview', { language })}`)).toBe(true);
});

test('L3: no identity, "none" or anything else is today\'s welcome exactly', async () => {
  const today = await welcome(params());
  for (const identity of ['none', 'claimed ', 'CLAIMED', 'other']) {
    expect(await welcome(params({ identity }))).toBe(today);
  }
  for (const language of ['en', 'ur']) {
    for (const key of ['regDoneClaimed', 'regDoneReview']) expect(today).not.toContain(resolveUx(key, { language }));
  }
});

test('L3: the line comes after the no-school line when both apply', async () => {
  const body = await welcome(params({ identity: 'review', school_linked: 'no' }));
  const noSchool = resolveUx('regDoneNoSchool', { language: 'en' });
  const review = resolveUx('regDoneReview', { language: 'en' });
  expect(body.indexOf(noSchool)).toBeGreaterThan(0);
  expect(body.indexOf(review)).toBeGreaterThan(body.indexOf(noSchool));
});
