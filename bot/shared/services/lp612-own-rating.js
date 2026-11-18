'use strict';
/**
 * bd-snkn32.11 (queue #134 C) — her rating of her own plan: "how good was this plan?" 1-5 and, optionally, "what was
 * confusing?" (max 300 chars). Saved on her own plan's row (V1.10.3: teacher_rating, teacher_confusing,
 * teacher_rated_at), matched by id AND her user id AND ready, so a shelf plan someone else opened, or a plan still
 * being made, is never rated through it (not_found). A second rating replaces the first.
 *
 * Not lp_feedback: its yes/no "useful" is the ready-made plans' survey and feeds the daily plan-quality panel.
 * Never throws: bad_request | not_found | error | saved.
 */
const TABLE = 'niete_lp612_own_plans';
const NOTE_MAX = 300;

/** { rating, confusing } from what the portal sent, or null when the rating is not a whole number 1-5. */
function parseRating(body) {
  const b = body || {};
  const n = typeof b.rating === 'string' && /^\s*\d\s*$/.test(b.rating) ? Number(b.rating) : b.rating;
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  const note = typeof b.confusing === 'string' ? b.confusing.trim().slice(0, NOTE_MAX) : '';
  return { rating: n, confusing: note || null };
}

function createOwnRating({ from, now = () => new Date().toISOString(), log = () => {} }) {
  async function rate(ownId, userId, body) {
    const r = parseRating(body);
    if (!r || !ownId || !userId) return { outcome: 'bad_request' };
    const at = now();
    const { data, error } = await from(TABLE)
      .update({ teacher_rating: r.rating, teacher_confusing: r.confusing, teacher_rated_at: at, updated_at: at })
      .eq('id', ownId).eq('user_id', userId).eq('status', 'ready')
      .select('id');
    if (error) {
      log('LP own rating: not saved', { ownId, error: error.message });
      return { outcome: 'error' };
    }
    return { outcome: Array.isArray(data) && data.length ? 'saved' : 'not_found' };
  }
  return { rate };
}

let live = null;
function liveRating() {
  if (!live) {
    const supabase = require('../config/supabase');
    const { logToFile } = require('../utils/logger');
    live = createOwnRating({ from: (t) => supabase.from(t), log: (m, x) => logToFile(m, x) });
  }
  return live;
}

module.exports = {
  createOwnRating, parseRating, NOTE_MAX,
  rate: (ownId, userId, body) => liveRating().rate(ownId, userId, body).catch(() => ({ outcome: 'error' })),
};
