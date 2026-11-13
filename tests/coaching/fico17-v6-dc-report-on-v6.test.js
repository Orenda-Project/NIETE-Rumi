'use strict';
/**
 * bd-ra8xu.52 — fico_dc_rubric 'v6' now moves the teacher's DC report to FICO17 v6 (operator 14 Nov ~01:10, asked
 * "Should Qurat see her DC report on v6 instead of V3?": "Yes"). The prod switch row names one account only.
 *
 *   'v6' + an ok v6 score   the analysis the report is built from is the v6 one: coaching_sessions.framework
 *                           'fico17_v6', analysis_data top level = the v6 analysis (scores.rubric 'fico17_v6', so it
 *                           never joins a V3 average), V3 kept whole under analysis_data.v3_fico, the raw v6 blob
 *                           still stored (analysis_data.dc.fico17_v6 on sandbox/staging; .shadow.fico17_v6 on main until
 *                           bd-qix9oh.2 reaches it). The report transformer dispatch gives the v6 report.
 *   'v6' + no ok v6 score   (failed / invalid / broken / timed out) the teacher gets today's V3 report: the write is
 *                           exactly the 'v6' write before this change.
 *   'v3', 'shadow', a coach visit                 untouched (fico17-v6-shadow.test.js keeps those).
 *   the wait                'v6' waits longer for the v6 read (V6_GRACE_MS) because the report now depends on it; on
 *                           12 Nov her prod read landed 4 s after the 45 s grace and was lost.
 */

jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn((patch) => { if (patch && patch.analysis_data) { global.__PERSISTED = patch.analysis_data; global.__PATCH = patch; } return builder; }),
    eq: jest.fn(() => builder), not: jest.fn(() => builder), in: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' }, region: null }, error: null })),
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
    reason: 'deployment_default',
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
  regionOfUser: jest.fn(() => Promise.resolve(null)),
  isAnySet: jest.fn(() => Promise.resolve(global.__DC !== 'v3' && global.__DC !== undefined)),
}));

const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');

// Timed, two halves, so the transcript gate passes and D2 can be counted.
const TRANSCRIPT = [
  '[00:10] Teacher (ur): Ali, what is half of ten?', '[00:15] Student (ur): Five.',
  '[05:00] Teacher (ur): Good. Tell your partner why.', '[05:10] Student (ur): Because two fives make ten.',
  '[15:00] Teacher (ur): Now page twenty.', '[20:00] Student (ur): I agree.', '[30:00] Student (ur): Done.',
].join('\n');

