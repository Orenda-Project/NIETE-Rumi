'use strict';
/**
 * The Urdu class-name digits switch for the child quiz page.
 *
 * app_settings web_quiz_ur_class_digits (default off, JSON `true` only, fail closed, 30 s cache): when on, the quiz
 * payload carries `ur_class_digits: true` and the page draws the class's name with Urdu digits on an Urdu page
 * («جماعتیں ۱، ۳، ۵», like the score beside it). The server's label stays Latin (the teacher's report shares it).
 * Off, the key is absent from the payload and every page is today's. English pages never change either way.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_ur_class_digits';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

// JSON true only: a string 'true' row is off, like every child-page switch
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
        logToFile('⚠️ web quiz ur class digits: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

/** The switch, waited for (page payloads). Never throws. */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  return refresh();
}

/** What a page payload carries: `true` when on, else null (the caller leaves the key out). */
async function field() {
  return (await flag()) ? true : null;
}

module.exports = { flag, field, KEY, _reset: () => { cache = null; reading = null; } };
