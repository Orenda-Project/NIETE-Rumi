'use strict';
/**
 * The "Continue on WhatsApp" button through the REAL /webhook route, the REAL WhatsApp service and the real handlers:
 * a coach on the portal's HITL switches types /observe, gets the app's button and the WhatsApp button, taps the
 * WhatsApp button, and today's WhatsApp /observe starts at its first step (the visit Flow). Only the network is faked:
 * the Graph API (global fetch + the axios stub), Supabase (in memory) and Redis (in memory). Harness as in
 * tests/feedback/whatsapp-feedback-webhook.test.js.
 */
const http = require('http');
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const PHONE = '923001112244';
const COACH = '60530046-7ac3-4ea3-a976-b43c37c23213';
const BUTTON_ID = 'coach_app_wa:observe';
const VISIT_FLOW = 'flow-visit-266';
const later = (ms) => new Promise((r) => setTimeout(r, ms));

const ENV = {
  INBOUND_TYPING_DEFER_MS: '0',
  INTERNAL_API_KEY: 'test-internal-key',
  PORTAL_URL: 'https://portal.example.test',
  OBSERVE_VISIT_FLOW_ID: VISIT_FLOW,
  OBSERVE_MEWAKA_FLOW_ID: 'flow-observe',
  OBSERVE_SCHEDULING_UI: 'true',
};

let mockDb;
let mockRedis;
let graph;
let realFetch;
let savedEnv;
let seq = 0;

function seedDb({ role = 'coach', settings = null } = {}) {
  const hitl = [
    { key: 'portal_coach_v2', value: true },
    { key: 'portal_coach_full_app', value: [COACH] },
    { key: 'portal_coach_flow_v2', value: [COACH] },
  ];
  mockDb = createMemorySupabase({
    users: [{
      id: COACH, phone_number: PHONE, name: 'Test Coach', first_name: 'Test', preferred_language: 'en',
      registration_completed: true, registration_state: 'completed', role, school_id: 's-1',
      preferences: { observe_onboarded: true },
    }],
    app_settings: settings || hitl,
    leader_schools: [],
    coaching_sessions: [],
    user_feature_first_use: [],
  });
}

function mockBoundaries() {
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: (table) => mockDb.from(table),
    rpc: (...a) => mockDb.rpc(...a),
  }));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
  jest.doMock('../../bot/shared/utils/logger', () => ({
    logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn(),
  }));
}

const isMessage = (b) => Boolean(b && b.to && b.type && b.type !== 'reaction');
const messages = () => graph.filter(isMessage);
const interactive = (kind) => messages().filter((b) => b.type === 'interactive' && b.interactive.type === kind);
const waButtonMessages = () => interactive('button')
  .filter((b) => b.interactive.action.buttons.some((x) => x.reply.id === BUTTON_ID));
const visitFlows = () => interactive('flow')
  .filter((b) => b.interactive.action && b.interactive.action.parameters && b.interactive.action.parameters.flow_id === VISIT_FLOW);

function webhookBody(message) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'pnid', display_phone_number: '920000000000' },
          contacts: [{ wa_id: PHONE, profile: { name: 'Coach' } }],
          messages: [{ from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
        },
      }],
    }],
  };
}

const tap = (id) => ({ id: `wamid.IN_${++seq}`, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'tap' } } });
const text = (body) => ({ id: `wamid.IN_${++seq}`, type: 'text', text: { body } });

async function post(message) {
  const { app } = require('../../bot/whatsapp-bot');
  const drain = require('../../bot/shared/utils/web-drain');
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await realFetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(webhookBody(message)),
    });
    expect(res.status).toBe(200);
    await later(20);
    const deadline = Date.now() + 8000;
    while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
    await later(50);
  } finally {
    server.close();
  }
}

beforeEach(() => {
  jest.resetModules();
  savedEnv = {};
  for (const [k, v] of Object.entries(ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  graph = [];
  mockRedis = createMemoryRedis();
  // observe-state writes through setexWithCeiling, which the shared double does not have; without it the visit
  // Flow's state write fails and /observe re-sends the Flow (today's fallback), so the counts below would be noise.
  mockRedis.setexWithCeiling = async (k, ttl, v) => mockRedis.set(k, v, ttl);
  seedDb();
  mockBoundaries();
  realFetch = global.fetch;
  global.fetch = jest.fn(async (url, init) => {
    if (String(url).includes('graph.facebook.com')) {
      let body = null;
      try { body = JSON.parse((init && init.body) || 'null'); } catch (_) { body = null; }
      graph.push(body);
      return { ok: true, status: 200, json: async () => ({ success: true, messages: [{ id: `wamid.OUT_${graph.length}` }] }), text: async () => '' };
    }
    return realFetch(url, init);
  });
  const axios = require('axios');
  axios.post.mockImplementation(async (url, body) => {
    if (/\/messages(\?|$)/.test(String(url))) graph.push(body);
    return { status: 200, data: { messages: [{ id: `wamid.OUT_${graph.length}` }], id: 'media-1' } };
  });
});

afterEach(() => {
  global.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('a coach on the portal\'s HITL switches', () => {
  test('/observe → the app\'s button and the WhatsApp button; the tap → today\'s WhatsApp /observe (the visit Flow)', async () => {
    await post(text('/observe'));
    expect(interactive('cta_url')).toHaveLength(1);
    expect(waButtonMessages()).toHaveLength(1);
    expect(visitFlows()).toHaveLength(0);

    await post(tap(BUTTON_ID));
    expect(visitFlows()).toHaveLength(1);
    // the tap does not loop back to the app's button
    expect(interactive('cta_url')).toHaveLength(1);
  }, 30000);

  test('the tap works on its own, hours later, with nothing armed', async () => {
    await post(tap(BUTTON_ID));
    expect(visitFlows()).toHaveLength(1);
    expect(interactive('cta_url')).toHaveLength(0);
  }, 30000);

  test('the tap answers once: no second Flow, no app button', async () => {
    await post(tap(BUTTON_ID));
    expect(visitFlows()).toHaveLength(1);
    expect(interactive('cta_url')).toHaveLength(0);
    expect(waButtonMessages()).toHaveLength(0);
  }, 30000);
});

describe('a coach the switches do not name: today\'s WhatsApp /observe, unchanged', () => {
  test('/observe → the visit Flow, no app button, no WhatsApp button', async () => {
    seedDb({ settings: [{ key: 'portal_coach_v2', value: true }, { key: 'portal_coach_full_app', value: [COACH] }] });
    await post(text('/observe'));
    expect(visitFlows()).toHaveLength(1);
    expect(interactive('cta_url')).toHaveLength(0);
    expect(waButtonMessages()).toHaveLength(0);
  }, 30000);
});

describe('anyone else tapping it: no WhatsApp /observe from this button', () => {
  test.each(['principal', 'teacher'])('a %s', async (role) => {
    seedDb({ role, settings: [] });
    await post(tap(BUTTON_ID));
    expect(visitFlows()).toHaveLength(0);
  }, 30000);
});
