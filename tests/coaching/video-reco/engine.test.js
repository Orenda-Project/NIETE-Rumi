'use strict';
/**
 * bd-gzfdu9 — engine.recommendForReport (SPEC v1.2.1 §3.2): flag off is a no-op; never throws; retries reuse the row;
 * control and shadow mode store 'shadow'; every none has its own reason.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

let E;
let log;
let supa;
const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';

beforeEach(() => {
  jest.resetModules();
  log = jest.fn();
  supa = { from: jest.fn(() => { throw new Error('the engine must not reach supabase directly in these tests'); }) };
  jest.doMock('../../../bot/shared/config/supabase', () => supa);
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: log, logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
});

function rows() {
  return [
    { id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed questions. Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[00:40]' },
    { id: 'C2', name: 'Re-explanation', score: 0, applicable: true, evidence: 'none', evidence_summary: '', timestamp: '[01:00]' },
  ];
}
function args(extra = {}) {
  return {
    session: {
      id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' },
      diarization_data: { segments: [
        { start_ms: 30000, label: 'Teacher', text: 'Ahmed, tum batao: is this a triangle? Yes or no, quickly!' },
        { start_ms: 45000, label: 'Student', text: 'Yes' },
      ] },
    },
    analysis: { framework: 'fico', domains: { C: { indicators: rows() } }, subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' }, topic: 'shapes' },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
    loop: { state: { angle: 'show' } },
    card: { indicator: 'C1', action: 'Ask two why questions about shapes' },
    coachingSessionId: SID,
    isRetry: false,
    ...extra,
  };
}
const GOOD = {
  seg_id: '10-s1', moment: { at: '00:30', quote: '[a student], tum batao: is this a triangle? Yes or no' },
  reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a teacher asking why and how instead.',
  reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.7,
};
function deps(extra = {}) {
  const written = [];
  return {
    written,
    env: { VIDEO_RECO_ENABLED: 'true' },
    catalog: require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(FIXTURE),
    store: {
      readForSession: jest.fn().mockResolvedValue(null),
      recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
      ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }),
      trainingBands: jest.fn().mockResolvedValue([]),
      write: jest.fn(async (row) => { written.push(row); return { id: 'rec-1', ...row }; }),
    },
    v10GroupFor: jest.fn().mockResolvedValue({ group: 'C' }),
    completeJson: jest.fn().mockResolvedValue({ result: GOOD, usage: { prompt_tokens: 900, completion_tokens: 120 }, finishReason: 'stop' }),
    ...extra,
  };
}

test('flag off → null, and NO store, supabase or LLM call', async () => {
  const d = deps({ env: {} });
  expect(await E.recommendForReport({ ...args(), deps: d })).toBeNull();
  expect(d.store.readForSession).not.toHaveBeenCalled();
  expect(d.completeJson).not.toHaveBeenCalled();
  expect(supa.from).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

test('flag off with the real process.env (no deps) → null, nothing touched', async () => {
  const before = process.env.VIDEO_RECO_ENABLED;
  delete process.env.VIDEO_RECO_ENABLED;
  expect(await E.recommendForReport(args())).toBeNull();
  expect(supa.from).not.toHaveBeenCalled();
  if (before !== undefined) process.env.VIDEO_RECO_ENABLED = before;
});

test('not FICO → null, nothing touched', async () => {
  const d = deps();
  expect(await E.recommendForReport({ ...args(), analysis: { framework: 'mewaka', domains: {} }, deps: d })).toBeNull();
  expect(d.store.readForSession).not.toHaveBeenCalled();
});

test('happy path: one LLM call, a shown row with the clip, the reason, the moment and every bookkeeping column', async () => {
  const d = deps();
  const row = await E.recommendForReport({ ...args(), deps: d });
  expect(d.completeJson).toHaveBeenCalledTimes(1);
  expect(d.completeJson.mock.calls[0][1]).toEqual({ job: 'coaching.videoReco', maxTokens: 4000, label: 'videoReco', reasoningEffort: 'low' });
  expect(E.ENGINE_TIMEOUT_MS).toBe(60000);
  expect(row).toMatchObject({
    id: 'rec-1', coaching_session_id: SID, user_id: UID, status: 'shown', arm: 'video',
    module_id: 10, seg_id: '10-s1', start_s: 30, end_s: 120,
    indicator: 'C1', catalog_indicator: 'C1', indicator_scheme: 'fico_v4', step_indicator: 'C1', differs_from_step: false,
    step_at_top: false, alias_kind: null, repeat_module: false, target_source: 'step', loop_angle: 'show', observation_type: 'self',
    language: 'ur', language_match: 'preferred', teacher_level: 2, teacher_level_source: 'ladder', level_match: 'near', ladder_completed: false,
    reason_en: GOOD.reason_en, reason_ur: GOOD.reason_ur, moment_at: '00:30', moment_quote: GOOD.moment.quote, moment_source: 'transcript',
    confidence: 0.7, none_reason: null, catalog_version: 'catalog-fixture', prompt_version: 'vr-3', model: 'gpt-5-mini-2025-08-07',
    experiment: null, v10_group: 'C', image_strip: false,
  });
  expect(row.candidates[0]).toEqual(expect.objectContaining({ seg_id: expect.any(String), score: expect.any(Number), indicator: 'C1' }));
  expect(typeof row.engine_ms).toBe('number');
  const prompt = d.completeJson.mock.calls[0][0];
  expect(prompt).toContain('Try this tomorrow: Ask two why questions about shapes');
  expect(prompt).toContain('Evidence the scorer quoted: "Is this a triangle? Yes or no"');
  expect(prompt).not.toMatch(/Ahmed|Saima/); // H8: names never reach the model
});

test('retry: the stored row is returned and nothing is recomputed', async () => {
  const d = deps();
  d.store.readForSession.mockResolvedValue({ id: 'rec-0', status: 'shown', sent_via: 'cta_header' });
  expect(await E.recommendForReport({ ...args(), isRetry: true, deps: d })).toEqual({ id: 'rec-0', status: 'shown', sent_via: 'cta_header' });
  expect(d.completeJson).not.toHaveBeenCalled();
  expect(d.store.write).not.toHaveBeenCalled();
});

test('control arm: computed and stored as shadow, experiment marked', async () => {
  const d = deps({ env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_AB_ENABLED: 'true' } });
  const arm = require('../../../bot/shared/services/coaching/video-reco/arm');
  let uid = UID;
  for (let i = 0; arm.assignArm(uid, d.env) !== 'control'; i++) uid = `user-${i}`;
  const a = args();
  a.session.user_id = uid;
  expect(await E.recommendForReport({ ...a, deps: d })).toMatchObject({ status: 'shadow', arm: 'control', experiment: 'vidrec-ab-2026-10-v1', seg_id: '10-s1' });
});

test('VIDEO_RECO_MODE=shadow: every row shadow, the video arm too (the prod shadow week)', async () => {
  const d = deps({ env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_MODE: 'shadow' } });
  expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ status: 'shadow', arm: 'video', seg_id: '10-s1' });
});

test('card_text path (v10 A/B: the LLM card has no indicator): the card is the step; the chapter\'s fico[0] is the indicator', async () => {
  const d = deps();
  const row = await E.recommendForReport({ ...args(), nextStep: { target: null }, card: { action: 'Ask why and how questions, not yes or no', highlights: ['why and how'] }, deps: d });
  expect(row).toMatchObject({ target_source: 'card_text', status: 'shown', seg_id: '10-s1', indicator: 'C1', catalog_indicator: 'C1', step_indicator: null });
  expect(d.completeJson.mock.calls[0][0]).toContain('Indicator: not named — the step is the sentence below');
});

test('no step and no card → none:no_target, no LLM call; the scorer\'s focus is never used', async () => {
  const d = deps();
  const a = args({ nextStep: { target: null }, card: null });
  a.analysis.focus_area = { indicator: 'C1' };
  expect(await E.recommendForReport({ ...a, deps: d })).toMatchObject({ status: 'none', none_reason: 'no_target' });
  expect(d.completeJson).not.toHaveBeenCalled();
});

test('an English-reading teacher who teaches in Urdu gets the Urdu chapter (language_match transcript)', async () => {
  const d = deps();
  const a = args();
  a.session.users.preferred_language = 'en';
  d.completeJson.mockResolvedValue({ result: GOOD, usage: {}, finishReason: 'stop' });
  expect(await E.recommendForReport({ ...a, deps: d })).toMatchObject({ language: 'en', language_match: 'transcript', seg_id: '10-s1' });
});

test('the whole ladder completed → every level open, ladder_completed stored', async () => {
  const d = deps();
  d.store.ladderProgress.mockResolvedValue({ level: 4, completedModules: FIXTURE.modules.map((m) => m.module_id) });
  expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ ladder_completed: true, level_match: 'completed', teacher_level: 4 });
});

test('no ladder rows → teacher_level null, source none, level unknown', async () => {
  const d = deps();
  d.store.ladderProgress.mockResolvedValue({ level: null, completedModules: [] });
  expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ teacher_level: null, teacher_level_source: 'none', level_match: 'unknown' });
});

test('grade chain: subject_resolution.grade first; else users.training_bands', async () => {
  const d = deps();
  await E.recommendForReport({ ...args(), deps: d });
  expect(d.store.trainingBands).not.toHaveBeenCalled();
  const a = args();
  a.analysis.subject_resolution.grade = null;
  d.store.readForSession.mockResolvedValue(null);
  await E.recommendForReport({ ...a, deps: d });
  expect(d.store.trainingBands).toHaveBeenCalledWith(UID);
});

test('LLM throws → an error row + one warn log + null', async () => {
  const d = deps({ completeJson: jest.fn().mockRejectedValue(new TypeError('socket hang up')) });
  expect(await E.recommendForReport({ ...args(), deps: d })).toBeNull();
  expect(d.written).toHaveLength(1);
  expect(d.written[0]).toMatchObject({ status: 'error', none_reason: 'error:TypeError', coaching_session_id: SID, arm: 'video' });
  const warns = log.mock.calls.filter((c) => c[2] === 'warn');
  expect(warns).toHaveLength(1);
  expect(warns[0][0]).toBe('[video-reco] failed (non-fatal)');
  expect(warns[0][1]).toMatchObject({ coachingSessionId: SID, error: 'socket hang up' });
});

test('the whole engine is capped: a hung step resolves null at the cap, and a late result is never written', async () => {
  jest.useFakeTimers();
  let release;
  const d = deps({ completeJson: jest.fn(() => new Promise((r) => { release = r; })) });
  const p = E.recommendForReport({ ...args(), deps: d, timeoutMs: 1000, llmTimeoutMs: 5000 });
  await jest.advanceTimersByTimeAsync(1001);
  expect(await p).toBeNull();
  release({ result: GOOD, usage: {}, finishReason: 'stop' });
  await jest.advanceTimersByTimeAsync(10);
  jest.useRealTimers();
  expect(d.written.map((r) => r.status)).toEqual(['error']);
  expect(d.written[0].none_reason).toBe('error:Timeout');
});

test('validation failure → none:validation, the shortlist kept', async () => {
  const d = deps({ completeJson: jest.fn().mockResolvedValue({ result: { ...GOOD, moment: { at: '00:30', quote: 'an invented sentence nobody said' } }, usage: {}, finishReason: 'stop' }) });
  const row = await E.recommendForReport({ ...args(), deps: d });
  expect(row).toMatchObject({ status: 'none', none_reason: 'validation', seg_id: null });
  expect(row.candidates.length).toBeGreaterThan(0);
});

test('a truncated answer → none:llm_truncated', async () => {
  const d = deps({ completeJson: jest.fn().mockResolvedValue({ result: {}, usage: { completion_tokens: 4000 }, finishReason: 'length' }) });
  expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ status: 'none', none_reason: 'llm_truncated' });
});

test('the model says none → none:llm_none', async () => {
  const d = deps({ completeJson: jest.fn().mockResolvedValue({ result: { seg_id: null, none_reason: 'nothing fits' }, usage: {}, finishReason: 'stop' }) });
  expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ status: 'none', none_reason: 'llm_none' });
});

test('no transcript lines and no scorer quote → none:no_moments before any LLM call', async () => {
  const d = deps();
  const a = args();
  a.session.diarization_data = null;
  a.analysis.domains.C.indicators[0].evidence = 'nothing quoted';
  a.analysis.domains.C.indicators[0].evidence_summary = '';
  expect(await E.recommendForReport({ ...a, deps: d })).toMatchObject({ status: 'none', none_reason: 'no_moments' });
  expect(d.completeJson).not.toHaveBeenCalled();
});

test('no transcript lines but a scorer quote → the pick may cite it (moment_source scorer)', async () => {
  const d = deps();
  const a = args();
  a.session.diarization_data = null;
  d.completeJson.mockResolvedValue({ result: { ...GOOD, moment: { at: '00:40', quote: 'Is this a triangle? Yes or no' } }, usage: {}, finishReason: 'stop' });
  expect(await E.recommendForReport({ ...a, deps: d })).toMatchObject({ status: 'shown', moment_source: 'scorer' });
});

test('empty shortlist → none with the gate, no LLM call', async () => {
  const d = deps();
  const a = args({ nextStep: { target: { indicator: 'C2' } }, card: { indicator: 'C2' } });
  a.session.users.preferred_language = 'en';
  a.session.transcript_language = 'en';
  expect(await E.recommendForReport({ ...a, deps: d })).toMatchObject({ status: 'none', none_reason: 'language' });
  expect(d.completeJson).not.toHaveBeenCalled();
});

test('the observe path (no nextStep passed): the step comes from selectNextStep on the analysis', async () => {
  const d = deps();
  const a = args();
  delete a.nextStep;
  a.card = null;
  expect(await E.recommendForReport({ ...a, deps: d })).toMatchObject({ step_indicator: 'C2', target_source: 'step' });
});

test('a write that fails → null (nothing for the sender to send)', async () => {
  const d = deps();
  d.store.write.mockResolvedValue(null);
  expect(await E.recommendForReport({ ...args(), deps: d })).toBeNull();
});
