'use strict';
/**
 * bd-ra8xu.38 — the self-recording pipeline with the DC rubric switch. 'v3' (the default) must be byte-identical
 * to today: no v6 call, the same analysis_data. 'shadow' (and 'v6', which does not switch the report yet) adds a
 * v6 score under analysis_data.shadow.fico17_v6 and leaves V3 exactly as it was; a v6 failure never touches V3.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn((patch) => { if (patch && patch.analysis_data) global.__PERSISTED = patch.analysis_data; return builder; }),
    eq: jest.fn(() => builder), not: jest.fn(() => builder), in: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' }, region: 'Sihala' }, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve()), sendSticker: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(() => Promise.resolve()), markAsFailed: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({
  fetchAndCompressPriorFeedback: jest.fn(() => Promise.resolve({ exists: false })),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({ getCoachingMessage: jest.fn(() => 'msg') }));
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({
  selectFrameworkWithReason: jest.fn(() => Promise.resolve({
    framework: require('../../bot/shared/services/coaching/frameworks/fico-framework'),
    frameworkKey: 'fico',
    reason: 'region_default',
  })),
}));
jest.mock('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator', () => ({
  isFidelityEnabled: jest.fn(() => false),
  resolveFidelitySources: jest.fn(() => ({ corpusKey: null, uploadedText: null, meta: {} })),
  computeLpFidelity: jest.fn(() => Promise.resolve(null)),
  fidelityPatch: jest.fn(() => ({})),
  isPhotoEvidenceOn: jest.fn(() => false),
}));
jest.mock('../../bot/shared/services/coaching/fico-rubric-switch', () => ({
  dcRubric: jest.fn(() => Promise.resolve(global.__DC)),
  coachRubric: jest.fn(() => Promise.resolve('current')),
  regionOfUser: jest.fn(() => Promise.resolve('Sihala')),
  // No switch value at all (the default) is the only time isAnySet is false.
  isAnySet: jest.fn(() => Promise.resolve(global.__DC !== 'v3' && global.__DC !== undefined)),
}));

const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');

const TRANSCRIPT = '[00:10] Teacher (ur): Ali, what is half of ten?\n[00:15] Student (ur): Five.\n[30:00] Student (ur): I agree.';

function v3Analysis() {
  const domains = {};
  for (const [key, def] of Object.entries(fico.getScoringConstants().domains)) {
    domains[key] = { indicators: def.indicators.map((i) => ({ id: i.id, score: 2 })) };
  }
  return fico.computeScores({ framework: 'fico', domains });
}

function v6Reply() {
  const levels = {};
  for (const c of v6.DC_CODES) levels[c] = { result: 3, because: 'seen', evidence: [{ time: '00:15', quote: 'Five.' }] };
  const combined_evidence = {};
  for (const c of ['C3', 'C5', 'C7', 'D3', 'D4']) combined_evidence[c] = { result: null, items: [] };
  return { levels, combined_evidence };
}

const mockAnalyze = jest.fn((transcript, metadata, lp, framework) => {
  if (framework && framework.name === 'fico17_v6') {
    if (global.__V6_FAIL) return Promise.reject(new Error('v6 provider down'));
    return Promise.resolve({
      analysis: { ...framework.computeScores(v6Reply(), false, transcript), framework: 'fico17_v6' },
      usage: { input_tokens: 5, output_tokens: 5, cached_tokens: 0, cost: 0.01 },
    });
  }
  return Promise.resolve({ analysis: { ...v3Analysis(), framework: 'fico' }, usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 } });
});
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: (...args) => mockAnalyze(...args),
  extractReflectiveCorpus: jest.fn(() => Promise.resolve(null)),
}));

const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');

const SID = 'sess-v6-shadow';
beforeEach(() => {
  jest.clearAllMocks();
  global.__PERSISTED = undefined;
  global.__V6_FAIL = false;
  global.__SESSION = {
    id: SID, user_id: 'u1', observation_type: 'self_observation',
    transcript_text: TRANSCRIPT, transcript_language: 'ur', classroom_photos: [],
    users: { phone_number: '92300', name: 'A B' },
  };
});

const v6Calls = () => mockAnalyze.mock.calls.filter((c) => c[3] && c[3].name === 'fico17_v6');

async function runWith(dc) {
  global.__DC = dc;
  await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
  return global.__PERSISTED;
}

describe('DC rubric switch on the self-recording pipeline', () => {
  test("'v3' (default): no v6 call, and analysis_data is exactly today's", async () => {
    const off = await runWith('v3');
    expect(v6Calls()).toHaveLength(0);
    expect(off.shadow).toBeUndefined();
    expect(off.framework).toBe('fico');
    expect(Object.keys(off)).not.toContain('shadow');
    expect(off.domains.high_leverage_practices.indicators[0]).toEqual({ id: 'C1', score: 2 });
  });

  test('default off costs no extra lookup: no region read when no switch value is set', async () => {
    const sw = require('../../bot/shared/services/coaching/fico-rubric-switch');
    sw.regionOfUser.mockClear();
    sw.dcRubric.mockClear();
    await runWith('v3');
    expect(sw.regionOfUser).not.toHaveBeenCalled();
    expect(sw.dcRubric).not.toHaveBeenCalled();
  });

  test("'shadow': v6 stored under analysis_data.shadow.fico17_v6, stamped; V3 unchanged", async () => {
    const off = JSON.parse(JSON.stringify(await runWith('v3')));
    const on = await runWith('shadow');
    expect(v6Calls()).toHaveLength(1);
    const s = on.shadow.fico17_v6;
    expect(s.status).toBe('ok');
    expect(s.rubric).toBe('fico17_v6');
    expect(s.prompt_version).toBe(v6.DC_PROMPT_VERSION);
    expect(s.levels.C1.result).toBe(3);
    expect(s.scores.overall_max_marks).toBe(44);
    const { shadow, ...v3Only } = on;
    expect(JSON.parse(JSON.stringify(v3Only))).toEqual(off);
    // the v6 call never carries the classroom photos
    const meta = v6Calls()[0][1];
    expect(meta.photo).toBeUndefined();
  });

  test("'v6': the read is stored under analysis_data.dc.fico17_v6 (CONTRACTS §7); an ok read moves the report to v6 (bd-ra8xu.52), V3 kept under v3_fico", async () => {
    const off = JSON.parse(JSON.stringify(await runWith('v3')));
    const on = await runWith('v6');
    expect(on.shadow).toBeUndefined();
    const d = on.dc.fico17_v6;
    expect(d.status).toBe('ok');
    expect(d.mode).toBe('v6');
    expect(d.rubric).toBe('fico17_v6');
    expect(d.transcript_quality).toEqual({ status: expect.any(String), coverage: expect.any(Number), issues: expect.any(Array) });
    // operator 14 Nov ~01:10 ("Yes", Qurat's DC report on v6): the report's analysis is v6; fico17-v6-dc-report-on-v6.test.js
    expect(on.framework).toBe('fico17_v6');
    expect(on.scores.rubric).toBe('fico17_v6');
    expect(JSON.parse(JSON.stringify(on.v3_fico.scores))).toEqual(off.scores);
  });

  test("'shadow' never writes analysis_data.dc", async () => {
    const on = await runWith('shadow');
    expect(on.dc).toBeUndefined();
    expect(on.shadow.fico17_v6.mode).toBe('shadow');
  });

  test('a v6 failure leaves V3 intact and records the failure, never a default level', async () => {
    global.__V6_FAIL = true;
    const off = JSON.parse(JSON.stringify(await runWith('v3')));
    const on = await runWith('shadow');
    expect(on.shadow.fico17_v6.status).toBe('failed');
    expect(on.shadow.fico17_v6.levels).toBeUndefined();
    const { shadow, ...v3Only } = on;
    expect(JSON.parse(JSON.stringify(v3Only))).toEqual(off);
  });

  test('a coach visit (leader_observation) is never shadow-scored by the DC switch', async () => {
    global.__SESSION.observation_type = 'leader_observation';
    jest.doMock('../../bot/shared/services/observe/observe-draft.service', () => ({ onAnalysisReady: jest.fn(() => Promise.resolve()) }));
    global.__DC = 'shadow';
    await AnalysisProcessor.processAnalysis(SID, { from: '92300' }).catch(() => {});
    expect(v6Calls()).toHaveLength(0);
  });
});

describe('bd-qix9oh.2 — where the v6 blob lands (spec §4.2, §6.3; CONTRACTS §7)', () => {
  const shadowMod = require('../../bot/shared/services/coaching/frameworks/fico17-v6/shadow');

  test("patch: mode 'v6' → { dc: { fico17_v6 } }; 'shadow' → { shadow: { fico17_v6 } }; nothing → {}", () => {
    const b6 = { status: 'ok', mode: 'v6' };
    const bs = { status: 'ok', mode: 'shadow' };
    expect(shadowMod.patch(b6)).toEqual({ dc: { fico17_v6: b6 } });
    expect(shadowMod.patch(bs)).toEqual({ shadow: { fico17_v6: bs } });
    expect(shadowMod.patch(null)).toEqual({});
    // A blob with no mode (an old shape) stays where shadow always wrote it.
    expect(shadowMod.patch({ status: 'timeout' })).toEqual({ shadow: { fico17_v6: { status: 'timeout' } } });
  });

  test('both keys survive the merge into the V3 write: V3\'s own analysis cannot overwrite them', () => {
    const analysis = { framework: 'fico', dc: 'from V3?', shadow: 'from V3?' };
    for (const blob of [{ status: 'ok', mode: 'v6' }, { status: 'ok', mode: 'shadow' }]) {
      const merged = { ...analysis, ...shadowMod.patch(blob) };
      const key = blob.mode === 'v6' ? 'dc' : 'shadow';
      expect(merged[key]).toEqual({ fico17_v6: blob });
    }
  });

  test('analysis-processor: the patch is the last spread of the analysis_data it writes, after the report analysis (V3, or v6 under bd-ra8xu.52)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/coaching/analysis-processor.service.js'), 'utf8');
    const at = src.indexOf('...ficoV6Shadow.patch(v6Shadow)');
    expect(at).toBeGreaterThan(-1);
    expect(src.indexOf('...ficoV6Shadow.patch(', at + 1)).toBe(-1); // one write site
    const open = src.lastIndexOf('analysis_data: {', at);
    const body = src.slice(open, at);
    expect(body.indexOf('...reportAnalysis,')).toBeGreaterThan(-1);
    // Nothing after the patch inside the same literal: the next non-space text closes the object.
    expect(src.slice(at + '...ficoV6Shadow.patch(v6Shadow)'.length)).toMatch(/^,?\s*\},/);
    // No later key in the literal is called dc or shadow.
    expect(body).not.toMatch(/\b(dc|shadow)\s*:/);
  });
});
