/**
 * bd-04m67 — ONE owner for "whose language is this?".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Language used to be decided at the point of use, from whatever user object
 * happened to be in scope. The nearest one was almost always `session.users` —
 * the FK join on `coaching_sessions.user_id`. That column holds the TEACHER on
 * a bound observation and the COACH on a bare capture, so the same helper
 * returned a different person's language depending on how the session had been
 * created. No call site could see the difference, and none of them handled it:
 * a coach reading English got Urdu acks, and a teacher's report followed the
 * coach.
 *
 * The fix is not a better helper — it is naming the AUDIENCE at the call site
 * and resolving from the right person here, once:
 *
 *     languageFor('teacher', session)   // the observed teacher's language
 *     languageFor('coach',   session)   // the observer's language
 *
 * Rules this module keeps so callers don't have to:
 *   · it NEVER reads `session.users` — that join is the bug;
 *   · the market clamp is applied exactly ONCE, here, so a stale Kiswahili
 *     preference cannot reach an ICT teacher (Rule 20 — language is data);
 *   · it is TOTAL. Every failure path returns a renderable language. This sits
 *     on render paths that must not fail closed.
 *
 * The market table is read at CALL time, never cached at import: the worker
 * process outlives any one market assumption, and a cached table is exactly how
 * Kiswahili reached a NIETE teacher before (bd-2405).
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

/**
 * What each observation framework's market actually serves. `fallback` is the
 * market default — the language a person with no stated preference gets.
 * (fico = NIETE/ICT, hots = Punjab, mewaka = Tanzania.)
 */
const MARKET_LANGS = {
  mewaka: { offer: ['sw', 'en'], fallback: 'sw' },
  fico:   { offer: ['ur', 'en'], fallback: 'en' },
  hots:   { offer: ['ur', 'en'], fallback: 'ur' },
};

function marketLangConfig() {
  const { getObservePack } = require('./observe-framework');
  return MARKET_LANGS[getObservePack().key] || { offer: ['en'], fallback: 'en' };
}

/** Clamp any language to the current market's offered set, else null. */
function clampToMarket(lang) {
  if (typeof lang !== 'string') return null;
  const code = lang.trim();
  if (!code) return null;
  return marketLangConfig().offer.includes(code) ? code : null;
}

/** The language a person with no stated preference gets in this market. */
function marketDefault() {
  return marketLangConfig().fallback;
}

/**
 * One users lookup, read-only, total. Returns a clamped language or null.
 * @param {'id'|'phone_number'} column
 */
async function _preferredLanguage(column, value) {
  if (!value) return null;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('preferred_language')
      .eq(column, value)
      .maybeSingle();
    if (error) return null;
    return clampToMarket(data && data.preferred_language);
  } catch (err) {
    // A language lookup must never take down a report render.
    logToFile('⚠️ observe-language: preference lookup failed — market default', {
      column, error: err.message,
    });
    return null;
  }
}

/**
 * The observed teacher, in resolution order:
 *   1. the phone the coach named for this report (`teacher_delivery`), which is
 *      the only identity a hand-typed teacher has;
 *   2. the session's own `user_id`, when the observation is BOUND (on a bare
 *      capture that column is the coach, so it is deliberately skipped);
 *   3. the market default — never the coach's language. A teacher who never set
 *      a preference must not inherit the person standing next to her.
 */
async function _teacherLanguage(session) {
  const delivery = (session && session.analysis_data && session.analysis_data.teacher_delivery) || {};
  const byPhone = await _preferredLanguage('phone_number', delivery.teacher_phone);
  if (byPhone) return byPhone;

  const teacherUserId = session && session.user_id;
  const bound = teacherUserId && teacherUserId !== (session && session.observer_user_id);
  if (bound) {
    const byId = await _preferredLanguage('id', teacherUserId);
    if (byId) return byId;
  }
  return marketDefault();
}

/**
 * The observer — always `observer_user_id`, on bound and bare sessions alike.
 * Her own acks ("preview sent", "queued") stay in HER language even when every
 * teacher-bound artefact in the same call is in another.
 */
async function _coachLanguage(session) {
  const byId = await _preferredLanguage('id', session && session.observer_user_id);
  return byId || marketDefault();
}

const RESOLVERS = { teacher: _teacherLanguage, coach: _coachLanguage };

/**
 * @param {'teacher'|'coach'} audience  who is going to READ this
 * @param {object} session  a coaching_sessions row
 * @returns {Promise<string>} a language this market can render
 */
async function languageFor(audience, session) {
  const resolve = RESOLVERS[audience];
  // Deliberately throws: an unknown audience is a programming error, and
  // guessing one is how the original defect was written in the first place.
  if (!resolve) throw new Error(`observe-language: unknown audience "${audience}"`);
  return resolve(session || {});
}

module.exports = { languageFor, clampToMarket, marketDefault, marketLangConfig };
