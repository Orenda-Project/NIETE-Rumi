'use strict';
/**
 * app_settings `web_quiz_library`: the video library on the web quiz (web-quiz-library.js) and the
 * lesson page's Download button. Read at most once a minute; fails closed. Its own module so
 * web-quiz.service can ask without requiring the library (which requires it back).
 *
 * app_settings `web_quiz_videos_v3` (default off; on only for the JSON true): the library lists the
 * child's language, sorts chapters by their numbers and gives each chapter its art. The same one read
 * answers both switches; a failed read is off for both.
 *
 * app_settings `web_quiz_videos_ur_titles` (default off; on only for the JSON true): the library carries each lesson's
 * Urdu-script name and its chapter's (student_videos.title_ur / chapter_ur) as title_ur / name_ur. Same one read.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const FLAG_KEY = 'web_quiz_library';
const VIDEOS_V3_KEY = 'web_quiz_videos_v3';
const UR_TITLES_KEY = 'web_quiz_videos_ur_titles';
const FLAG_TTL_MS = 60 * 1000;

let flag = null;
async function read() {
  if (flag && Date.now() - flag.at < FLAG_TTL_MS) return flag;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [FLAG_KEY, VIDEOS_V3_KEY, UR_TITLES_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === FLAG_KEY);
    const v = row && row.value;
    const v3 = (data || []).find((r) => r.key === VIDEOS_V3_KEY);
    const ur = (data || []).find((r) => r.key === UR_TITLES_KEY);
    flag = { at: Date.now(), on: v === true || v === 'true' || Boolean(v && v.enabled === true), v3: Boolean(v3 && v3.value === true), ur: Boolean(ur && ur.value === true) };
  } catch (e) {
    logToFile('⚠️ web-quiz library: settings lookup failed — library off', { error: e.message });
    flag = { at: Date.now(), on: false, v3: false, ur: false };
  }
  return flag;
}

async function libraryOn() { return (await read()).on; }
async function videosV3On() { return (await read()).v3; }
async function urTitlesOn() { return (await read()).ur; }

module.exports = { libraryOn, videosV3On, urTitlesOn, FLAG_KEY, VIDEOS_V3_KEY, UR_TITLES_KEY, _reset: () => { flag = null; } };
