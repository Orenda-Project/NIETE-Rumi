/**
 * Mock lane — scenario selection with an exclusion set, for sharding a feature across slots (bd-r09cmx).
 *
 * The suite wall is set by the longest feature on one slot (training 22.8 min, coaching 20.0 min). A
 * feature can be split across two slots only if one child can run "everything EXCEPT these ids" while the
 * other runs "ONLY these ids" — the drivers gate their blocks with want(...ids), so a block whose ids all
 * fall in the skip set must not run, and a block with any wanted id must.
 *
 * Red-first: fails on the bd-aqi0ay branch — .claude/qa/shared/selection.cjs does not exist.
 */
const { parseMap, makeWant, recAllowed, expandIds } = require('../../.claude/qa/shared/selection.cjs');

describe('parseMap — "feature=ids;feature=ids" → Set for one feature', () => {
  test('picks the feature\'s own list', () => {
    expect([...parseMap('coaching=COA09,COA20;training=T42', 'training')]).toEqual(['T42']);
    expect([...parseMap('coaching=COA09,COA20;training=T42', 'coaching')]).toEqual(['COA09', 'COA20']);
  });
  test('absent or empty → null (no selection)', () => {
    expect(parseMap('', 'menu')).toBe(null);
    expect(parseMap('coaching=COA09', 'menu')).toBe(null);
    expect(parseMap(undefined, 'menu')).toBe(null);
  });
});

describe('expandIds — ranges in a shard spec', () => {
  test('T25-T27,T696 → the enumerated ids', () => {
    expect(expandIds('T25-T27,T696')).toEqual(['T25', 'T26', 'T27', 'T696']);
    expect(expandIds('COA39-COA41')).toEqual(['COA39', 'COA40', 'COA41']);
  });
  test('zero-padded ids keep their width', () => {
    expect(expandIds('T08-T10')).toEqual(['T08', 'T09', 'T10']);
  });
});

describe('makeWant(only, skip)', () => {
  test('no selection: everything runs', () => {
    const want = makeWant(null, null);
    expect(want('T01')).toBe(true); expect(want('T01', 'T02')).toBe(true);
  });
  test('only: a block runs when any of its ids is wanted', () => {
    const want = makeWant(new Set(['T42']), null);
    expect(want('T41', 'T42')).toBe(true); expect(want('T41')).toBe(false);
  });
  test('skip: a block runs unless ALL of its ids are skipped', () => {
    const want = makeWant(null, new Set(['T25', 'T26']));
    expect(want('T25', 'T26')).toBe(false);
    expect(want('T25', 'T27')).toBe(true);
    expect(want('T01')).toBe(true);
  });
  test('ids may arrive as arrays, as the runner passes them', () => {
    const want = makeWant(null, new Set(['T25']));
    expect(want(['T25'])).toBe(false); expect(want(['T25', 'T30'])).toBe(true);
  });
});

describe('recAllowed(id, only, skip) — what a child reports', () => {
  const SCEN = /^[A-Z]{1,5}\d{1,3}$/;
  test('harness rows (COA-preflight, RUNNER) always report', () => {
    expect(recAllowed('RUNNER', new Set(['T42']), null, SCEN)).toBe(true);
    expect(recAllowed('COA-preflight', null, new Set(['COA04']), SCEN)).toBe(true);
  });
  test('only: unselected ids are dropped; skip: skipped ids are dropped', () => {
    expect(recAllowed('T41', new Set(['T42']), null, SCEN)).toBe(false);
    expect(recAllowed('T42', new Set(['T42']), null, SCEN)).toBe(true);
    expect(recAllowed('T25', null, new Set(['T25']), SCEN)).toBe(false);
    expect(recAllowed('T01', null, new Set(['T25']), SCEN)).toBe(true);
  });
});
