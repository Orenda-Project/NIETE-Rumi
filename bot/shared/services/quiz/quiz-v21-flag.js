'use strict';
/**
 * app_settings `quiz_slo_retest_enabled` (bd-v0toag.9/.10): one switch for the v21 quiz changes —
 * SLO codes on questions, the day-3 retest, the "who helped?" tap and the completion tile.
 * Default OFF: no row, a false value or a failed read all mean off. Read at most once a minute,
 * the same way web-quiz-library-flag reads `web_quiz_library`.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const FLAG_KEY = 'quiz_slo_retest_enabled';
const FLAG_TTL_MS = 60 * 1000;

let flag = null;
async function v21On() {
  if (flag && Date.now() - flag.at < FLAG_TTL_MS) return flag.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [FLAG_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === FLAG_KEY);
    const v = row && row.value;
    flag = { at: Date.now(), on: v === true || v === 'true' || Boolean(v && v.enabled === true) };
  } catch (e) {
    logToFile(`⚠️ ${FLAG_KEY}: settings lookup failed — v21 quiz changes off`, { error: e.message });
    flag = { at: Date.now(), on: false };
  }
  return flag.on;
}

module.exports = { v21On, FLAG_KEY, _reset: () => { flag = null; } };
