'use strict';
/**
 * bd-gzfdu9 — the #3313 review deviations (lead-review 19:13Z, review_3313.md) and the validator rulings
 * (lead-review 19:14Z, SPEC §3.5 [v1.3, evals 19:13Z]) folded into the v1.3 PR. One test per item.
 */
// v1.3c-4 stub floor: six words no fixture chapter carries, so a card clears the 6-word floor and BM25 is unchanged.
const PAD = ' zephyr quokka marimba origami lantern walrus';
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
    expect(text).toContain('then what the clip shows a teacher doing instead — say only what the clip\'s own line says it shows, in your own plain words (in reason_ur, in Urdu: never copy the clip\'s English title or summary); never add wait time, cold-calling, pairs, roles or a "why" question it does not name — and if the clip explains the move rather than shows it, one phrase the teacher could say tomorrow. The quote must contain no person\'s name: write [a student] in its place. Two sentences (under 300 characters), plain words a teacher uses, no jargon, no judgement of the teacher.');
  });
  test('PROMPT_VERSION is vr-7 (v1.3c-3 + r7 no clock time + R7b clip words, Urdu plural)', () => expect(P.PROMPT_VERSION).toBe('vr-7'));
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
  const EX = ['[00:30] Teacher: [a student], is this a triangle? Yes or no, quickly!', '[00:31] Student: جی۔'];
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
    expect(V.validate(pickOf({ reason_ur: latin }), list, EX, opts).none).toMatch(/^validation:/);
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
    expect(V.validate(p, list, [], { ...opts, scorerQuote: quoteOnly }).none).toMatch(/^validation:/);
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
  function run({ catalog = C.fromData(FIX), completed = [], nextStep, card, rowOverride = null }) {
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
      diarization_data: { segments: [{ start_ms: 30000, label: 'Teacher', text: 'Ahmed, is this a triangle? Yes or no, quickly!' }, { start_ms: 31000, label: 'Student', text: 'جی۔' }] } };
    const analysis = { framework: 'fico', subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' },
      domains: { C: { indicators: [rowOverride || { id: 'C1', name: 'Questioning', score: 1, applicable: true, evidence: 'Quote: "Is this a triangle"', timestamp: '[00:30]' }] } } };
    return E.recommendForReport({ session, analysis, nextStep, card, coachingSessionId: 's1', deps }).then((row) => Object.assign(row || {}, { _prompt: (deps.completeJson.mock.calls[0] || [])[0] || '' }));
  }
  test('vr-3: a row with no Quote: puts no evidence line in the prompt (never the evidence_summary sentence)', async () => {
    const row = await run({ nextStep: { target: { indicator: 'C1' } }, card: { action: 'Ask why' },
      rowOverride: { id: 'C1', name: 'Questioning', score: 1, applicable: true, evidence: 'Teacher gives frequent praise but lacks follow-up', evidence_summary: 'Praise without follow-up', timestamp: '[00:30]' } });
    expect(row._prompt).toContain('TRANSCRIPT MOMENTS');
    expect(row._prompt).not.toContain('The report\'s own moment');
    expect(row._prompt).not.toContain('Praise without follow-up');
  });
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

describe('⛔4 on the native-37 LABEL path (lead-review 19:37Z ruling 1)', () => {
  const native = copy((d) => { seg(d, '22-s1').fico_main37 = ['F5']; mod(d, 22).subjects = ['general']; });
  const F5n = tgt('F5', { native37: true, scheme: 'fico_main_37', storedIndicator: 'F5', aliasKind: 'native37' });
  const step = { action: 'wait pause silence' + PAD, tryTomorrow: '', thingToTry: '', name: '' };
  test('F5 on a maths lesson: the tag route runs', () => {
    const r = S.build(native, F5n, ctx(), 'x', L({ subject: 'maths' }), step);
    expect(r.textReason).toBe('label');
    expect(ids(r)[0]).toBe('22-s1');
  });
  test('F5 on an Urdu or unknown-subject lesson: no tag route, the step-text route alone, subject_blocked', () => {
    for (const subject of ['urdu', null]) {
      const r = S.build(native, F5n, ctx(), 'x', L({ subject }), step);
      expect(r.textReason).toBe('subject_blocked');
      expect(ids(r)).not.toContain('22-s1');
      expect(new Set(r.candidates.map((c) => c.route))).toEqual(new Set(['step_text']));
    }
  });
  test('F6 needs science, F7 a literacy subject', () => {
    const t6 = { ...F5n, indicator: 'F6', indicators: ['F6'], storedIndicator: 'F6' };
    const t7 = { ...F5n, indicator: 'F7', indicators: ['F7'], storedIndicator: 'F7' };
    expect(S.build(native, t6, ctx(), 'x', L({ subject: 'maths' }), step).textReason).toBe('subject_blocked');
    expect(S.build(native, t6, ctx(), 'x', L({ subject: 'science' }), step).textReason).toBe('label');
    expect(S.build(native, t7, ctx(), 'x', L({ subject: 'english' }), step).textReason).toBe('label');
    expect(S.build(native, t7, ctx(), 'x', L({ subject: 'maths' }), step).textReason).toBe('subject_blocked');
  });
});

