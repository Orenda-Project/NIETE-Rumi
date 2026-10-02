'use strict';
/**
 * Meta bill cut NC3 (N2-C02 / N1-08) — the lesson-plan outcome rides on Step 2/5.
 *
 * On a teacher's own Digital Coach session the LP step ends with an outcome line
 * ("✅ Lesson plan linked!…", "No problem! I'll analyze…without the lesson plan.",
 * "📄 Lesson plan received!…") and, seconds later, the analysis job's
 * "🔄 Step 2/5: Analyzing your teaching…". Two billed bubbles; one would do.
 *
 * The two lines come from different processes — the webhook and the SQS
 * analysis job — so:
 *   webhook  `deferOrSendLpOutcome` puts the outcome KEY in the analysis payload
 *            (`lpOutcomeKey`) instead of sending it, and arms a fallback timer;
 *   job      `leadForStep2` opens Step 2/5 with the outcome line.
 * ONE Redis claim (`coaching:lp_outcome_ack:<sid>`) decides who says it. If the
 * job has not started within LP_OUTCOME_ACK_FALLBACK_MS (default 20 s) the timer
 * claims it and sends the outcome on its own — the teacher is never left in silence —
 * and the job then sends a plain Step 2/5.
 *
 * "typing…" while the job is on its way (FX1, bd-w2daa.22). The webhook request
 * now ends having sent nothing, and the typing fix (inbound-typing.js, bd-0wrn4)
 * cancels "typing…" when a request ends silently — so the teacher saw the automatic
 * 👍 and then nothing until Step 2/5. A deferral therefore calls answerLater():
 * "typing…" goes up at once, BEFORE the job is queued (it cannot land after Step
 * 2/5), and outlives the request. WhatsApp keeps it ~25 s; the fallback at 20 s
 * lands inside that, so there is no silent gap even on the slow path.
 * Why 20 s: niete-logs production, 14 days to 1 Oct 2026, 3,723 LP picks paired
 * with their analysis start ("LP linked…"/"LP selection: none" → "🔄 Starting
 * pedagogical analysis", emitter `time`): p50 1.2 s, p95 4.8 s, p99 10.2 s;
 * 99.5% within 20 s and still 99.5% within 30 s — the 20→30 s window merged
 * nothing measurable, while it left the teacher without "typing…" for 3–5 s.
 *
 * Said ONCE, Redis or not (FX4, bd-w2daa.26). setNX fails open, so with Redis down both claims
 * used to "win" and the outcome was said twice. Now:
 *   - Redis unavailable at the deferral → nothing is deferred: the line is sent now, as before NC3;
 *   - the fallback claims only on a READABLE Redis; unavailable when it fires → it stays silent and
 *     Step 2/5 says the line (the job fails open), so it is still said, once;
 *   - the timer is kept per session in this process: cleared when Step 2/5 has claimed the line here,
 *     and replaced (not doubled) by a second deferral for the same session. In another process the
 *     timer still fires once and its claim refuses — one Redis SET NX, no send.
 * Residual: Redis readable at 20 s but failing when the job claims (fails open) → said twice.
 *
 * Scope: teacher self-serve sessions only (observation_type IS NULL). A coach
 * observation keeps the immediate ack — that path is owned elsewhere. A session
 * whose kind cannot be read is treated as NOT self-serve: send now, as before.
 *
 * Load: one keyed single-row read + one SET NX per LP outcome; one timer per
 * deferred outcome (unref'd, 20 s); one typing POST per deferral (free).
 */

const { logToFile } = require('../../../utils/logger');
const { getCoachingMessage } = require('../../../config/coaching-messages');

const DEFERRABLE_KEYS = new Set(['lessonPlan_linked', 'lessonPlan_skip', 'lessonPlan_received']);
const CLAIM_TTL_SECONDS = 60 * 60;
const DEFAULT_FALLBACK_MS = 20 * 1000;
const claimKey = (sessionId) => `coaching:lp_outcome_ack:${sessionId}`;

