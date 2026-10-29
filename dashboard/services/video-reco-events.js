'use strict';
/**
 * The recommended clip's events, portal side — bd-gzfdu9 (VIDREC), r-ab ab/EVENTS_SCHEMA.md §2. Pure helpers plus
 * the default loader and writer used by dashboard/routes/video-reco.routes.js.
 *
 *  - uaClass: link-preview fetchers and bots → 'crawler' (they still get a click row; the read excludes them, and
 *    they never get a presigned URL); WhatsApp's in-app browser / an Android WebView → 'in_app'; else 'browser'.
 *  - device: the first 16 hex of sha256 of a random first-party cookie the player sets: counts forwards, never a phone.
 *  - cleanEvents: the player's beacons, allow-listed (click/delivered/read/send_failed are written server side
 *    only), at most 50, at_s a finite number or null, client_ts a real time or null.
 * Never writes teacher_training_progress or any training table: watching a clip is not passing a module.
 */
const crypto = require('crypto');
const copy = require('../../bot/shared/services/coaching/video-reco/copy');

const CRAWLER = /^WhatsApp\/|facebookexternalhit|facebookcatalog|meta-externalagent|bot\b|bot\/|crawler|spider|preview|slurp|embedly|Slack|Telegram|Twitter|LinkedIn|Discord|Google-|curl\/|wget\/|python-requests|HeadlessChrome/i;
const IN_APP = /WhatsApp|; wv\)|\bFBAN|\bFBAV|Instagram/i;
const PLAYER_EVENTS = new Set(['open', 'play', 't30', 'segment_start', 'p50', 'p90', 'segment_end', 'ended', 'error']);
const MAX_EVENTS = 50;
const COOKIE = 'vr_d';
const COOKIE_RX = /^[0-9a-f]{32}$/;

function uaClass(ua) {
  const s = String(ua || '');
  if (!s || CRAWLER.test(s)) return 'crawler';
  return IN_APP.test(s) ? 'in_app' : 'browser';
}

/** The browser's device cookie (reused or new) and its hashed id. */
function deviceOf(cookieHeader) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(String(cookieHeader || ''));
  const raw = m && COOKIE_RX.test(m[1]) ? m[1] : null;
  const value = raw || crypto.randomBytes(16).toString('hex');
  return { value, fresh: !raw, id: crypto.createHash('sha256').update(value).digest('hex').slice(0, 16) };
}

function cleanEvents(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    if (out.length >= MAX_EVENTS) break;
    if (!e || typeof e !== 'object' || !PLAYER_EVENTS.has(e.event)) continue;
    const at = typeof e.at_s === 'number' && Number.isFinite(e.at_s) ? Math.max(0, Math.min(e.at_s, 86400)) : null;
    const ts = typeof e.client_ts === 'string' && !Number.isNaN(Date.parse(e.client_ts)) ? new Date(e.client_ts).toISOString() : null;
    out.push({ event: e.event, at_s: at, client_ts: ts });
  }
  return out;
}

/** The recommendation (only 'shown', only for this teacher), its module and chapter, and the teacher's language. */
async function loadClip(supabase, recommendationId, userId, catalog) {
  const { data: row, error } = await supabase.from('video_recommendations')
    .select('id, user_id, coaching_session_id, status, module_id, seg_id, start_s, end_s, reason_en, reason_ur')
    .eq('id', recommendationId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message || 'video_recommendations read failed');
  if (!row || row.status !== 'shown') return null;
  let hit = null;
  try { hit = catalog ? catalog.segment(row.seg_id) : null; } catch (_) { hit = null; }
  let mod = (hit && hit.module) || null;
  if (!mod || !mod.video_url) {
    const { data: m } = await supabase.from('training_modules').select('id, title, video_url').eq('id', row.module_id).maybeSingle();
    mod = { ...(mod || {}), module_id: row.module_id, title: (mod && mod.title) || (m && m.title) || '', video_url: (m && m.video_url) || (mod && mod.video_url) || null };
  }
  const { data: u } = await supabase.from('users').select('preferred_language, preferences').eq('id', userId).maybeSingle();
  // bd-9dbhh0.1: whether this teacher stopped the clips, so the page offers "back on" instead of "stop"
  const stopped = require('../../bot/shared/services/coaching/video-reco/clip-pref').isStopped(u && u.preferences); // eslint-disable-line global-require
  return { row, module: mod, segment: (hit && hit.segment) || null, language: copy.lang(u && u.preferred_language), stopped };
}

