'use strict';
/**
 * One tap from a message the teacher already has to WhatsApp's chat picker with the class message typed in, and the
 * tap logged (app_settings `quiz_forward_button`; JSON true only, 30 s cache, a failed read is off).
 *
 * The link is `<portal>/quiz/teacher/<qf token>/fwd`: the portal's teacher-home edge forwards it to the bot, which
 * logs `quiz_forward_tap` and answers 302 → `https://wa.me/?text=<the class message>`. The token is narrow on purpose:
 * it can open the picker with ONE class message and nothing else (never the teacher home), because a caption or a
 * reminder can itself be forwarded.
 *
 *   { k:'qf', q | c, s, l, exp }
 *     q / c  the teacher's own quiz id / a library share code id, each 16 bytes as base64url (22 letters)
 *     s      the surface letter (SURFACES)
 *     l      en | ur (the return line's language)
 *     exp    14 days: a hand-out is forwarded the same week, a reminder the same day
 *
 * Who the teacher is comes from the quiz row (teacher_id) or the code row (teacher_user_id) at the tap; the token
 * carries no user id, so the link stays short in a caption.
 *
 * Events (ids only): quiz_forward_tap { tk, share_code_id, surface, method, origin, stale }, quiz_forward_result
 * { tk, share_code_id, surface, result } (only where the browser reports one: the native share sheet).
 * The meter is not switched: the teacher home's send tap is logged with the switch off too (a switched meter is a blind
 * meter); every link and button that a teacher sees is switched.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const KEY = 'quiz_forward_button';
const KIND = 'qf';
const TTL_S = 14 * 24 * 60 * 60;
const TTL_MS = 30 * 1000;
// surface → its letter in the token (the event spells it out)
const SURFACES = Object.freeze({ wa_handout: 'h', wa_nudge: 'n', wa_report: 'r', wa_offer: 'o', maker: 'm', teacher_home: 't', class_link: 'k' });
const BY_LETTER = Object.freeze(Object.fromEntries(Object.entries(SURFACES).map(([k, v]) => [v, k])));
const METHODS = Object.freeze(['wa_me', 'wa_scheme', 'native', 'copy']);
// WhatsApp's own browser (in-app-browser-whatsapp: "WA4A/<v>", never "; wv)")
const WA_IAB_RX = /\bWA4A\/|WhatsApp/;
const RESULTS = Object.freeze(['shared', 'dismissed', 'failed']);
const ORIGINS = Object.freeze(['lesson_plan', 'coaching', 'library', 'story', 'again']);
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cache = null;

/** → true only when the switch row is the JSON boolean true. Never throws; a failed read is off and is not held. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: ((data || [])[0] || {}).value === true };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ quiz forward: settings lookup failed — off', { error: err && err.message });
    return false;
  }
}

const pack = (uuid) => (UUID_RX.test(String(uuid || '')) ? Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url') : null);
function unpack(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(s)) return null;
  const h = Buffer.from(s, 'base64url').toString('hex');
  return h.length === 32 ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : null;
}

/** → the token, or null (no id, an unknown surface, or no signing secret). Exactly one of quizId / codeId. */
function signForward({ quizId = null, codeId = null, surface, lang } = {}, { now = Date.now() } = {}) {
  const q = quizId ? pack(quizId) : null;
  const c = !q && codeId ? pack(codeId) : null;
  if ((!q && !c) || !SURFACES[surface]) return null;
  return require('../quiz/web-quiz-token').sign({ k: KIND, ...(q ? { q } : { c }), s: SURFACES[surface], l: lang === 'en' ? 'en' : 'ur', exp: Math.floor(now / 1000) + TTL_S });
}

function fieldsOf(p) {
  if (!p) return null;
  const quizId = p.q ? unpack(p.q) : null;
  const codeId = !quizId && p.c ? unpack(p.c) : null;
  const surface = BY_LETTER[p.s];
  if ((!quizId && !codeId) || !surface) return null;
  return { quizId, codeId, surface, lang: p.l === 'en' ? 'en' : 'ur' };
}

