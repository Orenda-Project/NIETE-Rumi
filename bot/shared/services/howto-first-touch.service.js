'use strict';
/**
 * bd-ik5e8j.5 (queue #85) — THE FIRST-TOUCH HOW-TO FILM. The operator, 11 Nov 2026: "the first time each user messages
 * NIETE after this goes live, send Film 1 once ('This is how you use NIETE' in Urdu), then handle their message as
 * usual."
 *
 * Who: a REGISTERED TEACHER on the teacher app (the same people the one-tap app link reaches: users.role teacher,
 * registration-status isRegistered, portal_teacher_v2 read with the portal's rule) whom the switch covers. Film 1
 * shows the teacher screens and /menu's link, which coaches and principals do not get, so it is never sent to them,
 * nor to unregistered numbers or children's handsets (StudentIngress answers those before the door).
 *
 *   howto_first_touch        app_settings: true, "teachers", or a JSON list of users.id. Anything else, no row, or a
 *                            failed read is OFF.
 *   howto_first_touch_video  app_settings: {"ur": "https://….mp4", "en": "https://….mp4"} — the film per language
 *                            (a missing en falls back to ur). No https URL → nothing is sent and nothing is claimed,
 *                            so she gets the film once a URL is set.
 *
 * Once per person: a `user_feature_first_use` row, feature 'howto_film_1', CLAIMED before the send with the table's
 * unique (user_id, feature) key (ON CONFLICT DO NOTHING), so two quick messages, or two replicas, send it once. A send
 * that fails keeps the claim (no second try): a duplicate film is worse than a missed one, and the film stays in More →
 * How to use.
 *
 * Never in her way: the caller awaits maybeSend, which never throws and gives up waiting after SEND_TIMEOUT_MS, so the
 * film normally lands before her answer and a slow Meta call can hold her message up by at most that long, once in her
 * life. Every failure is logged at error level with the request's correlation id.
 */

const FEATURE = 'howto_film_1';
const SWITCH_KEY = 'howto_first_touch';
const VIDEO_KEY = 'howto_first_touch_video';
const TEACHER_APP_KEY = 'portal_teacher_v2';
const SEND_TIMEOUT_MS = 4000;
const MEMO_MAX = 50000;

const { isTeachersValue, isTeacherRole } = require('./teacher-audience');
const { isRegistered } = require('../utils/registration-status');

function parseValue(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* keep the raw string */ }
  }
  return v;
}

function isOn(value) {
  const v = parseValue(value);
  if (v === true) return true;
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

function listHas(value, userId) {
  const v = parseValue(value);
  return Array.isArray(v) && Boolean(userId) && v.some((id) => typeof id === 'string' && id === String(userId));
}

/** Is she on the teacher app? The portal's rule (dashboard/lib/feature-flags.js isFlagEnabledForUser), from her row. */
function onTeacherApp(appValue, user) {
  if (listHas(appValue, user.id) || isOn(appValue)) return true;
  return isTeachersValue(appValue) && isTeacherRole(user.role);
}

/** Does the switch cover her? Off unless she is a registered teacher on the teacher app AND the switch names her. */
function covers(values, user) {
  if (!user || !user.id) return 'no_account';
  const sw = values.get(SWITCH_KEY);
  if (!listHas(sw, user.id) && !isOn(sw) && !isTeachersValue(sw)) return 'switch_off';
  if (!isTeacherRole(user.role)) return 'not_a_teacher';
  if (!isRegistered(user)) return 'not_registered';
  if (!onTeacherApp(values.get(TEACHER_APP_KEY), user)) return 'not_on_teacher_app';
  return null;
}

const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u);

/** The film for her language: en when she reads English and an en film exists, else ur. Null without an https URL. */
function filmUrl(value, lang) {
  const v = parseValue(value);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (lang === 'en' && isHttps(v.en)) return { url: v.en, lang: 'en' };
  if (isHttps(v.ur)) return { url: v.ur, lang: 'ur' };
  return null;
}

