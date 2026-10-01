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
 * job has not started within LP_OUTCOME_ACK_FALLBACK_MS (default 30 s) the timer
 * claims it and sends the outcome on its own — the teacher is never left in silence —
 * and the job then sends a plain Step 2/5. Redis down → both claims succeed
 * (setNX fails open) → at worst the outcome is said twice, never lost.
 *
 * Scope: teacher self-serve sessions only (observation_type IS NULL). A coach
 * observation keeps the immediate ack — that path is owned elsewhere. A session
 * whose kind cannot be read is treated as NOT self-serve: send now, as before.
 *
 * Load: one keyed single-row read + one SET NX per LP outcome; one timer per
 * deferred outcome (unref'd, 30 s).
 */

const { logToFile } = require('../../../utils/logger');
const { getCoachingMessage } = require('../../../config/coaching-messages');

const DEFERRABLE_KEYS = new Set(['lessonPlan_linked', 'lessonPlan_skip', 'lessonPlan_received']);
const CLAIM_TTL_SECONDS = 60 * 60;
const DEFAULT_FALLBACK_MS = 30 * 1000;
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

/** Whoever wins this says the outcome line. Fails OPEN (true) without Redis. */
async function claimOutcome(sessionId, who) {
  try {
    const redis = require('../../cache/railway-redis.service');
    return (await redis.setNX(claimKey(sessionId), who, CLAIM_TTL_SECONDS)) !== false;
  } catch (_) {
    return true;
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

  const timer = setTimeout(async () => {
    try {
      if (await claimOutcome(sessionId, 'fallback')) {
        await sendMessage(from, text);
        logToFile('⏱️ LP outcome sent on its own — the analysis had not started in time', { sessionId, messageKey });
      }
    } catch (err) {
      logToFile('❌ LP outcome fallback send failed', { sessionId, messageKey, error: err.message }, 'error');
    }
  }, fallbackMs());
  if (timer && typeof timer.unref === 'function') timer.unref();

  logToFile('📎 LP outcome deferred onto Step 2/5', { sessionId, messageKey });
  return { lpOutcomeKey: messageKey };
}

/**
 * Analysis-job side. The outcome line that opens Step 2/5, or null (no key, an
 * unknown key, or the fallback already said it).
 */
async function leadForStep2(sessionId, payload, language) {
  const key = payload && payload.lpOutcomeKey;
  if (!key || !DEFERRABLE_KEYS.has(key)) return null;
  if (!(await claimOutcome(sessionId, 'step2'))) {
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
