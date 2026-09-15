'use strict';
/**
 * bd-b3pop.8 — the v2 grader's own working (action_core, parts_present, parts_absent, content_as_prescribed) rides on
 * the persisted row additively; a v1 row keeps today's exact keys, and no verdict or score is touched by it.
 */
const { scoreFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-scorer');

const MOVES = [{ move_id: 'm1', phase: 'explain', bucket: 'must_happen' }, { move_id: 'm2', phase: 'exit', bucket: 'must_happen' }];

test("the v2 grader's working rides on the row; the score is unchanged by it", () => {
  const r = scoreFidelity(MOVES, [
    { move_id: 'm1', verdict: 'partial', evidence: 'e', parts_present: ['p'], parts_absent: ['q'], action_core: 'core', content_as_prescribed: false },
    { move_id: 'm2', verdict: 'not_adjudicable', evidence: '' },
  ]);
  expect(r.moves[0]).toMatchObject({ parts_present: ['p'], parts_absent: ['q'], action_core: 'core', content_as_prescribed: false, credit: 0.5 });
  expect(r.not_assessed).toEqual(['m2']);
  expect(r.fidelity_pct).toBe(50);
  expect(r).not.toHaveProperty('not_recorded');
});

test("a v1 verdict produces today's row keys, in today's order", () => {
  const r = scoreFidelity(MOVES, [{ move_id: 'm1', verdict: 'executed', evidence: 'e' }]);
  expect(Object.keys(r.moves[0])).toEqual(['move_id', 'phase', 'bucket', 'selection', 'text', 'verdict', 'evidence', 'evidence_translation', 'rationale', 'counted', 'credit']);
});
