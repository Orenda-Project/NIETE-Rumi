'use strict';
/**
 * The report's delivery path on the recommendation row — bd-gzfdu9 R7p-b (COS 20261026T044621 §1–3).
 *
 * recordReportPath(): once the hero (or the PDF) has gone, the session's video_recommendations row records how —
 * report_via: 'image' (the full image), 'slim' (v10 C/D), 'template' (window closed: share_dc_report_v1), 'pdf' — on
 * EVERY row, shown, shadow or none, so the A/B reads exposure per path from a table. image_strip = true when the image
 * that went carried the strip, on any path (on the template path no clip message follows, so markSent never runs).
 *
 * `row` is the engine's own promise (row | null, never rejects in production): null (flag off, engine refused, write
 * failed) → nothing is read or written. report_via is V1.7.9: the key is sent only when the column exists — probed
 * once per process and cached, or VIDEO_RECO_REPORT_VIA=1 — so a database without V1.7.9 still gets image_strip.
 * image_strip is never written false (the engine's row starts false; markSent writes the same value). Never throws.
 */
const { logToFile } = require('../../../utils/logger');

const TABLE = 'video_recommendations';
const PATHS = new Set(['image', 'slim', 'template', 'pdf']);
const MISSING = new Set(['42703', 'PGRST204']); // Postgres "undefined column"; PostgREST "column not in the schema cache"

let probed = null;

function hasColumn(supabase) {
  if (String(process.env.VIDEO_RECO_REPORT_VIA || '').trim() === '1') return Promise.resolve(true);
  if (!probed) {
    probed = Promise.resolve(supabase.from(TABLE).select('report_via').limit(1))
      .then(({ error }) => !(error && (MISSING.has(String(error.code)) || /report_via/.test(String(error.message || '')))))
      .catch(() => false);
  }
  return probed;
}

async function recordReportPath({ coachingSessionId, row, reportVia, imageStrip = false, deps = {} } = {}) {
  try {
    const r = await row;
    const sessionId = (r && r.coaching_session_id) || null;
    if (!sessionId || (coachingSessionId && sessionId !== coachingSessionId)) return false;
    const supabase = deps.supabase || require('../../../config/supabase');
    const patch = {};
    if (PATHS.has(reportVia) && await hasColumn(supabase)) patch.report_via = reportVia;
    if (imageStrip) patch.image_strip = true;
    if (!Object.keys(patch).length) return false;
    const { error } = await supabase.from(TABLE).update(patch).eq('coaching_session_id', sessionId);
    if (error) throw error;
    return true;
  } catch (err) {
    logToFile('[video-reco] report path not recorded (non-fatal)', { coachingSessionId, error: err && err.message }, 'warn');
    return false;
  }
}

module.exports = { recordReportPath, PATHS };
