'use strict';
/**
 * FLN landing target for a /go token (PR-E, Send to teacher).
 *
 * A leader sends a Reading Hour / Numeracy plan to a teacher. The bot sends that teacher a button that opens
 * the teacher's OWN /go/<token> (app-login-link.js). The token's feature is `fln:<plan id>`, and /go lands on
 * the plan page, signed in. `?src=send` tells the page that this open came from a sent message.
 *
 * Pure: no env, no I/O. Two one-line hooks read it: `linkable` in app-login-link.js (so the token can be signed
 * and verified) and the landing line in dashboard/routes/app-login.routes.js.
 */

/** `fln:` + 1..9 digits (the plan id), nothing else. Anchored, so no path or query can ride along. */
const FLN_TARGET = /^fln:(\d{1,9})$/;

/**
 * bd-zcgpkx — Send a lesson plan (the builder). One fixed string, compared whole, so nothing can ride along on it
 * either. bd-a73p5m: a leader's "lesson plan" now opens the Lesson Plans tab instead (app-login-link.js
 * LEADER_LANDINGS), so the bot no longer mints this target; it stays so a link already sent opens for its 24 hours.
 */
const FLN_SEND = 'fln:send';
const FLN_SEND_PATH = '/portal/fln/send';

/** True when `f` is an FLN landing target. */
function isFlnTarget(f) {
  return typeof f === 'string' && (f === FLN_SEND || FLN_TARGET.test(f));
}

/** The plan page (or, for `fln:send`, the builder) for an FLN target, or null for anything else. */
function flnPathFor(f) {
  if (typeof f !== 'string') return null;
  if (f === FLN_SEND) return FLN_SEND_PATH;
  const m = FLN_TARGET.exec(f);
  return m ? `/portal/fln/p/${m[1]}?src=send` : null;
}

module.exports = { FLN_TARGET, FLN_SEND, isFlnTarget, flnPathFor };
