'use strict';
/**
 * Graceful shutdown for the web server that waits for webhook WORK, not sockets.
 *
 * The /webhook route acks Meta straight away and does the work afterwards: a
 * quiz answer, the next question, a class card, an enqueue. server.close()'s
 * callback fires when the sockets close, which is right after the ack — so a
 * drain that exits there cuts that work off mid-send. This module counts the
 * route's work and waits for it, bounded so the process always exits inside
 * Railway's draining window (30 s on the bot service).
 */

let active = 0;
const idleWaiters = new Set();

/** Register a piece of webhook work. Resolves/rejects exactly as `work` does. */
function trackWebhookWork(work) {
  active += 1;
  return Promise.resolve(work).finally(() => {
    active -= 1;
    if (active === 0) for (const wake of [...idleWaiters]) wake();
  });
}

function inFlightCount() {
  return active;
}

/** True once nothing is in flight; false if `timeoutMs` passes first. */
function waitForIdle(timeoutMs) {
  if (active === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer = null;
    const wake = () => { clearTimeout(timer); idleWaiters.delete(wake); resolve(true); };
    timer = setTimeout(() => { idleWaiters.delete(wake); resolve(false); }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    idleWaiters.add(wake);
  });
}

/**
 * Own SIGTERM/SIGINT for the web process.
 *
 * waitMs  — how long to wait for in-flight webhook work (default 20 s).
 * forceMs — hard backstop in case anything below hangs (default 25 s), still
 *           inside Railway's 30 s window.
 */
function installWebDrain({
  server,
  proc = process,
  log,
  exit = (code) => process.stdout.write('', () => process.exit(code)),
  waitMs = 20000,
  forceMs = 25000,
}) {
  let draining = false;
  const drain = async (signal) => {
    if (draining) return;
    draining = true;
    log(`🛑 ${signal} received — draining HTTP server`, { inFlight: active });
    const force = setTimeout(() => {
      log('⚠️ Web drain timeout — forcing exit', { inFlight: active });
      exit(0);
    }, forceMs);
    if (typeof force.unref === 'function') force.unref();

    server.close();
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();

    const idle = await waitForIdle(waitMs);
    clearTimeout(force);
    if (idle) {
      log('✅ HTTP server drained and webhook work finished, exiting');
    } else {
      log('⚠️ Webhook work still running at the drain deadline, exiting', { inFlight: active });
    }
    exit(0);
  };
  proc.on('SIGTERM', () => drain('SIGTERM'));
  proc.on('SIGINT', () => drain('SIGINT'));
  return drain;
}

module.exports = { trackWebhookWork, inFlightCount, waitForIdle, installWebDrain };
