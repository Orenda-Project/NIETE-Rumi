'use strict';
/**
 * bd-8hhqhf (VIDREC round 7, COS 075310, ped-scale 080036): the grade gate reads a chapter's own grade_band before its
 * module's, and the panel cleared 7 chapters of primary-band modules for older classes (ped/GRADE_REVIEW_r7.md).
 * Gold 383a31f3: a teacher whose users.teacher_level is HIGH, no lesson grade, step C1. The panel's acceptable chapters
 * 51-s1/51-s2 sit in module 51 (grade_band primary), so the gate dropped them once the band reached the engine.
 */
const S = require('../../../bot/shared/services/coaching/video-reco/shortlist');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.load(); // the shipped catalogue data, not a fixture
const C1 = { indicator: 'C1', indicators: ['C1'], moves: [], native37: false, source: 'card', scheme: 'fico_main_37', storedIndicator: 'C1', aliasKind: 'exact' };
const ctx = { language: 'ur', languages: ['ur', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] } };
const HIGH = { subject: null, grade: { lo: 9, hi: 12 }, topic: null, inapplicable: [] };
const ids = (r) => r.candidates.map((c) => c.seg_id);
const segOf = (id) => cat.modules.flatMap((m) => m.segments).find((s) => s.seg_id === id);

test('383a31f3 shape: a HIGH-band teacher, no lesson grade, C1 → the panel-cleared 51-s1 / 51-s2 are shortlisted', () => {
  const r = S.build(cat, C1, ctx, 'why question answer', HIGH);
  expect(ids(r)).toEqual(expect.arrayContaining(['51-s1', '51-s2']));
});

test('a chapter the panel did not clear keeps its module band: 51-s3 (module primary) stays out for a HIGH lesson', () => {
  expect(ids(S.build(cat, C1, ctx, 'why question answer', HIGH))).not.toContain('51-s3');
});

test('the 9 reviewed chapters carry exactly the panel bands (PRIMARY-only ones carry none, the module band applies)', () => {
  const want = { '51-s1': 'all', '51-s2': 'all', '156-s2': '1-8', '50-s2': 'all', '65-s4': '1-8', '68-s4': '1-8', '141-s5': 'all' };
  for (const [id, band] of Object.entries(want)) expect(segOf(id).grade_band).toBe(band);
  expect(segOf('156-s3').grade_band).toBeUndefined();
  expect(segOf('156-s6').grade_band).toBeUndefined();
});

test('an unknown lesson grade: a chapter range that covers grades 1–5 passes like the primary module band it replaces', () => {
  expect(S.gradeOk('primary', null)).toBe(true);
  expect(S.gradeOk('1-8', null)).toBe(true);
  expect(S.gradeOk('6-8', null)).toBe(false); // unchanged: a narrow older band needs a known grade
  const NONE = { ...HIGH, grade: null };
  expect(ids(S.build(cat, C1, ctx, 'why question answer', NONE))).toEqual(expect.arrayContaining(['51-s1', '51-s2']));
});

test('a "1-8" chapter band: in for a MIDDLE lesson, out for a HIGH one', () => {
  const MIDDLE = { ...HIGH, grade: { lo: 6, hi: 8 } };
  const pool = (lesson) => S.build(cat, { ...C1, indicator: null, indicators: [], none: 'unknown_indicator', storedIndicator: 'B9' }, ctx, '', lesson,
    { action: 'mixed ability groups different tasks for each group zephyr quokka marimba', tryTomorrow: '', thingToTry: '', name: '' });
  // the gate itself, read directly: a chapter band overrides the module band both ways
  expect(S.gradeOk('1-8', MIDDLE.grade)).toBe(true);
  expect(S.gradeOk('1-8', HIGH.grade)).toBe(false);
  expect(Array.isArray(pool(MIDDLE).candidates)).toBe(true);
});
