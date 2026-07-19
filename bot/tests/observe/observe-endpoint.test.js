/**
 * FEAT-053 bd-18/bd-20 — data_exchange endpoint: INIT prefill, per-screen
 * pagination, edit accumulation, final submit → write-back → SUCCESS.
 * CRITICAL contract: no `version` field in any response (bd-215).
 */

jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    __store: store,
    setexWithCeiling: jest.fn((k, ttl, v) => { store.set(k, v); return Promise.resolve('OK'); }),
    // REAL contract: railway-redis get() auto-parses JSON and returns the
    // OBJECT (string only when its own parse fails). Modeling this faithfully
    // is what catches double-parse bugs (staging incident 2026-07-12).
    get: jest.fn((k) => {
      const v = store.get(k);
      if (!v) return Promise.resolve(null);
      try { return Promise.resolve(JSON.parse(v)); } catch { return Promise.resolve(v); }
    }),
    delete: jest.fn((k) => { store.delete(k); return Promise.resolve(1); }),
  };
});

let mockSessionRow = null;
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: mockSessionRow, error: null })),
    update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) })),
  })),
}));

jest.mock('../../shared/services/observe/observe-draft.service', () => {
  const actual = jest.requireActual('../../shared/services/observe/observe-draft.service');
  return { ...actual, applyObserverEdits: jest.fn().mockResolvedValue({ indicators_rescored: 1 }) };
});

const redis = require('../../shared/services/cache/railway-redis.service');
const ObserveDraft = require('../../shared/services/observe/observe-draft.service');
const mewaka = require('../../shared/services/coaching/frameworks/mewaka-framework');
const { handleObserveMewakaRequest } = require('../../shared/routes/observe-mewaka-endpoint');

function fixtureAnalysis() {
  const { domains } = mewaka.getScoringConstants();
  const analysis = { framework: 'mewaka', language: 'sw', domains: {} };
  Object.entries(domains).forEach(([key, d]) => {
    analysis.domains[key] = { indicators: d.indicators.map(ind => ({ id: ind.id, score: 1, evidence_sw: 'e', improvement_sw: 'i' })) };
  });
  return analysis;
}

beforeEach(() => {
  jest.clearAllMocks();
  redis.__store.clear();
  mockSessionRow = {
    id: 'sess-9', user_id: 'fo-1', observer_user_id: 'fo-1',
    observation_type: 'leader_observation',
    analysis_data: fixtureAnalysis(),
  };
});

const TOKEN = 'fo-1:sess-9';

describe('handleObserveMewakaRequest', () => {
  test('ping → active, no version field', async () => {
    const res = await handleObserveMewakaRequest({ action: 'ping' });
    expect(res.data.status).toBe('active');
    expect(res.version).toBeUndefined();
  });

  test('INIT → DOMAIN_A with prefill bound keys', async () => {
    const res = await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });
    expect(res.version).toBeUndefined();
    expect(res.screen).toBe('DOMAIN_A');
    expect(res.data.s_A1_1).toBe('1');
    expect(res.data.scale).toHaveLength(4);
  });

  test('data_exchange DOMAIN_A → stores edits, returns DOMAIN_B prefill', async () => {
    const res = await handleObserveMewakaRequest({
      action: 'data_exchange', flow_token: TOKEN,
      data: { _screen: 'DOMAIN_A', r_A1_1: '3', ev_A1_1: 'edited', imp_A1_1: 'i', r_A1_2: '1', ev_A1_2: 'e', imp_A1_2: 'i' },
    });
    expect(res.screen).toBe('DOMAIN_B');
    expect(res.data.s_B2_1).toBe('1');
    const buffered = JSON.parse(redis.__store.get('observe:edits:sess-9'));
    expect(buffered.r_A1_1).toBe('3');
    expect(buffered.ev_A1_1).toBe('edited');
  });

  test('final screen submit → applyObserverEdits with ALL accumulated edits → SUCCESS', async () => {
    // simulate A..E already buffered
    redis.__store.set('observe:edits:sess-9', JSON.stringify({ r_A1_1: '3' }));
    const res = await handleObserveMewakaRequest({
      action: 'data_exchange', flow_token: TOKEN,
      data: { _screen: 'DOMAIN_F', r_F6_1: '0', ev_F6_1: 'x', imp_F6_1: 'y', r_F6_2: '1', ev_F6_2: 'e', imp_F6_2: 'i' },
    });
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.extension_message_response.params.observe_action).toBe('submitted');
    expect(ObserveDraft.applyObserverEdits).toHaveBeenCalledTimes(1);
    const [sid, edits] = ObserveDraft.applyObserverEdits.mock.calls[0];
    expect(sid).toBe('sess-9');
    expect(edits.r_A1_1).toBe('3');   // earlier screen retained
    expect(edits.r_F6_1).toBe('0');   // final screen merged
  });

  test('bad token → error payload (no throw, no version)', async () => {
    mockSessionRow = null;
    const res = await handleObserveMewakaRequest({ action: 'INIT', flow_token: 'nope:missing' });
    expect(res.data.error).toBeDefined();
    expect(res.version).toBeUndefined();
  });

  test('BACK re-serves the requested screen prefill', async () => {
    const res = await handleObserveMewakaRequest({ action: 'BACK', flow_token: TOKEN, screen: 'DOMAIN_C' });
    expect(res.screen).toBe('DOMAIN_C');
    expect(res.data.s_C3_1).toBe('1');
  });
});
