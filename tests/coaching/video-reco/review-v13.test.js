'use strict';
/**
 * bd-gzfdu9 — the #3313 review deviations (lead-review 19:13Z, review_3313.md) and the validator rulings
 * (lead-review 19:14Z, SPEC §3.5 [v1.3, evals 19:13Z]) folded into the v1.3 PR. One test per item.
 */
const fs = require('fs');
const path = require('path');
const S = require('../../../bot/shared/services/coaching/video-reco/shortlist');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');
const T = require('../../../bot/shared/services/coaching/video-reco/target');
const P = require('../../../bot/shared/services/coaching/video-reco/prompt');
const V = require('../../../bot/shared/services/coaching/video-reco/select');

const FIX = require('./fixtures/catalog.fixture.json');
const copy = (fn) => { const d = JSON.parse(JSON.stringify(FIX)); fn(d); return C.fromData(d); };
const mod = (d, id) => d.modules.find((m) => m.module_id === id);
const seg = (d, id) => d.modules.flatMap((m) => m.segments).find((s) => s.seg_id === id);
const tgt = (indicator, extra = {}) => ({ indicator, indicators: [indicator], moves: [], native37: false, source: 'step', scheme: 'fico_v4', storedIndicator: indicator, ...extra });
const ctx = (extra = {}) => ({ language: 'ur', languages: ['ur', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] }, ...extra });
const L = (extra = {}) => ({ subject: 'urdu', grade: { lo: 3, hi: 3 }, topic: null, inapplicable: [], ...extra });
const ids = (r) => r.candidates.map((c) => c.seg_id);

describe('deviation 1 (D3a): §3.3 candidate rule seg.recommendable===true || (module.recommendable && seg.recommendable!==false)', () => {
  const c = copy((d) => { mod(d, 19).recommendable = false; seg(d, '19-s1').recommendable = true; seg(d, '19-s1').fico_main37 = ['B4']; });
  test('a recommendable chapter inside a not-recommendable module is a candidate', () => {
    expect(ids(S.build(c, tgt('B4'), ctx(), 'recall', L()))).toEqual(['19-s1']);
  });
  test('the native 37 check sees it too (target.js nativeAvailable)', () => {
    const a = { indicator_scheme: 'fico_main_37', domains: { B: { indicators: [{ id: 'B4', score: 1, applicable: true }] } } };
    expect(T.pick(a, { target: { indicator: 'B4' } }, null, c)).toMatchObject({ native37: true, aliasKind: 'native37' });
  });
  test('a chapter with no flag of its own in a not-recommendable module stays out', () => {
    const c2 = copy((d) => { mod(d, 19).recommendable = false; delete seg(d, '19-s1').recommendable; });
    expect(S.build(c2, tgt('B4'), ctx(), 'recall', L()).noneReason).toBe('hole');
  });
});

describe('deviation 2 + validator (c): prompt rule 2 verbatim from SPEC §3.4, "(under 300 characters)", vr-3', () => {
  const text = P.build({ target: tgt('C1'), candidates: [], catalog: C.fromData(FIX), excerpts: ['[00:30] Teacher: hello'] });
  test('rule 2 carries the "explains the move" clause and the length hint', () => {
    expect(text).toContain('then what the clip shows a teacher doing instead — and if the clip explains the move rather than shows it, one phrase the teacher could say tomorrow. The quote must contain no person\'s name: write [a student] in its place. Two sentences (under 300 characters), plain words a teacher uses, no jargon, no judgement of the teacher.');
  });
  test('PROMPT_VERSION is vr-3', () => expect(P.PROMPT_VERSION).toBe('vr-3'));
});

