'use strict';
/**
 * app_settings `web_quiz_invite_ask`: the challenge on the score card asked as "who can beat your score?", with
 * three "who" tiles, under "Share to class group" (dashboard/public/wq/wq.js askPanel). Values: 'on' (or true)
 * shows it to every class child's card; 'split' lets each phone pick its arm from its own device key, so the
 * lift can be measured against today's button; anything else, a missing row or a failed read is 'off'.
 * Read at most every 30 s.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const FLAG_KEY = 'web_quiz_invite_ask';
const TTL_MS = 30 * 1000;
let cache = null; // { at, mode }

function modeOf(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* a plain string */ } }
  if (v === true) return 'on';
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'on' || s === 'true') return 'on';
    if (s === 'split') return 'split';
  }
  return 'off';
}

async function mode(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.mode;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', FLAG_KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, mode: modeOf(data && data.value) };
  } catch (e) {
    logToFile('⚠️ web-quiz invite ask: settings lookup failed — off', { error: e.message });
    cache = { at: now, mode: 'off' };
  }
  return cache.mode;
}

module.exports = { mode, modeOf, FLAG_KEY, _reset: () => { cache = null; } };
