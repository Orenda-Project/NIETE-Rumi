'use strict';
/**
 * The door, with no data mode (the operator, 21 Nov 01:08: "I like D the most honestly. Alongside
 * 'data' to a flow"). For someone the data_analyst_whatsapp switch names:
 *   (d) a message that looks like a data question is answered straight away; the bot's own words and
 *       anything the classifier calls normal go to the ordinary handler; unsure asks with two buttons;
 *   (a) "data" alone opens the question Flow (a text box and four quick picks), or a list of the four
 *       quick picks when no Flow is configured on this tier;
 * and every answer is a chart image with one or two lines and "Ask another" / "Main menu" buttons
 * (text and the same buttons when there is nothing to draw). Everyone else is untouched.
 */

const E = require('../../bot/shared/services/data-analyst/entry');
const SW = require('../../bot/shared/services/data-analyst/switch');

const ME = '60530046-0000-4000-8000-000000000001';
const OTHER = '7eac0000-0000-4000-8000-000000000003';
const FROM = '920000000000';
const ENV = { DATA_MCP_URL: 'https://mcp.example/mcp', DATA_MCP_USER_EMAIL: 'operator@example.org', ANTHROPIC_API_KEY: 'k' };

const RULES = { name: 'get_rules', arguments: { region: 'niete-rumi' }, result: JSON.stringify({ rule_version: 'v0.42.5', rule_files: [{}] }) };
const BY_SECTOR = {
  name: 'query_metric', arguments: { metric: 'lp_users', from_date: '2026-11-07', to_date: '2026-11-13', by: ['sector'] },
  result: JSON.stringify({ status: 'ok', rows: [{ sector: 'B.K', value: 389 }, { sector: 'Nilore', value: 199 }, { sector: 'Urban-I', value: 451 }],
    measures: [{ name: 'value', label: 'Teachers who got a lesson plan' }], period: '07 Nov 2026 - 13 Nov 2026' }),
};
const ONE_NUMBER = {
  name: 'query_metric', arguments: { metric: 'lp_users', from_date: '2026-11-07', to_date: '2026-11-13' },
  result: JSON.stringify({ status: 'ok', rows: [{ value: 1816 }] }),
};

function fakeRedis() {
  const kv = new Map(); const locks = new Map();
  return {
    kv, locks,
    async get(k) { return kv.has(k) ? JSON.parse(kv.get(k)) : null; },
    async set(k, v, ttl) { kv.set(k, JSON.stringify(v)); kv.set(`${k}#ttl`, JSON.stringify(ttl)); return true; },
    async delete(k) { kv.delete(k); return true; },
    async incr(k) { const n = (kv.has(k) ? JSON.parse(kv.get(k)) : 0) + 1; kv.set(k, JSON.stringify(n)); return n; },
    async expire() { return true; },
    async acquireLock(r, id) { if (locks.has(r)) return false; locks.set(r, id); return true; },
    async releaseLock(r, id) { if (locks.get(r) === id) locks.delete(r); return true; },
  };
}
function fakeSupabase(value) {
  const reads = [];
  return { reads, from(table) { const q = { select: () => q, eq: (c, v) => { reads.push({ table, c, v }); return q; }, maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }; return q; } };
}

