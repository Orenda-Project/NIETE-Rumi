/**
 * bd-gr4fy.10 — a dated model id is priced at its model's list price.
 *
 * Anthropic answers with the dated snapshot id: a call for `claude-haiku-4-5` comes back as
 * `claude-haiku-4-5-20251001`. The price table is keyed by the undated id, so every direct-lane
 * Haiku call was recorded `costUnpriced: true` and its spend counted as nothing. Found on the
 * first production batch (7 Oct 2026), where nine jobs moved to Haiku showed $0. Sonnet 5 answers
 * with its undated id, which is why lesson-plan authoring was always priced.
 */
const { priceUsd, fromNativeResponse } = require('../../bot/shared/services/anthropic-native-facade');

const usage = { input_tokens: 1000, output_tokens: 500 };

test('a dated Haiku id is priced exactly like the undated one', () => {
  const dated = priceUsd('claude-haiku-4-5-20251001', usage);
  expect(dated).toBe(priceUsd('claude-haiku-4-5', usage));
  expect(dated).toBeGreaterThan(0);
});

test('so the mapped response carries a cost, not costUnpriced', () => {
  const res = fromNativeResponse({
    id: 'msg_1', model: 'claude-haiku-4-5-20251001', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'ur' }], usage,
  });
  expect(res.usage.cost).toBeGreaterThan(0);
  expect(res.usage.cost_unpriced).toBeUndefined();
});

test('a model with no price stays unpriced, dated or not: nothing is guessed', () => {
  expect(priceUsd('claude-unknown-9-20990101', usage)).toBeNull();
  expect(priceUsd('claude-unknown-9', usage)).toBeNull();
});
