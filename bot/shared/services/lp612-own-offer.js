'use strict';
/**
 * bd-iceyyu — "Make my own" in the bot, as a hand-off to the portal.
 *
 * Operator, 9 Nov: WhatsApp messages cost money since 1 Oct, so the five questions are NOT asked in chat. A flag-on
 * teacher sees a "Make my own" row FIRST on a 6-12 chapter's lesson screen in the lesson-plan Flow (a Flow screen is
 * not a billed message). Tapping it sends ONE message: a button that opens the portal's Make my own page for that
 * chapter in WhatsApp's in-app browser, already signed in (the app login link, app-login-link.js `lp_make_own`).
 * The questions, the generator and niete_lp612_own_plans are the portal's (bd-snkn32): one feature, two doors.
 *
 * WHO: the portal's own switch, read with the portal's rule (dashboard/lib/feature-flags.js isFlagEnabledForUser):
 * `portal_lp_make_own` true, a JSON list holding her, or "teachers" and her users.role is teacher — AND she is on the
 * teacher app (portal_teacher_v2), because the portal page needs both. Fail closed: no row, junk, a failed read: off.
 *
 * LOAD: the switch is held in-process for 30 s, so a flag-off teacher costs at most one app_settings read per 30 s
 * per process, and nothing else (no users read, no teacher-app read). A failed read is not held.
 */
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');
const { portalUrl } = require('../config/branding');
const { signAppLink } = require('./app-login-link');
const { isTeachersValue, isTeacherRole } = require('./teacher-audience');

const KEY = 'portal_lp_make_own';
const STEP = 'lp612_own';
const ROW_ID = 'lp612_own';
const FEATURE = 'lp_make_own';
const TTL_MS = 30_000;
const RLM = '‏';

let held = null;

/** The switch's raw value, held for TTL_MS. Throws on a failed read (the caller answers off; nothing is held). */
async function switchValue(now) {
  if (held && now - held.at < TTL_MS) return held.value;
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle();
  if (error) throw new Error(error.message || 'app_settings read failed');
  held = { at: now, value: data ? data.value : null };
  return held.value;
}

function decode(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return v; }
}

async function isTeacher(userId) {
  const { data, error } = await supabase.from('users').select('id, role').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message || 'users read failed');
  return Boolean(data) && isTeacherRole(data.role);
}

/** Is Make my own offered to this teacher? Never throws. */
async function isOfferedTo(userId, { now = Date.now() } = {}) {
  if (typeof userId !== 'string' || !userId) return false;
  try {
    const v = decode(await switchValue(now));
    let on = v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true')
      || (Array.isArray(v) && v.includes(userId));
    if (!on && isTeachersValue(v)) on = await isTeacher(userId);
    if (!on) return false;
    return Boolean(await require('./app-redirect.service').isOnTeacherApp(userId));
  } catch (err) {
    logToFile('⚠️ Make my own: switch read failed — off', { userId, error: err && err.message }, 'warn');
    return false;
  }
}

/** The Flow row, in the book's language. Its tap is the STEP data_exchange with the chapter, nothing else. */
function ownRow({ grade, subject, chapterKey, rtl }) {
  const language = rtl ? 'ur' : 'en';
  const lead = rtl ? RLM : '';
  const say = (k) => `${lead}${resolveUx(k, { language }).replace(/^‏/, '')}`;
  return {
    id: ROW_ID,
    'main-content': { title: say('lpOwnRowTitle'), description: say('lpOwnRowDesc'), metadata: say('lpOwnRowMeta') },
    'on-click-action': {
      name: 'data_exchange',
      payload: { step: STEP, grade: String(grade), subject, chapter_key: chapterKey },
    },
  };
}

/**
 * The ONE message: a line and a button that opens Make my own on this chapter, signed in. If Meta refuses the button,
 * the same link once as text. False when nothing was sent (no portal or key here, or the send failed). Never throws.
 * The token is the credential, so it is never logged.
 */
async function sendOwnLink({ userId, phone, language, grade, subject, chapterKey }) {
  const WhatsAppService = require('./whatsapp.service');
  const base = String(portalUrl() || '').replace(/\/+$/, '');
  const token = base ? signAppLink(userId, FEATURE, null, { grade, subject, chapter: chapterKey }) : null;
  if (!token) {
    logToFile('⚠️ Make my own: no portal url or signing key here — no link', { userId }, 'warn');
    return false;
  }
  const url = `${base}/go/${token}`;
  const body = resolveUx('lpOwnLinkBody', { language });
  const buttonText = resolveUx('lpOwnLinkButton', { language });
  try {
    let via = 'cta_url';
    let sent = await WhatsAppService.sendCtaUrl(phone, { body, buttonText, url });
    if (!sent) { via = 'text'; sent = await WhatsAppService.sendMessage(phone, `${body}\n${url}`); }
    logToFile(sent ? '🔗 Make my own: link sent' : '❌ Make my own: link not delivered', { userId, grade, subject, chapterKey, via });
    return Boolean(sent);
  } catch (err) {
    logToFile('❌ Make my own: link send threw', { userId, error: err && err.message }, 'error');
    return false;
  }
}

module.exports = { KEY, STEP, ROW_ID, FEATURE, TTL_MS, isOfferedTo, ownRow, sendOwnLink };