describe('deviation 5 (D3b): the tie-break needs moves[0] = target AND evidence_s inside (indicator path: evidence_s only)', () => {
  test('phase path: a lead move without evidence_s gets no tie-break', () => {
    const c = copy((d) => { seg(d, '19-s1').moves = ['activate_prior_knowledge']; });
    const t = { indicator: null, indicators: [], moves: ['activate_prior_knowledge'], source: 'phase' };
    const s = S.build(c, t, ctx(), 'zzz', L()).candidates.find((x) => x.seg_id === '19-s1').score;
    expect(Math.round(s * 1000) % 10).toBe(0); // no +0.001
  });
  test('phase path: lead move AND evidence_s inside → +0.001', () => {
    const c = copy((d) => { const s = seg(d, '19-s1'); s.moves = ['activate_prior_knowledge']; s.start_s = 0; s.end_s = 60; s.fico[0].evidence_s = 10; });
    const t = { indicator: null, indicators: [], moves: ['activate_prior_knowledge'], source: 'phase' };
    const s = S.build(c, t, ctx(), 'zzz', L()).candidates.find((x) => x.seg_id === '19-s1').score;
    expect(Math.round(s * 1000) % 10).toBe(1);
  });
  test('indicator path: evidence_s inside alone → +0.001', () => {
    const c = copy((d) => { const s = seg(d, '19-s1'); s.start_s = 0; s.end_s = 60; s.fico[0].evidence_s = 10; });
    const s = S.build(c, tgt('B4'), ctx(), 'zzz', L()).candidates.find((x) => x.seg_id === '19-s1').score;
    expect(Math.round(s * 1000) % 10).toBe(1);
  });
});

test('deviation 6 (D3c): unknown subject excludes only single-subject modules', () => {
  const c = copy((d) => { mod(d, 22).subjects = ['maths', 'science']; });
  expect(ids(S.build(c, tgt('C1'), ctx(), 'reasoning', L({ subject: null })))).toContain('22-s1');
  expect(ids(S.build(C.fromData(FIX), tgt('C1'), ctx(), 'reasoning', L({ subject: null })))).not.toContain('22-s1');
});