function fallbackMs() {
  const n = Number(process.env.LP_OUTCOME_ACK_FALLBACK_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FALLBACK_MS;
}

/** True only for a teacher's own Digital Coach session we could actually read. */
async function isSelfServeSession(sessionId) {
  try {
    const supabase = require('../../../config/supabase');
    const { data } = await supabase
      .from('coaching_sessions')
      .select('id, observation_type')
      .eq('id', sessionId)
      .maybeSingle();
    return !!(data && data.id && !data.observation_type);
  } catch (err) {
    logToFile('⚠️ LP outcome: session kind unreadable — sending the ack now', { sessionId, error: err.message }, 'warn');
    return false;
  }
}

function redisReadable() {
  try {
    const redis = require('../../cache/railway-redis.service');
    return typeof redis.isAvailable !== 'function' || redis.isAvailable() === true;
  } catch (_) {
    return false;
  }
}

/**
 * Whoever wins this says the outcome line. `failOpen`: the answer when Redis cannot be read —
 * true for Step 2/5 (never lose the line), false for the fallback (Step 2/5 will say it).
 */
async function claimOutcome(sessionId, who, { failOpen = true } = {}) {
  if (!redisReadable()) return failOpen;
  try {
    const redis = require('../../cache/railway-redis.service');
    return (await redis.setNX(claimKey(sessionId), who, CLAIM_TTL_SECONDS)) !== false;
  } catch (_) {
    return failOpen;
  }
}

// sessionId → the fallback timer armed in THIS process.
const fallbackTimers = new Map();

function clearFallback(sessionId) {
  const timer = fallbackTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    fallbackTimers.delete(sessionId);
  }
}

/**
 * Webhook side. Sends the outcome now (coach observation, unknown key, unreadable
 * session) or defers it onto Step 2/5 and returns the payload extras to merge
 * into the analysis job.
 *
 * @param {{ sessionId: string, from: string, messageKey: string, language: string,
 *           sendMessage: (to: string, text: string) => Promise<any>, text?: string }} args
 *   `text` — the caller's own rendering of `messageKey` (a handler with an
 *   injected catalog); defaults to the coaching catalog.
 * @returns {Promise<{ lpOutcomeKey?: string }>}
 */
async function deferOrSendLpOutcome({ sessionId, from, messageKey, language, sendMessage, text: rendered }) {
  const text = rendered || getCoachingMessage(messageKey, language);
  if (!DEFERRABLE_KEYS.has(messageKey) || !(await isSelfServeSession(sessionId))) {
    await sendMessage(from, text);
    return {};
  }

  if (!redisReadable()) {
    // No claim can be made, so deferring could only say it twice: say it now, once.
    logToFile('📎 LP outcome sent now — Redis unavailable, nothing deferred', { sessionId, messageKey });
    await sendMessage(from, text);
    return {};
  }

  clearFallback(sessionId);
  const timer = setTimeout(async () => {
    fallbackTimers.delete(sessionId);
    try {
      if (await claimOutcome(sessionId, 'fallback', { failOpen: false })) {
        await sendMessage(from, text);
        logToFile('⏱️ LP outcome sent on its own — the analysis had not started in time', { sessionId, messageKey });
      }
    } catch (err) {
      logToFile('❌ LP outcome fallback send failed', { sessionId, messageKey, error: err.message }, 'error');
    }
  }, fallbackMs());
  if (timer && typeof timer.unref === 'function') timer.unref();
  fallbackTimers.set(sessionId, timer);

  // Before the caller queues the job (see the header): typing up now, kept past the request.
  const typing = await require('../../inbound-typing').answerLater();
  logToFile('📎 LP outcome deferred onto Step 2/5', { sessionId, messageKey, typing });
  return { lpOutcomeKey: messageKey };
}

/**
 * Analysis-job side. The outcome line that opens Step 2/5, or null (no key, an
 * unknown key, or the fallback already said it).
 */
async function leadForStep2(sessionId, payload, language) {
  const key = payload && payload.lpOutcomeKey;
  if (!key || !DEFERRABLE_KEYS.has(key)) return null;
  const claimed = await claimOutcome(sessionId, 'step2');
  if (claimed) clearFallback(sessionId);   // said here — a timer in this process has nothing left to do
  if (!claimed) {
    logToFile('🔕 LP outcome already said by the fallback — plain Step 2/5', { sessionId, messageKey: key });
    return null;
  }
  return getCoachingMessage(key, language);
}

module.exports = {
  deferOrSendLpOutcome,
  leadForStep2,
  isSelfServeSession,
  DEFERRABLE_KEYS,
  DEFAULT_FALLBACK_MS,
  claimKey,
};
