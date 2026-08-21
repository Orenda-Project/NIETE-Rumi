/**
 * The dashboard/portal process must be able to ship telemetry ON ITS OWN.
 *
 * WHY THIS EXISTS — a fix that passed its tests and still did nothing
 * ------------------------------------------------------------------
 * The previous change made the latency middleware emit through the bot's
 * structured logger instead of a `global` that nothing assigned. The unit test
 * passed (it mocked the logger) and the deploy succeeded. On staging the fix
 * still shipped no telemetry, and said so:
 *
 *     [latency-logger] structured logger unavailable, console only:
 *         Cannot find module 'pino'
 *
 * The portal service installs `dashboard/package.json`, which does not carry
 * `pino` — the logger lives under `bot/` and belongs to a different deploy
 * unit. So the require could never resolve in that process. The defensive
 * fallback did its job (no request broke), but the goal — being able to
 * diagnose a portal request — was still not met.
 *
 * The lesson encoded here: the sink must depend only on what the dashboard
 * process actually has. This suite therefore asserts NO bot dependency, and
 * asserts the wire call itself rather than a mocked pass-through, so it cannot
 * pass again while shipping nothing.
 */

const path = require('path');
const Module = require('module');

const SINK = path.join(__dirname, '..', '..', 'dashboard', 'services', 'telemetry.service.js');

describe('dashboard telemetry sink', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env.AXIOM_DATASET = 'test-dataset';
    process.env.AXIOM_TOKEN = 'xaat-test-token';
    process.env.RAILWAY_SERVICE_NAME = 'portal';
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
    jest.resetModules();
  });

  it('requires nothing from bot/ — it runs in a process that has no bot deps', () => {
    const src = require('fs').readFileSync(SINK, 'utf8');
    // The exact failure that made the last fix inert.
    expect(src).not.toMatch(/require\(['"][^'"]*bot\//);
    expect(src).not.toMatch(/require\(['"]pino['"]\)/);
  });

  it('POSTs ndjson to the Axiom ingest endpoint for the configured dataset', () => {
    const https = require('https');
    const calls = [];
    const spy = jest.spyOn(https, 'request').mockImplementation((opts) => {
      calls.push(opts);
      return {
        on: () => {},
        write: () => {},
        end: () => {},
        destroy: () => {},
        setTimeout: () => {},
      };
    });

    const telemetry = require(SINK);
    telemetry.logEvent('http.request.completed', { path: '/training/levels', statusCode: 500 });
    telemetry.flush();

    expect(calls.length).toBe(1);
    expect(calls[0].hostname).toBe('api.axiom.co');
    expect(calls[0].path).toBe('/v1/datasets/test-dataset/ingest');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['Content-Type']).toBe('application/x-ndjson');
    expect(calls[0].headers.Authorization).toBe('Bearer xaat-test-token');

    spy.mockRestore();
  });

  it('tags the service so portal rows are findable in the dataset', () => {
    const https = require('https');
    let body = '';
    const spy = jest.spyOn(https, 'request').mockImplementation(() => ({
      on: () => {},
      write: (chunk) => { body += chunk; },
      end: () => {},
      destroy: () => {},
      setTimeout: () => {},
    }));

    const telemetry = require(SINK);
    telemetry.logEvent('http.request.completed', { path: '/training/levels', statusCode: 500 });
    telemetry.flush();

    const row = JSON.parse(body.split('\n')[0]);
    expect(row.service).toBe('portal');
    expect(row.event).toBe('http.request.completed');
    expect(row.statusCode).toBe(500);
    expect(row.path).toBe('/training/levels');
    expect(typeof row._time === 'string' || typeof row._time === 'number').toBe(true);

    spy.mockRestore();
  });

  it('is inert, and never throws, when Axiom is not configured', () => {
    delete process.env.AXIOM_DATASET;
    delete process.env.AXIOM_TOKEN;

    const https = require('https');
    const spy = jest.spyOn(https, 'request').mockImplementation(() => {
      throw new Error('must not be called when unconfigured');
    });

    const telemetry = require(SINK);
    expect(() => {
      telemetry.logEvent('http.request.completed', { path: '/x' });
      telemetry.flush();
    }).not.toThrow();
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('a throwing transport never propagates into the caller', () => {
    const https = require('https');
    const spy = jest.spyOn(https, 'request').mockImplementation(() => {
      throw new Error('socket exploded');
    });

    const telemetry = require(SINK);
    expect(() => {
      telemetry.logEvent('http.request.completed', { path: '/x' });
      telemetry.flush();
    }).not.toThrow();

    spy.mockRestore();
  });
});

describe('the latency middleware uses that sink', () => {
  it('emits through the dashboard sink, not a bot module', () => {
    const src = require('fs').readFileSync(
      path.join(__dirname, '..', '..', 'dashboard', 'middleware', 'latency-logger.js'),
      'utf8'
    );
    expect(src).not.toMatch(/require\(['"][^'"]*bot\/shared/);
    expect(src).toMatch(/telemetry/i);
  });
});
