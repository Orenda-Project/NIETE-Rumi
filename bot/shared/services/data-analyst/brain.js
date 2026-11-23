'use strict';
/**
 * The agent loop: ask Claude, run the tools it asks for through the proxy, repeat until it answers.
 * A port of the data team's slackbot/brain.py answer() — a manual loop rather than an MCP connector,
 * because the proxy's enforcement points are the point — with their notes and wrap-up words vendored.
 *
 * - Every tool result of a turn goes back in ONE user message (splitting them trains the model out of
 *   parallel tool use), and once the rules gate is open a turn's queries run together.
 * - One rolling cache breakpoint on the newest tool result, beside the cached system prompt: a single
 *   get_rules result is ~20k tokens that would otherwise be re-sent uncached every turn.
 * - The last permitted step (the cap, or the deadline: WhatsApp keeps the Data Studio's 240 s) is NOT
 *   dispatched — those would be real, billed queries for an answer never given — and one tools-off
 *   call turns what the steps found into an answer marked incomplete.
 */

const CONTRACT = require('./vendor/data-mcp-contract.json');
const { systemBlocks } = require('./prompt');

const B = CONTRACT.brain;
const TOOLS = CONTRACT.tool_schemas;
const CACHE = { type: 'ephemeral' };
const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const MAX_PARALLEL = 6;

function accumulate(usage, response) {
  const u = response && response.usage;
  if (!u) return;
  for (const k of USAGE_KEYS) usage[k] = (usage[k] || 0) + (u[k] || 0);
  usage.calls = (usage.calls || 0) + 1;
}

const textOf = (response) => (response.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n\n').trim();
const usesOf = (response) => (response.content || []).filter((b) => b && b.type === 'tool_use');

function request(cfg, now, messages, extra = {}) {
  const req = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    thinking: { type: 'adaptive' },
    system: systemBlocks(now()),
    tools: TOOLS,
    messages,
    ...extra,
  };
  if (cfg.effort) req.output_config = { effort: cfg.effort };
  return req;
}

async function runAll(proxy, uses) {
  const one = async (b) => ({ type: 'tool_result', tool_use_id: b.id, content: await proxy.dispatch(b.name, { ...(b.input || {}) }) });
  // Sequential while the rules gate is shut: a get_rules and a query in one turn would race it.
  if (uses.length < 2 || !proxy.rulesReady) {
    const out = [];
    for (const b of uses) out.push(await one(b));
    return out;
  }
  const out = new Array(uses.length);
  let next = 0;
  const worker = async () => { while (next < uses.length) { const i = next++; out[i] = await one(uses[i]); } };
  await Promise.all(Array.from({ length: Math.min(uses.length, MAX_PARALLEL) }, worker));
  return out; // block order, never completion order
}

function capped(lastText, turns, usage, reason) {
  const note = reason === 'time' ? B._TIME_CAP_NOTE : B._TURN_CAP_NOTE;
  return { text: `${note}\n\n${lastText || B._NO_ANSWER_NOTE}`.trim(), turns, stoppedEarly: true, usage, stopReason: reason };
}

async function wrapUp({ client, cfg, now, messages, response, lastText, turn, usage, reason, log }) {
  const timedOut = reason === 'time';
  const wrapMessages = [
    ...messages,
    { role: 'assistant', content: response.content },
    { role: 'user', content: usesOf(response).map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: timedOut ? B._NOT_RUN_TIME : B._NOT_RUN, is_error: true })) },
    { role: 'assistant', content: B._WRAP_UP_ACK },
    { role: 'user', content: timedOut ? B._WRAP_UP_PROMPT_TIME : B._WRAP_UP_PROMPT },
  ];
  let text = '';
  try {
    const final = await client.messages.create(request(cfg, now, wrapMessages, { tool_choice: { type: 'none' } }));
    accumulate(usage, final);
    text = final.stop_reason !== 'tool_use' && final.stop_reason !== 'refusal' ? textOf(final) : '';
    if (!text) log('data_analyst.wrap_up_empty', { turns: turn, stopReason: final.stop_reason });
  } catch (e) {
    log('data_analyst.wrap_up_failed', { error: String(e && e.message).slice(0, 300) });
  }
  if (!text) return capped(lastText, turn, usage, reason);
  return { text, turns: turn + 1, stoppedEarly: true, usage, stopReason: reason };
}

/**
 * @param {string} question the asker's words
 * @param {{proxy, client, cfg: {model, maxTurns, maxTokens, effort}, history?: object[], context?: string,
 *          deadlineMs?: number, clock?: () => number, now?: () => Date, log?: Function}} opts
 * @returns {Promise<{text: string, turns: number, stoppedEarly: boolean, usage: object, stopReason: string}>}
 */
async function answer(question, { proxy, client, cfg, history = [], context = '', deadlineMs = null, clock = Date.now, now = () => new Date(), log = () => {} }) {
  const messages = [...history];
  messages.push({ role: 'user', content: context ? `${context}\n\n## The new message\n\n${question}` : question });
  const usage = {};
  const startedAt = clock();
  let lastText = '';
  let cachedBlock = null;

  for (let turn = 1; turn <= cfg.maxTurns; turn += 1) {
    const response = await client.messages.create(request(cfg, now, messages));
    accumulate(usage, response);
    if (response.stop_reason === 'refusal') return { text: B._REFUSAL_NOTE, turns: turn, stoppedEarly: false, usage, stopReason: '' };
    lastText = textOf(response) || lastText;

    if (response.stop_reason !== 'tool_use') {
      const stoppedEarly = response.stop_reason === 'max_tokens';
      if (stoppedEarly) log('data_analyst.max_tokens_reached', { turns: turn, hadText: !!lastText });
      const reason = stoppedEarly ? 'tokens' : '';
      if (!lastText) return { text: stoppedEarly ? B._OUT_OF_ROOM_NOTE : B._NO_ANSWER_NOTE, turns: turn, stoppedEarly, usage, stopReason: reason };
      return { text: lastText, turns: turn, stoppedEarly, usage, stopReason: reason };
    }

    const outOfTime = deadlineMs !== null && clock() - startedAt >= deadlineMs;
    if (outOfTime) log('data_analyst.deadline_reached', { turns: turn });
    if (turn === cfg.maxTurns || outOfTime) {
      return wrapUp({ client, cfg, now, messages, response, lastText, turn, usage, reason: outOfTime ? 'time' : 'steps', log });
    }

    messages.push({ role: 'assistant', content: response.content });
    const results = await runAll(proxy, usesOf(response));
    if (cachedBlock) delete cachedBlock.cache_control;
    if (results.length) { results[results.length - 1].cache_control = { ...CACHE }; cachedBlock = results[results.length - 1]; } else cachedBlock = null;
    messages.push({ role: 'user', content: results });
  }
  return capped(lastText, cfg.maxTurns, usage, 'steps');
}

module.exports = { answer };
