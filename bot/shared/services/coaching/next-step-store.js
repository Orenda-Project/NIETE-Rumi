'use strict';
/**
 * bd-v0toag.1.5 — store the report's ONE next step as its focus_area.
 *
 * Voice calls and the PDFKit fallback read analysis_data.focus_area; when the
 * report coached a different step, the stored focus named a third thing nobody
 * saw. Read-merge-write (as narrative-store does), because analysis_data is
 * rewritten whole elsewhere and every other key must survive.
 *
 * NON-FATAL: the report already carries the step; a failure is logged at warn.
 */

const { logToFile } = require('../../utils/logger');

/**
 * @param {string} sessionId coaching_sessions.id
 * @param {object|null} patch what next-step.focusPatch returned
 * @param {{supabase?: object, log?: Function}} [deps]
 * @returns {Promise<boolean>} true when written
 */
async function persistNextStepFocus(sessionId, patch, deps = {}) {
  if (!sessionId || !patch) return false;
  const supabase = deps.supabase || require('../../config/supabase');
  const log = deps.log || logToFile;
  try {
    const { data: row, error } = await supabase
      .from('coaching_sessions').select('analysis_data').eq('id', sessionId).single();
    if (error || !row) throw new Error(`read failed: ${error && error.message}`);
    const merged = { ...(row.analysis_data || {}), ...patch };
    const { error: upErr } = await supabase
      .from('coaching_sessions').update({ analysis_data: merged }).eq('id', sessionId);
    if (upErr) throw new Error(`write failed: ${upErr.message}`);
    return true;
  } catch (err) {
    log('⚠️ [next-step] stored focus not aligned (non-fatal)', {
      coachingSessionId: sessionId, error: err.message,
    }, 'warn');
    return false;
  }
}

module.exports = { persistNextStepFocus };
