'use strict';
/**
 * The door into data mode, run before the text handler. Someone the switch names sends "data" and
 * stays in data mode until "menu" or 30 minutes idle; everyone else, and every other message, is
 * untouched (returns false, so the ordinary text handler runs as today).
 */

const { maybeHandleDataAnalyst, TEXTS } = require('../../bot/shared/services/data-analyst/entry');
const SW = require('../../bot/shared/services/data-analyst/switch');

const ME = '60530046-0000-4000-8000-000000000001';
const OTHER = '7eac0000-0000-4000-8000-000000000003';
const FROM = '920000000000';
const ENV = { DATA_MCP_URL: 'https://mcp.example/mcp', DATA_MCP_USER_EMAIL: 'operator@example.org', ANTHROPIC_API_KEY: 'k' };

function fakeRedis() {
  const kv = new Map();
  const locks = new Map();
  return {
    kv,
    locks,
    async get(k) { return kv.has(k) ? JSON.parse(kv.get(k)) : null; },
    async set(k, v, ttl) { kv.set(k, JSON.stringify(v)); kv.set(`${k}#ttl`, JSON.stringify(ttl)); return true; },
    async delete(k) { kv.delete(k); return true; },
    async incr(k) { const n = (kv.has(k) ? JSON.parse(kv.get(k)) : 0) + 1; kv.set(k, JSON.stringify(n)); return n; },
    async expire() { return true; },
    async acquireLock(r, id) { if (locks.has(r)) return false; locks.set(r, id); return true; },
    async releaseLock(r, id) { if (locks.get(r) === id) locks.delete(r); return true; },
    isAvailable() { return true; },
  };
}
function fakeSupabase(value) {
  const reads = [];
  return {
    reads,
    from(table) {
      const q = { select: () => q, eq: (c, v) => { reads.push({ table, c, v }); return q; }, maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) };
      return q;
    },
  };
}
function setup({ switchValue = [ME], answer, env = ENV } = {}) {
  SW._resetCache();
  const sent = [];
  const asked = [];
  const deps = {
    env,
    supabase: fakeSupabase(switchValue),
    redis: fakeRedis(),
    whatsapp: { sendMessage: async (to, text) => { sent.push({ to, text }); return true; } },
    runQuestion: async (args) => {
      asked.push(args);
      if (answer instanceof Error) throw answer;
      return answer || {
        text: '*736 teachers* made a plan.\n\nNEXT: [analyze] Which sectors lag? | [detect] Who stopped?',
        calls: [
          { name: 'get_rules', arguments: { region: 'niete-rumi' }, result: JSON.stringify({ rule_version: 'v0.42.5', rule_files: [{}] }) },
          { name: 'query_metric', arguments: { metric: 'lp_users', from_date: '2026-11-07', to_date: '2026-11-13' }, result: JSON.stringify({ status: 'ok', rows: [] }) },
        ],
        stoppedEarly: false,
        openQuestion: null,
      };
    },
    now: () => new Date('2026-11-20T16:00:00Z'),
  };
  const send = (body, user = { id: ME }) => maybeHandleDataAnalyst({ user, from: FROM, messageBody: body, correlationId: 'c1' }, deps);
  return { deps, sent, asked, send };
}

describe('off means untouched', () => {
  test('not configured: never handled, the switch is not even read', async () => {
    const s = setup({ env: { ...ENV, DATA_MCP_URL: '' } });
    await expect(s.send('data')).resolves.toBe(false);
    expect(s.deps.supabase.reads).toHaveLength(0);
    expect(s.sent).toHaveLength(0);
  });
  test('someone the switch does not name: "data" goes to the ordinary handler', async () => {
    const s = setup();
    await expect(s.send('data', { id: OTHER })).resolves.toBe(false);
    expect(s.sent).toHaveLength(0);
  });
  test('named, but not in data mode: an ordinary message is not taken', async () => {
    const s = setup();
    await expect(s.send('How many teachers made a lesson plan?')).resolves.toBe(false);
    expect(s.asked).toHaveLength(0);
  });
  test('no user (lookup failed) is not taken', async () => {
    const s = setup();
    await expect(s.send('data', null)).resolves.toBe(false);
  });
});

