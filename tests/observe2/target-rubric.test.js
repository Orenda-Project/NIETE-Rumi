/**
 * /observe2's levels use the impact team's 17 indicators (fico17), whose ids (C1, D1, F4…) are also
 * FICO V4 ids with other meanings. The report's "one thing to work on" must not borrow the V4
 * indicator's count bar or levels for an /observe2 analysis (review, 4 Oct).
 */
const { resolveTarget } = require('../../bot/shared/services/coaching/target-resolver');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');
const { CODES, ROW } = require('../../bot/shared/services/observe/observe2/fico17');

const form = {
  id: 'f1', answers: { lp: 'none', priority: 'C2' }, rumi_moments: { moments: [] },
  evidence_review: { priority_final: 'C2' }, final_levels: Object.fromEntries(CODES.map((c) => [c, '2'])),
};

test('the target is the coach\'s fico17 pick, with no V4 count bar or levels attached', () => {
  const t = resolveTarget(buildAnalysis(form));
  expect(t).toMatchObject({ indicator: 'C2', name: ROW.C2, rung: 2 });
  expect(t.count).toBeNull();
  expect(t.levels).toBeNull();
});

test('a FICO V4 analysis still gets its own indicator\'s count bar', () => {
  const v4 = { framework: 'fico', focus_area: { indicator: 'C2' }, domains: { high_leverage_practices: { indicators: [{ id: 'C2', score: 1, applicable: true }] } } };
  expect(resolveTarget(v4).count).not.toBeNull();
});
