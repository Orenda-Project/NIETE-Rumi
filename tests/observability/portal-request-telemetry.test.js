/**
 * bd-43487 — the portal's request telemetry must actually reach Axiom.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * Row 3 of the NIETE bug sheet ("training levels are not visible to teacher in
 * the portal") could not be diagnosed, because there was no record of what the
 * teacher's request did. The portal service HAS AXIOM_DATASET and AXIOM_TOKEN
 * set in Railway, and dashboard/middleware/latency-logger.js LOOKS instrumented:
 *
 *     if (global.logEvent) {
 *       global.logEvent('http.request.completed', logData);
 *     }
 *
 * but `global.logEvent` is never assigned anywhere in the repository — the bot
 * imports the logger as a module (`require('../utils/structured-logger')`), it
 * does not publish it on `global`. So both branches were dead: the portal
 * emitted nothing, Axiom held no `service == "portal"` rows at all, and
 * docs/observability/AXIOM_MONITORS.md's claim to the contrary was wrong.
 *
 * The failure this guards against is a SILENT one — the middleware still runs,
 * still console.logs, and still returns the right response. Only the telemetry
 * is missing, so nothing looks broken until an incident needs the logs and they
 * are not there. That is why it is asserted rather than eyeballed.
 *
 * The assertions below are deliberately about BEHAVIOUR, not wiring: a served
 * request emits an http.request.completed event, and a 500 is emitted with its
 * status code intact. The sink itself has since moved — see
 * dashboard-axiom-sink.test.js for why it must live in the dashboard's own
 * dependency set — but what this file guards is unchanged: the middleware must
 * actually emit.
 */

const path = require('path');

describe('bd-43487 — portal request telemetry reaches the log sink', () => {
  const SINK_PATH = path.join(
    __dirname, '..', '..', 'dashboard', 'services', 'telemetry.service'
  );

  let emitted;

  beforeEach(() => {
    jest.resetModules();
    emitted = [];

    // Stand in for the real Axiom-backed sink. The middleware must reach the
    // module, not a global that nothing sets.
    jest.doMock(SINK_PATH, () => ({
      logEvent: (event, data) => emitted.push({ event, data }),
      flush: () => {},
      isEnabled: () => true,
    }));

    // Nothing in the repo assigns this. Set it to undefined explicitly so a
    // regression cannot pass by accidentally relying on a leaked global.
    delete global.logEvent;
  });

  afterEach(() => {
    delete global.logEvent;
    jest.resetModules();
  });

  /** Drive the middleware the way Express does, and resolve when it finishes. */
  function runRequest({ statusCode = 200, method = 'GET', url = '/training/levels' } = {}) {
    const { latencyLogger } = require('../../dashboard/middleware/latency-logger');

    const handlers = { finish: [] };
    const req = {
      path: url,
      originalUrl: url,
      method,
      get: () => 'jest',
    };
    const res = {
      statusCode,
      on: (evt, cb) => { if (evt === 'finish') handlers.finish.push(cb); },
    };

    return new Promise((resolve) => {
      latencyLogger(req, res, () => {
        // Express fires 'finish' once the response is flushed.
        handlers.finish.forEach((cb) => cb());
        resolve();
      });
    });
  }

  it('emits http.request.completed for a served request', async () => {
    await runRequest({ statusCode: 200 });

    const completed = emitted.filter((e) => e.event === 'http.request.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0].data).toMatchObject({
      path: '/training/levels',
      method: 'GET',
      statusCode: 200,
    });
    expect(typeof completed[0].data.durationMs).toBe('number');
  });

  it('emits the failure with its status code — the case row 3 needed', async () => {
    await runRequest({ statusCode: 500 });

    const completed = emitted.filter((e) => e.event === 'http.request.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0].data.statusCode).toBe(500);
    expect(completed[0].data.path).toBe('/training/levels');
  });

  it('does not depend on a global that nothing assigns', async () => {
    expect(global.logEvent).toBeUndefined();
    await runRequest({ statusCode: 200 });
    // Would be 0 if the emit still went through `if (global.logEvent)`.
    expect(emitted.length).toBeGreaterThan(0);
  });
});