function setup({ verdict = 'data', answer, env = ENV, chart = Buffer.from('PNG'), switchValue = [ME] } = {}) {
  SW._resetCache();
  const out = [];
  const asked = [];
  const classified = [];
  const wa = {
    sendMessage: async (to, text) => { out.push({ kind: 'text', text }); return true; },
    sendInteractiveButtons: async (to, o) => { out.push({ kind: 'buttons', body: o.body, buttons: o.buttons }); return true; },
    sendImageBufferWithButtons: async (to, png, body, buttons) => { out.push({ kind: 'chart', png: String(png), body, buttons }); return true; },
    sendImageFromBuffer: async (to, png, caption) => { out.push({ kind: 'image', caption }); return true; },
    sendFlow: async (to, f) => { out.push({ kind: 'flow', flow: f }); return true; },
    sendInteractiveMessage: async (to, l) => { out.push({ kind: 'list', list: l }); return true; },
  };
  const deps = {
    env, supabase: fakeSupabase(switchValue), redis: fakeRedis(), whatsapp: wa,
    classify: async (text, ctx) => { classified.push({ text, ctx }); return typeof verdict === 'function' ? verdict(text) : verdict; },
    runQuestion: async (args) => {
      asked.push(args);
      if (answer instanceof Error) throw answer;
      return answer || { text: '*1,816 teachers* got a lesson plan last week.\n\n• Urban-I leads.', calls: [RULES, BY_SECTOR], stoppedEarly: false };
    },
    renderChart: async () => chart,
    now: () => new Date('2026-11-21T08:00:00Z'),
    log: () => {},
  };
  const text = (body, user = { id: ME }) => E.maybeHandleDataAnalyst({ user, from: FROM, messageBody: body }, deps);
  const tap = (buttonId, user = { id: ME }) => E.handleDataAnalystButton({ user, from: FROM, buttonId }, deps);
  const flow = (responseJson, user = { id: ME }) => E.handleDataAnalystFlowReply({ user, from: FROM, responseJson }, deps);
  return { deps, out, asked, classified, text, tap, flow };
}

describe('off means untouched', () => {
  test('not configured: nothing is taken and the switch is not read', async () => {
    const s = setup({ env: { ...ENV, DATA_MCP_URL: '' } });
    await expect(s.text('How many teachers made a lesson plan?')).resolves.toBe(false);
    expect(s.deps.supabase.reads).toHaveLength(0);
  });
  test('someone the switch does not name: nothing is taken, nothing classified', async () => {
    const s = setup();
    await expect(s.text('How many teachers made a lesson plan?', { id: OTHER })).resolves.toBe(false);
    await expect(s.text('data', { id: OTHER })).resolves.toBe(false);
    expect(s.classified).toHaveLength(0);
    await expect(s.tap('da_another', { id: OTHER })).resolves.toEqual({ handled: false });
  });
});

