'use strict';
/**
 * The portal's retry and warm touch (app_settings web_quiz_edge_warm, default off, fail off, 30 s cache). Only the
 * stored JSON boolean true turns it on.
 *
 * It rides the one learner's answer (GET /api/internal/wq/edge, web-quiz-edge-learn.js): with edge learn on, the answer
 * adds `edge_warm: true`, and each ask also touches the hub's one switch read so those switches stay warm on this bot
 * between children (a portal process asks every minute). The portal then, on a streamed child page whose bot answer
 * failed (unreachable, timed out, or a 5xx other than the switch-off 503), asks again itself twice under its early
 * frame before today's way (dashboard/routes/web-quiz.routes.js). Off, any other value or a failed read: nothing added.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_edge_warm';
const FIELD = 'edge_warm';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

/** The switch, waited for. Never throws. */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean(data) && data.value === true };
  } catch (err) {
    logToFile('⚠️ web quiz edge warm: settings lookup failed — off', { error: err.message });
    cache = { at: now, on: false };
  }
  return cache.on;
}

/** For the learner's answer: `{edge_warm: true}` after the warm touch while on, `{}` while off. Never throws. */
async function field() {
  if (!(await flag())) return {};
  await require('./web-quiz-hub-flags').flags().catch(() => null);
  return { [FIELD]: true };
}

module.exports = { flag, field, KEY, FIELD, TTL_MS, _reset: () => { cache = null; } };
