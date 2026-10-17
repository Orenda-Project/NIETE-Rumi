'use strict';
/**
 * The returning child's home in the family's language (app_settings `web_quiz_return_lang`). The WhatsApp /quiz reply
 * already speaks the language the bot resolved (the child's newest quiz, else the family's own); on, the hub link
 * carries it as `l` (as the join link does) and the hub falls back to it when the child has no quiz yet, before
 * English. Off: the link and the page are today's. 30 s cache; fails closed (a read error is off).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_return_lang';
const TTL_MS = 30 * 1000;
let cache = null;

/** Only the JSON boolean the flip writes turns the switch on (app_settings.value is jsonb); the string 'true' is off. */
function isTrue(value) {
  return value === true;
}

async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: isTrue(((data || [])[0] || {}).value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web quiz return language: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** A language a hub link may carry: en or ur, else null. */
function linkLang(lang) {
  return lang === 'en' || lang === 'ur' ? lang : null;
}

module.exports = { on, linkLang, KEY, _resetCache: () => { cache = null; } };
