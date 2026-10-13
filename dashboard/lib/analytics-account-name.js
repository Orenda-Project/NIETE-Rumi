/**
 * bd-s6qbts.5 — analytics-only accounts sign in with an ACCOUNT NAME instead of a phone number.
 *
 * Operator (2026-10-13): "can we login the analytics account without using a phone number … like a name or
 * something? make an exception for this".
 *
 * Storage: the account's users.phone_number holds the reserved value `analytics:<name>`. It is non-numeric, so it can
 * never equal a real phone: no teacher can collide with it or claim it, and WhatsApp can never reach it. No new
 * column (users has no username column; `email` is deliberately not used).
 *
 * The ONE place these rules live. Used by POST /api/portal/login and the reset endpoints
 * (dashboard/routes/portal.routes.js) and by scripts/create-analytics-user.js, so the login and the script that
 * makes the account cannot disagree on what a name is. The portal's client mirror is isAccountName in
 * portal/src/portal/lib/phone.ts — keep the two in step.
 *
 * Who may sign in with a name is NOT decided here: only an account on app_settings.portal_analytics_only
 * (feature-flags.readUserListFlag). These rules only say what a name looks like.
 */

const ANALYTICS_PHONE_PREFIX = 'analytics:';

/** Lower-case letter first, then lower-case letters, digits and hyphens: 3–40 characters in all. */
const ACCOUNT_NAME_RE = /^[a-z][a-z0-9-]{2,39}$/;

/**
 * At most this many digits in a name. Every phone normaliser that reads a STORED phone_number joins all of its
 * digits (scripts/backfill-school-id-from-roster.py, scripts/sync-training-from-fde.py, …), so
 * analytics:fde-0300-123-4567 would read as 923001234567 — a real teacher — and the roster backfill would attach the
 * account to her school as a teacher. A Pakistani mobile is at least 10 digits; 6 can never spell one.
 */
const MAX_NAME_DIGITS = 6;

/**
 * Is this sign-in identifier an account name rather than a phone? It is when it holds an ASCII letter — a phone
 * number, in any form the portal accepts (03XX, +92, 0092, spaces, dashes), never does. Anything that is not a string
 * is not a name (it takes the phone path, which rejects it as it always has).
 */
function isAccountNameInput(raw) {
  return typeof raw === 'string' && /[a-z]/i.test(raw);
}

/** The canonical name (trimmed, lower-cased), or null when it is not a well-formed account name. */
function normaliseAccountName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().toLowerCase();
  if (!ACCOUNT_NAME_RE.test(name)) return null;
  return (name.match(/\d/g) || []).length <= MAX_NAME_DIGITS ? name : null;
}

/** users.phone_number for an account name (pass a name from normaliseAccountName). */
function storedPhoneFor(name) {
  return `${ANALYTICS_PHONE_PREFIX}${name}`;
}

module.exports = {
  ANALYTICS_PHONE_PREFIX,
  ACCOUNT_NAME_RE,
  MAX_NAME_DIGITS,
  isAccountNameInput,
  normaliseAccountName,
  storedPhoneFor,
};
