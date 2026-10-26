/**
 * Mock lane — the fixed waits come off (bd-k5gjje).
 *
 * Run 20261023-1006-par (all 7 features, profiled): inside scenario windows the bot worked 21 s of
 * 2203 s. 527 s was the bot's own WhatsApp send pacer holding replies (6 s per phone once 8 sends are in
 * flight — the mock Graph API has no such limit), 154 s was the pre-send quiesce (the outbox moved during
 * it 0 times in 153), 318 s the post-reply settle (nothing more arrived in 208 of 210), 66 s the 500 ms
 * poll, 217 s the 31 s app-setting settles (the bot's 30 s switch cache). None of it tested anything.
 *
 *   1. local-stack.sh composes WA_PAIR_PACING=off and APP_SETTINGS_FLAG_TTL_MS=1000 into the lane's env
 *   2. app-redirect.service.js reads APP_SETTINGS_FLAG_TTL_MS (default 30 s, unchanged)
 *   3. mock-api.cjs: E2E_POLL_MS / E2E_SETTLE_MS / E2E_APP_SETTING_SETTLE_MS knobs, and the quiesce is
 *      SKIPPED when the outbox has not changed since a settle already proved it quiet
 *
 * Red-first: fails on the profiler branch — none of the knobs exist and every send pays the quiesce.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createMockGraphApi } = require('../../bot/scripts/e2e/mock-graph-api');

const REPO = path.resolve(__dirname, '..', '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lane-waits-'));
const readLines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('1. the lane env switches the pacer off and shortens the switch cache', () => {
  const src = fs.readFileSync(path.join(REPO, 'bot', 'scripts', 'e2e', 'local-stack.sh'), 'utf8');
  test('WA_PAIR_PACING=off, overridable through E2E_WA_PAIR_PACING', () => {
    expect(src).toMatch(/echo "WA_PAIR_PACING=\$\{E2E_WA_PAIR_PACING:-off\}"/);
  });
  test('the inbound rate limit is lifted to 1000 per window, overridable through E2E_RATE_LIMIT_MAX', () => {
    // the first fixed run: training T24/T37 got "You're sending messages very quickly" — 30/min per phone, one phone
    expect(src).toMatch(/echo "RATE_LIMIT_MAX=\$\{E2E_RATE_LIMIT_MAX:-1000\}"/);
  });
  test('the switch-cache TTL stays 30 s on the lane until every cache reads it (seven keep their own)', () => {
    expect(src).toMatch(/echo "APP_SETTINGS_FLAG_TTL_MS=\$\{E2E_APP_SETTINGS_FLAG_TTL_MS:-1000\}"/);
  });
  test('the lane config carries a signing key placeholder so /portal links can be signed (M10/M21, bd-0ek3rv)', () => {
    // app-login-link.js signs the /portal token with INTERNAL_API_KEY; without it the bot answers "the portal link is
    // not available right now". A placeholder is enough on the lane: nothing verifies the signature here.
    const lane = fs.readFileSync(path.join(REPO, '.claude', 'qa', 'config', 'local-lane.env'), 'utf8');
    expect(lane).toMatch(/^INTERNAL_API_KEY=e2e-local-[a-z-]+$/m);
  });
  test('run-suite.sh sets the three harness knobs for the mock lane only', () => {
    const rs = fs.readFileSync(path.join(REPO, '.claude', 'qa', 'shared', 'run-suite.sh'), 'utf8');
    expect(rs).toMatch(/E2E_POLL_MS="\$\{E2E_POLL_MS:-100\}"/);
    expect(rs).toMatch(/E2E_SETTLE_MS="\$\{E2E_SETTLE_MS:-800\}"/);
    expect(rs).toMatch(/E2E_APP_SETTING_SETTLE_MS="\$\{E2E_APP_SETTING_SETTLE_MS:-1500\}"/);
  });
});

describe('2. app-redirect.service.js — the switch cache TTL is env-tunable, default unchanged', () => {
  const fresh = (env) => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) } }));
    delete process.env.APP_SETTINGS_FLAG_TTL_MS;
    Object.assign(process.env, env);
    return require('../../bot/shared/services/app-redirect.service');
  };
  test('default stays 30 s', () => { expect(fresh({}).FLAG_TTL_MS).toBe(30000); });
  test('APP_SETTINGS_FLAG_TTL_MS=1000 is honoured', () => { expect(fresh({ APP_SETTINGS_FLAG_TTL_MS: '1000' }).FLAG_TTL_MS).toBe(1000); });
  test('garbage falls back to the default', () => { expect(fresh({ APP_SETTINGS_FLAG_TTL_MS: 'soon' }).FLAG_TTL_MS).toBe(30000); });
});

describe('3. mock-api.cjs — knobs from the env, and no quiesce after a quiet settle', () => {
  let mock, mockBase, bot;
  const DRIVER = '923000000778';
  beforeAll(async () => {
    bot = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        res.writeHead(200); res.end('EVENT_RECEIVED');
        const msg = JSON.parse(b).entry[0].changes[0].value.messages[0];
        const send = (text) => fetch(`${mockBase}/v21.0/e2e-local/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: msg.from, type: 'text', text: { body: text } }) }).catch(() => {});
        setTimeout(() => send('reply'), 30);
        // "late": a second message 250 ms later — inside an 800 ms settle, so the settle must catch it
        if (msg.text && msg.text.body === 'two') setTimeout(() => send('second'), 280);
      });
    });
    await new Promise((r) => bot.listen(0, '127.0.0.1', r));
    mock = createMockGraphApi({ phoneNumberId: 'e2e-local', botUrl: `http://127.0.0.1:${bot.address().port}`, quiet: true });
    mockBase = `http://127.0.0.1:${await mock.listen(0)}`;
  });
  afterAll(async () => { await mock.close(); bot.close(); });
  const make = (env, extra = {}) => {
    for (const k of ['E2E_POLL_MS', 'E2E_SETTLE_MS', 'E2E_QUIESCE_MS', 'E2E_APP_SETTING_SETTLE_MS']) delete process.env[k];
    Object.assign(process.env, env);
    jest.resetModules();
    const { createTracer } = require('../../.claude/qa/shared/trace.cjs');
    const file = path.join(tmp(), 'trace.jsonl');
    const tracer = createTracer({ file, run: 'r', feature: 'f' });
    const api = require('../../.claude/qa/shared/mock-api.cjs').makeMockApi({ baseUrl: mockBase, driver: DRIVER, tracer, ...extra });
    return { api, rows: () => readLines(file) };
  };

  test('E2E_POLL_MS / E2E_SETTLE_MS are read; opts still win', async () => {
    const { api, rows } = make({ E2E_POLL_MS: '50', E2E_SETTLE_MS: '300', E2E_QUIESCE_MS: '200' });
    await api.sendWait('one', 5000);
    const r = rows();
    expect(r.find((x) => x.name === 'poll.detect').attrs.pollMs).toBe(50);
    expect(r.find((x) => x.name === 'wait.settle').attrs.settleMs).toBe(300);
    const { api: api2, rows: rows2 } = make({ E2E_POLL_MS: '50', E2E_SETTLE_MS: '300' }, { settleMs: 120 });
    await api2.sendWait('one', 5000);
    expect(rows2().find((x) => x.name === 'wait.settle').attrs.settleMs).toBe(120);
  });

  test('the second send skips the quiesce when the settle already proved the outbox quiet', async () => {
    const { api, rows } = make({ E2E_POLL_MS: '50', E2E_SETTLE_MS: '300', E2E_QUIESCE_MS: '400' });
    await api.sendWait('one', 5000);
    await api.sendWait('one', 5000);
    const q = rows().filter((x) => x.name === 'wait.quiesce');
    expect(q).toHaveLength(2);
    expect(q[0].ms).toBeGreaterThanOrEqual(350);         // the first send has nothing to go on: full quiesce
    expect(q[1].ms).toBeLessThan(150);                    // the second: one outbox read, no sleep
    expect(q[1].attrs.skipped).toBe(true);
  });

  test('a message that lands after the settle makes the next quiesce wait again', async () => {
    const { api, rows } = make({ E2E_POLL_MS: '50', E2E_SETTLE_MS: '300', E2E_QUIESCE_MS: '400' });
    await api.sendWait('one', 5000);
    // something arrives out of band (a late reply): the outbox moved after the settle ended
    await fetch(`${mockBase}/v21.0/e2e-local/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: DRIVER, type: 'text', text: { body: 'late' } }) });
    await api.sendWait('one', 5000);
    const q = rows().filter((x) => x.name === 'wait.quiesce');
    expect(q[1].attrs.skipped).toBe(false);
    expect(q[1].ms).toBeGreaterThanOrEqual(350);
  });

  test('an 800 ms settle still gathers a reply that comes in two messages', async () => {
    const { api } = make({ E2E_POLL_MS: '50', E2E_SETTLE_MS: '800', E2E_QUIESCE_MS: '200' });
    const r = await api.sendWait('two', 5000);
    expect(r.freshIds).toBe(2);
    expect(r.txt).toBe('second');
  });

  test('the app-setting settle comes from E2E_APP_SETTING_SETTLE_MS', async () => {
    const { api } = make({ E2E_APP_SETTING_SETTLE_MS: '10' }, { pollMs: 50 });
    // the knob is read into the default; the call itself needs the local DB, so only the resolved default is checked
    expect(api.appSettingSettleMs).toBe(10);
    const { api: d } = make({}, { pollMs: 50 });
    expect(d.appSettingSettleMs).toBe(31000);
  });
});
