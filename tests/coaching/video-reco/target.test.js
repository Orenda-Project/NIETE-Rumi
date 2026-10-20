'use strict';
/**
 * bd-gzfdu9 — target.pick: the ONE indicator (or plan phase) a recommended clip is for (SPEC §3.2 step 4).
 */
const T = require('../../../bot/shared/services/coaching/video-reco/target');
const ALIASES = require('./fixtures/catalog.fixture.json').indicator_aliases;

function row(id, score, extra = {}) {
  return { id, name: `Name ${id}`, score, applicable: score !== null, evidence: `evidence ${id}`, evidence_summary: `summary ${id}`, timestamp: '[03:10]', ...extra };
}
function analysis(rows, extra = {}) {
  return {
    framework: 'fico',
    domains: {
      B: { indicators: rows.filter((r) => r.id[0] === 'B') },
      C: { indicators: rows.filter((r) => r.id[0] === 'C') },
      D: { indicators: rows.filter((r) => r.id[0] === 'D') },
      F: { indicators: rows.filter((r) => r.id[0] === 'F') },
    },
    ...extra,
  };
}
const base = () => analysis([row('B4', 1), row('C1', 1), row('C2', 0), row('C3', 2), row('C4', 1), row('D2', 0, { evidence: '', evidence_summary: '' })]);

test('the next step wins: target = nextStep.target.indicator, source step', () => {
  const t = T.pick(base(), { target: { indicator: 'C1', rung: 1 } }, { indicator: 'C3' }, ALIASES);
  expect(t).toMatchObject({ indicator: 'C1', source: 'step', stepIndicator: 'C1', forcedDiffer: false, none: null });
  expect(t.row.evidence).toBe('evidence C1');
});

test('alsoWeak = the two other lowest applicable rows (score ≤ 1), lowest first', () => {
  const t = T.pick(base(), { target: { indicator: 'C1' } }, null, ALIASES);
  expect(t.alsoWeak).toEqual(['C2', 'D2']);
});

test('a plan-phase step → moves, no indicator', () => {
  const t = T.pick(base(), { target: { kind: 'phase', phase: 'explain', name: 'Explain' } }, null, ALIASES);
  expect(t).toMatchObject({ indicator: null, source: 'phase', phase: 'explain', none: null });
  expect(t.moves).toEqual(['gradual_release', 'teaching_aids', 're_explain_differently']);
});

test.each([
  ['warm_up', ['activate_prior_knowledge', 'state_objective']],
  ['hook', ['activate_prior_knowledge', 'state_objective']],
  ['guided', ['check_understanding', 'group_work']],
  ['independent', ['differentiate_tasks']],
  ['exit', ['closure_check', 'peer_self_assessment']],
])('phase %s → %p', (phase, moves) => {
  expect(T.pick(base(), { target: { kind: 'phase', phase } }, null, ALIASES).moves).toEqual(moves);
});

test('an unmapped phase → none:phase', () => {
  expect(T.pick(base(), { target: { kind: 'phase', phase: 'dance' } }, null, ALIASES).none).toBe('phase');
});

test('v10 A/B (target null) → the commitment card\'s indicator, source card', () => {
  const t = T.pick(base(), { target: null }, { indicator: 'C4', action: 'Let them choose' }, ALIASES);
  expect(t).toMatchObject({ indicator: 'C4', source: 'card' });
});

test('no step, no card indicator → the scorer\'s stored focus (resolveTarget), source scorer', () => {
  const a = base();
  a.focus_area = { indicator: 'B4', try_this_tomorrow: 'recall yesterday' };
  const t = T.pick(a, { target: null }, { action: 'x' }, ALIASES);
  expect(t).toMatchObject({ indicator: 'B4', source: 'scorer' });
});

test('nothing at all → none:no_target (the weakest row is never used alone)', () => {
  expect(T.pick(base(), { target: null }, null, ALIASES).none).toBe('no_target');
  expect(T.pick(base(), null, null, ALIASES).none).toBe('no_target');
});

