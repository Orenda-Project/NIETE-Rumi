'use strict';
/**
 * A wordless first paint (app_settings web_quiz_plain_paint, default off, fail off, 30 s cache).
 *
 * The fast first page (web_quiz_fast) sends a page's head before the bot answers. When the edge only guesses that head
 * (a class quiz its process has not seen; a child's home from a link with no ?lang=), today's guess is English. On:
 * the quiz and hub answers that say `fast: true` also say `plain_paint: true`, and the edge's guessed head then says no
 * words in any language (the brand's name as the title, an empty opening line, the language left to its fix line).
 * Off: the key is absent, so every answer and every page is today's, byte for byte. Only the stored JSON boolean true
 * turns it on: the string 'true', '"true"', 'yes', 1, {enabled:true}, no row or a failed read are all off.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-one-face.js's shape), so the
 * switch adds no database round trip to a child's page. It is looked at only for an answer that says `fast: true` (an
 * answer without it gets no early head, so there is nothing to make plain): with web_quiz_fast off it is never read.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_plain_paint';
const FIELD = 'plain_paint';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

/** Only the JSON boolean the flip writes (app_settings.value is jsonb). */
function isTrue(value) {
  return value === true;
}

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        cache = { at: Date.now(), on: isTrue(data && data.value) };
      } catch (err) {
        logToFile('⚠️ web quiz plain paint: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

/** The switch, never waited for: the cached value, refreshed in the background when stale. Never throws. */
function on(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) refresh().catch(() => {});
  return Boolean(cache && cache.on && now - cache.at < 2 * TTL_MS);
}

/** The switch, waited for (tests). */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  return refresh();
}

/**
 * A page answer with the switch's field: `plain_paint: true` only when the answer says `fast: true` (web_quiz_fast on)
 * and this switch is on; nothing added otherwise, and the switch is not looked at for an answer without `fast: true`.
 */
function carry(answerP) {
  return Promise.resolve(answerP).then((out) => (out && typeof out === 'object' && !Array.isArray(out) && out.fast === true && on() ? Object.assign(out, { [FIELD]: true }) : out));
}

/**
 * The hub's answer: the same field, from the hub's one switch read (web-quiz-hub-flags.js carries this key), so a
 * child's home makes no settings read of its own for it. The hub's flags() has run by the time its answer resolves.
 */
function carryHub(answerP) {
  return Promise.resolve(answerP).then((out) => (out && typeof out === 'object' && !Array.isArray(out) && out.fast === true && require('./web-quiz-hub-flags').plainPaintNow() ? Object.assign(out, { [FIELD]: true }) : out));
}

module.exports = { on, flag, carry, carryHub, KEY, FIELD, TTL_MS, _reset: () => { cache = null; reading = null; } };
