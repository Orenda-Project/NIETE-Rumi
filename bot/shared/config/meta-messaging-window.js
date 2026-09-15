/**
 * Meta's free-form messaging window — one fact, one home.
 *
 * A business may send a free-form message only within 24 hours of the
 * customer's last inbound. Past that, Meta refuses the send with error 131047
 * and the only way in is an approved template the customer taps.
 *
 * This number lived as a `23 * 60 * 60 * 1000` literal in the window check and,
 * separately, as a `23 * 60 * 60` TTL on the negative cache that overrides that
 * check. Two copies of one fact, in two files, that must agree: a cache TTL
 * longer than the check's cutoff keeps a window closed after the check has
 * re-opened it. They read the same constant now, and a test asserts they match.
 *
 * Why the margin is minutes rather than the old hour: the hour existed because
 * nothing underneath caught a window that had actually closed, so the check
 * guessed early and accepted false negatives. Measured over the 152 observe
 * template sends in the week to 15 Sep, that cost 5 sends (3.3%) a paid
 * template and a message telling a coach her active teacher had not written
 * recently — every one of those five teachers had written 23.05-23.92 hours
 * before. Zero sends fell under 23h, so only the upper edge was wrong. The
 * teacher-report deliver path now falls back to the template on a real 131047,
 * so the check no longer has to buy safety with an hour of accuracy; five
 * minutes covers clock skew between our clock and Meta's.
 */

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Meta's own rule. Not ours to change. */
const META_WINDOW_MS = 24 * HOUR_MS;

/** Clock-skew margin. Five minutes, not an hour — see the note above. */
const WINDOW_SAFETY_MARGIN_MS = 5 * MINUTE_MS;

/** What our checks and caches treat as "still open". */
const MESSAGE_WINDOW_MS = META_WINDOW_MS - WINDOW_SAFETY_MARGIN_MS;

/** Meta's error code for "more than 24 hours since the customer last replied". */
const RE_ENGAGEMENT_ERROR_CODE = 131047;

/**
 * The Meta error code inside a send failure, or null.
 *
 * Both transports bury it in the same place, and every caller that wanted to
 * branch on it was re-deriving that path by hand. It lives here rather than on
 * the WhatsApp service so a caller can read a code without holding the service
 * — which also means a test that mocks the service still exercises the real
 * classification instead of a stub of it.
 */
function metaErrorCodeOf(error) {
  const code = error
    && error.response
    && error.response.data
    && error.response.data.error
    && error.response.data.error.code;
  return Number.isFinite(Number(code)) ? Number(code) : null;
}

/** Did Meta refuse this send because the free-form window has closed? */
function isWindowClosedError(error) {
  return metaErrorCodeOf(error) === RE_ENGAGEMENT_ERROR_CODE;
}

module.exports = {
  META_WINDOW_MS,
  WINDOW_SAFETY_MARGIN_MS,
  MESSAGE_WINDOW_MS,
  RE_ENGAGEMENT_ERROR_CODE,
  metaErrorCodeOf,
  isWindowClosedError,
};
