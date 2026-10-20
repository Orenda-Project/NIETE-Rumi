'use strict';
/**
 * bd-gzfdu9 — SPEC v1.3 retrieval (design/RETRIEVAL_v1.3.md §3, lead-review 19:09Z). One test per rule:
 * R1 level is a preference, never a filter; R2 the tag route sends up to 12; R3 the step-text route for
 * label / hole / unknown / empty / card_text targets; R4 route + tag_mismatch + step_text_query on the row;
 * history counts only rows the teacher could have seen (status 'shown', lead-review 19:11Z).
 */
const fs = require('fs');
const path = require('path');
const S = require('../../../bot/shared/services/coaching/video-reco/shortlist');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const FIX = require('./fixtures/catalog.fixture.json');
const cat = C.fromData(FIX);
const copy = (fn) => { const d = JSON.parse(JSON.stringify(FIX)); fn(d); return C.fromData(d); };
const seg = (d, id) => d.modules.flatMap((m) => m.segments).find((s) => s.seg_id === id);

const tgt = (indicator, extra = {}) => ({ indicator, indicators: [indicator], moves: [], native37: false, source: 'step', scheme: 'fico_v4', storedIndicator: indicator, ...extra });
// 37-F5 (subject pedagogy: maths) on a maths lesson: the crosswalk's approx ids, a LABEL, not a move.
const F5 = tgt('F4', { indicators: ['F4', 'F5'], scheme: 'fico_main_37', storedIndicator: 'F5', aliasKind: 'approx' });
// 37-B7 (use of the lesson plan): no native tag, no exact, no approx → target.pick says unknown_indicator.
const B7 = { indicator: null, indicators: [], moves: [], native37: false, source: 'step', scheme: 'fico_main_37', storedIndicator: 'B7', aliasKind: 'none', none: 'unknown_indicator' };
const CARD = { indicator: null, indicators: [], moves: [], source: 'card_text', cardText: 'unused by the text route' };
const ctx = (extra = {}) => ({ language: 'ur', languages: ['ur', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] }, ...extra });
const L = (extra = {}) => ({ subject: 'urdu', grade: { lo: 3, hi: 3 }, topic: null, inapplicable: [], ...extra });
const step = (action) => ({ action, tryTomorrow: '', thingToTry: '', name: '' });
const ids = (r) => r.candidates.map((c) => c.seg_id);
const routes = (r) => r.candidates.map((c) => c.route);

describe('R1 level is a preference, never a filter', () => {
  test('known level 2: the level-4 chapter is listed (far), the level-2 ones are near', () => {
    const r = S.build(cat, tgt('C1'), ctx({ level: 2 }), 'why', L());
    const by = Object.fromEntries(r.candidates.map((c) => [c.seg_id, c.level_match]));
    expect(by['13-s1']).toBe('far');
    expect(by['10-s1']).toBe('near');
    expect(by['11-s1']).toBe('near');
  });
  test('+0.5 within ±1: at equal text a near chapter ranks above a far one', () => {
    const score = (c) => S.build(c, tgt('C1'), ctx({ level: 2 }), 'why question', L()).candidates.find((x) => x.seg_id === '13-s1').score;
    const near = copy((d) => { d.modules.find((m) => m.module_id === 13).level_id = 3; });
    expect(score(near) - score(cat)).toBeCloseTo(0.5, 4); // the same chapter at level 3 (near) vs level 4 (far)
  });
  test('3 rungs apart is listed, not none:level (none:level cannot occur)', () => {
    const c = copy((d) => { d.modules.find((m) => m.module_id === 19).level_id = 1; });
    const r = S.build(c, tgt('B4'), ctx({ level: 4 }), 'recall', L());
    expect(ids(r)).toEqual(['19-s1']);
    expect(r.candidates[0].level_match).toBe('far');
    for (const lv of [1, 2, 3, 4]) expect(S.build(c, tgt('B4'), ctx({ level: lv }), 'x', L()).noneReason).not.toBe('level');
  });
  test('unknown level and a completed ladder are unchanged', () => {
    expect(ids(S.build(cat, tgt('C1'), ctx({ level: null }), 'why', L()))).not.toContain('13-s1');
    expect(S.build(cat, tgt('C1'), ctx({ level: null }), 'why', L()).levelMatch).toBe('unknown');
    expect(S.build(cat, tgt('C1'), ctx({ level: 4, ladderComplete: true }), 'why', L()).levelMatch).toBe('completed');
  });
});

