'use strict';
/**
 * app_settings `web_quiz_library`: the video library on the web quiz (web-quiz-library.js) and the
 * lesson page's Download button. Read at most once a minute; fails closed. Its own module so
 * web-quiz.service can ask without requiring the library (which requires it back).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const FLAG_KEY = 'web_quiz_library';
const FLAG_TTL_MS = 60 * 1000;

let flag = null;
async function libraryOn() {
  if (flag && Date.now() - flag.at < FLAG_TTL_MS) return flag.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [FLAG_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === FLAG_KEY);
    const v = row && row.value;
    flag = { at: Date.now(), on: v === true || v === 'true' || Boolean(v && v.enabled === true) };
  } catch (e) {
    logToFile('⚠️ web-quiz library: settings lookup failed — library off', { error: e.message });
    flag = { at: Date.now(), on: false };
  }
  return flag.on;
}

module.exports = { libraryOn, FLAG_KEY, _reset: () => { flag = null; } };
