/**
 * Claude Sonnet 5.5 has a list price on the direct lane.
 *
 * Anthropic returns no cost, so the lane prices each reply from its token split. A model with no
 * row is recorded as unpriced, which would make every board-pattern paper moved to Sonnet 5.5 look
 * free. List price: $2 input, $10 output per million tokens; a cache read is a tenth of input
 * ($0.20) and a five-minute cache write 1.25x ($2.50).
 */
const { priceUsd, fromNativeResponse } = require('../../bot/shared/services/anthropic-native-facade');

const USAGE = {
  input_tokens: 1000,
  cache_creation_input_tokens: 10000,
  cache_read_input_tokens: 40000,
  output_tokens: 5000,
};

test('priceUsd prices claude-sonnet-5-5 with cache reads and writes', () => {
  // 1,000 x $2 + 10,000 x $2.50 + 40,000 x $0.20 + 5,000 x $10, per million.
  const expected = (1000 * 2 + 10000 * 2.5 + 40000 * 0.2 + 5000 * 10) / 1e6;
  expect(priceUsd('claude-sonnet-5-5', USAGE)).toBeCloseTo(expected, 10);
  expect(priceUsd('claude-sonnet-5-5', USAGE)).toBeCloseTo(0.085, 10);
});

test('a reply from claude-sonnet-5-5 carries a cost, not cost_unpriced', () => {
  const res = fromNativeResponse({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage: USAGE });
  expect(res.usage.cost_unpriced).toBeUndefined();
  expect(res.usage.cost).toBeCloseTo(0.085, 10);
});
