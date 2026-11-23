'use strict';
/**
 * Bot reader for the per-programme lesson-plan WhatsApp switches (rules: config/lp-whatsapp-programmes.js).
 *
 * Fail closed to TODAY: no row, a malformed value, a failed settings read, no user, or a failed read of her programme
 * all answer "not off", so WhatsApp keeps sending exactly as before. The list is cached per key for
 * APP_SETTINGS_FLAG_TTL_MS (30 s), a failed read for at most 5 s; her programme is read only when the list is not
 * empty, so with the switches absent this costs one cached settings read and nothing else.
 */
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { APP_SETTINGS_FLAG_TTL_MS } = require('../config/app-settings-ttl');
const { isGbTeacher } = require('./lp-own-gb');
const {
  LP_WHATSAPP_PDF_OFF_KEY, LP_WHATSAPP_SURVEY_OFF_KEY, parseProgrammeList,
} = require('../config/lp-whatsapp-programmes');

const FAILURE_TTL_MS = 5000;
const teacherRef = (id) => { try { return id ? require('./quiz/web-quiz-kid').tk(id) : null; } catch (_) { return null; } };
const cache = new Map(); // key → { at, ttl, list }

/** The programmes a switch lists ([] = today). Never throws. */
async function lpWhatsappOffProgrammes(key) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < hit.ttl) return hit.list;
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    const list = data ? parseProgrammeList(data.value) : [];
    cache.set(key, { at: now, ttl: APP_SETTINGS_FLAG_TTL_MS, list });
    return list;
  } catch (err) {
    logToFile('⚠️ lp WhatsApp switch read failed — treating as today', { key, error: err && err.message }, 'warn');
    cache.set(key, { at: now, ttl: Math.min(FAILURE_TTL_MS, APP_SETTINGS_FLAG_TTL_MS), list: [] });
    return [];
  }
}

/** Her programme, 'gb' or 'ict'; null when it could not be read. */
async function programmeOf(userId) {
  try {
    return (await isGbTeacher(supabase, userId)) ? 'gb' : 'ict';
  } catch (err) {
    logToFile('⚠️ lp WhatsApp switch: programme read failed — treating as today', { tk: teacherRef(userId), error: err && err.message }, 'warn');
    return null;
  }
}

/** Is this switch on for her programme? false (today) on anything uncertain. */
async function isOffFor(key, userId) {
  if (typeof userId !== 'string' || !userId) return false;
  const list = await lpWhatsappOffProgrammes(key);
  if (!list.length) return false;
  const programme = await programmeOf(userId);
  return programme !== null && list.includes(programme);
}

const isLpWhatsappPdfOffFor = (userId) => isOffFor(LP_WHATSAPP_PDF_OFF_KEY, userId);
const isLpWhatsappSurveyOffFor = (userId) => isOffFor(LP_WHATSAPP_SURVEY_OFF_KEY, userId);

module.exports = {
  LP_WHATSAPP_PDF_OFF_KEY,
  LP_WHATSAPP_SURVEY_OFF_KEY,
  lpWhatsappOffProgrammes,
  programmeOf,
  isLpWhatsappPdfOffFor,
  isLpWhatsappSurveyOffFor,
};