describe('vr-3 teacher copy (lead-review 19:37Z ruling 2)', () => {
  test('the evidence line shows only the Quote: part, and is omitted without one', () => {
    const cat = C.fromData(FIX);
    const withQuote = P.build({ target: tgt('C1'), candidates: [], catalog: cat, excerpts: ['[00:30] Teacher: x'], scorerQuote: T.scorerQuoteOnly({ evidence: 'Closed. Quote: "Is this a triangle"' }) });
    expect(withQuote).toContain('The report\'s own moment: "Is this a triangle"');
    const noQuote = P.build({ target: tgt('C1'), candidates: [], catalog: cat, excerpts: ['[00:30] Teacher: x'], scorerQuote: T.scorerQuoteOnly({ evidence: 'Teacher gives frequent praise but lacks', evidence_summary: 'Praise only' }) });
    expect(noQuote).not.toContain('The report\'s own moment');
  });
  test('rule 2 ends with the no-scorer and no-N/A sentences', () => {
    const text = P.build({ target: tgt('C1'), candidates: [], catalog: C.fromData(FIX), excerpts: ['[00:30] Teacher: x'] });
    expect(text).toContain('no judgement of the teacher. Never write a clip id, number or code; never write a clock time (no [mm:ss], no \"at 12:08\") or a speaker label (no \"Teacher:\", \"Student:\") in reason_en or reason_ur: the moment\'s time goes only in moment.at; never mention the scorer, the report or the analysis; describe the lesson moment itself. Choose a moment with the teacher\'s or a child\'s own words; if the only candidate line is mostly [a student] placeholders, pick another line. If no real moment fits, return seg_id null — never write N/A, unknown or [around unknown].');
  });
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const EX = ['[00:30] Teacher: [a student], is this a triangle? Yes or no, quickly!', '[00:31] Student: جی۔'];
  const opts = { stepIndicator: 'C1', indicators: ['C1'], source: 'step', catalog: C.fromData(FIX), teacherName: 'Saima Khan' };
  const ok = {
    seg_id: '10-s1', moment: { at: '00:30', quote: 'is this a triangle? Yes or no' },
    reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a teacher asking why instead.',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں کے سوال پوچھتے ہیں۔', confidence: 0.6,
  };
  test('moment.at must be mm:ss', () => {
    expect(V.validate(ok, list, EX, opts).ok).toBe(true);
    for (const at of ['[00:30]', 'unknown', 'N/A', '', '0:30:00']) expect(V.validate({ ...ok, moment: { ...ok.moment, at } }, list, EX, opts).none).toMatch(/^validation:/);
    expect(V.validate({ ...ok, moment: { ...ok.moment, at: '4:17' } }, list, EX, opts).ok).toBe(true);
  });
  test('reason text naming the scorer, N/A or not applicable → validation', () => {
    for (const reason_en of ['The scorer noted only yes or no answers at 00:30. This clip shows why questions.', 'At N/A the class answered yes or no. This clip shows a teacher asking why.', 'The moment is not applicable here but the clip shows asking why questions.']) {
      expect(V.validate({ ...ok, reason_en }, list, EX, opts).none).toMatch(/^validation:/);
    }
    expect(V.validate({ ...ok, reason_ur: 'سکورر نے نوٹ کیا کہ کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں سوال ہیں۔' }, list, EX, opts).none).toMatch(/^validation:/);
  });
});