describe('in data mode', () => {
  test('"data" opens it with the welcome, and the session idles out after 30 minutes', async () => {
    const s = setup();
    await expect(s.send('Data ')).resolves.toBe(true);
    expect(s.sent).toEqual([{ to: FROM, text: TEXTS.welcome }]);
    expect(s.deps.redis.kv.get(`data_analyst:session:${ME}#ttl`)).toBe('1800');
  });

  test('a question: "looking into it", then the answer with its footer and numbered follow-ups', async () => {
    const s = setup();
    await s.send('data');
    await expect(s.send('How many teachers made a lesson plan last week?')).resolves.toBe(true);
    expect(s.sent.slice(1).map((m) => m.text)).toEqual([
      TEXTS.looking,
      '*736 teachers* made a plan.\n\n_NIETE data · 7–13 Nov 2026 · rules v0.42.5_\n\nAsk next (reply with a number):\n1. Which sectors lag?\n2. Who stopped?',
    ]);
    expect(s.asked[0]).toMatchObject({ question: 'How many teachers made a lesson plan last week?', identity: { userId: ME, email: 'operator@example.org' } });
  });

  test('a follow-up carries the conversation; a number picks a follow-up', async () => {
    const s = setup();
    await s.send('data');
    await s.send('How many teachers made a lesson plan last week?');
    await s.send('2');
    expect(s.asked[1].question).toBe('Who stopped?');
    expect(s.asked[1].history).toEqual([
      { role: 'user', content: 'How many teachers made a lesson plan last week?' },
      { role: 'assistant', content: '*736 teachers* made a plan.' },
    ]);
  });

  test('history keeps the last 6 turns', async () => {
    const s = setup();
    await s.send('data');
    for (let i = 1; i <= 8; i += 1) await s.send(`question ${i}`);
    expect(s.asked[7].history).toHaveLength(12);
    expect(s.asked[7].history[0]).toEqual({ role: 'user', content: 'question 2' });
  });

  test('"menu" leaves data mode; the next ordinary message is not taken', async () => {
    const s = setup();
    await s.send('data');
    await expect(s.send('menu')).resolves.toBe(true);
    expect(s.sent.at(-1).text).toBe(TEXTS.left);
    await expect(s.send('How many teachers?')).resolves.toBe(false);
  });

  test('one question at a time', async () => {
    const s = setup();
    await s.send('data');
    s.deps.redis.locks.set(`data_analyst:${ME}`, 'other-run');
    await expect(s.send('another question')).resolves.toBe(true);
    expect(s.sent.at(-1).text).toBe(TEXTS.busy);
    expect(s.asked).toHaveLength(0);
  });

  test('30 questions a day, then a plain limit message', async () => {
    const s = setup();
    await s.send('data');
    s.deps.redis.kv.set(`data_analyst:count:${ME}:2026-11-20`, JSON.stringify(30));
    await s.send('one more');
    expect(s.sent.at(-1).text).toBe(TEXTS.limit);
    expect(s.asked).toHaveLength(0);
    expect(s.deps.redis.locks.size).toBe(0);
  });

  test('a failure says the data service is not reachable, and frees the lock', async () => {
    const s = setup({ answer: new Error('MCP request failed') });
    await s.send('data');
    await expect(s.send('How many?')).resolves.toBe(true);
    expect(s.sent.at(-1).text).toBe(TEXTS.failed);
    expect(s.deps.redis.locks.size).toBe(0);
  });

  test('the store being down: "data" says it cannot start, and nothing else is taken', async () => {
    const s = setup();
    s.deps.redis.set = async () => false;
    await expect(s.send('data')).resolves.toBe(true);
    expect(s.sent.at(-1).text).toBe(TEXTS.cannotStart);
  });
});
