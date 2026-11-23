'use strict';
/**
 * The proxy between the model and the data team's MCP: a port of their slackbot/tools.py ToolProxy.
 * Its gates are mechanical refusals, not prompt advice, and every refusal text is theirs verbatim
 * (vendored contract). WhatsApp adds one gate of its own: ICT only.
 */

const { ToolProxy, EMAIL_DOMAIN_REJECTED_MESSAGE } = require('../../bot/shared/services/data-analyst/tool-proxy');
const { ConversationMemory } = require('../../bot/shared/services/data-analyst/memory');
const CONTRACT = require('../../bot/shared/services/data-analyst/vendor/data-mcp-contract.json');

const T = CONTRACT.texts;
const RULES = JSON.stringify({
  rule_version: 'v0.42.5',
  region: 'niete-rumi',
  domain: 'lesson_plans',
  rule_files: [{ path: 'niete-rumi/lesson_plans/lp-query-rules.md', content: 'Use Niete_Rumi_db.lesson_plans and users. Filter is_test_user.' }],
  shared_rules: [{ path: '_shared/policy.md', content: 'policy' }],
  word_meanings: {
    program: 'niete-rumi',
    matched: [],
    ambiguous: [{ id: 'active-q', question: 'Which active do you mean?', options: [{ label: 'Used the assistant' }, { label: 'Made a lesson plan' }] }],
    cards: [{ metric: 'lp_users', label: 'Teachers who got a lesson plan', compiled: true, by: ['sector', 'month'], program: 'niete-rumi' }],
  },
});
const OK_ROWS = JSON.stringify({ status: 'ok', rows: [{ teachers: 736 }], total_rows: 1, truncated: false });

function fakeMcp(answers = {}) {
  const calls = [];
  return {
    calls,
    surface: 'whatsapp',
    async callTool(name, args) {
      calls.push({ name, args });
      const a = answers[name];
      if (a instanceof Error) throw a;
      if (typeof a === 'function') return a(args, calls.length);
      return a ?? OK_ROWS;
    },
  };
}

const make = (mcp, extra = {}) => new ToolProxy({
  mcp, askedBy: 'operator@example.org', question: 'How many teachers made a lesson plan last week?', ...extra,
});

describe('rules first', () => {
  test('a query before any rules is refused with their words, and nothing reaches the MCP', async () => {
    const mcp = fakeMcp();
    const p = make(mcp);
    await expect(p.dispatch('execute_query', { sql: 'SELECT 1', question: 'q' })).resolves.toBe(T.RULES_FIRST_REFUSAL);
    await expect(p.dispatch('query_metric', { metric: 'lp_users', question: 'q' })).resolves.toBe(T.RULES_FIRST_REFUSAL);
    expect(mcp.calls).toHaveLength(0);
  });
  test('the index (no rule_files) or an error does not open the gate; real rule content does', async () => {
    const mcp = fakeMcp({ get_rules: (a) => (a.domain ? RULES : JSON.stringify({ regions: ['niete-rumi'] })) });
    const p = make(mcp);
    await p.dispatch('get_rules', {});
    expect(p.rulesReady).toBe(false);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    expect(p.rulesReady).toBe(true);
  });
});

describe('telemetry is stamped by our code, never the model', () => {
  test('asked_by, surface, turn_id and the asker\'s own words overwrite what the model sent', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans', asked_by: 'someone', surface: 'slack', question: 'paraphrase' });
    const sent = mcp.calls[0].args;
    expect(sent.asked_by).toBe('operator@example.org');
    expect(sent.surface).toBe('whatsapp');
    expect(sent.question).toBe('How many teachers made a lesson plan last week?');
    expect(sent.turn_id).toMatch(/^[0-9a-f]{32}$/);
    expect(sent.include_shared).toBe(true);
  });
  test('one turn id for every call of one question', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    await p.dispatch('execute_query', { sql: 'SELECT u.id FROM Niete_Rumi_db.users u', question: 'x' });
    expect(new Set(mcp.calls.map((c) => c.args.turn_id)).size).toBe(1);
  });
});

describe('rule fetches', () => {
  test('the same fetch twice is answered from the conversation, not refetched', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    const again = await p.dispatch('get_rules', { region: 'NIETE-RUMI', domain: 'lesson_plans' });
    expect(again).toBe(T.ALREADY_FETCHED.replace('{what}', 'region=niete-rumi domain=lesson_plans'));
    expect(mcp.calls).toHaveLength(1);
  });
  test('the shared policy goes out once per conversation', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'coaching' });
    expect(mcp.calls.map((c) => c.args.include_shared)).toEqual([true, false]);
  });
  test('a repeated word_meanings block is pointed back to the first', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    const second = JSON.parse(await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'coaching' }));
    expect(second.word_meanings).toBe(T.WORD_MEANINGS_REPEATED);
  });
  test('the open question this conversation asked last is ours to send', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const memory = new ConversationMemory();
    memory.setOpenQuestion('active-q');
    const p = make(mcp, { memory });
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans', open_question: 'made-up' });
    expect(mcp.calls[0].args.open_question).toBe('active-q');
  });
});