describe('vr-3 last copy rules (lead-review 19:40Z) and red-team session 2 (lead-review 19:41Z)', () => {
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const EX = ['[00:30] Teacher: [a student], is this a triangle? Yes or no, quickly!', '[00:31] Student: جی۔', '[00:50] Teacher: [a student] [a student] لکھنا ہے'];
  const opts = { stepIndicator: 'C1', indicators: ['C1'], source: 'step', catalog: C.fromData(FIX), teacherName: 'Saima Khan' };
  const ok = {
    seg_id: '10-s1', moment: { at: '00:30', quote: 'is this a triangle? Yes or no' },
    reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a teacher asking why instead.',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں کے سوال پوچھتے ہیں۔', confidence: 0.6,
  };
  const none = (x) => V.validate({ ...ok, ...x }, list, EX, opts).none;
  test('every validation none carries its sub-reason', () => {
    expect(none({ seg_id: '99-s9' })).toBe('validation:candidate');
    expect(none({ moment: { at: '00:30', quote: 'something nobody said in class' } })).toBe('validation:quote');
    expect(none({ reason_en: 'Too short.' })).toBe('validation:length');
    expect(V.validate(null, list, EX, opts).none).toBe('validation:shape');
  });
  test('a clip id in the reason → validation:id', () => {
    expect(none({ reason_en: 'At 00:30 the class answered yes or no. Clip 23-s2 shows a teacher asking why.' })).toBe('validation:id');
    expect(none({ reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ کلپ 23-s2 میں استاد کیوں کے سوال پوچھتے ہیں۔' })).toBe('validation:id');
  });
  test('scorer / score / rated / N/A → validation:scorer, by whole word (demonstrated is fine)', () => {
    expect(none({ reason_en: 'At 00:30 the class answered yes or no; the lesson was rated low. This clip shows asking why.' })).toBe('validation:scorer');
    expect(none({ reason_en: 'At 00:30 your score was low when the class answered yes or no. This clip shows asking why.' })).toBe('validation:scorer');
    expect(none({ reason_ur: 'اسکورر نے 14:43 پر یہ نقل کی؛ اس کلپ میں استاد کیوں کے سوال پوچھتے ہیں۔' })).toBe('validation:scorer');
    expect(V.validate({ ...ok, reason_en: 'At 00:30 the class answered yes or no. This clip demonstrated and illustrated asking why.' }, list, EX, opts).ok).toBe(true);
  });
  test('a quote with fewer than 3 real words after removing placeholders → validation:placeholder', () => {
    expect(none({ moment: { at: '00:50', quote: '[a student] [a student] لکھنا ہے' } })).toBe('validation:placeholder');
    expect(V.validate(ok, list, EX, opts).ok).toBe(true);
  });
  test('Roman Urdu: more than 2 consecutive Latin words in reason_ur outside quotes → validation:roman', () => {
    expect(none({ reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں agli dafa koshish karna دکھایا گیا ہے اور سوال پوچھے گئے ہیں۔' })).toBe('validation:roman');
    expect(V.validate({ ...ok, reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں open-ended questions اور wait time دکھائے گئے ہیں۔' }, list, EX, opts).ok).toBe(true);
    expect(V.validate({ ...ok, reason_ur: 'کلاس نے "is this a triangle yes or no" پر جواب دیا؛ اس کلپ میں استاد کیوں کے سوال پوچھتے ہیں اور بچے سوچتے ہیں۔' }, list, EX, opts).ok).toBe(true);
  });
  test('prompt rule 3 forbids Roman Urdu', () => {
    const text = P.build({ target: tgt('C1'), candidates: [], catalog: C.fromData(FIX), excerpts: ['[00:30] Teacher: x'] });
    expect(text).toContain('No Roman Urdu (Urdu in Latin letters); Urdu is written in Nastaliq script; only pedagogical terms stay in English letters (one or two words).');
  });

  const a37 = (row, extra = []) => ({ indicator_scheme: 'fico_main_37', domains: { F: { domain_max: 8, indicators: [row, ...extra] } } });
  test('an unscored step (applicable:false or null score) never takes the tag route: unscored_step', () => {
    const cat = copy((d) => { seg(d, '22-s1').fico_main37 = ['F5']; });
    const t = T.pick(a37({ id: 'F5', score: null, applicable: false, evidence: 'Not applicable — lesson subject is URDU' }), { target: { indicator: 'F5' } }, null, cat);
    expect(t).toMatchObject({ none: 'unscored_step', aliasKind: 'unscored', storedIndicator: 'F5' });
    const r = S.build(cat, t, ctx(), 'x', L({ subject: 'maths' }), { action: 'wait pause silence' + PAD });
    expect(r.textReason).toBe('unscored');
    expect(ids(r)).not.toContain('22-s1');
    expect(new Set(r.candidates.map((c) => c.route))).toEqual(new Set(['step_text']));
    expect(S.build(cat, t, ctx(), 'x', L({ subject: 'maths' }), { action: 'zzz' + PAD }).noneReason).toBe('unscored_step');
  });
  test('topRung divides domain_max by the SCORED rows only', () => {
    const rows = [{ id: 'F1', score: 2, applicable: true }, { id: 'F2', score: 4, applicable: true }, { id: 'F5', score: null, applicable: false }, { id: 'F6', score: null, applicable: false }];
    const t = T.pick({ indicator_scheme: 'fico_main_37', domains: { F: { domain_max: 8, indicators: rows } } }, { target: { indicator: 'F2' } }, null, C.fromData(FIX));
    expect(t.topRung).toBe(4);
    expect(t.stepAtTop).toBe(true);
  });
});

describe('engine: unscored step reaches the text route; card action and rationale are redacted (lead-review 19:41Z)', () => {
  let E;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('no supabase'); } }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    E = require('../../../bot/shared/services/coaching/video-reco/engine');
  });
  function run(analysis, nextStep, card, pick = null) {
    const completeJson = jest.fn().mockResolvedValue({ result: pick || { seg_id: null, none_reason: 'x' }, usage: {}, finishReason: 'stop' });
    const deps = {
      env: { VIDEO_RECO_ENABLED: 'true' }, catalog: C.fromData(FIX),
      store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }),
        ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r },
      v10GroupFor: async () => null, completeJson,
    };
    const session = { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' },
      diarization_data: { segments: [{ start_ms: 30000, label: 'Teacher', text: 'is this a triangle? Yes or no, quickly!' }, { start_ms: 31000, label: 'Student', text: 'جی۔' }] } };
    return E.recommendForReport({ session, analysis: { framework: 'fico', subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' }, ...analysis }, nextStep, card, coachingSessionId: 's1', deps })
      .then((row) => ({ row, prompt: (completeJson.mock.calls[0] || [])[0] || '' }));
  }
  test('unscored 37-F5 with a card sentence → step_text list, alias_kind unscored', async () => {
    // R7b: an F5 MATH label is a move only on a maths lesson (silence:label_subject elsewhere, r7b-silence.test.js)
    const { row } = await run({ subject_resolution: { code: 'maths', grade: '3', confidence: 'high' }, indicator_scheme: 'fico_main_37', domains: { F: { domain_max: 4, indicators: [{ id: 'F5', score: null, applicable: false }, { id: 'F1', score: 1, applicable: true }] } } },
      { target: { indicator: 'F5' } }, { action: 'wait for silence and pause' + PAD });
    expect(row).toMatchObject({ route: 'step_text', alias_kind: 'unscored', none_reason: 'llm_none' });
  });
  test('the teacher\'s name in the card action and a child\'s in the rationale never reach the model', async () => {
    const { prompt } = await run({ domains: { C: { indicators: [{ id: 'C1', name: 'Questioning', score: 1, applicable: true, evidence: 'Quote: "is this a triangle"', timestamp: '[00:30]' }] } } },
      { target: { indicator: 'C1', rationale: 'Ahmed answered only yes or no' } }, { indicator: 'C1', action: 'Saima Khan، اگلی کلاس میں why questions پوچھیں' });
    expect(prompt).toContain('Try this tomorrow:');
    expect(prompt).not.toMatch(/Saima|Ahmed/);
  });
});
