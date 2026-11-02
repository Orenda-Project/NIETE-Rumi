'use strict';
/**
 * The "Watch the clip" button on the closed-window report template — bd-22gf7p (VIDREC R8), COS ruling 20261031T144349 §2.
 *
 * The operator (31 Oct): the teachers whose WhatsApp window was closed got the report as share_dc_report_v1 (IMAGE header,
 * no buttons), so the clip had no link: "for those moving forward (not retrospectively) can we fix it?". With
 * VIDEO_RECO_CLIP_TEMPLATE set (the approved template's name on this WABA, e.g. share_dc_report_clip_v1), a window-closed
 * report whose session row is 'shown' goes as that template instead: the same header and body, plus a URL button
 * `<PORTAL_URL>/v/{{1}}` whose parameter is the /v token (link-token.js, surface 'wa').
 *
 * forRow(): { template, token } for a row, or null — the engine off, the env unset, a row that is not 'shown' (control arm
 * = shadow, none, a teacher who stopped the clips), or no token (INTERNAL_API_KEY / SUPABASE_URL missing). Sync, pure on
 * env. buttonFor(): the same for the engine's promise, waited for at most the strip's cap; the env is read FIRST, so with
 * it unset nothing is waited for and nothing is read (today's timing). Never throws.
 */
const { logToFile } = require('../../../utils/logger');

function forRow(row, deps = {}) {
  try {
    const flags = deps.flags || require('./flags'); // eslint-disable-line global-require
    if (flags.videoRecoEnabled() !== true) return null;
    const template = typeof flags.videoRecoClipTemplate === 'function' ? flags.videoRecoClipTemplate() : null;
    if (!template) return null;
    if (!row || row.status !== 'shown' || !row.id || !row.user_id) return null;
    const sign = deps.sign || require('./link-token').signVideoLink; // eslint-disable-line global-require
    const token = sign({ recommendationId: row.id, userId: row.user_id, surface: 'wa' });
    return token ? { template, token } : null;
  } catch (err) {
    logToFile('[video-reco] clip button skipped (non-fatal)', { error: err && err.message }, 'warn');
    return null;
  }
}

/** The env is on and named: worth waiting for the row at all. */
function configured(deps = {}) {
  try {
    const flags = deps.flags || require('./flags'); // eslint-disable-line global-require
    return flags.videoRecoEnabled() === true && typeof flags.videoRecoClipTemplate === 'function' && !!flags.videoRecoClipTemplate();
  } catch (_) {
    return false;
  }
}

async function buttonFor({ row: given, capMs, coachingSessionId, deps = {} } = {}) {
  try {
    if (!configured(deps)) return null;
    let row;
    if (given !== undefined && given !== null && typeof given.then !== 'function') row = given;
    else if (given) {
      let wait = capMs;
      if (wait === undefined) {
        try { wait = require('./strip').stripWaitMs(); } catch (_) { wait = 0; } // eslint-disable-line global-require
      }
      let timer;
      row = await Promise.race([Promise.resolve(given), new Promise((r) => { timer = setTimeout(() => r(null), Math.max(0, Number(wait) || 0)); })]);
      clearTimeout(timer);
    }
    return forRow(row, deps);
  } catch (err) {
    logToFile('[video-reco] clip button skipped (non-fatal)', { coachingSessionId, error: err && err.message }, 'warn');
    return null;
  }
}

module.exports = { forRow, buttonFor, configured };
