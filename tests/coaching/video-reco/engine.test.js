'use strict';
/**
 * bd-gzfdu9 — engine.recommendForReport: flag off is a no-op; never throws; retries reuse the row;
 * the control arm is computed and stored as shadow (SPEC §3.2, §6).
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
  jest.doMock('../../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn().mockResolvedValue({ group: 'C' }) }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
});

function rows() {
  return [
    { id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[00:40]' },
    { id: 'C2', name: 'Re-explanation', score: 0, applicable: true, evidence: 'none', evidence_summary: '', timestamp: '[01:00]' },
  ];
}
function args(extra = {}) {
  return {
    session: {
      id: SID, user_id: UID, users: { name: 'Saima Khan', preferred_language: 'ur' },
      diarization_data: { segments: [
        { start_ms: 30000, label: 'Teacher', text: 'Is this a triangle? Yes or no, quickly!' },
        { start_ms: 45000, label: 'Student', text: 'Yes' },
      ] },
    },
    analysis: { framework: 'fico', domains: { C: { indicators: rows() } }, subject_resolution: { code: 'maths', grade: '3', confidence: 'high' }, topic: 'triangles' },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
    loop: { state: { angle: 'show' } },
    card: { indicator: 'C1', action: 'Ask two why questions about shapes' },
    coachingSessionId: SID,
    isRetry: false,
    ...extra,
  };
}
const GOOD = {
  seg_id: '10-s1', differs_from_step: false, moment: { at: '00:30', quote: 'Is this a triangle? Yes or no' },
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
      recentModules: jest.fn().mockResolvedValue([]),
      ladderProgress: jest.fn().mockResolvedValue({ level: 2, completed: [] }),
      write: jest.fn(async (row) => { written.push(row); return { id: 'rec-1', ...row }; }),
    },
    completeJson: jest.fn().mockResolvedValue({ result: GOOD, usage: { prompt_tokens: 900, completion_tokens: 120 } }),
    ...extra,
  };
}

test('flag off → null, and NO store, supabase or LLM call', async () => {
  const d = deps({ env: {} });
  expect(await E.recommendForReport({ ...args(), deps: d })).toBeNull();
  expect(d.store.readForSession).not.toHaveBeenCalled();
  expect(d.store.write).not.toHaveBeenCalled();
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

test('happy path: one LLM call, a shown row with the clip, the reason, the moment and the bookkeeping', async () => {
  const d = deps();
  const row = await E.recommendForReport({ ...args(), deps: d });
  expect(d.completeJson).toHaveBeenCalledTimes(1);
  expect(d.completeJson.mock.calls[0][1]).toEqual({ job: 'coaching.videoReco', maxTokens: 4000, label: 'videoReco' });
  expect(row).toMatchObject({
    id: 'rec-1', coaching_session_id: SID, user_id: UID, status: 'shown', arm: 'video',
    module_id: 10, seg_id: '10-s1', start_s: 30, end_s: 120,
    indicator: 'C1', catalog_indicator: 'C1', indicator_scheme: 'fico_v4', step_indicator: 'C1', differs_from_step: false,
    repeat_module: false, target_source: 'step', loop_angle: 'show', observation_type: 'self', language: 'ur', teacher_level: 2,
    reason_en: GOOD.reason_en, reason_ur: GOOD.reason_ur, moment_at: '00:30', moment_quote: GOOD.moment.quote, confidence: 0.7,
    none_reason: null, catalog_version: 'catalog-fixture', prompt_version: 'vr-1', model: 'gpt-5-mini-2025-08-07',
    experiment: null, v10_group: 'C',
  });
  expect(row.candidates[0]).toEqual(expect.objectContaining({ seg_id: expect.any(String), score: expect.any(Number), indicator: expect.any(String) }));
  expect(row.usage).toEqual({ prompt_tokens: 900, completion_tokens: 120 });
  expect(typeof row.engine_ms).toBe('number');
  expect(d.completeJson.mock.calls[0][0]).toContain('Try this tomorrow: Ask two why questions about shapes');
});

test('retry: the stored row is returned and nothing is recomputed (no second LLM call)', async () => {
  const d = deps();
  d.store.readForSession.mockResolvedValue({ id: 'rec-0', status: 'shown', sent_via: 'cta_header' });
  expect(await E.recommendForReport({ ...args(), isRetry: true, deps: d })).toEqual({ id: 'rec-0', status: 'shown', sent_via: 'cta_header' });
  expect(d.completeJson).not.toHaveBeenCalled();
  expect(d.store.write).not.toHaveBeenCalled();
});

test('control arm: computed and stored as shadow (nothing to send)', async () => {
  const d = deps({ env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_AB_ENABLED: 'true' } });
  const arm = require('../../../bot/shared/services/coaching/video-reco/arm');
  let uid = UID;
  for (let i = 0; arm.assignArm(uid, d.env) !== 'control'; i++) uid = `user-${i}`;
  const a = args();
  a.session.user_id = uid;
  const row = await E.recommendForReport({ ...a, deps: d });
  expect(row).toMatchObject({ status: 'shadow', arm: 'control', experiment: 'vidrec-ab-2026-10-v1', seg_id: '10-s1' });
  expect(d.completeJson).toHaveBeenCalledTimes(1);
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
  release({ result: GOOD, usage: {} });
  await jest.advanceTimersByTimeAsync(10);
  jest.useRealTimers();
  expect(d.written.map((r) => r.status)).toEqual(['error']);
  expect(d.written[0].none_reason).toBe('error:Timeout');
});

test('validation failure → status none, none_reason validation, the shortlist kept', async () => {
  const d = deps({ completeJson: jest.fn().mockResolvedValue({ result: { ...GOOD, moment: { at: '00:30', quote: 'an invented sentence nobody said' } }, usage: {} }) });
  const row = await E.recommendForReport({ ...args(), deps: d });
  expect(row).toMatchObject({ status: 'none', none_reason: 'validation', seg_id: null });
  expect(row.candidates.length).toBeGreaterThan(0);
});

test('a truncated answer → status none, llm_truncated (its own reason)', async () => {
  const d = deps({ completeJson: jest.fn().mockResolvedValue({ result: {}, usage: { completion_tokens: 4000 }, finishReason: 'length' }) });
  expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ status: 'none', none_reason: 'llm_truncated', usage: { completion_tokens: 4000 } });
});

test('the model says none → status none, llm_none', async () => {
  const d = deps({ completeJson: jest.fn().mockResolvedValue({ result: { seg_id: null, none_reason: 'nothing fits' }, usage: {} }) });
  expect(await E.recommendForReport({ ...args(), deps: d })).toMatchObject({ status: 'none', none_reason: 'llm_none' });
});

test('empty shortlist → status none with the gate, and no LLM call', async () => {
  const d = deps();
  const a = args();
  a.session.users.preferred_language = 'en';
  a.analysis.domains.C.indicators[0].score = 2; // C1 at the top rung: not a weak row, so C2 has no alsoWeak
  a.nextStep = { target: { indicator: 'C2' } };
  a.card = { indicator: 'C2' };
  const row = await E.recommendForReport({ ...a, deps: d });
  expect(row).toMatchObject({ status: 'none', none_reason: 'language', language: 'en' });
  expect(d.completeJson).not.toHaveBeenCalled();
});

test('no target → status none no_target, no LLM call', async () => {
  const d = deps();
  const row = await E.recommendForReport({ ...args(), nextStep: { target: null }, card: null, deps: d });
  expect(row).toMatchObject({ status: 'none', none_reason: 'no_target' });
  expect(d.completeJson).not.toHaveBeenCalled();
});

test('completed ladder modules and recent recommendations are both history', async () => {
  const d = deps();
  d.store.recentModules.mockResolvedValue([11]);
  d.store.ladderProgress.mockResolvedValue({ level: 2, completed: [10] });
  d.completeJson.mockResolvedValue({ result: { seg_id: null }, usage: {} });
  const row = await E.recommendForReport({ ...args(), deps: d });
  // 10 and 11 are history; every other C1/C2 clip fails a gate for this grade-3 Urdu lesson → history once, repeat_module
  expect(row.repeat_module).toBe(true);
});

test('a write that fails → null (nothing for the sender to send)', async () => {
  const d = deps();
  d.store.write.mockResolvedValue(null);
  expect(await E.recommendForReport({ ...args(), deps: d })).toBeNull();
});

test('the observe path (no nextStep passed): the step comes from selectNextStep on the analysis', async () => {
  const d = deps();
  const a = args();
  delete a.nextStep;
  a.card = null;
  const row = await E.recommendForReport({ ...a, deps: d });
  expect(row).toMatchObject({ step_indicator: 'C2', target_source: 'step' });
});
