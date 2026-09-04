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
  // server_vad — snappier, more interruptible turn-taking (the Noor tuning).
  //
  // KNOWN TRADE-OFF, recorded so it is not rediscovered on a bad call: the value
  // this replaced was `semantic_vad`, chosen because teachers ring us from NOISY
  // CLASSROOMS. server_vad is an energy threshold, so classroom noise is exactly
  // what it is worst at — it can hold her turn open under chatter, or trip on a
  // burst. semantic_vad judges whether a THOUGHT finished, which is more robust
  // to noise but slower.
  //
  // We ship server_vad for the latency win and keep the escape hatch one env var
  // wide: set CALLS_VAD=semantic_vad to go straight back, and tune the turn-end
  // window with CALLS_VAD_SILENCE_MS (see realtime-client.js — we ship 500 ms,
  // NOT the 5 ms the Noor tuning uses).
  vad: 'server_vad',

  // Voice engine (bd-oxu2q). 'openai' = the native realtime voice, which is what
  // every call has run on to date. 'uplift' = OpenAI reasons and emits TEXT and
  // Uplift speaks it, which is markedly more natural in Urdu.
  //
  // The DEFAULT IS DELIBERATELY 'openai'. Uplift is opt-in per environment via
  // VOICE_PROVIDER, so turning it on is a decision someone makes for one
  // deployment at a time rather than something a deploy does to every call at
  // once. (The upstream implementation defaulted to 'uplift'; we do not.)
  // Selection is also not final: if Uplift is selected but cannot connect, that
  // CALL falls back to the OpenAI voice — see call-session.
  voiceProvider: 'openai',
  upliftVoiceId: 'v_meklc281',                 // Urdu female; override per env
  upliftWsUrl: 'wss://api.upliftai.org/text-to-speech/multi-stream',

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

    // Voice engine (see DEFAULTS). Uplift is used only when selected AND a key
    // is present; the session then decides per-call and falls back to the OpenAI
    // voice if the TTS socket is not ready in time.
    voiceProvider: String(process.env.VOICE_PROVIDER || DEFAULTS.voiceProvider).toLowerCase(),
    uplift: {
      apiKey: process.env.UPLIFT_API_KEY || '',
      voiceId: process.env.UPLIFT_VOICE_ID || DEFAULTS.upliftVoiceId,
      wsUrl: process.env.UPLIFT_WS_URL || DEFAULTS.upliftWsUrl,
    },
  };
}

module.exports = { isCallsEnabled, getCallsConfig, DEFAULTS };