const insertEvent = (supabase, row) => supabase.from('video_reco_events').insert(row);

/** VIDEO_RECO_ENABLED, read at call time: the engine's flags.js when it is deployed, else the same rule on the env. */
function enabled(env = process.env) {
  try {
    return require('../../bot/shared/services/coaching/video-reco/flags').videoRecoEnabled(env) === true;
  } catch (_) {
    return /^(true|1)$/i.test(String(env.VIDEO_RECO_ENABLED || '').trim());
  }
}

/** VIDEO_RECO_CR_CARD (R7r), read at call time: false only on an explicit off, the same rule when the engine is absent. */
function crCardEnabled(env = process.env) {
  try {
    return require('../../bot/shared/services/coaching/video-reco/flags').videoRecoCrCard(env) === true;
  } catch (_) {
    return !/^(false|0|off)$/i.test(String(env.VIDEO_RECO_CR_CARD || '').trim());
  }
}

/**
 * The /cr card for a session (bd-gzfdu9, SPEC §4.5): its 'shown' recommendation for this teacher, shaped for
 * coaching-report-page.js videoSection, with a player link minted for surface 'cr'. null when there is none.
 * Throws on a failed read; the caller (coaching-report.routes.js loadReport) treats that as "no card".
 */
async function cardFor(supabase, sessionId, userId, language, catalog) {
  const { data: rec, error } = await supabase.from('video_recommendations')
    .select('id, module_id, seg_id, start_s, end_s, reason_en, reason_ur')
    .eq('coaching_session_id', sessionId).eq('user_id', userId).eq('status', 'shown').maybeSingle();
  if (error) throw new Error(error.message || 'video_recommendations read failed');
  if (!rec) return null;
  const { signVideoLink, VIDEO_PATH } = require('../../bot/shared/services/coaching/video-reco/link-token');
  const token = signVideoLink({ recommendationId: rec.id, userId, surface: 'cr' });
  if (!token) return null;
  let hit = null;
  try { hit = catalog ? catalog.segment(rec.seg_id) : null; } catch (_) { hit = null; }
  const mod = (hit && hit.module) || {};
  const seg = (hit && hit.segment) || {};
  let title = copy.localized(seg, 'title', language) || mod.title;
  if (!title) {
    const { data: m } = await supabase.from('training_modules').select('title').eq('id', rec.module_id).maybeSingle();
    title = (m && m.title) || '';
  }
  const start = Number(rec.start_s ?? seg.start_s) || 0;
  const end = Number(rec.end_s ?? seg.end_s) || 0;
  return {
    title,
    durationS: end > start ? end - start : Number(mod.duration_s) || 60,
    clipLanguage: mod.language || 'ur',
    reason: copy.localized(rec, 'reason', language),
    thumbUrl: rec.module_id != null ? `${VIDEO_PATH}/thumb/${encodeURIComponent(rec.module_id)}.jpg` : null,
    href: `${VIDEO_PATH}/${token}`,
  };
}

function catalogOrNull() {
  try {
    return require('../../bot/shared/services/coaching/video-reco/catalog');
  } catch (_) {
    return null;
  }
}

module.exports = {
  uaClass, deviceOf, cleanEvents, loadClip, insertEvent, enabled, crCardEnabled, cardFor, catalogOrNull, PLAYER_EVENTS, MAX_EVENTS, COOKIE,
};