test('the C1 trap: a top-rung step keeps stepIndicator but retrieval uses the next-lowest row with quotable evidence', () => {
  const a = analysis([row('C1', 2), row('C2', 1), row('B4', 0, { evidence: '', evidence_summary: '' }), row('C4', 1, { timestamp: '[09:00]' })]);
  const t = T.pick(a, { target: { indicator: 'C1' } }, null, ALIASES);
  expect(t).toMatchObject({ indicator: 'C2', stepIndicator: 'C1', forcedDiffer: true, none: null });
});

test('a top-rung step with no weaker quotable row → none:top_rung', () => {
  const a = analysis([row('C1', 2), row('C2', 2)]);
  expect(T.pick(a, { target: { indicator: 'C1' } }, null, ALIASES).none).toBe('top_rung');
});

describe('the 37-id scheme (prod analyses, the eval corpus)', () => {
  const a37 = () => analysis([row('B10', 1), row('C1', 2), row('C5', 1), row('C6', 1), row('B7', 1), row('C10', 1)], { indicator_scheme: 'fico_main_37' });

  test('a 37-id maps through the aliases to its v4 id', () => {
    const t = T.pick(a37(), { target: { indicator: 'B10' } }, null, ALIASES);
    expect(t).toMatchObject({ indicator: 'B7', stepIndicator: 'B7', none: null });
  });

  test('37-scheme B7 (use of the plan) is NOT v4 B7 (closure): it maps to null → unknown_indicator', () => {
    expect(T.pick(a37(), { target: { indicator: 'B7' } }, null, ALIASES).none).toBe('unknown_indicator');
  });

  test('an id with no v4 equivalent → none:unknown_indicator', () => {
    expect(T.pick(a37(), { target: { indicator: 'C6' } }, null, ALIASES).none).toBe('unknown_indicator');
  });

  test('top rung on the 37 scheme is 3, not 2: C1 at 2 is still a growth area', () => {
    const t = T.pick(a37(), { target: { indicator: 'C1' } }, null, ALIASES);
    expect(t).toMatchObject({ indicator: 'C1', forcedDiffer: false });
  });

  test('alsoWeak are v4 ids, unmappable rows dropped', () => {
    const t = T.pick(a37(), { target: { indicator: 'C1' } }, null, ALIASES);
    expect(t.alsoWeak).toEqual(['B7', 'C4']);
  });

  test('the scheme is detected from the ids when the analysis does not say', () => {
    const a = a37();
    delete a.indicator_scheme;
    expect(T.pick(a, { target: { indicator: 'B7' } }, null, ALIASES).none).toBe('unknown_indicator');
  });
});

test('red-team H13: an /observe2 analysis (other meanings for the same ids) → none:scheme_observe2', () => {
  expect(T.pick({ ...base(), observe2: { v: 1 } }, { target: { indicator: 'C1' } }, null, ALIASES).none).toBe('scheme_observe2');
  expect(T.pick({ ...base(), focus_area: { indicator: 'plan' } }, { target: null }, null, ALIASES).none).toBe('scheme_observe2');
});

test('r-ab: the stored id and the scheme ride along (37-id B10 → catalog B7)', () => {
  const a = analysis([row('B10', 1), row('C5', 1)], { indicator_scheme: 'fico_main_37' });
  expect(T.pick(a, { target: { indicator: 'B10' } }, null, ALIASES)).toMatchObject({ storedIndicator: 'B10', storedStep: 'B10', indicator: 'B7', scheme: 'fico_main_37' });
  expect(T.pick(base(), { target: { indicator: 'C1' } }, null, ALIASES)).toMatchObject({ storedIndicator: 'C1', scheme: 'fico_v4' });
});

test('never throws on junk', () => {
  expect(T.pick(null, null, null, null).none).toBe('no_target');
  expect(T.pick({ domains: 'x' }, { target: { indicator: 'C1' } }, null, {}).indicator).toBe('C1');
});