test('R2 the tag route sends up to 12 chapters', () => {
  const c = copy((d) => {
    for (let i = 0; i < 15; i++) {
      d.modules.push({ ...JSON.parse(JSON.stringify(d.modules[0])), module_id: 100 + i, segments: [{ seg_id: `${100 + i}-s1`, start_s: 0, end_s: 60, fico: [{ indicator: 'C1', strength: 2 }], keywords: ['why'] }] });
    }
  });
  expect(S.MAX_CANDIDATES).toBe(12);
  const r = S.build(c, tgt('C1'), ctx(), 'why', L());
  expect(r.candidates).toHaveLength(12);
  expect(new Set(routes(r))).toEqual(new Set(['tag']));
});

describe('R3 the step-text route', () => {
  test('LABEL (37-F5 on maths): tag candidates first, then step_text ones, never a duplicate', () => {
    const r = S.build(cat, F5, ctx(), 'reasoning', L({ subject: 'maths' }), step('wait for silence, pause, then feedback'));
    expect(r.textReason).toBe('label');
    expect(ids(r)[0]).toBe('22-s1');
    expect(r.candidates[0].route).toBe('tag');
    expect(ids(r)).toEqual(expect.arrayContaining(['10-s2', '14-s1']));
    const firstText = routes(r).indexOf('step_text');
    expect(firstText).toBeGreaterThan(0);
    expect(routes(r).slice(firstText).every((x) => x === 'step_text')).toBe(true);
    expect(new Set(ids(r)).size).toBe(ids(r).length);
    expect(r.stepTextQuery).toContain('silence');
  });
  test('a MOVE indicator never gets the text route (the list stays step-indicator-only)', () => {
    const r = S.build(cat, tgt('C1'), ctx(), 'why', L(), step('feedback correct next exit summary'));
    expect(r.textReason).toBeNull();
    expect(ids(r)).not.toContain('14-s1');
    expect(new Set(routes(r))).toEqual(new Set(['tag']));
    expect(r.stepTextQuery).toBeNull();
  });
  test('37 label with a NATIVE tag pool still appends the text route', () => {
    const c = copy((d) => { seg(d, '22-s1').fico_main37 = ['F5']; });
    const t = tgt('F5', { native37: true, scheme: 'fico_main_37', storedIndicator: 'F5', aliasKind: 'native37' });
    const r = S.build(c, t, ctx(), 'x', L({ subject: 'maths' }), step('wait pause silence'));
    expect(r.textReason).toBe('label');
    expect(ids(r)).toEqual(['22-s1', '10-s2']);
  });
  test('v4 id in holes[]: the text route alone; nothing over the floor → none:hole', () => {
    const r = S.build(cat, tgt('D3'), ctx(), 'x', L(), step('feedback correct next'));
    expect(r.textReason).toBe('hole');
    expect(ids(r)).toEqual(['14-s1']);
    expect(routes(r)).toEqual(['step_text']);
    expect(S.build(cat, tgt('D3'), ctx(), 'x', L(), step('zzz')).noneReason).toBe('hole');
  });
  test('37 label whose v4 exact is a hole (native pool present) also appends the text route', () => {
    const c = copy((d) => { seg(d, '14-s1').fico_main37 = ['D9']; d.indicator_aliases.D9 = { exact: 'D3', approx: [] }; });
    const t = tgt('D9', { native37: true, scheme: 'fico_main_37', storedIndicator: 'D9', aliasKind: 'native37' });
    const r = S.build(c, t, ctx(), 'x', L(), step('wait pause silence'));
    expect(r.textReason).toBe('hole');
    expect(ids(r)).toEqual(['14-s1', '10-s2']);
  });
  test('unknown_indicator: the text route alone; nothing over the floor → none:unknown_indicator', () => {
    const r = S.build(cat, B7, ctx(), 'x', L(), step('exit summary'));
    expect(r.textReason).toBe('unknown');
    expect(ids(r)).toEqual(['14-s2']);
    expect(routes(r)).toEqual(['step_text']);
    expect(S.build(cat, B7, ctx(), 'x', L(), step('zzz')).noneReason).toBe('unknown_indicator');
  });
  test('subject-blocked alias is its own reason', () => {
    expect(S.build(cat, { ...B7, storedIndicator: 'F5', aliasKind: 'subject_blocked' }, ctx(), 'x', L(), step('exit summary')).textReason).toBe('subject_blocked');
  });
  test('tag pool emptied by the filters (language): the text route alone; still empty → the filter\'s own reason', () => {
    const en = ctx({ language: 'en', languages: ['en', 'mixed'] });
    const r = S.build(cat, tgt('B4'), en, 'x', L(), step('feedback correct next'));
    expect(r.textReason).toBe('empty');
    expect(ids(r)).toEqual(['14-s1']);
    expect(S.build(cat, tgt('B4'), en, 'x', L(), step('zzz')).noneReason).toBe('language');
  });
  test('card_text: the text route alone, route card_text, the query is the card words (never the evidence)', () => {
    const r = S.build(cat, CARD, ctx(), 'wait pause silence', L(), step('feedback correct next'));
    expect(r.textReason).toBe('card_text');
    expect(ids(r)).toEqual(['14-s1']);
    expect(routes(r)).toEqual(['card_text']);
    expect(S.build(cat, CARD, ctx(), 'wait pause silence feedback', L(), step('zzz')).noneReason).toBe('no_target');
  });
  test('floor 2.0 per chapter, at most 6, BM25 order', () => {
    const c = copy((d) => {
      for (let i = 0; i < 9; i++) {
        d.modules.push({ ...JSON.parse(JSON.stringify(d.modules[0])), module_id: 200 + i, segments: [{ seg_id: `${200 + i}-s1`, start_s: 0, end_s: 60, fico: [{ indicator: 'B6', strength: 2 }], keywords: ['rhyme', 'chant', ...Array(i).fill('filler')] }] });
      }
    });
    const r = S.build(c, B7, ctx(), 'x', L(), step('rhyme chant'));
    expect(r.candidates).toHaveLength(6);
    expect(r.candidates.every((x) => x.score >= 2.0)).toBe(true);
    expect(ids(r)).toEqual(['200-s1', '201-s1', '202-s1', '203-s1', '204-s1', '205-s1']);
    const weak = S.build(cat, B7, ctx(), 'x', L(), step('why question'));
    expect(weak.candidates.every((x) => x.score >= 2.0)).toBe(true);
  });
  test('the text pool keeps the subject, grade, language, history and media filters', () => {
    const r = S.build(cat, B7, ctx({ history: { segments: ['10-s2'], modules: [] } }), 'x', L(), step('reasoning know wait pause welcome course recall'));
    for (const id of ['22-s1', '10-s2', '16-s1']) expect(ids(r)).not.toContain(id); // maths-only, seen, programme intro
    expect(ids(r)).toContain('19-s1');
    expect(ids(S.build(cat, B7, ctx(), 'x', L({ grade: { lo: 3, hi: 3 } }), step('why question')))).not.toContain('18-s1');
    expect(ids(S.build(cat, B7, ctx(), 'x', L(), step('why question')))).not.toContain('12-s1'); // English chapter, Urdu teacher
  });
  test('textRoute is pure and exported; exclude drops already-listed chapters', () => {
    const q = { action: 'feedback correct', tryTomorrow: 'next', thingToTry: '', name: '' };
    expect(S.textRoute(cat, q, ctx(), L(), []).map((x) => x.seg_id)).toEqual(['14-s1']);
    expect(S.textRoute(cat, q, ctx(), L(), ['14-s1'])).toEqual([]);
  });
  test('stepQuery = action + try_this_tomorrow + thing_to_try + the indicator name', () => {
    expect(S.stepQuery({ action: 'a1', tryTomorrow: 't2', thingToTry: 'k3', name: 'Use of Lesson Plan' })).toBe('a1\nt2\nk3\nUse of Lesson Plan');
    expect(S.stepQuery({ action: 'a1', tryTomorrow: '', thingToTry: null, name: '' })).toBe('a1');
  });
});

