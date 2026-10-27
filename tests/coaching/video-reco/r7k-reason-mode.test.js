'use strict';
/**
 * bd-8hhqhf R7k (COS 20261024T044233 §1a): VIDEO_RECO_REASON=card — the reason is never a moment the model cites: the card
 * frame or silence, and no model call. Unset (or any other value) = today, byte-identical. Measured, not decided.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

let E;
let C;
let F;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  F = require('../../../bot/shared/services/coaching/video-reco/flags');
});
const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const LINES = [
  T('00:20', 'Teacher', 'آج ہم پانی کے بارے میں بات کریں گے اور سب دھیان سے سنیں'), T('00:30', 'Teacher', 'پانی کہاں سے آتا ہے؟'),
  T('00:33', 'Student', 'جی پانی بادل سے آتا ہے'), T('00:36', 'Teacher', 'اور کہاں سے آتا ہے؟'), T('00:39', 'Student', 'دریا سے'),
  T('00:42', 'Teacher', 'ٹھیک ہے بچو، اور کون بتائے گا؟'), T('00:45', 'Student', 'جی'),
];
const run = (env, action, completeJson, lang = 'ur') => E.recommendForReport({
  session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: LINES } },
  analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "اور کہاں سے آتا ہے؟"', timestamp: '[00:36]' }] } }, subject_resolution: { code: 'science', grade: '3', confidence: 'high' } },
  nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'x', try: action } }, card: { indicator: 'C1', action }, coachingSessionId: 's1',
  deps: { env: { VIDEO_RECO_ENABLED: 'true', ...env }, catalog: C.fromData(FIXTURE), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null, completeJson },
});
const answer = (p) => ({ result: { seg_id: (p.split('CANDIDATE CLIPS')[1].match(/\b\d{1,3}-s\d+\b/) || [])[0], moment: { at: '00:36', quote: 'اور کہاں سے آتا ہے؟' }, confidence: 0.7,
  reason_en: 'In the lesson the teacher asked "اور کہاں سے آتا ہے؟" and one child answered in a word. This clip shows how to ask why.',
  reason_ur: 'سبق میں استاد نے پوچھا، "اور کہاں سے آتا ہے؟" اور ایک بچے نے ایک لفظ میں جواب دیا۔ یہ کلپ دکھاتا ہے کہ کیوں کیسے پوچھیں۔' }, usage: {}, finishReason: 'stop' });
const WHY = "After a one-word answer, ask 'why do you think so?' and wait five seconds.";
const strip = (row) => JSON.parse(JSON.stringify(row, (k, v) => (['latency_ms', 'engine_ms', 'latencies_ms', 'created_at', 'at'].includes(k) ? undefined : v)));

describe('flag', () => {
  test.each([[undefined, null], ['', null], ['llm', null], ['CARD', 'card'], [' card ', 'card']])('%p → %p', (raw, want) => {
    expect(F.videoRecoReason(raw === undefined ? {} : { VIDEO_RECO_REASON: raw })).toBe(want);
  });
});

describe('VIDEO_RECO_REASON=card', () => {
  test('no model call; the card frame, never a cited moment', async () => {
    const cj = jest.fn(async (p) => answer(p));
    const row = await run({ VIDEO_RECO_REASON: 'card' }, WHY, cj);
    expect(cj).not.toHaveBeenCalled();
    expect(row.status).not.toBe('none');
    expect(row.moment_source).not.toBe('transcript');
    expect(row.moment_quote || null).toBeNull();
    expect(row.attempts).toBe(0);
  });
  test('the English reader too', async () => {
    const cj = jest.fn(async (p) => answer(p));
    const row = await run({ VIDEO_RECO_REASON: 'card' }, WHY, cj, 'en');
    expect(cj).not.toHaveBeenCalled();
    expect(row.moment_source).not.toBe('transcript');
  });
  test('a card no chapter\'s move matches and no why / wait → silence, still no call', async () => {
    const cj = jest.fn(async (p) => answer(p));
    const row = await run({ VIDEO_RECO_REASON: 'card' }, 'Decorate the classroom wall with the children\'s drawings.', cj);
    expect(cj).not.toHaveBeenCalled();
    expect(row.status).toBe('none');
  });
});

describe('unset = today', () => {
  test.each([[{}], [{ VIDEO_RECO_REASON: '' }], [{ VIDEO_RECO_REASON: 'llm' }]])('%p: the model is asked and the row equals the unset row', async (env) => {
    const cj0 = jest.fn(async (p) => answer(p));
    const base = await run({}, WHY, cj0);
    const cj = jest.fn(async (p) => answer(p));
    const row = await run(env, WHY, cj);
    expect(cj).toHaveBeenCalled();
    expect(strip(row)).toEqual(strip(base));
  });
});
