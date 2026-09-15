/**
 * What a model call cost, recorded in one place. bd-8t362.
 *
 * NO RATE TABLE HERE, DELIBERATELY. This deployment calls OpenRouter, which resells four
 * vendors and takes a margin, so a table of vendor list prices would be confidently wrong.
 * OpenRouter reports what it actually charged when the request asks for it, and the direct
 * Anthropic lane already computes a real price in anthropic-native-facade, cache multipliers
 * and all. Both put it in the same place: `usage.cost`.
 *
 * So the rule is: record what the vendor says, and record NOTHING rather than a guess. An
 * invented number is worse than an admitted gap, because nobody re-checks a figure that looks
 * plausible. The main bot learned that the expensive way: a rate table there matched on first
 * prefix, billed gpt-5.4-mini as gpt-5.4, and overstated recorded spend 3.4x for months.
 *
 * Tokens are always recorded even when cost is not, so a price added later can be applied
 * retrospectively to calls already made.
 */
const { logEvent } = require('./structured-logger');

/**
 * @param {string} model     the model id as sent, provider prefix included
 * @param {object} response  whatever came back
 * @param {number} startedAt Date.now() from just before the call
 * @param {object} [extra]   anything else worth keeping on the event, e.g. a job name
 */
function recordModelCost(model, response, startedAt, extra = {}) {
  try {
    const u = (response && response.usage) || {};
    const cost = Number.isFinite(u.cost) ? u.cost : null;
    logEvent('api.cost.incurred', {
      service: 'llm',
      model: (response && response.model) || model || 'unknown',
      tokensIn: u.prompt_tokens ?? u.input_tokens ?? 0,
      tokensOut: u.completion_tokens ?? u.output_tokens ?? 0,
      estimatedCostUsd: cost,
      // Says WHY there is no number, so an empty column is answerable without re-running
      // anything. The facade already sets this flag on the direct lane.
      costUnpriced: cost === null ? true : undefined,
      durationMs: Number.isFinite(startedAt) ? Date.now() - startedAt : null,
      ...extra,
    });
  } catch (_) {
    // Never throw. A teacher waiting on a reply does not care what we spent.
  }
}

module.exports = { recordModelCost };