describe('R4 the row (engine)', () => {
  let E;
  const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
  const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: () => { throw new Error('no supabase'); } }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    E = require('../../../bot/shared/services/coaching/video-reco/engine');
  });
  const pickOf = (segId) => ({
    seg_id: segId, moment: { at: '00:30', quote: '[a student], tum batao: is this a triangle? Yes or no' },
    reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a calmer way to finish.',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں سبق کو بہتر طریقے سے ختم کیا گیا ہے۔', confidence: 0.6,
  });
  function run({ analysis, nextStep, card, pick, subject = 'urdu' }) {
    const completeJson = jest.fn().mockResolvedValue({ result: pickOf(pick), usage: {}, finishReason: 'stop' });
    const deps = {
      env: { VIDEO_RECO_ENABLED: 'true' },
      catalog: C.fromData(FIX),
      store: {
        readForSession: jest.fn().mockResolvedValue(null),
        recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
        ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }),
        trainingBands: jest.fn().mockResolvedValue([]),
        write: jest.fn(async (row) => row),
      },
      v10GroupFor: jest.fn().mockResolvedValue(null),
      completeJson,
    };
    const session = {
      id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' },
      diarization_data: { segments: [{ start_ms: 30000, label: 'Teacher', text: 'Ahmed, tum batao: is this a triangle? Yes or no, quickly!' }] },
    };
    const a = { framework: 'fico', subject_resolution: { code: subject, grade: '3', confidence: 'high' }, ...analysis };
    return E.recommendForReport({ session, analysis: a, nextStep, card, coachingSessionId: SID, deps }).then((row) => ({ row, completeJson }));
  }
  const a37 = (id, name) => ({ indicator_scheme: 'fico_main_37', domains: { B: { domain_max: 4, indicators: [{ id, name, score: 1, applicable: true, evidence: 'Quote: "Is this a triangle"', timestamp: '[00:30]' }] } } });

  test('unknown 37-id (B7, use of the plan): reaches the model via the text route; route step_text, alias_kind unknown, tag_mismatch true, differs false', async () => {
    const { row, completeJson } = await run({
      analysis: a37('B7', 'Use of Taleemabad Lesson Plan'), nextStep: { target: { indicator: 'B7' } },
      card: { action: 'Close with an exit summary of what we learned' }, pick: '14-s2',
    });
    expect(completeJson).toHaveBeenCalledTimes(1);
    expect(completeJson.mock.calls[0][0]).toContain('Indicator: B7 — Use of Taleemabad Lesson Plan');
    expect(row).toMatchObject({ status: 'shown', seg_id: '14-s2', route: 'step_text', alias_kind: 'unknown', tag_mismatch: true, differs_from_step: false });
    expect(row.step_text_query).toContain('exit summary');
    expect(new Set(row.candidates.map((c) => c.route))).toEqual(new Set(['step_text']));
    expect(row.step_text_query).toContain('Use of Taleemabad Lesson Plan');
  });
  test('LABEL (37-F5, maths): a step_text pick passes validation; differs false, tag_mismatch reported', async () => {
    const { row } = await run({
      analysis: a37('F5', 'Subject-Specific Pedagogy: MATH'), nextStep: { target: { indicator: 'F5' } },
      card: { action: 'Wait for silence and pause before you ask' }, pick: '10-s2', subject: 'maths',
    });
    expect(row).toMatchObject({ status: 'shown', seg_id: '10-s2', route: 'step_text', alias_kind: 'label', tag_mismatch: true, differs_from_step: false });
    expect(row.candidates[0]).toMatchObject({ seg_id: '22-s1', route: 'tag' });
  });
  test('MOVE indicator (C1): route tag, tag_mismatch false, no step_text_query', async () => {
    const { row } = await run({
      analysis: { domains: { C: { indicators: [{ id: 'C1', name: 'Questioning', score: 1, applicable: true, evidence: 'Quote: "Is this a triangle"', timestamp: '[00:30]' }] } } },
      nextStep: { target: { indicator: 'C1' } }, card: { action: 'Ask why questions' }, pick: '10-s1',
    });
    expect(row).toMatchObject({ status: 'shown', route: 'tag', tag_mismatch: false, differs_from_step: false, step_text_query: null, level_match: 'near' });
  });
  test('card_text: route card_text, no step indicator so tag_mismatch is null', async () => {
    const { row } = await run({
      analysis: { domains: { C: { indicators: [] } } }, nextStep: { target: null }, card: { action: 'Give feedback: correct, then next' }, pick: '14-s1',
    });
    expect(row).toMatchObject({ status: 'shown', target_source: 'card_text', route: 'card_text', tag_mismatch: null, differs_from_step: false });
  });
});

