'use strict';
/**
 * bd-gzfdu9 — SPEC §3.3 R3 [v1.3c-4] (lead-review 21:02Z; evals 21:01Z measured 0 gold hits lost): the stub floor on
 * the step-text route. The card's own content words (action + try-tomorrow + thing-to-try, names redacted, [TAG]s
 * dropped, en/ur function words out, distinct, WITHOUT the indicator's display name) under 6 → no BM25 over a stub,
 * none:'no_target'. Tag-route indicators are untouched.
 */
const S = require('../../../bot/shared/services/coaching/video-reco/shortlist');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.fromData(require('./fixtures/catalog.fixture.json'));
const tgt = (indicator, extra = {}) => ({ indicator, indicators: [indicator], moves: [], native37: false, source: 'step', scheme: 'fico_v4', storedIndicator: indicator, ...extra });
const B7 = { indicator: null, indicators: [], moves: [], native37: false, source: 'step', scheme: 'fico_main_37', storedIndicator: 'B7', aliasKind: 'none', none: 'unknown_indicator' };
const ctx = () => ({ language: 'ur', languages: ['ur', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] } });
const L = () => ({ subject: 'urdu', grade: { lo: 3, hi: 3 }, topic: null, inapplicable: [] });
const step = (action, extra = {}) => ({ action, tryTomorrow: '', thingToTry: '', name: '', ...extra });

describe('contentWords: what the floor counts', () => {
  test('function words, [TAG]s and repeats are out; the indicator name is not counted', () => {
    expect(S.contentWords(step('[TEACHER], give the feedback and the feedback', { name: 'Student Talk Time Quality' }))).toEqual(['give', 'feedback']);
  });
  test('the three card fields are counted together, distinct', () => {
    expect(S.contentWords(step('wait pause', { tryTomorrow: 'pause silence', thingToTry: 'count five' }))).toEqual(['wait', 'pause', 'silence', 'count', 'five']);
  });
  test('Urdu function words are out', () => {
    expect(S.contentWords(step('بچوں کو سوال کے بعد انتظار کریں'))).toEqual(['بچوں', 'سوال', 'بعد', 'انتظار']);
  });
});

describe('the stub floor (6) on the step-text route', () => {
  test('4-word card on an unknown step → none:no_target, no BM25 (alias kept via textReason)', () => {
    const r = S.build(cat, B7, ctx(), 'x', L(), step('give feedback, correct next'));
    expect(r.candidates).toEqual([]);
    expect(r.noneReason).toBe('no_target');
    expect(r.textReason).toBe('unknown');
    expect(r.route).toBe('step_text');
  });
  test('4-word card on a hole (v4 D3) step → none:no_target', () => {
    const r = S.build(cat, tgt('D3'), ctx(), 'x', L(), step('give feedback, correct next'));
    expect(r.noneReason).toBe('no_target');
    expect(r.textReason).toBe('hole');
  });
  test('the indicator display name does not lift a stub over the floor', () => {
    const r = S.build(cat, B7, ctx(), 'x', L(), step('give feedback, correct next', { name: 'Feedback Exit Summary Lesson Plan Use' }));
    expect(r.noneReason).toBe('no_target');
  });
  test('6-word card → the route runs', () => {
    const r = S.build(cat, tgt('D3'), ctx(), 'x', L(), step('give feedback, correct next answer quickly'));
    expect(r.textReason).toBe('hole');
    expect(r.candidates.map((c) => c.seg_id)).toEqual(['14-s1']);
    expect(r.route).toBe('step_text');
  });
  test('4-word card on a tag-route (move) indicator → unaffected (b1664ce6)', () => {
    const r = S.build(cat, tgt('C1'), ctx(), 'why', L(), step('Sat together, worked alone'));
    expect(r.textReason).toBeNull();
    expect(r.route).toBe('tag');
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});

test('a filter emptied the tag pool and the card is a stub: no BM25, the filter stays the reason', () => {
  const en = { ...ctx(), language: 'en', languages: ['en', 'mixed'] };
  const r = S.build(cat, tgt('B4'), en, 'x', L(), step('feedback correct next'));
  expect(r.textReason).toBe('empty');
  expect(r.candidates).toEqual([]);
  expect(r.noneReason).toBe('language');
});
