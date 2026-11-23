'use strict';
/**
 * Test servers bind the loopback they are called on (bd-w2x3l4).
 *
 * A harness that listens with no host binds every interface ('::'), while its client calls 127.0.0.1. The OS lets a
 * second process bind 127.0.0.1 on that same port beside a wildcard listener, and the request then lands on that
 * process instead (a 404 the suite did not write, "flaky under load"). Bound to 127.0.0.1, the port is the harness's
 * alone: a second bind there fails with EADDRINUSE.
 *
 * The shared harnesses below are run through their own exports; every server they start is read at 'listening'.
 */
const net = require('net');
const fs = require('fs');
const path = require('path');

const seen = [];
const listen = net.Server.prototype.listen;
beforeAll(() => {
  net.Server.prototype.listen = function spyListen(...args) {
    this.once('listening', () => seen.push(this.address()));
    return listen.apply(this, args);
  };
});
afterAll(() => { net.Server.prototype.listen = listen; });
beforeEach(() => { seen.length = 0; });

const bound = () => seen.map((a) => a && a.address);

describe('the shared harnesses bind 127.0.0.1', () => {
  test('closed-lang-scenarios: run()', async () => {
    const C = require('./fixtures/closed-lang-scenarios');
    await C.run(Object.keys(C.SCENARIOS)[0], false);
    expect(seen.length).toBeGreaterThan(0);
    expect(bound()).toEqual(seen.map(() => '127.0.0.1'));
  });
  test('plain-paint-scenarios: run()', async () => {
    const P = require('./fixtures/plain-paint-scenarios');
    await P.run(Object.keys(P.SCENARIOS)[0], false);
    expect(seen.length).toBeGreaterThan(0);
    expect(bound()).toEqual(seen.map(() => '127.0.0.1'));
  });
  test('one-hop-off-cases: streamedOpen()', async () => {
    const O = require('./fixtures/one-hop-off-cases');
    const R = require('../routes/web-quiz.routes');
    const fast = O.HUB({ lang: 'en', fast: true });
    await O.streamedOpen(R, [fast, fast], fast);
    expect(seen.length).toBeGreaterThan(0);
    expect(bound()).toEqual(seen.map(() => '127.0.0.1'));
  });
  test('web-quiz-busy-page.harness: runCase()', async () => {
    const B = require('./web-quiz-busy-page.harness');
    await B.runCase(Object.keys(B.SITES)[0], Object.keys(B.FAILS)[0]);
    expect(seen.length).toBeGreaterThan(0);
    expect(bound()).toEqual(seen.map(() => '127.0.0.1'));
  });
});

describe('why: a second bind on the harness port', () => {
  const up = (host) => new Promise((r) => { const s = net.createServer(); s.listen(0, ...(host ? [host] : []), () => r(s)); });
  const probe = (port) => new Promise((r) => {
    const p = net.createServer();
    p.once('error', (e) => r(e.code));
    p.listen(port, '127.0.0.1', () => p.close(() => r('bound')));
  });
  test('beside a 127.0.0.1 server it fails with EADDRINUSE: the port is the harness\'s alone', async () => {
    const s = await up('127.0.0.1');
    try { expect(await probe(s.address().port)).toBe('EADDRINUSE'); } finally { await new Promise((r) => s.close(r)); }
  });
});

describe('the harness files this change edits keep a host on every listen(0)', () => {
  // The files edited by bd-w2x3l4 (both parts), relative to the repo root (listen-host.files.json beside this test). A
  // new host-less listen(0) in one of them brings back the shared-port 404.
  const ROOT = path.join(__dirname, '..', '..');
  const FILES = require('./qfix-reminders-listen-host.files.json');
  // The callback form with no host, and the bare form: a bare listen(0) binds every interface too. Its caller reading
  // address() on the next line needs the bind to have happened, so those files wait for 'listening' with the host.
  const HOSTLESS = /\.listen\(\s*0\s*(\)|,\s*(\(?[\w$,\s]*\)?\s*=>|async\s*\(|function\b|[A-Za-z_$][\w$]*\s*\)))/;
  test.each(FILES)('%s', (f) => {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const bad = text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => HOSTLESS.test(l)).map(([n]) => n);
    expect(bad).toEqual([]);
  });
});