test('deviation 8: .env.template documents VIDEO_RECO_REASONING', () => {
  const env = fs.readFileSync(path.join(__dirname, '../../../.env.template'), 'utf8');
  expect(env).toMatch(/^#?\s*VIDEO_RECO_REASONING=/m);
});

describe('validator rulings (SPEC §3.5 [v1.3, evals 19:13Z])', () => {
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const EX = ['[00:30] Teacher: [a student], is this a triangle? Yes or no, quickly!'];
  const pickOf = (extra) => ({
    seg_id: '10-s1', moment: { at: '00:30', quote: 'is this a triangle? Yes or no' },
    reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a teacher asking why instead.',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں کے سوال پوچھتے ہیں۔', confidence: 0.6, ...extra,
  });
  const opts = { stepIndicator: 'C1', indicators: ['C1'], source: 'step', catalog: C.fromData(FIX), teacherName: 'Saima Khan' };
  test('(a) the Urdu share is counted after removing the quoted moment and [a student]', () => {
    const ur = '00:30 پر "is this a triangle? Yes or no, quickly" کہا گیا، [a student] نے جواب دیا؛ اس کلپ میں open-ended questions دکھائے گئے ہیں۔';
    expect(V.validate(pickOf({ reason_ur: ur }), list, EX, opts).ok).toBe(true);
    const latin = 'The teacher said "yes or no" — یہ open-ended questions and wait time ka clip hai';
    expect(V.validate(pickOf({ reason_ur: latin }), list, EX, opts).none).toBe('validation');
  });
  test('(b) a leading [mm:ss] Speaker: prefix is stripped before the Dice match', () => {
    // The scorer's quote has no line prefix: a quote copied with one only matches once the prefix is stripped.
    const p = pickOf({ moment: { at: '00:40', quote: '[00:40] Teacher: is this a triangle? Yes or no' } });
    expect(V.validate(p, list, [], { ...opts, scorerQuote: 'is this a triangle? Yes or no, quickly' })).toMatchObject({ ok: true, momentSource: 'scorer' });
  });
  test('(d) a quote that matches only the evidence_summary (not the Quote: part) stays validation', () => {
    const row = { evidence: 'Closed questions only.', evidence_summary: 'Teacher asked only yes or no questions throughout' };
    const quoteOnly = T.scorerQuoteOnly(row);
    expect(quoteOnly).toBe('');
    const p = pickOf({ moment: { at: '00:30', quote: 'Teacher asked only yes or no questions throughout' } });
    expect(V.validate(p, list, [], { ...opts, scorerQuote: quoteOnly }).none).toBe('validation');
    const withQuote = { evidence: 'Closed. Quote: "Teacher asked only yes or no questions throughout"' };
    expect(V.validate(p, list, [], { ...opts, scorerQuote: T.scorerQuoteOnly(withQuote) })).toMatchObject({ ok: true, momentSource: 'scorer' });
  });
});

describe('engine: ladderComplete over recommendable modules (deviation 4) and the observe-path card record (deviation 9)', () => {
  let E;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('no supabase'); } }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    E = require('../../../bot/shared/services/coaching/video-reco/engine');
  });
  const GOOD = {
    seg_id: '10-s1', moment: { at: '00:30', quote: 'is this a triangle? Yes or no' },
    reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a teacher asking why instead.',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں کے سوال پوچھتے ہیں۔', confidence: 0.6,
  };
  function run({ catalog = C.fromData(FIX), completed = [], nextStep, card }) {
    const deps = {
      env: { VIDEO_RECO_ENABLED: 'true' }, catalog,
      store: {
        readForSession: jest.fn().mockResolvedValue(null),
        recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
        ladderProgress: jest.fn().mockResolvedValue({ level: 4, completedModules: completed }),
        trainingBands: jest.fn().mockResolvedValue([]),
        write: jest.fn(async (row) => row),
      },
      v10GroupFor: jest.fn().mockResolvedValue(null),
      completeJson: jest.fn().mockResolvedValue({ result: GOOD, usage: {}, finishReason: 'stop' }),
    };
    const session = { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' },
      diarization_data: { segments: [{ start_ms: 30000, label: 'Teacher', text: 'Ahmed, is this a triangle? Yes or no, quickly!' }] } };
    const analysis = { framework: 'fico', subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' },
      domains: { C: { indicators: [{ id: 'C1', name: 'Questioning', score: 1, applicable: true, evidence: 'Quote: "Is this a triangle"', timestamp: '[00:30]' }] } } };
    return E.recommendForReport({ session, analysis, nextStep, card, coachingSessionId: 's1', deps });
  }
  test('every recommendable module completed (a not-recommendable one not) → ladder_completed', async () => {
    const c = copy((d) => { mod(d, 16).recommendable = false; });
    const done = FIX.modules.map((m) => m.module_id).filter((id) => id !== 16);
    expect(await run({ catalog: c, completed: done, nextStep: { target: { indicator: 'C1' } }, card: { action: 'Ask why' } }))
      .toMatchObject({ ladder_completed: true, level_match: 'completed' });
  });
  test('the stored prioritized_action record (uptake-loop buildRecord: indicator under target) is read as the card', async () => {
    const record = { action: 'Ask why questions', framework: 'fico', target: { indicator: 'C1', domain: 'C', name: 'Questioning' }, action_spec: { move: 'Ask why questions' } };
    expect(await run({ nextStep: { target: null }, card: record })).toMatchObject({ target_source: 'card', indicator: 'C1', status: 'shown' });
  });
});

test('V1.7.1 carries the click-by-device uniqueness (EVENTS_SCHEMA v1.1 §3a) and its rollback restores V1.7.0', () => {
  const dir = path.join(__dirname, '../../../infrastructure/supabase/migrations');
  const up = fs.readFileSync(path.join(dir, 'V1.7.1__video_reco_retrieval_route.sql'), 'utf8');
  const down = fs.readFileSync(path.join(dir, 'ROLLBACK_V1.7.1__video_reco_retrieval_route.sql'), 'utf8');
  expect(up).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_video_reco_events_click_device\s+ON video_reco_events \(recommendation_id, COALESCE\(surface,\s*'wa'\), COALESCE\(ua_class,\s*'-'\), COALESCE\(device,\s*'-'\)\)\s+WHERE event = 'click'/);
  expect(up).toMatch(/WHERE event NOT IN \('error',\s*'click'\)/);
  expect(down).toMatch(/DROP INDEX IF EXISTS uq_video_reco_events_click_device/);
  expect(down).toMatch(/WHERE event <> 'error'/);
});
