'use strict';
/**
 * bd-fmf24g.10 — keep the hero report's narrative.
 *
 * The narrative (headline, identity, moments, strength, horizon, the per-section "why" lines) is
 * generated when the report is RENDERED, for the WhatsApp image. narrative.service's header has
 * always said it is "stored at analysis_data.report_narrative"; nothing stored it, so the teacher
 * app's report page — which reads the session, not the image — could not show any of it.
 *
 * Stored at analysis_data.report_narrative (an existing JSONB: no new column), exactly what the
 * renderer used, plus `generated_at`. Read-merge-write, because analysis_data is rewritten whole
 * elsewhere (the voice-debrief script is persisted the same way) and every other key must survive.
 *
 * NON-FATAL: she already has her report; losing the record costs the app page a section, never
 * her report. A failure is logged at warn (a degraded path, not a terminal one).
 */

const { logToFile } = require('../../../utils/logger');

/** Has something a page could show. A hollow object must never replace a stored narrative. */
function hasContent(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return false;
  return Boolean(n.affirmation || n.identity || n.strength_name || n.horizon_title
    || (Array.isArray(n.moments) && n.moments.length));
}

/**
 * @param {string} sessionId coaching_sessions.id
 * @param {object|null} narrative what generateReportNarrative returned
 * @param {{supabase?: object, log?: Function, now?: () => Date}} [deps]
 * @returns {Promise<boolean>} true when written
 */
async function persistReportNarrative(sessionId, narrative, deps = {}) {
  if (!sessionId || !hasContent(narrative)) return false;
  const supabase = deps.supabase || require('../../../config/supabase');
  const log = deps.log || logToFile;
  const now = deps.now || (() => new Date());
  try {
    const { data: row, error } = await supabase
      .from('coaching_sessions').select('analysis_data').eq('id', sessionId).single();
    if (error || !row) throw new Error(`read failed: ${error && error.message}`);
    const merged = {
      ...(row.analysis_data || {}),
      report_narrative: { ...narrative, generated_at: now().toISOString() },
    };
    const { error: upErr } = await supabase
      .from('coaching_sessions').update({ analysis_data: merged }).eq('id', sessionId);
    if (upErr) throw new Error(`write failed: ${upErr.message}`);
    return true;
  } catch (err) {
    log('⚠️ report narrative not stored (non-fatal) — the app report page will omit it', {
      coachingSessionId: sessionId, error: err.message,
    }, 'warn');
    return false;
  }
}

module.exports = { persistReportNarrative, hasContent };
