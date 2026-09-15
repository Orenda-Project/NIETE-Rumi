'use strict';
/**
 * Is this message the video-library command?
 *
 * Extracted out of text-message.handler so it can be called and tested without
 * the handler's dependency graph, and widened to the plural in the same move.
 *
 * The old matcher was `t === '/video' || t.startsWith('/video ') || t === 'video'`,
 * so `/videos` — the plural the feature is actually called by, and the one people
 * type — matched nothing and fell through to the chat LLM. That is the same gap
 * `/class` vs `/classes` had, which is why `classes/class-command.js` exists, and
 * this is the same fix: match the stem with a word boundary.
 *
 * Kept narrow on purpose. A slash form may carry a tail (`/videos maths`), but the
 * bare word must be the WHOLE message — "make me a video on photosynthesis" is a
 * request for generated video and still falls through to the generator, and
 * "send videos to my class tomorrow" is a sentence, not a command.
 *
 * Pure and side-effect-free.
 */

/** `/video`, `/videos`, either with a tail; any case. */
const SLASH_VIDEO_RX = /^\/videos?\b/i;

/** The bare word, whole message only. */
const BARE_VIDEO_RX = /^videos?$/i;

function isVideoCommand(trimmedMessage) {
  const t = String(trimmedMessage || '').trim();
  if (!t) return false;
  return SLASH_VIDEO_RX.test(t) || BARE_VIDEO_RX.test(t);
}

module.exports = { isVideoCommand, SLASH_VIDEO_RX, BARE_VIDEO_RX };