describe('ungoverned tables', () => {
  test('a table no rule read names is refused; INFORMATION_SCHEMA always is', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    const r = await p.dispatch('execute_query', { sql: 'SELECT * FROM Niete_Rumi_db.secret_table', question: 'x' });
    expect(r).toBe(T.UNGOVERNED_TABLE_REFUSAL.replace('{tables}', '`secret_table`'));
    const s = await p.dispatch('execute_query', { sql: 'SELECT * FROM Niete_Rumi_db.INFORMATION_SCHEMA.TABLES', question: 'x' });
    expect(s).toContain('`INFORMATION_SCHEMA`');
    expect(mcp.calls.filter((c) => c.name === 'execute_query')).toHaveLength(0);
  });
  test('a table the rules name runs', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    await expect(p.dispatch('execute_query', { sql: 'SELECT u.id FROM `Niete_Rumi_db.users` u', question: 'x' })).resolves.toBe(OK_ROWS);
  });
});

describe('compiled first', () => {
  test('hand-written SQL counting what an offered compiled card counts is turned back once, then runs', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    const sql = 'SELECT COUNT(DISTINCT lp.user_id) FROM Niete_Rumi_db.lesson_plans lp JOIN Niete_Rumi_db.users u ON u.id = lp.user_id';
    const first = await p.dispatch('execute_query', { sql, question: 'x' });
    expect(first.startsWith('NOT RUN: this query counts what a compiled figure counts: `lp_users`')).toBe(true);
    expect(mcp.calls.filter((c) => c.name === 'execute_query')).toHaveLength(0);
    await expect(p.dispatch('execute_query', { sql, question: 'x' })).resolves.toBe(OK_ROWS);
  });
  test('query_metric blanks are normalised and the program is always ICT, explicitly', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    await p.dispatch('query_metric', { metric: ' lp_users ', from_date: '2026-11-07', to_date: '2026-11-13',
      filters: [{ name: 'sector', values: ['Tarnol'] }], by: 'sector', program: 'NIETE-RUMI', sql: 'DROP' });
    const sent = mcp.calls.find((c) => c.name === 'query_metric').args;
    expect(sent).toMatchObject({ metric: 'lp_users', filters: { sector: ['Tarnol'] }, by: ['sector'] });
    expect(sent.program).toBe('niete-rumi');
    expect(sent.sql).toBeUndefined();
  });
  test('unreadable filters are refused with their words, nothing runs', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    const r = await p.dispatch('query_metric', { metric: 'lp_users', filters: [{ name: 'sector', values: [true] }] });
    expect(r.startsWith('query_metric was not run:')).toBe(true);
    expect(mcp.calls.filter((c) => c.name === 'query_metric')).toHaveLength(0);
  });
});

describe('ICT only (the WhatsApp surface)', () => {
  test('rules for another region are refused before the MCP', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    for (const args of [{ region: 'rawalpindi', domain: 'coaching' }, { region: 'rumi' }, { path: 'myschool/x.md' }]) {
      await expect(p.dispatch('get_rules', args)).resolves.toMatch(/^REFUSED: on WhatsApp this assistant answers about ICT/);
    }
    expect(mcp.calls).toHaveLength(0);
  });
  test('a compiled figure of another program is refused', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    await expect(p.dispatch('query_metric', { metric: 'active_teachers', program: 'rumi' })).resolves.toMatch(/^REFUSED: on WhatsApp/);
  });
  test('no file exports here', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    await expect(p.dispatch('save_query_results', { sql: 'SELECT 1', question: 'q' })).resolves.toMatch(/^REFUSED: WhatsApp cannot deliver a file/);
    expect(mcp.calls.filter((c) => c.name === 'save_query_results')).toHaveLength(0);
  });
});