describe('(d) no mode: data questions are answered, everything else goes on as before', () => {
  test('the bot\'s own words go to the ordinary handler without a model call', async () => {
    const s = setup();
    for (const t of ['menu', '/observe', 'lesson plan', 'hi']) await expect(s.text(t)).resolves.toBe(false);
    expect(s.classified).toHaveLength(0);
  });
  test('the classifier saying normal: the ordinary handler', async () => {
    const s = setup({ verdict: 'normal' });
    await expect(s.text('Make me a lesson plan on fractions for grade 4')).resolves.toBe(false);
    expect(s.asked).toHaveLength(0);
  });
  test('a data question: "Looking into it", then the chart with one or two lines and the two buttons', async () => {
    const s = setup();
    await expect(s.text('How many teachers made a lesson plan last week, by sector?')).resolves.toBe(true);
    expect(s.out[0]).toEqual({ kind: 'text', text: E.TEXTS.looking });
    const chart = s.out[1];
    expect(chart.kind).toBe('chart');
    expect(chart.png).toBe('PNG');
    expect(chart.body.startsWith('*1,816 teachers* got a lesson plan last week.')).toBe(true);
    expect(chart.body).not.toMatch(/Urban-I leads/); // the bullets are the chart's job
    expect(chart.body).toContain('rules v0.42.5');
    expect(chart.buttons).toEqual([{ id: 'da_another', title: 'Ask another' }, { id: 'da_menu', title: 'Main menu' }]);
    expect(s.asked[0]).toMatchObject({ question: 'How many teachers made a lesson plan last week, by sector?', identity: { userId: ME } });
  });
  test('nothing to draw: the answer as text, with the same two buttons', async () => {
    const s = setup({ answer: { text: '*1,816 teachers* got a lesson plan last week.', calls: [RULES, ONE_NUMBER], stoppedEarly: false } });
    await s.text('How many teachers made a lesson plan last week?');
    const last = s.out[s.out.length - 1];
    expect(last.kind).toBe('buttons');
    expect(last.body.startsWith('*1,816 teachers* got a lesson plan last week.')).toBe(true);
    expect(last.buttons.map((b) => b.id)).toEqual(['da_another', 'da_menu']);
  });
  test('a wide result: the chart, and the measures it leaves out listed under it (bd-bhgw20.4)', async () => {
    const WIDE = {
      name: 'query_metric', arguments: { metric: 'hitl_conducted', by: ['sector'] },
      result: JSON.stringify({ status: 'ok', period: '01 Nov 2026 - 21 Nov 2026',
        rows: [{ sector: 'B.K', value: 229, reviewed: 217, complete: 212, debrief_pending: 5 }, { sector: 'Nilore', value: 131, reviewed: 127, complete: 122, debrief_pending: 5 }],
        measures: [{ name: 'value', label: 'coach visits' }, { name: 'reviewed', label: 'visits reviewed' }, { name: 'complete', label: 'debriefs sent' }, { name: 'debrief_pending', label: 'debriefs waiting' }] }),
    };
    const s = setup({ answer: { text: '*360 coach visits* were held 1–21 Nov.\n• B.K: 229\n• Nilore: 131', calls: [RULES, WIDE], stoppedEarly: false } });
    await s.text('How many coach visits were held this month, by sector?');
    const chart = s.out[s.out.length - 1];
    expect(chart.kind).toBe('chart');
    expect(chart.body).toContain('B.K: 217 reviewed · 212 complete · 5 debrief pending');
    expect(chart.body).toContain('Nilore: 127 reviewed · 122 complete · 5 debrief pending');
  });
  test('a chart that cannot be rendered falls back to the text answer', async () => {
    const s = setup({ chart: null });
    await s.text('How many teachers made a lesson plan last week, by sector?');
    expect(s.out[s.out.length - 1].kind).toBe('buttons');
    expect(s.out[s.out.length - 1].body).toContain('Urban-I leads');
    expect(s.out[s.out.length - 1].body).toContain('B.K: 389\nNilore: 199\nUrban-I: 451'); // every row, from the data
  });
  test('unsure: two buttons; "Data answer" answers it, "Normal" hands the same words to the ordinary handler', async () => {
    const s = setup({ verdict: 'unsure' });
    await expect(s.text('teachers in Tarnol')).resolves.toBe(true);
    expect(s.out[0].kind).toBe('buttons');
    expect(s.out[0].buttons).toEqual([{ id: 'da_route_data', title: 'Data answer' }, { id: 'da_route_normal', title: 'Normal' }]);
    await expect(s.tap('da_route_data')).resolves.toEqual({ handled: true });
    expect(s.asked[0].question).toBe('teachers in Tarnol');
    const s2 = setup({ verdict: 'unsure' });
    await s2.text('teachers in Tarnol');
    await expect(s2.tap('da_route_normal')).resolves.toEqual({ handled: true, normalText: 'teachers in Tarnol' });
    expect(s2.asked).toHaveLength(0);
  });
  test('a follow-up within ten minutes carries the answer before it, to the classifier and to the analyst', async () => {
    const s = setup();
    await s.text('How many teachers made a lesson plan last week, by sector?');
    await s.text('and the week before?');
    expect(s.classified[1].ctx.recentAnswer).toContain('1,816 teachers');
    expect(s.asked[1].history).toEqual([
      { role: 'user', content: 'How many teachers made a lesson plan last week, by sector?' },
      { role: 'assistant', content: '*1,816 teachers* got a lesson plan last week.\n\n• Urban-I leads.' },
    ]);
    expect(s.deps.redis.kv.get(`data_analyst:conv:${ME}#ttl`)).toBe(String(E.FOLLOW_UP_WINDOW_S));
  });
  test('"Main menu" hands "menu" to the ordinary handler', async () => {
    const s = setup();
    await expect(s.tap('da_menu')).resolves.toEqual({ handled: true, normalText: 'menu' });
  });
  test('one question at a time, 30 a day, and a failure says so', async () => {
    const s = setup();
    s.deps.redis.locks.set(`data_analyst:${ME}`, 'other');
    await s.text('How many teachers made a lesson plan last week?');
    expect(s.out[s.out.length - 1].text).toBe(E.TEXTS.busy);
    const s2 = setup();
    s2.deps.redis.kv.set(`data_analyst:count:${ME}:2026-11-21`, JSON.stringify(30));
    await s2.text('How many teachers made a lesson plan last week?');
    expect(s2.out[s2.out.length - 1].text).toBe(E.TEXTS.limit);
    const s3 = setup({ answer: new Error('MCP down') });
    await s3.text('How many teachers made a lesson plan last week?');
    expect(s3.out[s3.out.length - 1].text).toBe(E.TEXTS.failed);
    expect(s3.deps.redis.locks.size).toBe(0);
  });
});

