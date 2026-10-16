#!/usr/bin/env node
'use strict';
/**
 * The direct ping's plan, counts only: what a run WOULD do now, without doing any of it.
 *
 *   node scripts/sample-ping-dry-run.js
 *
 * Calls the ping service's dryRun({now}) (read-only; it works with the switch web_quiz_sample_ping off) and prints ONE
 * JSON object on one line: the frame, the exclusions by reason, eligible, would send after the caps, classes touched,
 * max per class, the cost at the utility and the marketing rate, the switch on/off and whether the operator's go
 * token is present. Never an id, a phone, a hash or a name: only numbers, booleans and short plain words pass (a
 * value that looks like an id, a phone or a hash is dropped, and so is any list). Never calls send(); writes nothing.
 * The cost is the service's own (usd_utility, usd_marketing) when it gives one, else would-send × RATE here.
 * Exit 0 with the counts; exit 1 with {"error":"<word>"} when the dry run fails or says it failed. Never throws.
 */

const RATE_DEFAULT = Object.freeze({ utility: 0.015, marketing: 0.0473 });
const KEY_RX = /^[a-z][a-z0-9_]{0,47}$/;
const WORD_RX = /^[a-z0-9][a-z0-9_.-]{0,23}$/i;
const UNSAFE_KEY_RX = /phone|tomb|name|ukey|kid|hash|_id$|^id$|ids$/i;
const UNSAFE_VALUE_RX = /[0-9a-f]{8}-[0-9a-f]{4}|[0-9a-f]{12,}|\d{7,}/i;
const WOULD_SEND_KEYS = ['would_send_n', 'would_send', 'wouldSend'];

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** A dry run's answer → the counts only (one level of nesting kept for grouped counts). */
function countsOnly(value, depth = 0) {
  const out = {};
  for (const [k, v] of Object.entries(value || {})) {
    if (!KEY_RX.test(k) || UNSAFE_KEY_RX.test(k)) continue;
    if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = round6(v); continue; }
    if (typeof v === 'boolean') { out[k] = v; continue; }
    if (typeof v === 'string') { if (WORD_RX.test(v) && !UNSAFE_VALUE_RX.test(v)) out[k] = v; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v) && depth === 0) {
      const inner = countsOnly(v, depth + 1);
      if (Object.keys(inner).length) out[k] = inner;
    }
  }
  return out;
}

/** The ping service, required only when it is needed (the script does nothing else at load). */
function loadService() {
  return require('../shared/services/quiz/web-quiz-sample-ping');
}

/**
 * Run the dry run once and print its counts. → the exit code (0 printed, 1 failed).
 * @param {{now?: Date, Service?: object, out?: {write: Function}}} [opts]
 */
async function main({ now = new Date(), Service = null, out = process.stdout } = {}) {
  let line;
  let code = 0;
  try {
    const svc = Service || loadService();
    const plan = await svc.dryRun({ now });
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('no plan');
    if (plan.error) {                                       // the service's own refusal word (e.g. read_failed)
      out.write(`${JSON.stringify({ error: typeof plan.error === 'string' && /^[a-z_]{1,32}$/.test(plan.error) ? plan.error : 'dry_run_failed' })}\n`);
      return 1;
    }
    const counts = countsOnly(plan);
    const rate = { ...RATE_DEFAULT, ...(svc.RATE && typeof svc.RATE === 'object' ? svc.RATE : {}) };
    const wouldKey = WOULD_SEND_KEYS.find((k) => Number.isFinite(counts[k]));
    if (wouldKey && !('usd_utility' in counts) && !('usd_marketing' in counts)) {
      counts.cost_usd_utility = round6(counts[wouldKey] * Number(rate.utility));
      counts.cost_usd_marketing = round6(counts[wouldKey] * Number(rate.marketing));
    }
    line = JSON.stringify(counts);
  } catch (_) {
    line = JSON.stringify({ error: 'dry_run_failed' });   // the error text may hold an id: never printed
    code = 1;
  }
  out.write(`${line}\n`);
  return code;
}

module.exports = { main, countsOnly };

if (require.main === module) {
  main().then((code) => {
    // the service's clients (database, cache) may hold the event loop open: leave once stdout has flushed
    process.stdout.write('', () => process.exit(code));
  });
}