describe('history counts only what the teacher could have seen', () => {
  test('recentHistory filters status = shown', async () => {
    jest.resetModules();
    const { fakeSupabase } = require('./fixtures/fake-supabase');
    const db = fakeSupabase({ video_recommendations: { data: [], error: null } });
    jest.doMock('../../../bot/shared/config/supabase', () => db);
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    const store = require('../../../bot/shared/services/coaching/video-reco/store');
    await store.recentHistory('u1');
    expect(db.calls[0]).toContainEqual(['eq', ['status', 'shown']]);
  });
});

test('build-catalog: each alias carries the crosswalk display name (the text-route query uses it)', () => {
  const B = require('../../../bot/scripts/video-reco/build-catalog');
  const a = B.aliasesFrom({ map: { B7: { name: 'Use of Taleemabad Lesson Plan', exact: null, approx: [] } } });
  expect(a.B7).toEqual({ exact: null, approx: [], name: 'Use of Taleemabad Lesson Plan' });
  expect(a.C1).toEqual({ exact: 'C1', approx: [], name: null });
});

test('V1.7.1 is additive and idempotent; its rollback drops only its own columns', () => {
  const dir = path.join(__dirname, '../../../infrastructure/supabase/migrations');
  const up = fs.readFileSync(path.join(dir, 'V1.7.1__video_reco_retrieval_route.sql'), 'utf8');
  const down = fs.readFileSync(path.join(dir, 'ROLLBACK_V1.7.1__video_reco_retrieval_route.sql'), 'utf8');
  for (const col of ['route', 'tag_mismatch', 'step_text_query']) {
    expect(up).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    expect(down).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${col}\\b`));
  }
  expect(up).not.toMatch(/DROP|CREATE TABLE|NOT NULL(?! DEFAULT)/);
  expect(down).not.toMatch(/DROP TABLE/);
});
