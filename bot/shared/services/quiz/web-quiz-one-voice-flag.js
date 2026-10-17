'use strict';
/**
 * One voice per quiz: app_settings `web_quiz_one_voice` (default off).
 *
 * A library (video-bank) quiz carries the bank's own recordings of people for its questions and, for some,
 * its options and explanation; every other line of the quiz is the quiz voice (web-quiz-voice.js). Served
 * together, a child hears the voice change inside one question. On, every spoken line of a quiz is the quiz
 * voice: the recorded question, option and explanation clips are neither served (web-quiz-sound.js) nor
 * skipped at publish (web-quiz-publish.service.js), a quiz recorded before is recorded again, and the page
 * shows the words instead of reading them with the phone's own voice (wq.js, boot `one_voice`). A listen
 * item's sound to identify (`stim`) is the question's material and is still played.
 *
 * Only a real `true` (JSON true or the string "true") is on; an absent row, any other value and a failed
 * read are off. 30 s cache.
 */
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_one_voice';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* a plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** → true only when the switch reads a real true. `db`: a Supabase client (defaults to the bot's). Never throws. */
async function on({ db, now = Date.now() } = {}) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const client = db || require('../../config/supabase');
    const { data, error } = await client.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean(data) && isTrue(data.value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web-quiz: one-voice setting unreadable — the recorded clips play as before', { error: err && err.message });
    return false;
  }
}

/** The last reading, without asking (false before the first): for a caller that must name a clip's key at once. */
function current() { return Boolean(cache && cache.on); }

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

module.exports = { on, current, reset, isTrue, KEY, TTL_MS };
