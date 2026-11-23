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

describe('every test file that calls 127.0.0.1 binds its servers there: a scan of bot/tests and dashboard/tests', () => {
  // A list of edited files cannot see a harness added after it (a host-less one landed within hours of the list), so
  // every .js file under the two test trees is read. A file that never names 127.0.0.1 is out of scope by construction:
  // its client calls localhost (the five `http.get({ port })` sites). The mechanism test's up(host) passes its host by
  // spread, which the pattern does not read.
  const ROOT = path.join(__dirname, '..', '..');
  const TREES = ['bot/tests', 'dashboard/tests'];
  const FIXTURE = 'dashboard/tests/fixtures/listen-scan-hostless.js';
  // One reason each.
  const EXEMPT = { [FIXTURE]: 'the scan\'s own red fixture' };
  // The callback form with no host, and the bare form: a bare listen(0) binds every interface too. Its caller reading
  // address() on the next line needs the bind to have happened, so those files wait for 'listening' with the host.
  const HOSTLESS = /\.listen\(\s*0\s*(\)|,\s*(\(?[\w$,\s]*\)?\s*=>|async\s*\(|function\b|[A-Za-z_$][\w$]*\s*\)))/;
  const COMMENT = /^\s*(\/\/|\/\*|\*)/;
  const offenders = (rel) => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (!text.includes('127.0.0.1')) return [];
    return text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !COMMENT.test(l) && HOSTLESS.test(l)).map(([n]) => n);
  };
  const walk = (rel) => fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((e) => {
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return e.name.endsWith('.js') ? [p] : [];
  });

  test('the red fixture is caught, both forms, and its commented-out site is not', () => {
    expect(offenders(FIXTURE)).toEqual([9, 13]);
  });
  test('every exemption is a file that is still there', () => {
    Object.keys(EXEMPT).forEach((f) => expect(fs.existsSync(path.join(ROOT, f))).toBe(true));
  });
  test('no other file has a host-less listen(0)', () => {
    const files = TREES.flatMap(walk).filter((f) => !EXEMPT[f]);
    expect(files.length).toBeGreaterThan(1000);
    const bad = {};
    files.forEach((f) => { const o = offenders(f); if (o.length) bad[f] = o; });
    expect(bad).toEqual({});
  });
});
