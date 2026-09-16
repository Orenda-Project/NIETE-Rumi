/**
 * A cost number that reaches Axiom but cannot be summed is not telemetry. bd-9b58p.
 *
 * Proved live on 2026-09-16 against the deployed sandbox commit: one real model call recorded
 * `estimatedCostUsd: 0.000004`, the row landed in the `rumi-sandbox` dataset, and
 *
 *     ['rumi-sandbox'] | where event == 'api.cost.incurred' | summarize sum(estimatedCostUsd)
 *
 * returned 0. Every column that mattered was null; the values were stringified inside
 * `data_json`, because `AXIOM_CORE_FIELDS` is an allowlist and none of them were on it.
 *
 * Zero is the worst possible wrong answer here: an admitted gap gets chased, a zero gets
 * believed. These tests pin the fields that have to stay queryable.
 */
const { normalizeForAxiom, AXIOM_CORE_FIELDS } = require('../shared/utils/structured-logger');

/** Exactly what recordModelCost emits, as logEvent shapes it. */
function aCostRow(over = {}) {
  return {
    level: 'info',
    time: '2026-09-16T09:18:58.951Z',
    msg: 'api.cost.incurred',
    service: 'llm',
    env: 'sandbox',
    event: 'api.cost.incurred',
    feature: 'api',
    action: 'cost',
    result: 'incurred',
    model: 'google/gemini-2.5-flash',
    job: 'quiz.transcript',
    tokensIn: 5,
    tokensOut: 1,
    estimatedCostUsd: 0.000004,
    durationMs: 2367,
    ...over,
  };
}

describe('model spend survives into Axiom columns (bd-9b58p)', () => {
  test('the fields a spend query needs are promoted, not stringified', () => {
    const row = normalizeForAxiom(aCostRow());

    // The name you filter on.
    expect(row.event).toBe('api.cost.incurred');
    // The number you sum. `toBe` on purpose: a null here is the live bug.
    expect(row.estimatedCostUsd).toBe(0.000004);
    // What you group that sum BY. Without these, total spend is one undifferentiated figure
    // and a vendor migration cannot be measured at all.
    expect(row.model).toBe('google/gemini-2.5-flash');
    expect(row.job).toBe('quiz.transcript');
    // Tokens, so a price discovered later can be applied to calls already made.
    expect(row.tokensIn).toBe(5);
    expect(row.tokensOut).toBe(1);
  });

  test('sum() over normalized rows returns the real total, not zero', () => {
    const rows = [
      normalizeForAxiom(aCostRow({ estimatedCostUsd: 0.000004 })),
      normalizeForAxiom(aCostRow({ estimatedCostUsd: 0.000021 })),
    ];
    const total = rows.reduce((t, r) => t + (r.estimatedCostUsd || 0), 0);
    expect(total).toBeCloseTo(0.000025, 9);
  });

  test('an unpriced call stays null, and never becomes a zero', () => {
    const row = normalizeForAxiom(aCostRow({ estimatedCostUsd: null, costUnpriced: true }));
    expect(row.estimatedCostUsd).toBeNull();
    expect(row.estimatedCostUsd).not.toBe(0);
  });

  test('the allowlist still bounds column growth', () => {
    // The reason the allowlist exists: Axiom's 257-column limit. Promoting a handful of named
    // fields is the fix; promoting everything is the bug it was written to prevent.
    expect(AXIOM_CORE_FIELDS.size).toBeLessThan(40);
    const row = normalizeForAxiom(aCostRow({ someBigNestedThing: { a: { b: { c: 1 } } } }));
    expect(row.someBigNestedThing).toBeUndefined();
    expect(JSON.parse(row.data_json).someBigNestedThing).toEqual({ a: { b: { c: 1 } } });
  });
});
