'use strict';
/**
 * The quiz funnel — ONE event shape for every stage of both quiz streams.
 *
 *   quiz_funnel.<stage>  { quiz_id, source, channel, teacher_id?, … }
 *
 * `source` is the quiz STREAM (quizzes.quiz_source: `transcript` for a quiz born
 * of a coaching recording, `lp_v8` for one born of a lesson plan). `channel` is
 * where the quiz was born (see channelOf). With both on every event the whole
 * chain is one query — `where msg startswith 'quiz_funnel.'` grouped by stage and
 * stream — which is what the funnel watcher reads and what anyone asking "how
 * many were offered, made, sent, finished, reported" should read.
 *
 * WHY A FAMILY OF ITS OWN rather than renaming what exists: the same chain was
 * already logged across `transcript_quiz.*`, `lp_quiz.*` and `video_quiz.*`, with
 * the stream missing from half of them and `source` meaning three different
 * things (the quiz stream, the offer channel, the child-session engine). Those
 * names are read by tooling and tests that stay as they are; this family sits
 * beside them and is the one to count with. The catalogue, with APL, is in
 * docs/quiz-telemetry.md ("The quiz funnel").
 *
 * GUARANTEES every caller relies on:
 *   - an unknown stage is refused, so a typo cannot mint a new event name;
 *   - only whitelisted fields are logged, and only as ids, short tokens, counts
 *     and booleans — a child's or a teacher's name, or a message, cannot reach
 *     Axiom through here (data standard D4);
 *   - it never throws: a log call must never break the pipeline it describes.
 */

const { logEvent } = require('../../utils/structured-logger');

const EVENT_PREFIX = 'quiz_funnel.';

/** The chain, in order. */
const STAGES = Object.freeze([
  'offer_made',          // an offer reached (or was attempted on) a teacher
  'offer_answered',      // yes / no / a class picked / a tap after the offer expired
  'accepted',            // the quiz is committed and queued for generation
  'generation_started',  // the worker picked the quiz up (a redelivery repeats it — count distinct quiz_id)
  'generated',           // questions stored, status ready
  'generation_failed',   // terminal: status failed, with the reason
  'sent',                // the teacher's PDF + forwardable link went out (status sent)
  'send_failed',         // the hand-off could not deliver the link (or mint one)
  'child_joined',        // a child's session started
  'child_completed',     // a child finished (scored)
  'scorecard_sent',      // the child's scorecard (ok:false = the text fallback went instead)
  'class_cards',         // one report run's class cards (leaderboards): n sent, failed, skipped
  'report_sent',         // the teacher's class report (kind:'no_one' = nobody took it)
  'report_failed',       // a report that could not go out
]);

const ID_FIELDS = ['quiz_id', 'nudge_id', 'session_id', 'share_code_id', 'teacher_id'];
const TOKEN_FIELDS = ['source', 'channel', 'choice', 'reason', 'step', 'kind', 'language'];
const COUNT_FIELDS = ['n', 'failed', 'skipped', 'pct'];
const BOOL_FIELDS = ['ok', 'delivered', 'pdf_sent', 'link_sent'];

/** Every field an event may carry. Anything else is dropped. */
const FIELDS = Object.freeze([...ID_FIELDS, ...TOKEN_FIELDS, ...COUNT_FIELDS, ...BOOL_FIELDS]);

const ID_RX = /^[0-9a-f][0-9a-f-]{7,63}$/i;
// Lower-case machine tokens only: `validator_failed`, `class:g5_general_science`.
// Free text — an error message, a sentence, a name — never matches.
const TOKEN_RX = /^[a-z0-9][a-z0-9_:.-]{0,63}$/;

function clean(key, value) {
  if (value === undefined || value === null) return undefined;
  if (ID_FIELDS.includes(key)) {
    const s = String(value);
    return ID_RX.test(s) ? s : undefined;
  }
  if (TOKEN_FIELDS.includes(key)) {
    const s = String(value);
    if (TOKEN_RX.test(s)) return s;
    // A reason that is not a token is still a reason: say one was given, never what.
    return key === 'reason' ? 'other' : undefined;
  }
  if (COUNT_FIELDS.includes(key)) {
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }
  if (BOOL_FIELDS.includes(key)) {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 0) return Boolean(value);
    if (value === 'yes' || value === 'true') return true;
    if (value === 'no' || value === 'false') return false;
    return undefined;
  }
  return undefined;
}

/**
 * Log one funnel stage.
 * @param {string} stage one of STAGES
 * @param {Object} fields any of FIELDS; anything else is dropped
 * @returns {boolean} true when the event was logged
 */
function emit(stage, fields = {}) {
  try {
    if (!STAGES.includes(stage)) return false;
    const out = {};
    for (const key of FIELDS) {
      const v = clean(key, fields && fields[key]);
      if (v !== undefined) out[key] = v;
    }
    logEvent(`${EVENT_PREFIX}${stage}`, out);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where a quiz was born, from the `meta.source` its row was created with.
 * `self` is the offer after a self-coaching report (scheduleOffer's default).
 */
const CHANNEL_BY_META_SOURCE = Object.freeze({
  self: 'coaching_offer',
  offer: 'coaching_offer',
  lp_offer: 'lp_offer',
  list: 'quiz_menu',
  flow: 'quiz_menu',
  remake: 'remake',
});

function channelOf(metaSource) {
  return CHANNEL_BY_META_SOURCE[metaSource] || 'unknown';
}

/**
 * The stream a quiz_source belongs to: `transcript`, `lp` (every lesson-plan
 * source — the K-5 `lp_v8` and whatever the 6-12 plans are called), or null for
 * a quiz outside the two streams (the video-lesson quiz shares the child engine).
 */
function streamOf(source) {
  if (source === 'transcript') return 'transcript';
  if (typeof source === 'string' && /^lp/.test(source)) return 'lp';
  return null;
}

module.exports = { emit, channelOf, streamOf, STAGES };
