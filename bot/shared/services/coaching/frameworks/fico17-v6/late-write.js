'use strict';

/**
 * FICO6 fix-shadow (bd-qix9oh.241): a v6 shadow result that lands after the session's own write is still stored.
 *
 * Both shadow reads run beside the work the coach or the teacher waits for, and neither is waited on for long:
 *   - /observe2 (observe2/shadow-v6.js): the coach may finish the check before the read does. The check's hand-over
 *     lifts only what the form held then, so analysis_data.observe2.shadow_v6 was missing (e2e 154450, staging).
 *   - the DC (shadow.js): a reply slower than the grace is stored as status 'timeout' and the real one was dropped.
 * patchSession writes the late result into coaching_sessions.analysis_data afterwards, and only the one key it owns:
 *
 *   - every write is a read-modify-write guarded by the updated_at the read saw (the row's BEFORE UPDATE trigger moves
 *     it on every update, as observe-send's claim relies on), so a writer that got in between is never overwritten:
 *     the pass matches no row and the next pass reads again;
 *   - `place(analysis_data)` decides from what is stored now: { next } to write, { done } when it is already there,
 *     { wait } when the session is not ready for it yet, { stop } to leave it (a newer result is stored);
 *   - it is read back until it has been seen in place CONFIRMS times, so a whole-blob rewriter that read before the
 *     write and wrote after it is undone on the next pass.
 * Bounded: at most PASSES_MS.length reads (about four minutes in all), only for a result that came late. Never throws.
 */

const { isDeepStrictEqual } = require('util');
const supabase = require('../../../../config/supabase');
const { logToFile } = require('../../../../utils/logger');

const PASSES_MS = [0, 3000, 10000, 30000, 60000, 120000];
const CONFIRMS = 2;

// The test seam: the waits between passes.
const timing = { sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }) };

// As the row stores it: no undefined keys (jsonb drops them), so a stored copy compares equal.
const asStored = (blob) => JSON.parse(JSON.stringify(blob));

/**
 * @param {string} sessionId  coaching_sessions.id
 * @param {(analysis: object) => {next?: object, done?: true, wait?: true, stop?: string}} place
 * @param {{sleep?: Function, label?: string}} [opts]
 * @returns {Promise<{ok: boolean, written: boolean, why?: string}>}
 */
async function patchSession(sessionId, place, { sleep = (ms) => timing.sleep(ms), label = 'late shadow' } = {}) {
  let written = false;
  let seen = 0;
  try {
    for (const ms of PASSES_MS) {
      if (ms) await sleep(ms);
      const { data: row, error } = await supabase.from('coaching_sessions')
        .select('analysis_data, updated_at').eq('id', sessionId).maybeSingle();
      if (error) return fail(label, sessionId, error.message, written);
      if (!row) return fail(label, sessionId, 'no session', written);
      const step = place(row.analysis_data || {});
      if (step.stop) return { ok: false, written, why: step.stop };
      if (step.wait) continue;
      if (step.done) {
        seen += 1;
        if (seen >= CONFIRMS) return { ok: true, written };
        continue;
      }
      seen = 0;
      let q = supabase.from('coaching_sessions').update({ analysis_data: step.next }).eq('id', sessionId);
      q = row.updated_at ? q.eq('updated_at', row.updated_at) : q.is('updated_at', null);
      const { data: won, error: wErr } = await q.select('id');
      if (wErr) return fail(label, sessionId, wErr.message, written);
      if ((won || []).length) written = true;
    }
    if (seen) return { ok: true, written };
    logToFile(`[fico17-v6] ${label}: not in place after the last pass — it stays where it was stored first`, { sessionId, written }, 'warn');
    return { ok: false, written, why: 'not in place' };
  } catch (err) {
    return fail(label, sessionId, err.message, written);
  }
}

function fail(label, sessionId, error, written) {
  logToFile(`[fico17-v6] ${label}: session write failed`, { sessionId, error }, 'error');
  return { ok: false, written, why: error };
}

/**
 * /observe2: analysis_data.observe2.shadow_v6 = blob, once the check has handed this form's visit over (until then
 * the hand-over itself lifts it from the form). A newer read already in place is left as it is.
 */
function observe2ShadowV6(formId, blob) {
  const want = asStored(blob);
  return (analysis) => {
    const o = analysis.observe2;
    if (!o || o.form_id !== formId) return { wait: true };
    if (isDeepStrictEqual(o.shadow_v6, want)) return { done: true };
    if (o.shadow_v6 && o.shadow_v6.at && want.at && o.shadow_v6.at > want.at) return { stop: 'a newer shadow read is stored' };
    return { next: { ...analysis, observe2: { ...o, shadow_v6: want } } };
  };
}

/**
 * The DC: analysis_data.<shadow|dc>.fico17_v6 = blob in place of the 'timeout' blob the analysis wrote. Anything else
 * stored there (a re-analysis's own result) is newer, and stays.
 */
function dcFico17V6(key, timedOut, blob) {
  const want = asStored(blob);
  return (analysis) => {
    const cur = analysis[key] && analysis[key].fico17_v6;
    if (isDeepStrictEqual(cur, want)) return { done: true };
    if (cur && !(cur.status === 'timeout' && cur.at === timedOut.at)) return { stop: 'another v6 result is stored' };
    return { next: { ...analysis, [key]: { ...(analysis[key] || {}), fico17_v6: want } } };
  };
}

module.exports = { patchSession, observe2ShadowV6, dcFico17V6, timing, PASSES_MS, CONFIRMS };
