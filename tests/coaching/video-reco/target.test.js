'use strict';
/**
 * bd-gzfdu9 — target.pick: the ONE thing a recommended clip is for (SPEC v1.2.1 §3.2 step 4).
 */
const T = require('../../../bot/shared/services/coaching/video-reco/target');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const FIX = require('./fixtures/catalog.fixture.json');
const cat = C.fromData(FIX);

function row(id, score, extra = {}) {
  return { id, name: `Name ${id}`, score, applicable: score !== null, evidence: `Quote: "evidence ${id}"`, evidence_summary: `summary ${id}`, timestamp: '[03:10]', ...extra };
}
function analysis(rows, extra = {}) {
  const dom = (k) => ({ indicators: rows.filter((r) => r.id[0] === k) });
  return { framework: 'fico', domains: { B: dom('B'), C: dom('C'), D: dom('D'), F: dom('F') }, ...extra };
}
const base = () => analysis([row('B4', 1), row('C1', 1), row('C2', 0), row('C3', 2), row('C4', 1)]);

test('(b) the next step wins: source step, the stored id and the scheme ride along', () => {
  const t = T.pick(base(), { target: { indicator: 'C1' } }, { indicator: 'C3' }, cat);
  expect(t).toMatchObject({ indicator: 'C1', indicators: ['C1'], source: 'step', stepIndicator: 'C1', stepAtTop: false, storedIndicator: 'C1', scheme: 'fico_v4', aliasKind: null, none: null });
  expect(t.row.evidence).toBe('Quote: "evidence C1"');
});

test('(a) a plan-phase step → moves, no indicator', () => {
  const t = T.pick(base(), { target: { kind: 'phase', phase: 'explain' } }, null, cat);
  expect(t).toMatchObject({ indicator: null, source: 'phase', phase: 'explain', none: null });
  expect(t.moves).toEqual(['gradual_release', 'teaching_aids', 're_explain_differently']);
  expect(T.pick(base(), { target: { kind: 'phase', phase: 'dance' } }, null, cat).none).toBe('phase');
});

test('(c) no step, a card that carries an indicator → source card', () => {
  expect(T.pick(base(), { target: null }, { indicator: 'C4', action: 'x' }, cat)).toMatchObject({ indicator: 'C4', source: 'card' });
});

test('(c\') the LLM card (action text, no indicator) → source card_text, no indicator, the card text carried', () => {
  const t = T.pick(base(), { target: null }, { action: 'Give the three fastest finishers one harder sum', highlights: ['harder sum'] }, cat);
  expect(t).toMatchObject({ indicator: null, indicators: [], source: 'card_text', none: null });
  expect(t.cardText).toContain('Give the three fastest finishers one harder sum');
  expect(t.cardText).toContain('harder sum');
});

test('(d) is gone: the scorer\'s focus is never a target', () => {
  const a = base();
  a.focus_area = { indicator: 'B4', try_this_tomorrow: 'recall yesterday' };
  expect(T.pick(a, { target: null }, null, cat).none).toBe('no_target');
  expect(T.pick(a, null, { action: '' }, cat).none).toBe('no_target');
});

test('top rung: retrieval stays on the step indicator, stepAtTop stored, never a forced differ', () => {
  const a = analysis([row('C1', 2), row('C2', 0)]);
  expect(T.pick(a, { target: { indicator: 'C1' } }, null, cat)).toMatchObject({ indicator: 'C1', stepIndicator: 'C1', stepAtTop: true, none: null });
});

test('top rung comes from domain_max / indicators, not a constant', () => {
  const a = analysis([row('C1', 3), row('C2', 1)]);
  a.domains.C.domain_max = 8; // 2 indicators → top 4
  expect(T.pick(a, { target: { indicator: 'C1' } }, null, cat).stepAtTop).toBe(false);
  a.domains.C.indicators[0].score = 4;
  expect(T.pick(a, { target: { indicator: 'C1' } }, null, cat).stepAtTop).toBe(true);
});

