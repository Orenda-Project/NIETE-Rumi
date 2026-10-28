/**
 * Mock-lane profiling — the span trace the harness writes for every primitive.
 *
 * WHY. A mock-lane feature JSON records one number per scenario (`ms`) and a flat list of bot waits.
 * Neither says where the time went: the 2026-10-12 menu run shows M01 at 3232 ms while the bot answered
 * /menu in ~200 ms — the other 3 s is the harness's own quiesce + poll + settle, invisible in any
 * artefact. The tracer makes every primitive a span with children (quiesce / inject / bot.reply /
 * poll.detect / settle), so the profiler can split intentional waits from bot processing.
 *
 * Red-first: fails on sandbox — `.claude/qa/engine/bin/trace.cjs` does not exist, and makeMockApi ignores
 * `opts.tracer`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createMockGraphApi } = require('../../bot/scripts/e2e/mock-graph-api');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-trace-'));
const readLines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('trace.cjs — the span emitter', () => {
  test('nested spans land as JSON lines with parent ids, layer, kind and a measured ms', async () => {
    const { createTracer } = require('../../.claude/qa/engine/bin/trace.cjs');
    const file = path.join(tmp(), 'trace.jsonl');
    const tr = createTracer({ file, run: 'r1', feature: 'menu' });
    const outer = tr.span('send', { layer: 'harness', kind: 'primitive', attrs: { text: '/menu' } });
    const inner = tr.span('wait.quiesce', { layer: 'wait', kind: 'intentional', parent: outer });
    await new Promise((r) => setTimeout(r, 20));
    inner.end('ok');
    outer.end('ok', { freshIds: 1 });
    const rows = readLines(file);
    expect(rows).toHaveLength(2);
    const q = rows.find((r) => r.name === 'wait.quiesce'), s = rows.find((r) => r.name === 'send');
    expect(q.parent).toBe(s.span);
    expect(s.parent).toBe(null);
    expect(q.ms).toBeGreaterThanOrEqual(15);
    expect(s.ms).toBeGreaterThanOrEqual(q.ms);
    expect(s).toMatchObject({ run: 'r1', feature: 'menu', layer: 'harness', kind: 'primitive', status: 'ok', attrs: { text: '/menu', freshIds: 1 } });
    expect(typeof s.t0).toBe('number'); expect(s.t1 - s.t0).toBe(s.ms);
  });

  test('a scenario is recorded from its end + duration, so the runner needs no start hook', () => {
    const { createTracer } = require('../../.claude/qa/engine/bin/trace.cjs');
    const file = path.join(tmp(), 'trace.jsonl');
    const tr = createTracer({ file, run: 'r1', feature: 'menu' });
    const before = Date.now();
    tr.scenario('M01', { verdict: 'PASS', ms: 3000, title: '/menu renders' });
    const [row] = readLines(file);
    expect(row).toMatchObject({ name: 'scenario', layer: 'scenario', status: 'PASS', ms: 3000, attrs: { id: 'M01', title: '/menu renders' } });
    expect(row.t1).toBeGreaterThanOrEqual(before);
    expect(row.t1 - row.t0).toBe(3000);
  });

  test('with no file the tracer is a no-op that never throws', () => {
    const { createTracer } = require('../../.claude/qa/engine/bin/trace.cjs');
    const tr = createTracer({ file: '' });
    expect(tr.enabled).toBe(false);
    const s = tr.span('x', { layer: 'harness' });
    expect(() => s.end('ok')).not.toThrow();
    expect(() => tr.scenario('M01', { verdict: 'PASS', ms: 1 })).not.toThrow();
  });
});

describe('mock-api.cjs — a sendWait is traced as quiesce → inject → bot.reply → poll.detect → settle', () => {
  let mock, mockBase, bot, botPort, file;
  const DRIVER = '923000000777';
  beforeAll(async () => {
    // A fake bot: every webhook is answered 40 ms later with ONE text through the mock's Meta endpoint.
    bot = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        res.writeHead(200); res.end('EVENT_RECEIVED');
        const to = JSON.parse(b).entry[0].changes[0].value.messages[0].from;
        setTimeout(() => fetch(`${mockBase}/v21.0/e2e-local/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'hello back' } }) }).catch(() => {}), 40);
      });
    });
    await new Promise((r) => bot.listen(0, '127.0.0.1', r)); botPort = bot.address().port;
    mock = createMockGraphApi({ phoneNumberId: 'e2e-local', botUrl: `http://127.0.0.1:${botPort}`, quiet: true });
    const p = await mock.listen(0); mockBase = `http://127.0.0.1:${p}`;
  });
  afterAll(async () => { await mock.close(); bot.close(); });

  test('the inject answer carries the bot ack latency, and the trace splits the wait', async () => {
    const { createTracer } = require('../../.claude/qa/engine/bin/trace.cjs');
    const { makeMockApi } = require('../../.claude/qa/engine/bin/mock-api.cjs');
    file = path.join(tmp(), 'trace.jsonl');
    const tracer = createTracer({ file, run: 'r1', feature: 'menu' });
    const api = makeMockApi({ baseUrl: mockBase, driver: DRIVER, tracer, pollMs: 25, quiesceMs: 60, settleMs: 80 });
    const r = await api.sendWait('hi', 5000);
    expect(r.ok).toBe(true);
    expect(r.txt).toBe('hello back');
    const rows = readLines(file);
    const send = rows.find((x) => x.name === 'send');
    expect(send).toBeTruthy();
    const kids = rows.filter((x) => x.parent === send.span).map((x) => x.name);
    expect(kids).toEqual(expect.arrayContaining(['wait.quiesce', 'mock.inject', 'bot.reply', 'poll.detect', 'wait.settle']));
    const inject = rows.find((x) => x.name === 'mock.inject');
    expect(typeof inject.attrs.ackMs).toBe('number');
    expect(inject.attrs.messageId).toMatch(/^sim_/);
    const reply = rows.find((x) => x.name === 'bot.reply');
    expect(reply.kind).toBe('processing');
    expect(reply.ms).toBeGreaterThanOrEqual(30);   // the fake bot's 40 ms, measured from the mock's own timestamps
    expect(reply.ms).toBeLessThan(1000);
    const settle = rows.find((x) => x.name === 'wait.settle');
    expect(settle.kind).toBe('intentional');
    expect(settle.ms).toBeGreaterThanOrEqual(70);
    expect(rows.find((x) => x.name === 'wait.quiesce').kind).toBe('intentional');
    // every child sits inside its parent
    for (const k of rows.filter((x) => x.parent === send.span)) { expect(k.t0).toBeGreaterThanOrEqual(send.t0); expect(k.t1).toBeLessThanOrEqual(send.t1); }
  });

  test('the inject answer itself carries the ack latency and the mock-side timestamp', async () => {
    const r = await fetch(`${mockBase}/inject`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'text', from: DRIVER, text: 'ping' }) });
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(typeof j.ackMs).toBe('number');
    expect(j.ackMs).toBeLessThan(5000);
    expect(typeof j.at).toBe('number');
  });
});
