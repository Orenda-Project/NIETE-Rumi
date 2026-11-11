/**
 * bd-ra8xu.38 — the /observe review endpoint on a FICO17 v6 visit (stamp on the session), and that a V3 FICO visit
 * is served exactly as before. Pairs with fico17-v6-observe-pack.test.js.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    __store: store,
    setexWithCeiling: jest.fn((k, ttl, v) => { store.set(k, v); return Promise.resolve('OK'); }),
    setNX: jest.fn(() => Promise.resolve(true)),
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
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(() => {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      not: jest.fn(() => chain),
      then: (res, rej) => Promise.resolve({ data: [{ id: 'sess-6' }], error: null }).then(res, rej),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
      single: jest.fn(() => Promise.resolve({ data: { ...mockSessionRow, users: { name: 'C', phone_number: '1' } }, error: null })),
      update: jest.fn((patch) => { mockUpdates.push(patch); return chain; }),
    };
    return chain;
  }),
}));

jest.mock('../../bot/shared/services/observe/observe-language', () => ({ languageFor: jest.fn(async () => 'en') }));

const redis = require('../../bot/shared/services/cache/railway-redis.service');
const ObserveDraft = require('../../bot/shared/services/observe/observe-draft.service');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { handleObserveMewakaRequest } = require('../../bot/shared/routes/observe-mewaka-endpoint');

const TOKEN = 'co-1:sess-6';

function v6Analysis() {
  const levels = {};
  v6.DC_CODES.forEach((c) => { levels[c] = { result: 2, because: `Rumi heard ${c}`, evidence: [{ time: '03:10', quote: 'Why is that?' }] }; });
  const domains = {};
  Object.values(v6.SECTIONS).forEach((s) => {
    domains[s.domain] = { indicators: s.codes.map((c) => ({ id: c, score: v6.isDc(c) ? 2 : null, result: v6.isDc(c) ? 2 : null })) };
  });
  return {
    framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+abcd1234', levels, domains,
    combined_evidence: { C3: { result: null, items: [{ time: '05:10', quote: 'Ali, what do you think?', kind: 'name_called' }] }, D3: { result: 'NA', items: [] }, D2: { student_turns_first_half: 30, student_turns_second_half: 12 } },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  redis.__store.clear();
  mockUpdates.length = 0;
  mockSessionRow = {
    id: 'sess-6', user_id: 't-1', observer_user_id: 'co-1', status: 'awaiting_observer_review',
    observation_type: 'leader_observation', framework: 'fico17_v6', analysis_data: v6Analysis(),
  };
});

const goodC = () => ({
  _screen: 'DOMAIN_C', r_C1: '2', r_C2: '2', r_C4: '2', r_C6: '2', r_C8: '2',
  r_C3: '3', why_C3: 'Named Ali and Sara before asking.', r_C5: '2', why_C5: 'Signal given, took about three minutes.',
  r_C7: 'NA', why_C7: 'No group task in this lesson at all.',
});

describe('v6 visit', () => {
  test('INIT serves screen B (the measured fidelity, editable) — same first screen as V3', async () => {
    const res = await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN });
    expect(res.screen).toBe('DOMAIN_B');
    expect(res.data.fid_scale).toBeDefined();
    expect(res.version).toBeUndefined();
  });

  test('B → C serves Rumi\'s DC levels and the combined evidence, no combined pre-selection', async () => {
    const res = await handleObserveMewakaRequest({ action: 'data_exchange', flow_token: TOKEN, data: { _screen: 'DOMAIN_B' } });
    expect(res.screen).toBe('DOMAIN_C');
    expect(res.data.s_C1).toBe('2');
    expect(res.data.s_C3).toBeUndefined();
    expect(res.data.cb_C3).toContain('05:10  "Ali, what do you think?"');
    expect(res.data.cb_C3).toContain('Coach adds:');
    expect(res.data.err_v).toBe(false);
  });

  test('a short reason keeps the coach on the same screen with the reason listed, answers kept', async () => {
    const res = await handleObserveMewakaRequest({ action: 'data_exchange', flow_token: TOKEN, data: { ...goodC(), why_C3: 'too short' } });
    expect(res.screen).toBe('DOMAIN_C');
    expect(res.data.err_v).toBe(true);
    expect(res.data.err_note).toContain('Who got to answer');
    expect(res.data.w_C3).toBe('too short');
    expect(res.data.w_C5).toBe('Signal given, took about three minutes.');
  });

  test('a changed DC level with no reason is refused; with a reason it goes on to D', async () => {
    let res = await handleObserveMewakaRequest({ action: 'data_exchange', flow_token: TOKEN, data: { ...goodC(), r_C1: '4' } });
    expect(res.screen).toBe('DOMAIN_C');
    expect(res.data.err_note).toMatch(/changed a level Rumi set/);
    expect(res.data.s_C1).toBe('4');
    res = await handleObserveMewakaRequest({ action: 'data_exchange', flow_token: TOKEN, data: { ...goodC(), r_C1: '4', chg_C: 'She asked why and followed it up.' } });
    expect(res.screen).toBe('DOMAIN_D');
    expect(res.data.cb_D2).toContain('30 student turns in the first half and 12');
    expect(res.data.cb_D3).toContain('no child-to-child talk');
  });

  test('applyObserverEdits stores every level with rubric, prompt_version and set_by, and v6 totals', async () => {
    const edits = {
      ...goodC(), r_C1: '4', chg_C: 'She asked why and followed it up.',
      r_D1: '2', r_D5: '2', d2_children: '4', d2_quiet_later: '0', r_D2: '3', why_D2: 'Four children answered, front rows.',
      r_D3: 'NA', why_D3: 'No child spoke to another child.', r_D4: '2', why_D4: 'They answered only when they were sure.',
      r_F1: '2', r_F2: '2', r_F3: '2', r_F4: '2',
    };
    const summary = await ObserveDraft.applyObserverEdits('sess-6', edits);
    expect(summary.indicators_rescored).toBeGreaterThan(0);
    const written = mockUpdates.find((u) => u.analysis_data && u.status === 'observer_review_complete');
    const ad = written.analysis_data;
    expect(ad.framework).toBe('fico17_v6');
    expect(ad.fico17_v6_review.levels.C1).toMatchObject({ level: 4, set_by: 'coach', rumi_level: 2, rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+abcd1234' });
    expect(ad.fico17_v6_review.levels.C3).toMatchObject({ level: 3, set_by: 'coach', because: 'Named Ali and Sara before asking.', rubric: 'fico17_v6' });
    expect(ad.fico17_v6_review.levels.F1).toMatchObject({ level: 2, set_by: 'rumi' });
    expect(ad.fico17_v6_review.d2_counts).toEqual({ children: 4, quiet_later: 0 });
    expect(ad.scores.rubric).toBe('fico17_v6');
    expect(ad.domains.v6_teacher.indicators.find((i) => i.id === 'C1').score).toBe(4);
    expect(ad.domains.lesson_plan_fidelity).toBeUndefined();
  });
});

describe('a V3 FICO visit on the same deployment is untouched', () => {
  test('no stamp: the V3 pack drives the screens and no v6 field is served', async () => {
    mockSessionRow = { ...mockSessionRow, framework: 'fico', analysis_data: { framework: 'fico', domains: {} } };
    const res = await handleObserveMewakaRequest({ action: 'data_exchange', flow_token: TOKEN, data: { _screen: 'DOMAIN_B' } });
    expect(res.screen).toBe('DOMAIN_C');
    expect(Object.keys(res.data)).toEqual(expect.arrayContaining(['scale', 's_C1', 'e_C1', 'i_C1', 's_C12']));
    expect(res.data.err_v).toBeUndefined();
    expect(res.data.cb_C3).toBeUndefined();
  });
});
