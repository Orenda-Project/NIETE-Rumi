'use strict';
/**
 * One governed answer for one WhatsApp question: the data team's answering.run_question, assembled
 * from NIETE's pieces. Their MCP (as this person, surface whatsapp), their proxy's gates, their
 * prompt and loop, and our model key (llm-client's direct-Anthropic client).
 *
 * The conversation's earlier rule reads are fetched again first and its earlier queries put in front
 * of the question, so a follow-up keeps the figures already given. The clarifying question the answer
 * asked is remembered, so the reply is read against it.
 */

const { getAnthropicDirectClient } = require('../llm-client');
const { priceUsd } = require('../anthropic-native-facade');
const { recordModelCost } = require('../../utils/model-cost');
const { fromEnv } = require('./mcp-client');
const { ToolProxy, askedOpenQuestion } = require('./tool-proxy');
const { answer } = require('./brain');

const DEFAULT_MODEL = 'claude-sonnet-5';

const positive = (v, d) => { const n = Number.parseInt(String(v || ''), 10); return Number.isFinite(n) && n > 0 ? n : d; };

/** The loop's settings, from the environment (their defaults: 32 steps, 20,000 tokens, high effort; 240 s like their Studio). */
function configFrom(env = process.env) {
  return {
    model: String(env.DATA_ANALYST_MODEL || '').trim() || DEFAULT_MODEL,
    maxTurns: positive(env.DATA_ANALYST_MAX_TURNS, 32),
    maxTokens: 20000,
    effort: String(env.DATA_ANALYST_EFFORT || '').trim() || 'high',
    deadlineMs: positive(env.DATA_ANALYST_DEADLINE_SECONDS, 240) * 1000,
  };
}

/**
 * @param {{question: string, identity: {userId: string, email: string}, memory: object,
 *          history?: object[], log?: Function, env?: object, client?: object, mcp?: object}} a
 * @returns {Promise<{text: string, calls: object[], stoppedEarly: boolean, knownText: string,
 *          turnId: string, usage: object, costUsd: number|null}>}
 */
async function runQuestion({ question, identity, memory, history = [], log = () => {}, env = process.env, client, mcp }) {
  const cfg = configFrom(env);
  const server = mcp || fromEnv(env, identity.email);
  const proxy = new ToolProxy({ mcp: server, askedBy: identity.email, question, memory, log });
  const fetches = memory.rules();
  const preloaded = fetches.length ? await proxy.preloadRules(fetches) : '';
  const context = [preloaded, memory.context()].filter(Boolean).join('\n\n');
  const startedAt = Date.now();
  const result = await answer(question, {
    proxy, client: client || getAnthropicDirectClient(), cfg, history, context, deadlineMs: cfg.deadlineMs, log,
  });
  memory.setOpenQuestion(askedOpenQuestion(proxy.calls, result.text));
  const costUsd = priceUsd(cfg.model, result.usage);
  recordModelCost(cfg.model, { model: cfg.model, usage: { ...result.usage, cost: Number.isFinite(costUsd) ? costUsd : undefined } }, startedAt, {
    job: 'data_analyst', lane: 'anthropic-direct', turnId: proxy.turnId, turns: result.turns,
  });
  log('data_analyst.answered', {
    turnId: proxy.turnId, turns: result.turns, stoppedEarly: result.stoppedEarly, stopReason: result.stopReason,
    tools: proxy.calls.map((c) => c.name), authRejected: proxy.authRejected, costUsd, ms: Date.now() - startedAt,
  });
  return {
    text: result.text,
    calls: proxy.calls,
    stoppedEarly: result.stoppedEarly,
    knownText: [question, context, ...history.map((m) => String(m.content || ''))].join('\n'),
    turnId: proxy.turnId,
    usage: result.usage,
    costUsd,
  };
}

module.exports = { runQuestion, configFrom, DEFAULT_MODEL };
