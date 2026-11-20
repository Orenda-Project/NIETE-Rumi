'use strict';
/**
 * The tool loop: a port of the data team's slackbot/brain.py answer(). Ask Claude, run the tools it
 * asks for through the proxy, repeat; tools-off wrap-up when the step cap or the deadline is hit, so
 * a slow answer still says what it found. Their notes and wrap-up wording are vendored verbatim.
 */

const { answer } = require('../../bot/shared/services/data-analyst/brain');
const CONTRACT = require('../../bot/shared/services/data-analyst/vendor/data-mcp-contract.json');

const B = CONTRACT.brain;

function fakeClient(script) {
  const requests = [];
  return {
    requests,
    messages: {
      async create(req) {
        requests.push(JSON.parse(JSON.stringify(req)));
        const step = script[requests.length - 1];
        if (!step) throw new Error(`no scripted reply for call ${requests.length}`);
        return typeof step === 'function' ? step(req) : step;
      },
    },
  };
}
const toolUse = (...uses) => ({
  stop_reason: 'tool_use',
  content: uses.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${name}_${i}`, name, input })),
  usage: { input_tokens: 10, output_tokens: 5 },
});
const final = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 20 } });

function fakeProxy() {
  const dispatched = [];
  return {
    dispatched,
    rulesReady: false,
    async dispatch(name, input) {
      dispatched.push({ name, input });
      if (name === 'get_rules') this.rulesReady = true;
      return `result of ${name}`;
    },
  };
}

const CFG = { model: 'claude-sonnet-5', maxTurns: 8, maxTokens: 20000, effort: 'high' };

test('asks, runs the tools, returns every result in one user message, then the answer', async () => {
  const client = fakeClient([toolUse(['get_rules', { region: 'niete-rumi', domain: 'lesson_plans' }]),
    toolUse(['query_metric', { metric: 'lp_users' }], ['check_table_freshness', { dataset: 'd', table: 't' }]),
    final('736 teachers.')]);
  const proxy = fakeProxy();
  const out = await answer('How many?', { proxy, client, cfg: CFG, now: () => new Date('2026-11-20T16:00:00Z') });
  expect(out.text).toBe('736 teachers.');
  expect(out.stoppedEarly).toBe(false);
  expect(out.turns).toBe(3);
  expect(proxy.dispatched.map((d) => d.name)).toEqual(['get_rules', 'query_metric', 'check_table_freshness']);
  const third = client.requests[2];
  const last = third.messages[third.messages.length - 1];
  expect(last.role).toBe('user');
  expect(last.content.map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
  // One rolling cache breakpoint, on the newest tool result only.
  expect(last.content[1].cache_control).toEqual({ type: 'ephemeral' });
  expect(last.content[0].cache_control).toBeUndefined();
  expect(out.usage.output_tokens).toBe(30);
});

test('sends their tools and their system blocks with the model settings', async () => {
  const client = fakeClient([final('ok')]);
  await answer('q', { proxy: fakeProxy(), client, cfg: CFG, now: () => new Date('2026-11-20T16:00:00Z') });
  const req = client.requests[0];
  expect(req.model).toBe('claude-sonnet-5');
  expect(req.max_tokens).toBe(20000);
  expect(req.tools.map((t) => t.name)).toEqual(CONTRACT.tool_schemas.map((t) => t.name));
  expect(req.system[0].text).toBe(CONTRACT.system_prompt);
  expect(req.thinking).toEqual({ type: 'adaptive' });
  expect(req.output_config).toEqual({ effort: 'high' });
});

test('history and the conversation\'s earlier context go in front of the new message', async () => {
  const client = fakeClient([final('ok')]);
  await answer('and by sector?', {
    proxy: fakeProxy(), client, cfg: CFG,
    history: [{ role: 'user', content: 'How many?' }, { role: 'assistant', content: '736.' }],
    context: '## Queries already run in this thread',
  });
  const msgs = client.requests[0].messages;
  expect(msgs.slice(0, 2)).toEqual([{ role: 'user', content: 'How many?' }, { role: 'assistant', content: '736.' }]);
  expect(msgs[2]).toEqual({ role: 'user', content: '## Queries already run in this thread\n\n## The new message\n\nand by sector?' });
});

test('the step cap stops without running the capped turn\'s tools, then wraps up with tools off', async () => {
  const client = fakeClient([toolUse(['get_rules', {}]), toolUse(['execute_query', { sql: 'x' }]), final('What I found so far.')]);
  const proxy = fakeProxy();
  const out = await answer('q', { proxy, client, cfg: { ...CFG, maxTurns: 2 } });
  expect(proxy.dispatched.map((d) => d.name)).toEqual(['get_rules']);
  expect(out.stoppedEarly).toBe(true);
  expect(out.stopReason).toBe('steps');
  expect(out.text).toBe('What I found so far.');
  const wrap = client.requests[2];
  expect(wrap.tool_choice).toEqual({ type: 'none' });
  expect(wrap.messages[wrap.messages.length - 1]).toEqual({ role: 'user', content: B._WRAP_UP_PROMPT });
  expect(wrap.messages[wrap.messages.length - 3].content[0].content).toBe(B._NOT_RUN);
});

test('the deadline ends the loop the same way, in its own words', async () => {
  let t = 0;
  const client = fakeClient([(req) => { t = 300_000; return toolUse(['get_rules', {}]); }, final('')]);
  const out = await answer('q', { proxy: fakeProxy(), client, cfg: CFG, deadlineMs: 240_000, clock: () => t });
  expect(out.stoppedEarly).toBe(true);
  expect(out.stopReason).toBe('time');
  expect(out.text.startsWith(B._TIME_CAP_NOTE)).toBe(true);
});

test('a refusal and an empty max_tokens answer say so in their words', async () => {
  const r = await answer('q', { proxy: fakeProxy(), client: fakeClient([{ stop_reason: 'refusal', content: [] }]), cfg: CFG });
  expect(r.text).toBe(B._REFUSAL_NOTE);
  const m = await answer('q', { proxy: fakeProxy(), client: fakeClient([{ stop_reason: 'max_tokens', content: [] }]), cfg: CFG });
  expect(m.text).toBe(B._OUT_OF_ROOM_NOTE);
  expect(m.stoppedEarly).toBe(true);
});

test('once the rules are read, a turn\'s independent queries run together', async () => {
  let inFlight = 0; let peak = 0;
  const proxy = {
    rulesReady: true,
    async dispatch(name) { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight -= 1; return name; },
  };
  const client = fakeClient([toolUse(['execute_query', { sql: 'a' }], ['execute_query', { sql: 'b' }], ['query_metric', {}]), final('ok')]);
  await answer('q', { proxy, client, cfg: CFG });
  expect(peak).toBe(3);
  const results = client.requests[1].messages.at(-1).content;
  expect(results.map((r) => r.tool_use_id)).toEqual(['tu_execute_query_0', 'tu_execute_query_1', 'tu_query_metric_2']);
});
