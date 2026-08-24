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
const { buildCallPrompt } = require('./shared/calls/call-prompt.service');
const { buildCallContext } = require('./shared/calls/call-context.service');
const contextDeps = require('./shared/calls/call-context.repo');
const { createCallTools } = require('./shared/calls/call-tools.service');
const toolsRepo = require('./shared/calls/call-tools.repo');
const callLog = require('./shared/calls/call-log.service');
const { createBudgetGovernor } = require('./shared/calls/budget-governor');
const WhatsAppService = require('./shared/services/whatsapp.service');
const { resolveUx } = require('./shared/config/ux-strings');

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

/**
 * The admission gate: $150/week, 3 calls per caller per day, 80% alarm to the
 * operator. Fails CLOSED — an unreadable ledger declines the call.
 */
const governor = createBudgetGovernor({
  logger,
  config: {
    weeklyBudgetUsd: config.weeklyBudgetUsd,
    perCallerDaily: config.perCallerDaily,
  },
  ledger: {
    weeklySpendUsd: callLog.weeklySpendUsd,
    callsToday: callLog.callsToday,
    onAlarm: async ({ spendUsd, budgetUsd, fraction }) => {
      const operator = process.env.OPERATOR_WHATSAPP || '923365709413';
      const pct = Math.round(fraction * 100);
      await WhatsAppService.sendMessage(operator,
        `NIETE calls: ${pct}% of the weekly calling budget used `
        + `($${spendUsd.toFixed(2)} of $${budgetUsd}). New calls are declined at 100%.`);
    },
  },
});

/** The language a declined caller should be answered in — never block on it. */
async function callerLanguage(from) {
  try {
    const user = await contextDeps.fetchUser(from);
    return (user && user.preferred_language) || 'ur';
  } catch (_) {
    return 'ur';
  }
}

const OVERFLOW_KEY = {
  busy: 'callBusyOverflow',
  weekly_budget: 'callBudgetOverflow',
  per_caller_daily: 'callDailyLimitOverflow',
};

function buildEngine() {
  return new CallEngine({
    callsApi,
    logger,
    gate: ({ from, callId }) => governor.check({ from, callId }),
    config: { maxConcurrent: config.maxConcurrent, drainGraceMs: config.drainGraceMs },

    /**
     * A declined call gets a WhatsApp message, so she is never left wondering
     * why the phone did not answer. Best-effort: the engine has already
     * rejected by the time we get here.
     */
    onBusy: async ({ from, reason }) => {
      const key = OVERFLOW_KEY[reason];
      if (!key || !from) return;
      const language = await callerLanguage(from);
      await WhatsAppService.sendMessage(from, resolveUx(key, { language }));
    },

    /** Close the audit row when the call ends. */
    onCallEnd: async ({ waCallId, durationSeconds, status, transcript }) => {
      await callLog.logCallEnd({
        waCallId, durationSeconds, status, transcript, model: config.model,
      });
    },

    createSession: (ctx) => {
      let traceSeq = 0;
      // Resolved during buildInstructions, so the tools are scoped to the caller
      // we actually identified — never to a number we could not resolve.
      let tools = null;

      const session = new CallSession({
        ...ctx,
        callsApi,
        logger,
        createPeer: (peerCtx) => new RtcPeer({ ...peerCtx, logger }),
        createRealtime: ({ instructions, callbacks }) => new RealtimeClient({
          instructions,
          apiKey: config.apiKey,
          model: config.model,
          voice: config.voice,
          vad: config.vad,
          tools: tools ? tools.definitions : undefined,
          callbacks: {
            ...callbacks,
            // The model can keep talking while this runs; a preamble covers the
            // gap. Any failure comes back as a speakable line, never a throw.
            onToolCall: (name, args) => (tools
              ? tools.invoke(name, args)
              : Promise.resolve('That lookup is not available on this call.')),
          },
        }),
        // Tier-A connect context + persona (bd-1hae7.5/.6). Each context block
        // soft-fails on its own; a total failure still yields a working persona,
        // because a call that knows nothing beats a call that never connects.
        buildInstructions: async ({ from, callId, callerName }) => {
          const { block, language, role, userId, known, snapshot } = await buildCallContext({
            from, deps: contextDeps,
          });

          // Scope the tools to THIS caller. With no resolved user they decline
          // rather than query unscoped (the privacy invariant, tested first).
          tools = createCallTools({
            callerUserId: userId,
            callerNumber: from,
            repo: toolsRepo,
            logger,
            onTrace: ({ toolName, args, result, latencyMs }) => {
              traceSeq += 1;
              callLog.recordTrace({
                waCallId: callId, seq: traceSeq, kind: 'tool',
                toolName, args, result, latencyMs,
              }).catch(() => undefined);
            },
          });

          const instructions = buildCallPrompt({ language, role, contextBlock: block, callerName });

          logToFile('[calls] context assembled', {
            callId, userId, known, blocks: snapshot.blocks, failures: snapshot.failures,
            chars: block.length,
          });

          // Open the audit row with the EXACT instructions the model will run —
          // this is what makes "what did she know?" answerable afterwards.
          await callLog.logCallStart({
            waCallId: callId, from, callerName, userId,
            model: config.model, voice: config.voice,
            contextSnapshot: { instructions, ...snapshot },
          });
          return instructions;
        },
        hooks: {
          // Rewrite the transcript as each line finalises, so a crash cannot
          // take the whole conversation with it.
          onTranscriptLine: () => {
            callLog.recordTranscript({
              waCallId: ctx.callId, transcript: session.getTranscript(),
            }).catch(() => undefined);
          },
          onLatency: ({ latencyMs }) => {
            traceSeq += 1;
            callLog.recordTrace({
              waCallId: ctx.callId, seq: traceSeq, kind: 'latency', latencyMs,
            }).catch(() => undefined);
          },
          onTrace: ({ toolName, args, result, latencyMs }) => {
            traceSeq += 1;
            callLog.recordTrace({
              waCallId: ctx.callId, seq: traceSeq, kind: 'tool', toolName, args, result, latencyMs,
            }).catch(() => undefined);
          },
        },
        config: {
          maxSeconds: config.maxSeconds,
          wrapUpSeconds: config.wrapUpSeconds,
          silenceTimeoutMs: config.silenceTimeoutMs,
        },
      });
      return session;
    },
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