/** → { ok: fields } | { stale: fields } (genuine but past 14 days) | null (forged, garbled, another kind). */
function verifyForward(t) {
  if (typeof t !== 'string' || !t) return null;
  const Tok = require('../quiz/web-quiz-token');
  const fresh = fieldsOf(Tok.verify(t, KIND));
  if (fresh) return { ok: fresh };
  const old = fieldsOf(Tok.verify(t, KIND, { allowExpired: true }));
  return old ? { stale: old } : null;
}

/** → the absolute link on the portal, or null (no portal base or no secret). */
function forwardUrl(fields, opts) {
  const base = String(require('../../config/branding').portalUrl() || '').replace(/\/+$/, '');
  const t = base ? signForward(fields, opts) : null;
  return t ? `${base}/quiz/teacher/${t}/fwd` : null;
}

/**
 * The one line a message carries ("📲 Send it to your class group in one tap:\n<link>"), or null when the switch is off,
 * the link cannot be made, or anything throws: the message then goes exactly as today. Never throws.
 */
async function lineFor(fields, { key = 'qfix_forward_line', params = {} } = {}) {
  try {
    if ((await on()) !== true) return null;
    const link = forwardUrl(fields);
    if (!link) return null;
    return require('../../config/ux-strings').resolveUx(key, { language: fields.lang === 'en' ? 'en' : 'ur', params: { ...params, link } });
  } catch (err) {
    logToFile('⚠️ quiz forward: the one-tap line could not be built — the message goes as before', { error: err && err.message });
    return null;
  }
}

/**
 * Where the tap goes: in WhatsApp's own browser the app's scheme (whatsapp://send?text=…: the picker, not the wa.me web
 * page with its "Continue to chat"), anywhere else the wa.me link as it is. → { url, method }.
 */
function targetFor(wa, ua) {
  const m = /^https:\/\/wa\.me\/\?(text=.*)$/.exec(String(wa || ''));
  if (m && WA_IAB_RX.test(String(ua || ''))) return { url: `whatsapp://send?${m[1]}`, method: 'wa_scheme' };
  return { url: wa, method: 'wa_me' };
}

const tkOf = (uid) => { try { return require('../quiz/web-quiz-kid').tk(uid) || null; } catch (_) { return null; } };

/** quiz_forward_tap, ids only. Never throws. */
function logTap({ uid = null, shareCodeId = null, surface, method = 'wa_me', origin = null, stale = false }) {
  try {
    logEvent('quiz_forward_tap', {
      w: 's', tk: tkOf(uid), share_code_id: UUID_RX.test(String(shareCodeId || '')) ? shareCodeId : null,
      surface: SURFACES[surface] ? surface : 'unknown', method: METHODS.includes(method) ? method : 'wa_me',
      origin: ORIGINS.includes(origin) ? origin : null, stale: stale === true,
    });
  } catch (_) { /* a failed log never decides a send */ }
}

/** quiz_forward_result, only for a result the browser reported. Never throws. */
function logResult({ uid = null, shareCodeId = null, surface, result }) {
  if (!RESULTS.includes(result)) return;
  try {
    logEvent('quiz_forward_result', {
      w: 's', tk: tkOf(uid), share_code_id: UUID_RX.test(String(shareCodeId || '')) ? shareCodeId : null,
      surface: SURFACES[surface] ? surface : 'unknown', result,
    });
  } catch (_) { /* never decides anything */ }
}

/** A quiz_source → the event's origin. */
function originOf(source) {
  if (source === 'lp_v8' || source === 'lp612' || source === 'lesson_plan') return 'lesson_plan';
  if (source === 'transcript') return 'coaching';
  if (source === 'story') return 'story';
  if (source === 'video') return 'library';
  return null;
}

module.exports = {
  on, signForward, verifyForward, forwardUrl, lineFor, logTap, logResult, originOf, targetFor,
  KEY, KIND, TTL_S, SURFACES, METHODS, RESULTS, _resetCache: () => { cache = null; },
};
