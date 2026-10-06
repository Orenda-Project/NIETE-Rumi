'use strict';
/**
 * Training on the web — what the portal writes down when a training link is opened.
 *
 * Two things found by opening a real link on sandbox:
 *
 *   1. The request log carried the credential. latency-logger logged req.path, so
 *      every http.request.completed row and every [LATENCY] console line held
 *      /t/<token> — a 24-hour way into a teacher's training for anyone who can
 *      read the logs. It is now /t/:token.
 *
 *   2. training.web_link_open never reached Axiom. The route logged through the
 *      BOT's structured logger, which needs `pino`; the portal service installs
 *      only the dashboard's dependencies, so the require threw inside a
 *      try/catch and nothing was logged (dashboard/services/telemetry.service.js
 *      records this exact trap). It now uses the portal's own sink.
 *
 * The bot logger is replaced below by a module that throws exactly as it does in
 * the portal process, so a route that still reaches for it loses its event here
 * the way it did on sandbox.
 */
const http = require('http');
const express = require('express');

const SINK_PATH = '../../dashboard/services/telemetry.service';
// A made-up token of the real shape (never a signed one: this repo is public).
const TOKEN = 'eyJrIjoidCIsInUiOiJ4eHh4IiwiZXhwIjoxfQ.ZmFrZS1zaWduYXR1cmUtMDA';

let emitted;
let consoleLines;
const ENV = { ...process.env };
beforeEach(() => {
  jest.resetModules();
  emitted = [];
  consoleLines = [];
  jest.doMock(SINK_PATH, () => ({
    logEvent: (event, data) => emitted.push({ event, data }),
    flush: () => {},
    isEnabled: () => true,
  }));
  // The portal process cannot load the bot's loggers: they need pino.
  for (const p of ['../../bot/shared/utils/structured-logger', '../../bot/shared/utils/logger']) {
    jest.doMock(p, () => { throw new Error("Cannot find module 'pino'"); });
  }
  jest.spyOn(console, 'log').mockImplementation((...a) => { consoleLines.push(a.join(' ')); });
  jest.spyOn(console, 'error').mockImplementation((...a) => { consoleLines.push(a.join(' ')); });
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key' };
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
  process.env = ENV;
});

function runLatency(path, statusCode = 303) {
  const { latencyLogger } = require('../../dashboard/middleware/latency-logger');
  const finish = [];
  const req = { path, originalUrl: path, method: 'GET', get: () => 'jest' };
  const res = { statusCode, on: (evt, cb) => { if (evt === 'finish') finish.push(cb); } };
  return new Promise((resolve) => latencyLogger(req, res, () => { finish.forEach((cb) => cb()); resolve(); }));
}

describe('the request log never carries a training link token', () => {
  test.each([
    [`/t/${TOKEN}`, '/t/:token'],
    ['/t/expired', '/t/:token'],
  ])('%s is logged as %s', async (path, logged) => {
    await runLatency(path);

    const completed = emitted.filter((e) => e.event === 'http.request.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0].data.path).toBe(logged);
    expect(JSON.stringify(emitted)).not.toContain(TOKEN);
    expect(consoleLines.join('\n')).not.toContain(TOKEN);
    expect(consoleLines.join('\n')).toContain('/t/:token');
  });

  test.each(['/t', '/training/levels', '/portal/training', '/tx/abc', '/q/AB12CD'])('%s is logged unchanged', async (path) => {
    await runLatency(path, 200);
    expect(emitted.find((e) => e.event === 'http.request.completed').data.path).toBe(path);
  });
});

describe('opening a link is recorded through the portal\'s own sink', () => {
  async function open(path, findUser = async () => ({ id: 'aaaa', name: 'Ayesha' })) {
    const Token = require('../../bot/shared/services/training/training-link-token');
    const { createTrainingLinkRouter } = require('../../dashboard/routes/training-link.routes');
    const app = express();
    app.use((req, _res, next) => {
      const make = (d) => Object.assign({ regenerate(cb) { req.session = make({}); cb(null); }, save(cb) { cb(null); } }, d);
      req.session = make({});
      next();
    });
    app.use(createTrainingLinkRouter({ findUser }));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const target = typeof path === 'function' ? path(Token) : path;
    const status = await new Promise((resolve, reject) => {
      const rq = http.request({ host: '127.0.0.1', port: srv.address().port, path: target, headers: { 'x-requested-with': 'com.whatsapp' } }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      rq.on('error', reject); rq.end();
    });
    await new Promise((r) => srv.close(r));
    return status;
  }

  test('a genuine link: training.web_link_open, outcome ok, with the browser facts', async () => {
    const status = await open((T) => `/t/${T.signTrainingLink('aaaa')}`);

    expect(status).toBe(303);
    expect(emitted).toContainEqual({ event: 'training.web_link_open', data: expect.objectContaining({ outcome: 'ok', userId: 'aaaa', xrw: 'com.whatsapp', iab: 1 }) });
  });

  test('an expired link: training.web_link_open, outcome invalid', async () => {
    const status = await open('/t/expired');

    expect(status).toBe(200);
    expect(emitted).toContainEqual({ event: 'training.web_link_open', data: expect.objectContaining({ outcome: 'invalid' }) });
  });

  test('a lookup that fails is recorded AND written to the error console', async () => {
    const status = await open((T) => `/t/${T.signTrainingLink('aaaa')}`, async () => { throw new Error('db down'); });

    expect(status).toBe(200);
    expect(emitted).toContainEqual({ event: 'training.web_link_open', data: expect.objectContaining({ outcome: 'error' }) });
    expect(console.error).toHaveBeenCalled();
    expect(consoleLines.join('\n')).toMatch(/training link/);
  });
});
