'use strict';
/**
 * The audit spine for live calls (bd-1hae7.11).
 *
 * Answers, for any call, after the fact:
 *   - what was said, by both sides            → calls.transcript
 *   - what she knew before she spoke          → calls.context_snapshot
 *   - what she pulled from the DB, and when   → call_trace
 *   - what it cost                            → calls.cost_estimate
 * and it is the same `cost_estimate` column the budget governor sums, so the
 * $150/week cap is only ever as honest as what gets written here.
 *
 * **Persistence never breaks a call.** Every writer swallows its error and
 * reports by return value. Losing an audit row is bad; dropping a teacher
 * mid-sentence because an INSERT failed is worse.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { estimateCallCost } = require('./budget-governor');

const PREVIEW_LIMIT = 1024; // matches the "first ~1KB" contract on call_trace

/** Open the row when the call connects. */
async function logCallStart({
  waCallId, from, callerName, userId, model, voice, contextSnapshot,
}) {
  try {
    const { error } = await supabase.from('calls').insert({
      wa_call_id: waCallId,
      caller_number: from,
      caller_name: callerName || null,
      user_id: userId || null,
      started_at: new Date().toISOString(),
      status: 'in_progress',
      model: model || null,
      voice: voice || null,
      context_snapshot: contextSnapshot || null,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    logToFile('[calls] logCallStart failed (call continues)', { waCallId, error: err.message });
    return false;
  }
}

/** Close the row: duration, status, final transcript, cost. */
async function logCallEnd({
  waCallId, durationSeconds, status, transcript, model, endedAt, voice,
}) {
  try {
    const patch = {
      ended_at: (endedAt || new Date()).toISOString ? (endedAt || new Date()).toISOString() : new Date().toISOString(),
      duration_seconds: Number.isFinite(Number(durationSeconds)) ? Number(durationSeconds) : null,
      status: status || 'completed',
      cost_estimate: estimateCallCost({ durationSeconds, model }),
    };
    if (transcript) patch.transcript = transcript;
    // Only when known. The row already carries the configured voice from
    // logCallStart; overwriting it with undefined would trade a stale value for
    // no value, which is worse.
    if (voice) patch.voice = voice;

    const { error } = await supabase.from('calls').update(patch).eq('wa_call_id', waCallId);
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    logToFile('[calls] logCallEnd failed', { waCallId, error: err.message });
    return false;
  }
}

/**
 * Rewrite the accumulated transcript as each line finalises. Chattier than a
 * single write at hangup, and deliberately so: a crashed process would otherwise
 * take the whole conversation with it. At 5 concurrent calls this is roughly one
 * small write per second.
 */
async function recordTranscript({ waCallId, transcript }) {
  try {
    const { error } = await supabase.from('calls')
      .update({ transcript })
      .eq('wa_call_id', waCallId);
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    logToFile('[calls] recordTranscript failed', { waCallId, error: err.message });
    return false;
  }
}

/**
 * One row per tool invocation — the "what did it pull from the DB" trail.
 * Safety-classifier findings ride the same table with kind='safety' rather than
 * earning a fifth table.
 */
async function recordTrace({
  waCallId, seq, kind, toolName, args, result, latencyMs,
}) {
  try {
    const text = result === undefined || result === null ? '' : String(result);
    const { error } = await supabase.from('call_trace').insert({
      wa_call_id: waCallId,
      seq,
      kind: kind || 'tool',
      tool_name: toolName || null,
      args_json: args || null,
      result_preview: text.slice(0, PREVIEW_LIMIT),
      result_bytes: text.length,
      latency_ms: Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : null,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    logToFile('[calls] recordTrace failed', { waCallId, seq, error: err.message });
    return false;
  }
}

/**
 * Total spend since the week boundary.
 *
 * ⚠ PRIMARY ONLY — this and `callsToday` are the ONLY reads in the calls stack
 * that stay off the production read replica along with `call_memory`
 * (bd-vrbk4.2). Both COUNT rows that `logCallStart` inserted moments earlier, so
 * on a replica they read a stale total: a caller redialling inside the
 * replication window walks straight through the per-caller daily limit, and this
 * function lets the weekly cap overshoot in dollars. The rest of the stack reads
 * the replica — see shared/config/supabase-replica.js.
 *
 * @returns {Promise<number|null>} null on ANY failure — the governor treats null
 *          as "unknown" and declines, which is the fail-closed behaviour we want.
 */
async function weeklySpendUsd(since) {
  try {
    const { data, error } = await supabase
      .from('calls')
      .select('cost_estimate')
      .gte('started_at', since.toISOString());
    if (error) throw new Error(error.message);
    return (data || []).reduce((sum, r) => sum + (Number(r.cost_estimate) || 0), 0);
  } catch (err) {
    logToFile('[calls] weeklySpendUsd failed', { error: err.message });
    return null;
  }
}

/**
 * How many calls this caller has already had today (PKT day boundary).
 * @returns {Promise<number|null>} null on failure → governor fails closed.
 */
async function callsToday(from) {
  try {
    const now = new Date();
    const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const midnightPkt = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate());
    const since = new Date(midnightPkt - 5 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('calls')
      .select('id')
      .eq('caller_number', from)
      .gte('started_at', since.toISOString());
    if (error) throw new Error(error.message);
    return (data || []).length;
  } catch (err) {
    logToFile('[calls] callsToday failed', { from, error: err.message });
    return null;
  }
}

module.exports = {
  logCallStart,
  logCallEnd,
  recordTranscript,
  recordTrace,
  weeklySpendUsd,
  callsToday,
};
