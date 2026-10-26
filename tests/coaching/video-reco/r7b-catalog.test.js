'use strict';
/**
 * bd-8hhqhf R7b (COS ruling 20261023T144730 2c; panel ped/REVIEW_r7_scale.md §1.4, §6.2; ped/GRADE_REVIEW_r7.md §Addendum).
 * The shipped catalogue data, not a fixture:
 * - Bloom's-definition chapters 48-s2/s4/s5 and the inquiry definition 95-s2 stay on the ladder but are never a next-step
 *   pick (0/8 right+acceptable across the 200; both personas named 51-s1 the better pick);
 * - the leader-facing differentiation chapters 156-s2 / 157-s3 are kept with a caveat: only for a lesson with a visible
 *   mixed-level moment (4/14 in the panel; P093, P097, P140, P188 reached them with none);
 * - the six chapters ped-scale cleared at 14:42Z carry their own grade_band (77-s3's module is already 'all').
 */
const S = require('../../../bot/shared/services/coaching/video-reco/shortlist');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.load();
const hitOf = (id) => cat.segment(id);
const ctx = { language: 'ur', languages: ['ur', 'en', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] } };
const PRIMARY = { subject: null, grade: { lo: 3, hi: 3 }, topic: null, inapplicable: [] };
const ids = (r) => r.candidates.map((c) => c.seg_id);
const tag = (id) => ({ indicator: id, indicators: [id], moves: [], native37: true, source: 'card', scheme: 'fico_main_37', storedIndicator: id, aliasKind: 'native37' });

test.each([['48-s2'], ['48-s4'], ['48-s5'], ['95-s2']])('%s is not recommendable, with a panel reason, and stays in the ladder', (id) => {
  const { module, segment } = hitOf(id);
  expect(segment.recommendable).toBe(false);
  expect(segment.recommendable_reason).toMatch(/^panel_veto: /);
  expect(S.recommendable(module, segment)).toBe(false);
  expect(module.recommendable).not.toBe(false); // the module (the ladder) is untouched
});

test('P080 shape: a C1 step on a primary lesson never shortlists a Bloom\'s-definition chapter', () => {
  const r = S.build(cat, tag('C1'), ctx, 'remember understand recall own words bloom levels question', PRIMARY);
  expect(r.candidates.length).toBeGreaterThan(0);
  for (const id of ['48-s2', '48-s4', '48-s5', '95-s2']) expect(ids(r)).not.toContain(id);
});

test.each([['156-s2'], ['157-s3']])('%s carries the mixed-level caveat', (id) => {
  expect(hitOf(id).segment.keep_with_caveat).toBe('mixed_level_task');
});

test('P093/P140 shape: a B6 step with no mixed-level moment → neither caveat chapter is shortlisted; with one → both can be', () => {
  const l4 = { ...ctx, level: 4 }; // both chapters sit in level-4 modules: a level-4 teacher sees them first
  const words = 'same content different support three-tier task describing people different tasks'; // their own titles
  const without = ids(S.build(cat, tag('B6'), l4, words, { ...PRIMARY, levelsMoment: false }));
  expect(without).not.toContain('156-s2');
  expect(without).not.toContain('157-s3');
  const withIt = ids(S.build(cat, tag('B6'), l4, words, { ...PRIMARY, levelsMoment: true }));
  expect(withIt).toEqual(expect.arrayContaining(['156-s2', '157-s3']));
});

test('the six chapters ped-scale cleared at 14:42Z carry exactly its bands', () => {
  const want = { '50-s3': '1-8', '10-s2': 'all', '10-s3': '1-8', '22-s3': '1-8', '128-s4': 'all' };
  for (const [id, band] of Object.entries(want)) expect(hitOf(id).segment.grade_band).toBe(band);
  // 77-s3: the gate already reads its module's 'all' (the caveat ped-scale raised), so no chapter band is needed
  expect(hitOf('77-s3').segment.grade_band).toBeUndefined();
  expect(hitOf('77-s3').module.grade_band).toBe('all');
});

test.each([
  ['50-s3', { lo: 7, hi: 7 }, true], ['50-s3', { lo: 10, hi: 10 }, false],
  ['10-s3', { lo: 7, hi: 7 }, true], ['10-s3', { lo: 10, hi: 10 }, false],
  ['22-s3', { lo: 6, hi: 8 }, true], ['22-s3', { lo: 9, hi: 12 }, false],
  ['10-s2', { lo: 10, hi: 10 }, true], ['128-s4', { lo: 9, hi: 12 }, true], ['77-s3', { lo: 9, hi: 12 }, true],
])('%s at grades %j passes the grade gate: %s', (id, grade, ok) => {
  const { module, segment } = hitOf(id);
  expect(S.gradeOk(segment.grade_band || module.grade_band, grade)).toBe(ok);
});