function v3Analysis() {
  const domains = {};
  for (const [key, def] of Object.entries(fico.getScoringConstants().domains)) {
    domains[key] = { indicators: def.indicators.map((i) => ({ id: i.id, score: 2 })) };
  }
  return {
    ...fico.computeScores({ framework: 'fico', domains }),
    topic: 'Halves', subject: 'maths', has_lesson_plan: false,
    focus_area: { indicator: 'C3', title: 'a V3 code: must never reach a v6 report' },
    executive_summary: 'V3 summary',
  };
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
const shadow = require('../../bot/shared/services/coaching/frameworks/fico17-v6/shadow');

const SID = 'sess-dc-report-v6';
const json = (x) => JSON.parse(JSON.stringify(x));
beforeEach(() => {
  jest.clearAllMocks();
  global.__PERSISTED = undefined;
  global.__PATCH = undefined;
  global.__V6_FAIL = false;
  global.__SESSION = {
    id: SID, user_id: 'u-qurat', observation_type: null, audio_duration_seconds: 1900,
    transcript_text: TRANSCRIPT, transcript_language: 'ur', classroom_photos: [],
    users: { phone_number: '92300', name: 'A B', region: null },
  };
});

async function runWith(dc) {
  global.__DC = dc;
  await AnalysisProcessor.processAnalysis(SID, { from: '92300' });
  return { data: global.__PERSISTED, patch: global.__PATCH };
}

describe("fico_dc_rubric 'v6': the DC report is built from the v6 analysis", () => {
  test('framework column, analysis framework and the score stamp are all fico17_v6', async () => {
    const { data, patch } = await runWith('v6');
    expect(patch.framework).toBe('fico17_v6');
    expect(patch.framework_selection_reason).toBe('dc_rubric_v6');
    expect(data.framework).toBe('fico17_v6');
    expect(data.rubric).toBe('fico17_v6');
    expect(data.scores.rubric).toBe('fico17_v6');
    expect(data.scores.overall_max_marks).toBe(44); // 11 DC indicators × 4, never V3's total
  });

  test("the v6 domains are what the report reads: 11 DC levels, the six combined with evidence and no level", async () => {
    const { data } = await runWith('v6');
    const rows = Object.values(data.domains).flatMap((d) => d.indicators);
    expect(rows.map((r) => r.id).sort()).toEqual([...v6.DC_CODES, ...v6.COMBINED_CODES].sort());
    for (const r of rows) {
      if (v6.isCombined(r.id)) { expect(r.result).toBeNull(); expect(r.set_by).toBe('coach'); } else expect(r.result).toBe(3);
    }
    expect(data.combined_evidence.D2).toBeDefined(); // counted from the transcript, never the model's
  });

  test('V3 is kept whole beside it, and the raw v6 read is still stored', async () => {
    const before = json((await runWith('v3')).data);
    const { data } = await runWith('v6');
    // V3 as the processor finishes it (Section B not assessed, etc.): what a 'v3' run stores at the top level
    for (const k of Object.keys(data.v3_fico)) expect([k, json(data.v3_fico[k])]).toEqual([k, before[k]]);
    expect(data.v3_fico.framework).toBe('fico');
    expect(Object.keys(data.v3_fico)).toEqual(expect.arrayContaining(['domains', 'scores', 'focus_area', 'executive_summary']));
    const raw = (data.dc || data.shadow).fico17_v6;
    expect(raw.status).toBe('ok');
    expect(raw.mode).toBe('v6');
    // what the write adds around the analysis is unchanged
    for (const k of ['subject_resolution', 'photo_mode']) expect(json(data[k])).toEqual(before[k]);
  });

  test("lesson facts carry over from V3; V3's own coaching keys (focus_area, its summary) do not", async () => {
    const { data } = await runWith('v6');
    expect(data.topic).toBe('Halves');
    expect(data.subject).toBe('maths');
    expect(data.has_lesson_plan).toBe(false);
    expect(data.focus_area).toBeUndefined();
    expect(data.executive_summary).toBeUndefined();
  });

  test('the report transformer dispatch gives the FICO17 v6 report for what was stored', async () => {
    const { data } = await runWith('v6');
    const { getReportTransformer } = require('../../bot/shared/services/coaching/report-transformers/report-transformer-dispatch');
    const report = getReportTransformer(data.framework)({ created_at: '2026-11-14T08:00:00Z', users: { region: null } }, 'Teacher', data, false);
    expect(report.framework).toBe('fico17_v6');
    expect(report.maxScore).toBe(44);
    expect(report.totalScore).toBe(33);
  });

  test('a failed v6 read: the teacher gets the V3 report, exactly as the v6 switch wrote it before this change', async () => {
    global.__V6_FAIL = true;
    const { data, patch } = await runWith('v6');
    expect(patch.framework).toBe('fico');
    expect(patch.framework_selection_reason).toBe('deployment_default');
    expect(data.framework).toBe('fico');
    expect(data.v3_fico).toBeUndefined();
    expect((data.dc || data.shadow).fico17_v6.status).toBe('failed');
    const { dc, shadow: _s, ...v3Only } = data;
    const off = json((await runWith('v3')).data);
    expect(json(v3Only)).toEqual(off);
  });

  test("'shadow' and 'v3' never move the report", async () => {
    for (const mode of ['shadow', 'v3']) {
      const { data, patch } = await runWith(mode);
      expect(patch.framework).toBe('fico');
      expect(data.framework).toBe('fico');
      expect(data.v3_fico).toBeUndefined();
    }
  });
});

describe('shadow.teacherFacing and the longer wait in v6 mode', () => {
  const okBlob = () => {
    const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
    const s = fw.computeScores(v6Reply(), false, TRANSCRIPT);
    return { status: 'ok', mode: 'v6', rubric: 'fico17_v6', levels: s.levels, combined_evidence: s.combined_evidence, transcript_quality: { status: 'ok', coverage: 1, issues: [] } };
  };

  test('null unless the mode is v6 and the read is ok', () => {
    expect(shadow.teacherFacing(null, v3Analysis(), TRANSCRIPT)).toBeNull();
    expect(shadow.teacherFacing({ ...okBlob(), mode: 'shadow' }, v3Analysis(), TRANSCRIPT)).toBeNull();
    for (const status of ['failed', 'invalid', 'broken', 'timeout']) {
      expect(shadow.teacherFacing({ ...okBlob(), status }, v3Analysis(), TRANSCRIPT)).toBeNull();
    }
    expect(shadow.teacherFacing({ ...okBlob(), levels: undefined }, v3Analysis(), TRANSCRIPT)).toBeNull();
  });

  test('builds the v6 analysis without touching the stored blob', () => {
    const blob = okBlob();
    const frozen = json(blob);
    const a = shadow.teacherFacing(blob, v3Analysis(), TRANSCRIPT);
    expect(a.framework).toBe('fico17_v6');
    expect(a.transcript_quality).toEqual(frozen.transcript_quality);
    expect(json(blob)).toEqual(frozen);
  });

  test("graceFor: 'v6' waits V6_GRACE_MS, everything else the old GRACE_MS", () => {
    expect(shadow.V6_GRACE_MS).toBeGreaterThan(shadow.GRACE_MS);
    expect(shadow.graceFor(Object.assign(Promise.resolve(null), { state: { mode: 'v6' } }))).toBe(shadow.V6_GRACE_MS);
    expect(shadow.graceFor(Object.assign(Promise.resolve(null), { state: { mode: 'shadow' } }))).toBe(shadow.GRACE_MS);
    expect(shadow.graceFor(null)).toBe(shadow.GRACE_MS);
  });

  test('analysis-processor waits with graceFor', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../bot/shared/services/coaching/analysis-processor.service.js'), 'utf8');
    expect(src).toContain('ficoV6Shadow.settle(v6ShadowTask, ficoV6Shadow.graceFor(v6ShadowTask))');
  });
});