describe('(a) "data" opens the question Flow', () => {
  test('with a Flow configured: the Flow, on a data-analyst token', async () => {
    const s = setup({ env: { ...ENV, DATA_ANALYST_FLOW_ID: '1234567890' } });
    await expect(s.text('Data')).resolves.toBe(true);
    const f = s.out[0].flow;
    expect(f.flowId).toBe('1234567890');
    expect(f.screen).toBe('DATA_QUESTION');
    expect(f.flowToken.startsWith('dataq:')).toBe(true);
    expect(s.classified).toHaveLength(0);
  });
  test('without one: a list of the four quick picks, and a pick is answered', async () => {
    const s = setup();
    await s.text('data');
    const rows = s.out[0].list.action.sections[0].rows;
    expect(rows).toHaveLength(4);
    expect(rows[0].id).toBe('da_pick_1');
    await expect(s.tap('da_pick_2')).resolves.toEqual({ handled: true });
    expect(s.asked[0].question).toBe(E.QUICK_PICKS[1].question);
  });
  test('"Ask another" opens the same thing again', async () => {
    const s = setup({ env: { ...ENV, DATA_ANALYST_FLOW_ID: '1234567890' } });
    await s.tap('da_another');
    expect(s.out[0].kind).toBe('flow');
  });
  test('the Flow\'s reply: a typed question wins over a pick; a pick alone is its question', async () => {
    const s = setup();
    await expect(s.flow({ flow_token: 'dataq:x', question: 'Coach visits in Tarnol this month', pick: 'pick_1' })).resolves.toBe(true);
    expect(s.asked[0].question).toBe('Coach visits in Tarnol this month');
    await s.flow({ flow_token: 'dataq:y', question: '', pick: 'pick_3' });
    expect(s.asked[1].question).toBe(E.QUICK_PICKS[2].question);
  });
  test('a Flow reply on any other token is not ours', async () => {
    const s = setup();
    await expect(s.flow({ flow_token: 'obsnotes:1', question: 'x' })).resolves.toBe(false);
  });
});

describe('a clarifying question is answered by tapping', () => {
  test('the options come as a list; a tap answers the question with the option', async () => {
    const s = setup({ answer: { text: '"Active" can mean two things.\nASK: Which active? | Used the assistant | Made a lesson plan', calls: [RULES], stoppedEarly: false } });
    await s.text('How many teachers are active?');
    const list = s.out[s.out.length - 1].list;
    expect(list.body.text).toContain('"Active" can mean two things.');
    expect(list.action.sections[0].rows.map((r) => r.id)).toEqual(['da_opt_1', 'da_opt_2']);
    s.deps.runQuestion = async (args) => { s.asked.push(args); return { text: 'ok', calls: [RULES], stoppedEarly: false }; };
    await expect(s.tap('da_opt_1')).resolves.toEqual({ handled: true });
    expect(s.asked[s.asked.length - 1].question).toBe('Which active: Used the assistant');
  });
});
