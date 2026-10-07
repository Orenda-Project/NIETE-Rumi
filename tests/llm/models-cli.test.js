/**
 * bd-gr4fy.16 — anyone can see, and switch, which model runs each job, from the repo.
 *
 * Which model a job runs is decided in one place (bot/shared/config/model-registry.js), and moved without a
 * deploy by two settings rows: `llm_per_job` (job -> model) and `llm_kill_switch` (every job back on its own
 * model). Until now the only tool that read and wrote them safely lived outside the repo, so nobody else could
 * use them without hand-written SQL. `npm run models` is that tool: `list` and `status` read; `apply`, `kill`
 * and `unkill` write, and only with --confirm.
 *
 * Executed for real: only the network (globalThis-style `fetch`, here Supabase's REST API) is replaced.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { main } = require('../../scripts/llm/models');
const { JOBS, TELEMETRY_ONLY_JOBS, modelFor } = require('../../bot/shared/config/model-registry');

const PROJECT = 'abcdefghijklmnop';
const URL = `https://${PROJECT}.supabase.co`;
const KEY = 'test-service-key-never-printed';
const SONNET = 'anthropic-direct/claude-sonnet-5';
const HAIKU = 'anthropic-direct/claude-haiku-4-5';

let rows; // the llm_* rows the fake database holds: key -> value
let requests; // every request made: { method, url, body }

async function fakeFetch(input, init = {}) {
  const url = String(input);
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ method, url, body });
  const json = (obj, status = 200) => ({ ok: status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (!url.startsWith(`${URL}/rest/v1/app_settings`)) return json({ message: 'unexpected url' }, 404);
  if (method === 'GET') {
    return json(Object.keys(rows).sort().map((key) => ({ key, value: rows[key], updated_at: '2026-10-08T00:00:00Z' })));
  }
  if (method === 'POST') {
    for (const r of body) rows[r.key] = r.value;
    return json(body.map((r) => ({ ...r, updated_at: '2026-10-08T00:00:01Z' })), 201);
  }
  return json({ message: 'unexpected method' }, 405);
}

async function run(args, env = {}) {
  const out = [];
  const err = [];
  const code = await main(args, {
    fetch: fakeFetch,
    env: { SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: KEY, ...env },
    out: (s) => out.push(String(s)),
    err: (s) => err.push(String(s)),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

let dir;
function mapFile(obj) {
  const f = path.join(dir, `map-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return f;
}
const line = (text, job) => text.split('\n').find((l) => l.split(/\s+/)[0] === job) || '';
const posts = () => requests.filter((r) => r.method === 'POST');

beforeEach(() => {
  rows = {};
  requests = [];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-cli-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('npm run models: one tool for the single source, the per-job row and the kill switch (bd-gr4fy.16)', () => {
  test('list: every routed job with its model, env var and call site, and needs no database', async () => {
    const r = await run(['list'], { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
    expect(r.code).toBe(0);
    for (const job of Object.keys(JOBS)) {
      expect(line(r.out, job)).not.toBe('');
      if (JOBS[job].env) expect(line(r.out, job)).toContain(JOBS[job].env);
    }
    for (const job of TELEMETRY_ONLY_JOBS) expect(line(r.out, job)).toBe('');
    expect(requests).toEqual([]);
  });

  test.each([
    ['a job the registry does not know', { 'no.such.job': SONNET }, 'no.such.job'],
    ['a labelled job that is not routed', { [TELEMETRY_ONLY_JOBS[0]]: SONNET }, TELEMETRY_ONLY_JOBS[0]],
    ['a value that is not a model id', { 'chat.intent': 'claude sonnet!' }, 'chat.intent'],
  ])('apply refuses %s, names it, and makes no request at all', async (_what, map, named) => {
    const r = await run(['apply', mapFile(map), '--confirm']);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(named);
    expect(requests).toEqual([]);
  });

  test('apply refuses a file that is not a map of job -> model', async () => {
    const r = await run(['apply', mapFile('["chat.intent"]'), '--confirm']);
    expect(r.code).not.toBe(0);
    expect(requests).toEqual([]);
  });

  test('apply without --confirm writes nothing and says what would change against the live row', async () => {
    rows.llm_per_job = { 'chat.intent': HAIKU, 'lang.detect': HAIKU };
    const r = await run(['apply', mapFile({ 'chat.intent': HAIKU, 'chat.respond': SONNET })]);
    expect(r.code).toBe(0);
    expect(posts()).toEqual([]);
    expect(r.out).toMatch(/\+\s*chat\.respond\b.*claude-sonnet-5/);
    expect(r.out).toMatch(/-\s*lang\.detect\b/);
    expect(r.out).toContain('--confirm');
    expect(rows.llm_per_job).toEqual({ 'chat.intent': HAIKU, 'lang.detect': HAIKU });
  });

  test('apply --confirm makes the row exactly the map, then reads it back', async () => {
    rows.llm_per_job = { 'lang.detect': HAIKU };
    const map = { 'chat.intent': HAIKU, 'chat.respond': SONNET };
    const r = await run(['apply', mapFile(map), '--confirm']);
    expect(r.code).toBe(0);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toContain('on_conflict=key');
    expect(posts()[0].body).toEqual([expect.objectContaining({ key: 'llm_per_job', value: map })]);
    expect(rows.llm_per_job).toEqual(map);
    const last = requests[requests.length - 1];
    expect(last.method).toBe('GET'); // the read-back
    expect(r.out).toContain(PROJECT);
  });

  test.each([['kill', true], ['unkill', false]])('%s writes the kill switch only with --confirm', async (cmd, value) => {
    const refused = await run([cmd]);
    expect(refused.code).not.toBe(0);
    expect(posts()).toEqual([]);
    const done = await run([cmd, '--confirm']);
    expect(done.code).toBe(0);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toEqual([expect.objectContaining({ key: 'llm_kill_switch', value })]);
    expect(rows.llm_kill_switch).toBe(value);
  });

  test('status: per job, the row\'s model where the row names it, otherwise its registry model', async () => {
    rows.llm_kill_switch = false;
    rows.llm_per_job = { 'chat.respond': SONNET };
    const r = await run(['status']);
    expect(r.code).toBe(0);
    expect(line(r.out, 'chat.respond')).toContain(SONNET);
    expect(line(r.out, 'chat.intent')).toContain(modelFor('chat.intent'));
    expect(line(r.out, 'chat.intent')).not.toContain('claude');
    expect(r.out).toContain(PROJECT);
  });

  test('status with the kill switch on: every job on its registry model, and the switch called out', async () => {
    rows.llm_kill_switch = true;
    rows.llm_per_job = { 'chat.respond': SONNET };
    const r = await run(['status']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/KILL SWITCH IS ON/);
    expect(line(r.out, 'chat.respond')).toContain(modelFor('chat.respond'));
    expect(line(r.out, 'chat.respond')).not.toContain(SONNET);
  });

  test('a command that needs the database refuses without it, and nothing secret is ever printed', async () => {
    for (const cmd of [['status'], ['kill', '--confirm']]) {
      const r = await run(cmd, { SUPABASE_URL: '' });
      expect(r.code).not.toBe(0);
      expect(r.err).toContain('SUPABASE_URL');
    }
    expect(requests).toEqual([]);
    rows.llm_per_job = { 'chat.intent': HAIKU };
    const r = await run(['status']);
    expect(`${r.out}\n${r.err}`).not.toContain(KEY);
  });
});
