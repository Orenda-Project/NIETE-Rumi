/**
 * Mock lane — the drivers' sleeps wake when the bot answers (bd-aqi0ay).
 *
 * After the pacer and the harness waits came off (bd-k5gjje) the biggest layer left was the feature
 * scripts' own `sleep()`: 737 s inside scenario windows and most of the 2400 s between them, in loops
 * shaped `while (!done) { await sleep(2500); seen.push(...await fresh()); }`. With cassette replay the
 * bot answers in milliseconds; the loop then sleeps out the rest of its 2.5 s for nothing.
 *
 *   1. mock-graph-api: GET /outbox?after=&to=&wait=<ms> long-polls — answers the moment an item for that
 *      recipient lands after `after`, or empty when the wait elapses
 *   2. mock-api.cjs: api.sleep(ms) uses it — returns early once a message lands AND the outbox has then
 *      stayed quiet for settleMs (the same settle rule a reply gets); consumes nothing (fresh() still
 *      sees the item); traced as driver.sleep with how it woke
 *   3. feature-runner injects api.sleep as the drivers' sleep on the mock lane; training.cjs's inline
 *      setTimeout waits go through it
 *   4. lesson-plan.cjs's two 15 s sleeps exist to pace Meta's pair rate limit on the chrome lane — skipped
 *      when api.caps.method is 'mock'
 *
 * Red-first: fails on the bd-k5gjje branch — no `wait` on /outbox, no api.sleep, the runner injects a plain
 * setTimeout sleep, and lesson-plan sleeps 15 s on every lane.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createMockGraphApi } = require('../../bot/scripts/e2e/mock-graph-api');

const REPO = path.resolve(__dirname, '..', '..');
const QA = path.join(REPO, '.claude', 'qa', 'shared');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'driver-sleep-'));
const readLines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const DRIVER = '923000000779';

let mock, mockBase, bot;
const send = (to, text) => fetch(`${mockBase}/v21.0/e2e-local/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }) });
beforeAll(async () => {
  bot = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { res.writeHead(200); res.end('EVENT_RECEIVED'); }); });
  await new Promise((r) => bot.listen(0, '127.0.0.1', r));
  mock = createMockGraphApi({ phoneNumberId: 'e2e-local', botUrl: `http://127.0.0.1:${bot.address().port}`, quiet: true });
  mockBase = `http://127.0.0.1:${await mock.listen(0)}`;
});
afterAll(async () => { await mock.close(); bot.close(); });
beforeEach(async () => { await fetch(`${mockBase}/reset`, { method: 'POST' }); });

describe('1. /outbox?wait= long-polls', () => {
  test('answers as soon as an item for the recipient lands', async () => {
    const t0 = Date.now();
    setTimeout(() => send(DRIVER, 'late'), 150);
    const r = await (await fetch(`${mockBase}/outbox?after=0&to=${DRIVER}&wait=3000`)).json();
    expect(r.items.map((i) => i.txt)).toEqual(['late']);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  test('returns empty when the wait elapses with nothing', async () => {
    const t0 = Date.now();
    const r = await (await fetch(`${mockBase}/outbox?after=0&to=${DRIVER}&wait=300`)).json();
    expect(r.items).toEqual([]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
  });
  test('an item already there answers at once; another recipient\'s item does not wake it', async () => {
    await send(DRIVER, 'already');
    const t0 = Date.now();
    const r = await (await fetch(`${mockBase}/outbox?after=0&to=${DRIVER}&wait=3000`)).json();
    expect(r.items).toHaveLength(1); expect(Date.now() - t0).toBeLessThan(300);
    setTimeout(() => send('923000000001', 'someone else'), 100);
    const t1 = Date.now();
    const r2 = await (await fetch(`${mockBase}/outbox?after=${r.last}&to=${DRIVER}&wait=400`)).json();
    expect(r2.items).toEqual([]); expect(Date.now() - t1).toBeGreaterThanOrEqual(380);
  });
});

describe('2. api.sleep — wakes on arrival + settle, consumes nothing', () => {
  const make = () => {
    jest.resetModules();
    for (const k of ['E2E_POLL_MS', 'E2E_SETTLE_MS', 'E2E_QUIESCE_MS']) delete process.env[k];
    const { createTracer } = require('../../.claude/qa/engine/bin/trace.cjs');
    const file = path.join(tmp(), 'trace.jsonl');
    const api = require('../../.claude/qa/engine/bin/mock-api.cjs').makeMockApi({ baseUrl: mockBase, driver: DRIVER, tracer: createTracer({ file, run: 'r', feature: 'f' }), pollMs: 50, settleMs: 300, quiesceMs: 200 });
    return { api, rows: () => readLines(file) };
  };
  test('a message at 100 ms ends a 3 s sleep after the settle, and fresh() still returns it', async () => {
    const { api, rows } = make();
    await api.freshReset();
    setTimeout(() => send(DRIVER, 'wake'), 100);
    const t0 = Date.now();
    await api.sleep(3000);
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(380);   // 100 + the 300 ms settle
    expect(took).toBeLessThan(1500);
    expect((await api.fresh()).map((x) => x.txt)).toEqual(['wake']);
    const sp = rows().find((x) => x.name === 'driver.sleep');
    expect(sp).toMatchObject({ layer: 'driver', kind: 'intentional', attrs: { askedMs: 3000, woke: 'message' } });
  });
  test('nothing arriving: the sleep lasts its full length', async () => {
    const { api, rows } = make();
    const t0 = Date.now();
    await api.sleep(600);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(580);
    expect(rows().find((x) => x.name === 'driver.sleep').attrs.woke).toBe('timeout');
  });
  test('a short sleep is just a sleep', async () => {
    const { api, rows } = make();
    const t0 = Date.now();
    await api.sleep(80);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
    expect(rows().filter((x) => x.name === 'driver.sleep')).toHaveLength(0);
  });
});

describe('3 + 4. the drivers use it', () => {
  test('feature-runner hands the drivers api.sleep on the mock lane', () => {
    const src = fs.readFileSync(path.join(REPO, '.claude', 'qa', 'engine', 'bin', 'feature-runner.cjs'), 'utf8');
    expect(src).toMatch(/sleep: MOCK && api\.sleep \? api\.sleep : sleep/);
  });
  test('training.cjs has no inline setTimeout wait of 800 ms or more left', () => {
    const src = fs.readFileSync(path.join(QA, 'features', 'training.cjs'), 'utf8');
    const inline = [...src.matchAll(/setTimeout\((?:r|res|resolve), *(\d+)\)/g)].map((m) => Number(m[1])).filter((ms) => ms >= 800);
    expect(inline).toEqual([]);
  });
  test('lesson-plan.cjs skips its two 15 s Meta-pacing sleeps on the mock lane', () => {
    const src = fs.readFileSync(path.join(QA, 'features', 'lesson-plan.cjs'), 'utf8');
    expect(src).not.toMatch(/if \(hits\.length\) await sleep\(15000\)/);
    expect(src).not.toMatch(/if \(want\('L02'\)\) await sleep\(15000\)/);
    expect((src.match(/api\.caps\.method !== 'mock'/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
