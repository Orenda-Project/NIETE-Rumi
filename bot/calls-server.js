'use strict';
/**
 * The `calls` Railway service — live WhatsApp voice calls (bd-1hae7.1).
 *
 * Same repo as the bot (shared modules, one deploy pipeline, zero dependency on
 * any external codebase) but a SEPARATE service, because:
 *   - media work must never destabilise the message bot;
 *   - a bot deploy must not drop a teacher mid-call;
 *   - the bot is free to scale replicas while this one stays single-replica
 *     (call sessions are in-process — see the replica guard below).
 *
 * It has no public webhook of its own. The bot receives Meta's webhook and
 * forwards `value.calls` here over Railway private networking with a shared
 * secret.
 *
 * Endpoints:
 *   GET  /                    health + live state (active calls, flag, budget)
 *   POST /internal/call-event  the bot's forward
 */

require('dotenv').config();
const express = require('express');

const { logToFile } = require('./shared/utils/logger');
const { isCallsEnabled, getCallsConfig } = require('./shared/calls/calls-config');
const { verifyForwardSecret } = require('./shared/calls/call-forwarder');
const CallEngine = require('./shared/calls/call-engine');
const CallSession = require('./shared/calls/call-session');
const RtcPeer = require('./shared/calls/rtc-peer');
const RealtimeClient = require('./shared/calls/realtime-client');
const callsApi = require('./shared/calls/graph-calls-api');

const logger = {
  info: (msg, meta) => logToFile(msg, meta),
  warn: (msg, meta) => logToFile(msg, meta),
  error: (msg, meta) => logToFile(msg, meta),
};

const config = getCallsConfig();

/**
 * Single-replica guard (RT-4). Call sessions live in this process's memory, so a
 * second replica would answer `terminate` events for calls it does not hold and
 * leave the real ones hanging. A Redis session registry is the precondition for
 * scaling this service; until then, refuse to serve calls rather than corrupt
 * them silently.
 */
function replicaGuardTripped() {
  const count = Number(process.env.RAILWAY_REPLICA_COUNT || process.env.CALLS_REPLICA_COUNT || 1);
  return Number.isFinite(count) && count > 1;
}

function buildEngine() {
  return new CallEngine({
    callsApi,
    logger,
    config: { maxConcurrent: config.maxConcurrent, drainGraceMs: config.drainGraceMs },
    createSession: (ctx) => new CallSession({
      ...ctx,
      callsApi,
      logger,
      createPeer: (peerCtx) => new RtcPeer({ ...peerCtx, logger }),
      createRealtime: ({ instructions, callbacks }) => new RealtimeClient({
        instructions,
        callbacks,
        apiKey: config.apiKey,
        model: config.model,
        voice: config.voice,
        vad: config.vad,
      }),
      // P1.2 (bd-1hae7.6) replaces this with the Tier-A connect context.
      buildInstructions: async () => 'You are the NIETE Teaching Assistant.',
      config: {
        maxSeconds: config.maxSeconds,
        wrapUpSeconds: config.wrapUpSeconds,
        silenceTimeoutMs: config.silenceTimeoutMs,
      },
    }),
  });
}

const engine = buildEngine();
const app = express();
app.use(express.json({ limit: '2mb' })); // SDP offers are a few KB

app.get('/', (req, res) => {
  res.status(200).json({
    service: 'niete-calls',
    status: 'ok',
    callsEnabled: isCallsEnabled(),
    replicaGuardTripped: replicaGuardTripped(),
    activeCalls: engine.activeCount,
    maxConcurrent: config.maxConcurrent,
    model: config.model,
    draining: engine.isDraining,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.post('/internal/call-event', async (req, res) => {
  if (!verifyForwardSecret(config.forwardSecret, req.get('x-calls-secret'))) {
    logToFile('[calls] rejected forward — bad or missing secret');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const { calls = [], contacts = [] } = req.body || {};

  // Answer the bot immediately; the handshake runs on its own.
  res.status(200).json({ received: calls.length });

  if (!isCallsEnabled()) {
    logToFile('[calls] CALLS_ENABLED is not "true" — declining', {
      events: calls.map((c) => `${c.event}:${c.id}`),
    });
    // Decline politely rather than let the caller ring out.
    for (const call of calls) {
      if (call.event === 'connect') {
        // eslint-disable-next-line no-await-in-loop
        await callsApi.reject(call.id).catch(() => undefined);
      }
    }
    return;
  }

  if (replicaGuardTripped()) {
    logToFile('[calls] REPLICA GUARD — more than one replica detected, calls disabled', {
      replicas: process.env.RAILWAY_REPLICA_COUNT,
    });
    for (const call of calls) {
      if (call.event === 'connect') {
        // eslint-disable-next-line no-await-in-loop
        await callsApi.reject(call.id).catch(() => undefined);
      }
    }
    return;
  }

  const nameByWaId = new Map(
    contacts.filter((c) => c && c.wa_id).map((c) => [c.wa_id, c.profile && c.profile.name]),
  );

  for (const call of calls) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await engine.handleEvent(call, { callerName: nameByWaId.get(call.from) });
    } catch (err) {
      logToFile('[calls] event handling threw', { callId: call.id, error: err.message });
    }
  }
});

const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
  logToFile('[calls] service listening', {
    port,
    callsEnabled: isCallsEnabled(),
    model: config.model,
    maxConcurrent: config.maxConcurrent,
    maxSeconds: config.maxSeconds,
  });
});

/**
 * Graceful drain: a deploy must not cut live calls dead. Stop admitting, let the
 * calls in flight finish (up to the grace window), then exit.
 */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logToFile('[calls] shutdown signal — draining', { signal, active: engine.activeCount });
  try {
    await engine.drain();
  } catch (err) {
    logToFile('[calls] drain error', { error: err.message });
  }
  server.close(() => process.exit(0));
  // Belt and braces: never hang a deploy on a stuck socket.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, engine };
