'use strict';
/**
 * The two switches for Urdu word help (bd-0q8b4x), read from app_settings,
 * cached a minute, failing CLOSED (a failed read is off):
 *   quiz_word_help      JSON true → English lesson quizzes are written with word help and the page shows it
 *   quiz_word_help_lot  JSON true → the page shows it to half the class links only (quiz-word-help armOf)
 * Only JSON true is on; strings and anything else are off (quiz/CLAUDE.md "Never").
 */
const { logToFile } = require('../../utils/logger');

const KEYS = ['quiz_word_help', 'quiz_word_help_lot'];
const TTL_MS = 60 * 1000;
let cache = null;

/** @returns {Promise<{on:boolean, lot:boolean}>} */
async function readFlag({ now = Date.now(), client = null } = {}) {
  if (cache && now - cache.at < TTL_MS) return cache.v;
  try {
    const db = client || require('../../config/supabase');
    const { data, error } = await db.from('app_settings').select('key, value').in('key', KEYS);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const val = (k) => ((data || []).find((r) => r.key === k) || {}).value === true;
    cache = { at: now, v: { on: val(KEYS[0]), lot: val(KEYS[1]) } };
  } catch (err) {
    logToFile('⚠️ quiz word help: settings lookup failed — off', { error: err.message });
    cache = { at: now, v: { on: false, lot: false } };
  }
  return cache.v;
}

function resetCache() { cache = null; }

module.exports = { readFlag, resetCache, KEYS };
