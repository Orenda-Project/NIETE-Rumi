'use strict';
/**
 * "We could not reach the database" is NOT "you are not registered".
 *
 * `getOrCreateUser` either returns a row — an existing one, or one it just
 * created — or it THROWS. It never resolves to nothing for a person who simply
 * has no account, because it makes the account. So the discriminant already
 * exists at the source; what destroyed it was the two call sites that catch the
 * throw and continue with `user = null` ("continue without database — the bot
 * will still work"). That swallow is deliberate and stays: a parent or a child
 * arriving on a forwarded quiz link has no row and must still be served. What
 * cannot stay is throwing away WHY the row is missing.
 *
 * Downstream, every `if (!user)` branch then sent one sentence — "I could not
 * find your account, please send me a message first to register" — for both
 * states. A coach reported the consequence: during a Cloudflare 522 a
 * registered teacher typing /video was told she was not registered. She was
 * registered and mid-session. Nothing logged; the outage was invisible.
 *
 * So callers now carry the discriminant and pass it here:
 *
 *   lookupFailed = true   the lookup itself failed. Nothing is known about her
 *                         account, so nothing may be claimed about it. She is
 *                         told the fault is ours and asked to retry.
 *   lookupFailed = false  the lookup succeeded and produced nothing. Only then
 *                         is the caller's registration guidance true, so it is
 *                         passed straight through unchanged.
 *
 * Kept in its own module rather than inline in the handler so the decision is
 * testable without booting forty services, and so the two branches can never
 * drift apart across the eleven places that ask the question.
 */

const { resolveUx } = require('../config/ux-strings');

/**
 * The outage copy, in BOTH offered languages.
 *
 * Her stored `preferred_language` lives in the row we have just failed to read,
 * so at this exact moment her language is genuinely unknown. Sending both is
 * the honest answer; defaulting to English at the one moment she is already
 * confused is not. This deployment offers exactly en and ur (flat, no region
 * keying), and the pair is ~240 code points against a 1024 body cap.
 */
function lookupUnavailableText() {
  return `${resolveUx('accountLookupUnavailable', { language: 'en' })}\n\n`
    + `${resolveUx('accountLookupUnavailable', { language: 'ur' })}`;
}

/**
 * What to say when a handler has no user object.
 *
 * @param {boolean} lookupFailed did the lookup itself fail?
 * @param {string} registrationCopy the caller's existing "no account" line,
 *   returned verbatim when the lookup succeeded — this function never rewrites
 *   the registration guidance, it only refuses to send it when it is not true.
 * @returns {string}
 */
function accountMissingReply(lookupFailed, registrationCopy) {
  return lookupFailed ? lookupUnavailableText() : registrationCopy;
}

module.exports = { accountMissingReply, lookupUnavailableText };
