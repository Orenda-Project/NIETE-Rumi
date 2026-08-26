'use strict';
/**
 * Live-calls flag + runtime config (bd-1hae7.4).
 *
 * The flag follows this repo's live convention — `=== 'true'`, the same shape as
 * LP_FIDELITY_ENABLED — deliberately NOT a presence gate. A Railway env that
 * still carries `CALLS_ENABLED=false` from a rollback must keep calls OFF; a
 * presence gate would turn them on and nobody would notice until a teacher rang.
 *
 * Everything is read at call time, never captured at import, so flipping a var
 * and restarting is the whole deploy story.
 *
 * The defaults ARE the operator's decisions (2026-08-23): mini for v1, 5 lines,
 * a 5-minute cap with a warm wrap-up at 4:30, $150/week, 3 calls per caller
 * per day.
 */

const DEFAULTS = {
  model: 'gpt-realtime-2.1-mini',
  voice: 'marin',
  // server_vad @ 5ms silence — the snappier, more interruptible turn-taking the
  // Noor tuning uses (override with CALLS_VAD / CALLS_VAD_SILENCE_MS).
  vad: 'server_vad',
  maxConcurrent: 5,
  maxSeconds: 300,
  wrapUpSeconds: 270,
  weeklyBudgetUsd: 150,
  perCallerDaily: 3,
  drainGraceMs: 60000,
  silenceTimeoutMs: 60000,
};

/** Parse a positive number from the env, falling back on anything unusable. */
function num(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Calls are OFF unless explicitly, unambiguously enabled. */
function isCallsEnabled() {
  return process.env.CALLS_ENABLED === 'true';
}

function getCallsConfig() {
  const maxSeconds = num('CALLS_MAX_SECONDS', DEFAULTS.maxSeconds);
  let wrapUpSeconds = num('CALLS_WRAPUP_SECONDS', DEFAULTS.wrapUpSeconds);
  // A wrap-up at or past the hard cap would never fire — clamp it to 90% so the
  // caller always gets a goodbye instead of a mid-sentence hangup.
  if (wrapUpSeconds >= maxSeconds) wrapUpSeconds = Math.floor(maxSeconds * 0.9);

  return {
    model: process.env.OPENAI_REALTIME_MODEL || DEFAULTS.model,
    voice: process.env.OPENAI_REALTIME_VOICE || DEFAULTS.voice,
    vad: process.env.CALLS_VAD || DEFAULTS.vad,
    apiKey: process.env.OPENAI_REALTIME_API_KEY || process.env.OPENAI_API_KEY || '',

    maxConcurrent: num('CALLS_MAX_CONCURRENT', DEFAULTS.maxConcurrent),
    maxSeconds,
    wrapUpSeconds,
    silenceTimeoutMs: num('CALLS_SILENCE_TIMEOUT_MS', DEFAULTS.silenceTimeoutMs),
    drainGraceMs: num('CALLS_DRAIN_GRACE_MS', DEFAULTS.drainGraceMs),

    weeklyBudgetUsd: num('CALLS_WEEKLY_BUDGET_USD', DEFAULTS.weeklyBudgetUsd),
    perCallerDaily: num('CALLS_PER_CALLER_DAILY', DEFAULTS.perCallerDaily),

    forwardSecret: process.env.CALLS_FORWARD_SECRET || '',
    serviceUrl: process.env.CALLS_SERVICE_URL || '',
  };
}

module.exports = { isCallsEnabled, getCallsConfig, DEFAULTS };
