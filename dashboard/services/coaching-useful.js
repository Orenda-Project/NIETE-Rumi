'use strict';
/**
 * "Was this coaching report useful to you?" on group C and D's report page — v10 coaching test, bd-v0toag.49.
 *
 * The page's half of the survey A and B get on WhatsApp (bot/shared/services/coaching/coaching-feedback.service.js):
 * the same columns, so the four groups compare. coaching_quality_metrics.user_satisfaction_rating is a binary
 * thumb in an INTEGER column (1 = 👍, 0 = 👎), never points out of five; the 👎 reason goes in user_feedback.
 *
 * The group is read here rather than through the bot's ab-v10-arms, whose logger needs pino (not installed in
 * the portal). Same rule: null unless ab_v10_enabled is on and the teacher's school is drawn; a read error is null.
 */

const REASON_MAX = 1000;
const GROUPS = new Set(['A', 'B', 'C', 'D']);

function isOn(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* keep the raw string */ }
  }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** The teacher's group letter while the test is on, else null. Never throws. */
async function groupOf(supabase, userId) {
  try {
    if (!userId) return null;
    const { data: flag } = await supabase.from('app_settings').select('value').eq('key', 'ab_v10_enabled').maybeSingle();
    if (!flag || !isOn(flag.value)) return null;
    const { data: user } = await supabase.from('users').select('school_id').eq('id', userId).maybeSingle();
    if (!user || !user.school_id) return null;
    const { data: row } = await supabase.from('niete_coaching_ab_assignment').select('ab_group')
      .eq('school_id', user.school_id).maybeSingle();
    return row && GROUPS.has(row.ab_group) ? row.ab_group : null;
  } catch (_) {
    return null;
  }
}

/**
 * Store a thumb ({ useful: true|false }) or a reason ({ reason }) on the session's metrics row, creating it if
 * missing. Only for the teacher's own session. Returns true when written. Never throws.
 */
async function recordUseful(supabase, { sessionId, userId, useful, reason }) {
  try {
    const patch = {};
    if (typeof useful === 'boolean') patch.user_satisfaction_rating = useful ? 1 : 0;
    if (typeof reason === 'string' && reason.trim()) patch.user_feedback = reason.trim().slice(0, REASON_MAX);
    if (!Object.keys(patch).length) return false;
    const { data: own } = await supabase.from('coaching_sessions').select('id')
      .eq('id', sessionId).eq('user_id', userId).maybeSingle();
    if (!own) return false;
    // limit(1), not maybeSingle(): two rows made maybeSingle error into a third insert (bd-v0toag.80).
    const { data: existing, error: readError } = await supabase.from('coaching_quality_metrics').select('id')
      .eq('coaching_session_id', sessionId).limit(1);
    if (readError) return false;
    const { error } = existing && existing.length
      ? await supabase.from('coaching_quality_metrics').update(patch).eq('coaching_session_id', sessionId)
      : await supabase.from('coaching_quality_metrics')
        .insert({ coaching_session_id: sessionId, created_at: new Date().toISOString(), ...patch });
    return !error;
  } catch (_) {
    return false;
  }
}

module.exports = { groupOf, recordUseful, REASON_MAX };
