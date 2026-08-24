'use strict';
/**
 * The budget governor (bd-1hae7.16).
 *
 * The operator's caps, enforced in code rather than trusted to good behaviour:
 * **$150/week**, **3 calls per caller per day**, an **80% alarm** to the
 * operator, and the 5-minute call cap (enforced in CallSession, which owns the
 * clock). At mini prices $150 buys roughly 600–1,200 five-minute calls a week —
 * so this cap is not there to ration the pilot, it is there to bound a bug or an
 * abusive caller.
 *
 * The load-bearing property is that it **fails CLOSED**. If the ledger cannot be
 * read we decline. An ungoverned call is precisely what the cap exists to
 * prevent, so "we could not check" can never mean "go ahead".
 */

// Per 1M audio tokens (2026-08). The mini is ~⅓ the rate of the full model.
const MODEL_RATES = {
  'gpt-realtime-2.1-mini': { inputPerM: 10, outputPerM: 20 },
  'gpt-realtime-2.1': { inputPerM: 32, outputPerM: 64 },
};
const FALLBACK_RATE = MODEL_RATES['gpt-realtime-2.1']; // never under-bill an unknown model

// Measured shape of a call: roughly 600 audio tokens/min heard from the caller,
// ~1,200/min spoken back (she talks more than she listens on a coaching call).
const INPUT_TOKENS_PER_MIN = 600;
const OUTPUT_TOKENS_PER_MIN = 1200;
// Transcription + post-call summary + embeddings, per call.
const FIXED_OVERHEAD_USD = 0.02;

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5, no DST

/**
 * Monday 00:00 Pakistan time, as a UTC instant — the weekly ledger boundary.
 * @param {Date} now
 * @returns {Date}
 */
function weekStartPkt(now) {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const dow = pkt.getUTCDay();               // 0=Sun … 1=Mon
  const daysSinceMonday = (dow + 6) % 7;     // Mon→0, Sun→6
  const midnightPkt = Date.UTC(
    pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate() - daysSinceMonday, 0, 0, 0, 0,
  );
  return new Date(midnightPkt - PKT_OFFSET_MS);
}

/**
 * Estimate what one call cost. Used to write `calls.cost_estimate`, which is
 * what the weekly ledger sums — so the cap is only ever as good as this.
 * @param {{durationSeconds?:number, model?:string}} opts
 * @returns {number} USD, rounded to 4dp for NUMERIC(8,4)
 */
function estimateCallCost({ durationSeconds, model } = {}) {
  const rate = MODEL_RATES[model] || FALLBACK_RATE;
  const seconds = Number.isFinite(Number(durationSeconds)) ? Math.max(0, Number(durationSeconds)) : 0;
  const minutes = seconds / 60;
  const inputCost = (minutes * INPUT_TOKENS_PER_MIN * rate.inputPerM) / 1e6;
  const outputCost = (minutes * OUTPUT_TOKENS_PER_MIN * rate.outputPerM) / 1e6;
  return Number((inputCost + outputCost + FIXED_OVERHEAD_USD).toFixed(4));
}

/**
 * @param {object} deps
 * @param {object} deps.ledger  { weeklySpendUsd(since), callsToday(from), onAlarm(info) }
 * @param {object} [deps.config]
 * @param {object} [deps.logger]
 */
function createBudgetGovernor({ ledger, config = {}, logger }) {
  const log = logger || { info: () => {}, warn: () => {}, error: () => {} };
  const weeklyBudgetUsd = config.weeklyBudgetUsd || 150;
  const perCallerDaily = config.perCallerDaily || 3;
  const alarmAtFraction = config.alarmAtFraction || 0.8;

  // The alarm is a heads-up, not a log line — once per week is the useful dose.
  let alarmedForWeek = null;

  async function check({ from, callId }) {
    const now = config.now ? config.now() : new Date();
    const weekStart = weekStartPkt(now);

    let spend;
    try {
      spend = await ledger.weeklySpendUsd(weekStart);
    } catch (err) {
      log.error('[calls] weekly ledger unreadable — declining (fail closed)', { callId, error: err.message });
      return { allowed: false, reason: 'ledger_unavailable' };
    }
    // null/undefined must NOT coerce to 0 — Number(null) is 0, and reading an
    // empty ledger as "nothing spent" is exactly the fail-open we are avoiding.
    if (spend === null || spend === undefined || !Number.isFinite(Number(spend))) {
      log.error('[calls] weekly spend is not a number — declining (fail closed)', { callId, spend });
      return { allowed: false, reason: 'ledger_unavailable' };
    }
    spend = Number(spend);

    // Alarm before the decision, so the operator hears about the week that hit
    // the cap on the very call that hit it.
    if (spend >= weeklyBudgetUsd * alarmAtFraction) {
      const weekKey = weekStart.toISOString();
      if (alarmedForWeek !== weekKey && ledger.onAlarm) {
        alarmedForWeek = weekKey;
        try {
          await ledger.onAlarm({
            spendUsd: spend, budgetUsd: weeklyBudgetUsd, weekStart: weekKey,
            fraction: spend / weeklyBudgetUsd,
          });
        } catch (err) {
          log.warn('[calls] budget alarm failed to send', { error: err.message });
        }
      }
    }

    if (spend >= weeklyBudgetUsd) {
      log.warn('[calls] weekly budget reached — declining', { callId, spend, weeklyBudgetUsd });
      return { allowed: false, reason: 'weekly_budget' };
    }

    let todayCount;
    try {
      todayCount = await ledger.callsToday(from);
    } catch (err) {
      log.error('[calls] per-caller ledger unreadable — declining (fail closed)', { callId, error: err.message });
      return { allowed: false, reason: 'ledger_unavailable' };
    }
    if (todayCount === null || todayCount === undefined || !Number.isFinite(Number(todayCount))) {
      return { allowed: false, reason: 'ledger_unavailable' };
    }

    if (Number(todayCount) >= perCallerDaily) {
      log.info('[calls] per-caller daily cap reached — declining', { callId, from, todayCount });
      return { allowed: false, reason: 'per_caller_daily' };
    }

    return { allowed: true, spendUsd: spend, callsToday: Number(todayCount) };
  }

  return { check };
}

module.exports = { createBudgetGovernor, estimateCallCost, weekStartPkt, MODEL_RATES };
