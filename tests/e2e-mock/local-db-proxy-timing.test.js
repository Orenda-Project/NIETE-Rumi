/**
 * Mock-lane profiling — the local DB proxy times every PostgREST request.
 *
 * WHY. supabase-js sends no correlation header, and the bot's own logs do not time its queries. The
 * proxy is the one place every DB call of a run passes through, so a per-request line there
 * (method, table, status, ms, response bytes) is the DB layer of the profile — no bot change.
 *
 * Red-first: fails on sandbox — LOCAL_DB_TIMING_LOG is unknown to local-db-proxy.js.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PROXY = path.resolve(__dirname, '..', '..', 'bot', 'scripts', 'e2e', 'local-db-proxy.js');
const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const waitHealth = async (url, tries = 60) => { for (let i = 0; i < tries; i++) { try { if ((await fetch(url)).ok) return; } catch (_) {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('proxy never healthy'); };

describe('local-db-proxy.js — LOCAL_DB_TIMING_LOG', () => {
  let rest, child, port, log;
  beforeAll(async () => {
    // a fake PostgREST that answers /users after 60 ms and /rpc/fn with a 404
    rest = http.createServer((req, res) => {
      if (req.url.startsWith('/rpc/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"message":"no fn"}'); }
      setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[{"id":1},{"id":2}]'); }, 60);
    });
    await new Promise((r) => rest.listen(0, '127.0.0.1', r));
    port = await freePort();
    log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'db-timing-')), 'db-timing.jsonl');
    child = spawn(process.execPath, [PROXY, String(port), String(rest.address().port)], { env: { ...process.env, LOCAL_DB_TIMING_LOG: log }, stdio: 'ignore' });
    await waitHealth(`http://127.0.0.1:${port}/health`);
  });
  afterAll(() => { try { child.kill(); } catch (_) {} rest.close(); });

  test('one JSON line per request: method, table, status, bytes and a measured ms', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/rest/v1/users?select=id&phone_number=eq.1`, { headers: { apikey: 'x' } });
    expect(r.status).toBe(200);
    await fetch(`http://127.0.0.1:${port}/rest/v1/rpc/get_thing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await new Promise((res) => setTimeout(res, 50));
    const rows = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ method: 'GET', table: 'users', status: 200, bytes: 19 });
    expect(rows[0].ms).toBeGreaterThanOrEqual(55);
    expect(typeof rows[0].ts).toBe('number');
    expect(rows[0].query).toBe('select=id&phone_number=eq.1');
    expect(rows[1]).toMatchObject({ method: 'POST', table: 'rpc/get_thing', status: 404 });
  });
});
