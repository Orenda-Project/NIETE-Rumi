/**
 * bd-59 — the observe endpoint must work for EVERY pack, not just mewaka.
 *
 * Found in PK production (Noor, 2026-07-17, 9 failed opens): the HOTS flow
 * crashed on INIT with "Cannot read properties of undefined (reading
 * 'indicators')". Two stacked bugs, both invisible on TZ/mewaka:
 *   1. the INIT branch hardcoded the mewaka first-domain key 'introduction'
 *      (the bd-52 pack refactor converted BACK/data_exchange but missed INIT);
 *   2. fid() assumed string indicator ids ("C3.7".replace) — HOTS ids are
 *      NUMBERS (7), and the published HOTS flow's field names are ev_1..ev_16.
 */

jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    __store: store,
    setexWithCeiling: jest.fn((k, ttl, v) => { store.set(k, v); return Promise.resolve('OK'); }),
    get: jest.fn((k) => {
      const v = store.get(k);
      if (!v) return Promise.resolve(null);
      try { return Promise.resolve(JSON.parse(v)); } catch { return Promise.resolve(v); }
    }),
    delete: jest.fn((k) => { store.delete(k); return Promise.resolve(1); }),
  };
});

let mockSessionRow = null;
const mockUpdates = [];
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: mockSessionRow, error: null })),
    update: jest.fn((patch) => {
      mockUpdates.push(patch);
      return { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
    }),
  })),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlowMessage: jest.fn().mockResolvedValue(true),
}));

const redis = require('../../shared/services/cache/railway-redis.service');
const hots = require('../../shared/services/coaching/frameworks/hots-framework');
const { handleObserveMewakaRequest } = require('../../shared/routes/observe-mewaka-endpoint');
const ObserveDraft = require('../../shared/services/observe/observe-draft.service');
const { getObservePack } = require('../../shared/services/observe/observe-framework');

// HOTS-shaped analysis exactly as the worker stores it: numeric indicator ids.
function hotsFixtureAnalysis() {
  process.env.OBSERVE_FRAMEWORK = 'hots';
  const pack = getObservePack();
  const analysis = { framework: 'hots', language: 'ur', domains: {} };
  Object.entries(pack.domains).forEach(([key, d]) => {
    analysis.domains[key] = {
      indicators: d.indicators.map((ind) => ({ id: ind.id, score: 2, evidence_sw: 'ثبوت', improvement_sw: 'مشورہ' })),
    };
  });
  return analysis;
}

beforeEach(() => {
  jest.clearAllMocks();
  redis.__store.clear();
  mockUpdates.length = 0;
  process.env.OBSERVE_FRAMEWORK = 'hots';
  mockSessionRow = {
    id: 'sess-pk1', user_id: 'aeo-1', observer_user_id: 'aeo-1',
    observation_type: 'leader_observation',
    analysis_data: hotsFixtureAnalysis(),
    users: { phone_number: '923375106516', first_name: 'Noor', preferred_language: 'ur' },
  };
});

afterEach(() => { delete process.env.OBSERVE_FRAMEWORK; });

const TOKEN = 'aeo-1:sess-pk1';

describe('bd-59 — HOTS pack endpoint', () => {
  test('INIT → DOMAIN_A prefilled from the FIRST HOTS domain (never the mewaka key)', async () => {
    const res = await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });
    expect(res.data.error).toBeUndefined();
    expect(res.screen).toBe('DOMAIN_A');
    // classroom_environment is HOTS domain #1; its indicator ids are numeric.
    const pack = getObservePack();
    const firstIds = pack.domains[pack.domainOrder[0]].indicators.map((i) => i.id);
    for (const id of firstIds) {
      expect(res.data[`s_${id}`]).toBe('2');
      expect(res.data[`e_${id}`]).toBe('ثبوت');
      expect(res.data[`i_${id}`]).toBe('مشورہ');
    }
  });

  test('BACK and data_exchange pagination survive numeric ids across all 5 screens', async () => {
    for (const screen of ['DOMAIN_A', 'DOMAIN_B', 'DOMAIN_C', 'DOMAIN_D']) {
      const res = await handleObserveMewakaRequest({
        action: 'data_exchange', flow_token: TOKEN,
        data: { _screen: screen, r_1: '3' },
      });
      expect(res.data.error).toBeUndefined();
    }
  });

  test('buildScreenPrefill: numeric ids never crash (the fid("C3.7") assumption)', () => {
    const analysis = hotsFixtureAnalysis();
    const pack = getObservePack();
    for (const key of pack.domainOrder) {
      expect(() => ObserveDraft.buildScreenPrefill(analysis, key)).not.toThrow();
    }
  });

  test('applyObserverEdits maps r_<numeric-id> edits back onto the analysis', async () => {
    const edits = { r_1: '3', ev_1: 'nayi shahadat', imp_1: 'naya mashwara' };
    await ObserveDraft.applyObserverEdits('sess-pk1', edits);
    const v2Write = mockUpdates.find((u) => u.analysis_data);
    expect(v2Write).toBeTruthy();
    const ind = Object.values(v2Write.analysis_data.domains)
      .flatMap((d) => d.indicators).find((i) => i.id === 1);
    expect(ind.score).toBe(3);
    expect(ind.evidence_sw).toBe('nayi shahadat');
    expect(v2Write.analysis_data.observer_edit_summary.indicators_rescored).toBe(1);
    // scores recomputed with the hots pack (16 indicators × 3 max)
    expect(v2Write.analysis_data.scores.overall_max_marks).toBe(48);
  });
});

describe('bd-60 — score-scale labels follow the pack, not Kiswahili hardcodes', () => {
  test('hots INIT serves the ur/en scale (the published flow binds ${data.scale} at runtime)', async () => {
    const res = await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });
    const titles = res.data.scale.map((o) => o.title);
    expect(titles[0]).toBe('0 · نظر نہیں آیا · Absent');
    expect(titles[3]).toBe('3 · بھرپور · Strong');
    expect(titles.join()).not.toMatch(/Haikuonekana|Mara chache/);
  });

  test('mewaka INIT keeps the Swahili scale byte-identical', async () => {
    delete process.env.OBSERVE_FRAMEWORK;
    const mewaka = require('../../shared/services/coaching/frameworks/mewaka-framework');
    const { domains } = mewaka.getScoringConstants();
    const analysis = { framework: 'mewaka', domains: {} };
    Object.entries(domains).forEach(([key, d]) => {
      analysis.domains[key] = { indicators: d.indicators.map((i) => ({ id: i.id, score: 1 })) };
    });
    mockSessionRow.analysis_data = analysis;
    const res = await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });
    expect(res.data.scale.map((o) => o.title)).toEqual([
      '0 · Haikuonekana kabisa', '1 · Mara chache', '2 · Vya kutosha', '3 · Sana',
    ]);
  });
});