function defaultDeps() {
  const supabase = require('../config/supabase');
  const { logToFile, logError } = require('../utils/logger');
  return {
    readSettings: async (keys) => {
      const { data, error } = await supabase.from('app_settings').select('key,value').in('key', keys);
      if (error) throw new Error(error.message || 'app_settings read failed');
      return new Map((data || []).map((r) => [r.key, r.value]));
    },
    readFirstUse: async (userId) => {
      const { data, error } = await supabase.from('user_feature_first_use').select('id')
        .eq('user_id', userId).eq('feature', FEATURE).maybeSingle();
      if (error) throw new Error(error.message || 'user_feature_first_use read failed');
      return Boolean(data);
    },
    claim: async (userId) => {
      const { data, error } = await supabase.from('user_feature_first_use')
        .upsert({ user_id: userId, feature: FEATURE, video_shown_at: new Date().toISOString() },
          { onConflict: 'user_id,feature', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(error.message || 'user_feature_first_use claim failed');
      return Array.isArray(data) && data.length === 1;
    },
    sendVideo: (to, url, caption) => require('./whatsapp.service').sendVideoByLink(to, url, caption),
    getLanguage: (userId) => require('../utils/language-cache').getUserLanguage(userId),
    caption: (lang) => require('../config/ux-strings').resolveUx('howtoFirstTouchCaption', { language: lang }),
    log: (msg, meta) => logToFile(msg, meta),
    logError: (msg, meta) => logError(msg, meta),
    // The one switch-cache TTL where the tier has it (sandbox, staging); main has no app-settings-ttl.js yet: 30 s there.
    ttlMs: (() => {
      try { return require('../config/app-settings-ttl').APP_SETTINGS_FLAG_TTL_MS; } catch (_) { return 30000; }
    })(),
    sendTimeoutMs: SEND_TIMEOUT_MS,
  };
}

function createHowtoFirstTouch(injected = {}) {
  const deps = { ...(Object.keys(injected).length ? {} : defaultDeps()), ...injected };
  const ttlMs = Number.isFinite(deps.ttlMs) ? deps.ttlMs : 30000;
  const sendTimeoutMs = Number.isFinite(deps.sendTimeoutMs) ? deps.sendTimeoutMs : SEND_TIMEOUT_MS;
  let cache = null;            // { at, values } — the switches, read together and held briefly (every message asks)
  const done = new Set();      // users.id already claimed or found claimed: no table read on their later messages
  const inflight = new Map();  // users.id → the running attempt, so this replica never races itself

  async function settings() {
    const now = Date.now();
    if (cache && now - cache.at < ttlMs) return cache.values;
    const values = await deps.readSettings([SWITCH_KEY, VIDEO_KEY, TEACHER_APP_KEY]);
    cache = { at: now, values };
    return values;
  }

  async function attempt({ user, from, correlationId }) {
    const values = await settings();
    const why = covers(values, user);
    if (why) return { sent: false, why };
    if (done.has(user.id)) return { sent: false, why: 'already_sent' };
    let lang = 'ur';
    try { lang = (await deps.getLanguage(user.id)) || user.preferred_language || 'ur'; } catch (_) { /* her film in Urdu */ }
    const film = filmUrl(values.get(VIDEO_KEY), lang === 'en' ? 'en' : 'ur');
    if (!film) return { sent: false, why: 'no_url' };
    if (await deps.readFirstUse(user.id)) { remember(user.id); return { sent: false, why: 'already_sent' }; }
    if (!(await deps.claim(user.id))) { remember(user.id); return { sent: false, why: 'already_sent' }; }
    remember(user.id);

    let timer = null;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), sendTimeoutMs); });
    const send = Promise.resolve().then(() => deps.sendVideo(from, film.url, deps.caption(film.lang)));
    // A send still running when we stop waiting must not surface later as an unhandled rejection; it is logged only
    // then (a failure inside the wait is logged below, once).
    let gaveUp = false;
    send.catch((err) => {
      if (gaveUp) deps.logError('❌ howto first touch: the film send failed after the wait', { correlationId, userId: user.id, error: err?.message });
    });
    let outcome;
    try {
      outcome = await Promise.race([send, timeout]);
    } catch (err) {
      deps.logError('❌ howto first touch: the film send threw', { correlationId, userId: user.id, error: err?.message });
      return { sent: false, why: 'send_failed' };
    } finally {
      clearTimeout(timer);
    }
    if (outcome === 'timeout') {
      gaveUp = true;
      deps.log('⏱️ howto first touch: still sending the film; her message goes on', { correlationId, userId: user.id });
      return { sent: false, why: 'send_timeout' };
    }
    if (outcome !== true) {
      deps.logError('❌ howto first touch: Meta did not take the film', { correlationId, userId: user.id, lang: film.lang });
      return { sent: false, why: 'send_failed' };
    }
    deps.log('🎬 howto first touch: Film 1 sent', { correlationId, userId: user.id, lang: film.lang });
    return { sent: true };
  }

  function remember(userId) {
    if (done.size >= MEMO_MAX) done.clear();
    done.add(userId);
  }

  /** Send Film 1 if this is her first touch. Never throws; resolves with { sent, why }. */
  async function maybeSend({ user, from, correlationId = null } = {}) {
    const key = user && user.id;
    if (key && inflight.has(key)) { await inflight.get(key).catch(() => {}); return { sent: false, why: 'already_sent' }; }
    const run = attempt({ user, from, correlationId }).catch((err) => {
      deps.logError('❌ howto first touch: skipped after an error (her message goes on)', { correlationId, userId: key || null, error: err?.message });
      return { sent: false, why: 'error' };
    });
    if (key) inflight.set(key, run);
    try { return await run; } finally { if (key) inflight.delete(key); }
  }

  return { maybeSend, _reset: () => { cache = null; done.clear(); inflight.clear(); } };
}

let shared = null;
/** The bot's door (whatsapp-bot.js): the one shared instance with the real reads and sends. */
async function maybeSendHowtoFirstTouch(args) {
  try {
    if (!shared) shared = createHowtoFirstTouch();
    return await shared.maybeSend(args);
  } catch (err) {
    // Nothing here may stop her message: a failure to even build the service is logged and skipped.
    try { require('../utils/logger').logError('❌ howto first touch: unavailable (her message goes on)', { error: err?.message }); } catch (_) { /* no logger */ }
    return { sent: false, why: 'unavailable' };
  }
}

module.exports = { createHowtoFirstTouch, maybeSendHowtoFirstTouch, FEATURE, SWITCH_KEY, VIDEO_KEY, SEND_TIMEOUT_MS };