describe('auth rejections are terminal and classified', () => {
  test('once the MCP refuses the asker, every later call gets the same explanation', async () => {
    const mcp = fakeMcp({ get_rules: "Unauthorized domain in email 'x@example.net'. Allowed: the data team's domains" });
    const p = make(mcp);
    await expect(p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' })).resolves.toBe(EMAIL_DOMAIN_REJECTED_MESSAGE);
    await expect(p.dispatch('get_table_schema', { dataset: 'a', table: 'b' })).resolves.toBe(EMAIL_DOMAIN_REJECTED_MESSAGE);
    expect(mcp.calls).toHaveLength(1);
    expect(p.authRejected).toBe('email_domain_rejected');
  });
  test('strict mode without our token reads as the bot\'s credential, not the asker', async () => {
    const mcp = fakeMcp({ get_rules: 'Unauthorized: missing or invalid Bearer token.' });
    await expect(make(mcp).dispatch('get_rules', { region: 'niete-rumi', domain: 'x' })).resolves.toBe(T.BOT_TOKEN_INVALID_MESSAGE);
  });
});

describe('the conversation\'s figures are the record', () => {
  test('a query this person already ran is answered with the result they were given', async () => {
    const memory = new ConversationMemory();
    let n = 0;
    const mcp = fakeMcp({ get_rules: RULES, execute_query: () => JSON.stringify({ status: 'ok', rows: [{ n: ++n }], total_rows: 1 }) });
    const sql = 'SELECT u.id FROM Niete_Rumi_db.users u';
    await make(mcp, { memory }).dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    const p1 = make(mcp, { memory });
    await p1.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    const first = JSON.parse(await p1.dispatch('execute_query', { sql, question: 'x' }));
    const p2 = make(mcp, { memory });
    await p2.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    const second = JSON.parse(await p2.dispatch('execute_query', { sql: `  ${sql}  `, question: 'x' }));
    expect(second.rows).toEqual(first.rows);
    expect(second.reused_from_this_thread).toBe(true);
    expect(mcp.calls.filter((c) => c.name === 'execute_query')).toHaveLength(1);
  });
});

test('an MCP failure reaches the model as a tool error, never a throw', async () => {
  const mcp = fakeMcp({ get_rules: new Error('ECONNRESET') });
  await expect(make(mcp).dispatch('get_rules', { region: 'niete-rumi', domain: 'x' })).resolves.toMatch(/^Tool 'get_rules' failed: /);
});

test('an unknown tool is named, not run', async () => {
  const mcp = fakeMcp();
  await expect(make(mcp).dispatch('drop_tables', {})).resolves.toMatch(/^Unknown tool 'drop_tables'/);
  expect(mcp.calls).toHaveLength(0);
});

test('a compiled answer of real size (live: 20,298 chars) is remembered, so the same figure is reused', async () => {
  const memory = new ConversationMemory();
  const big = JSON.stringify({ status: 'ok', rows: [{ value: 1816 }], total_rows: 1, sql: 'x'.repeat(25000) });
  const mcp = fakeMcp({ get_rules: RULES, query_metric: big });
  const p = make(mcp, { memory });
  await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
  const args = { metric: 'lp_users', from_date: '2026-11-07', to_date: '2026-11-13' };
  await p.dispatch('query_metric', args);
  const again = JSON.parse(await p.dispatch('query_metric', { ...args, rule_version: 'v0.42.5' }));
  expect(again.reused_from_this_thread).toBe(true);
  expect(mcp.calls.filter((c) => c.name === 'query_metric')).toHaveLength(1);
});

describe('ICT by default on our side (the operator, 21 Nov: always Islamabad, always niete, never rumi)', () => {
  test('a rules fetch with no region and no path asks for niete-rumi, never the bare index', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', {});
    await p.dispatch('get_rules', { domain: 'coaching' });
    expect(mcp.calls.map((c) => c.args.region)).toEqual(['niete-rumi', 'niete-rumi']);
  });
  test('a fetch by path is left as it is', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    await make(mcp).dispatch('get_rules', { path: 'niete-rumi/coaching/fico-scores-rules.md' });
    expect(mcp.calls[0].args.region).toBeUndefined();
    expect(mcp.calls[0].args.path).toBe('niete-rumi/coaching/fico-scores-rules.md');
  });
  test('every compiled figure is asked as program niete-rumi, explicitly', async () => {
    const mcp = fakeMcp({ get_rules: RULES });
    const p = make(mcp);
    await p.dispatch('get_rules', { region: 'niete-rumi', domain: 'lesson_plans' });
    await p.dispatch('query_metric', { metric: 'lp_users' });
    await p.dispatch('query_metric', { metric: 'lp_users', program: 'NIETE-RUMI', from_date: '2026-11-01' });
    expect(mcp.calls.filter((c) => c.name === 'query_metric').map((c) => c.args.program)).toEqual(['niete-rumi', 'niete-rumi']);
  });
});