describe('the 37-id scheme (prod analyses, the eval corpus)', () => {
  const a37 = (rows) => analysis(rows, { indicator_scheme: 'fico_main_37' });

  test('native match first: a recommendable chapter tagged fico_main37 with the stored id → native37', () => {
    const t = T.pick(a37([row('B4', 2)]), { target: { indicator: 'B4' } }, null, cat);
    expect(t).toMatchObject({ indicator: 'B4', native37: true, aliasKind: 'native37', storedIndicator: 'B4', scheme: 'fico_main_37' });
  });

  test('no native chapter → the exact alias', () => {
    const t = T.pick(a37([row('B10', 1)]), { target: { indicator: 'B10' } }, null, cat);
    expect(t).toMatchObject({ indicator: 'B7', indicators: ['B7'], native37: false, aliasKind: 'exact', storedIndicator: 'B10' });
  });

  test('approx aliases survive only for the lesson\'s subject group (F4/F5 maths)', () => {
    expect(T.pick(a37([row('F5', 1)]), { target: { indicator: 'F5' } }, null, cat, { subject: 'maths' }))
      .toMatchObject({ indicators: ['F4', 'F5'], aliasKind: 'approx' });
    expect(T.pick(a37([row('F5', 1)]), { target: { indicator: 'F5' } }, null, cat, { subject: 'urdu' }).none).toBe('unknown_indicator');
    expect(T.pick(a37([row('F5', 1)]), { target: { indicator: 'F5' } }, null, cat, {}).none).toBe('unknown_indicator');
  });

  test('C8 → [C2, F5]: C2 survives any subject, F5 only maths', () => {
    const noNative = C.fromData({ ...FIX, modules: FIX.modules.map((m) => ({ ...m, segments: m.segments.map((s) => ({ ...s, fico_main37: [] })) })) });
    expect(T.pick(a37([row('C8', 1)]), { target: { indicator: 'C8' } }, null, noNative, { subject: 'urdu' })).toMatchObject({ indicators: ['C2'], indicator: 'C2', aliasKind: 'approx' });
    expect(T.pick(a37([row('C8', 1)]), { target: { indicator: 'C8' } }, null, noNative, { subject: 'maths' }).indicators).toEqual(['C2', 'F5']);
  });

  test('37-B7 (use of the plan) is NOT v4-B7 (closure): no native, no exact, no approx → unknown_indicator', () => {
    expect(T.pick(a37([row('B7', 1)]), { target: { indicator: 'B7' } }, null, cat).none).toBe('unknown_indicator');
  });

  test('the scheme is detected from the ids when the analysis does not say', () => {
    const a = analysis([row('B7', 1), row('C10', 1)]);
    expect(T.pick(a, { target: { indicator: 'B7' } }, null, cat).none).toBe('unknown_indicator');
  });

  test('top rung on the 37 scheme defaults to 4', () => {
    expect(T.pick(a37([row('C1', 3)]), { target: { indicator: 'C1' } }, null, cat).stepAtTop).toBe(false);
    expect(T.pick(a37([row('C1', 4)]), { target: { indicator: 'C1' } }, null, cat).stepAtTop).toBe(true);
  });
});

test('H13: an /observe2 analysis or target plan → none:scheme_observe2', () => {
  expect(T.pick({ ...base(), observe2: { v: 1 } }, { target: { indicator: 'C1' } }, null, cat).none).toBe('scheme_observe2');
  expect(T.pick(base(), { target: { indicator: 'plan' } }, null, cat).none).toBe('scheme_observe2');
});

test('the scorer quote: the Quote: part of evidence, else evidence_summary', () => {
  expect(T.scorerQuote({ evidence: 'The teacher asked closed questions. Quote: "Is this red? Yes or no"' })).toBe('Is this red? Yes or no');
  expect(T.scorerQuote({ evidence: 'no quote here', evidence_summary: 'Mostly yes/no' })).toBe('Mostly yes/no');
  expect(T.scorerQuote(null)).toBe('');
});

test('never throws on junk', () => {
  expect(T.pick(null, null, null, null).none).toBe('no_target');
  expect(T.pick({ domains: 'x' }, { target: { indicator: 'C1' } }, null, C.fromData(null)).indicator).toBe('C1');
});
