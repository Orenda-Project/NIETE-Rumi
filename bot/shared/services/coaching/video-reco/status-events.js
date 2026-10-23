'use strict';
/**
 * Delivered / read / failed for the "watch this clip" message — bd-gzfdu9 (VIDREC), r-ab ab/EVENTS_SCHEMA.md §2.
 *
 * Called by the bot's status webhook (whatsapp-bot.js handleBroadcastStatusWebhook) for every delivered, read and
 * failed status. When the flag is on, the status's wamid is looked up on video_recommendations (partial index on
 * wamid); a hit becomes a video_reco_events row: delivered | read | send_failed (+ Meta's code), at Meta's own
 * timestamp. This works whether or not the v10 report tracker is logging (red-team H10). A repeat hits the
 * first-only unique index and is a no-op. Flag off: nothing is read. Never throws.
 */
const { logToFile } = require('../../../utils/logger');

const EVENT = { delivered: 'delivered', read: 'read', failed: 'send_failed' };

function enabledByDefault() {
  try {
    return require('./flags').videoRecoEnabled() === true;
  } catch (_) {
    return false;
  }
}

/** → true when an event row was written. */
async function recordStatus(status, deps = {}) {
  try {
    const event = status && EVENT[status.status];
    if (!event || !status.id) return false;
    const on = typeof deps.enabled === 'function' ? deps.enabled() : enabledByDefault();
    if (!on) return false;
    const db = deps.supabase || require('../../../config/supabase');
    const { data: rec } = await db.from('video_recommendations').select('id').eq('wamid', status.id).maybeSingle();
    if (!rec || !rec.id) return false;
    const seconds = Number.parseInt(status.timestamp, 10);
    const row = {
      recommendation_id: rec.id,
      event,
      surface: 'wa',
      created_at: Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString(),
    };
    const code = event === 'send_failed' ? status.errors && status.errors[0] && status.errors[0].code : null;
    if (code != null) row.code = String(code);
    const { error } = await db.from('video_reco_events').insert(row);
    if (error) {
      if (error.code !== '23505') logToFile('[video-reco] status event not stored (non-fatal)', { recommendationId: rec.id, event, error: error.message }, 'warn');
      return false;
    }
    return true;
  } catch (err) {
    logToFile('[video-reco] status event failed (non-fatal)', { error: err.message }, 'warn');
    return false;
  }
}

module.exports = { recordStatus };
