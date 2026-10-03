'use strict';
/**
 * reaction-only-taps — the tap ids whose WHOLE answer is a free reaction, decided at the webhook
 * door, before any handler runs (Meta bill cut FX7, bd-w2daa.31).
 *
 * WHY. inbound-typing defers "typing…" by 2 s and cancels it when a reply goes out. A reaction-only
 * handler used to settle the scope itself — by its reaction, or its own nothingComing() — but only
 * AFTER its lookups and writes. When those ran past the deadline, "typing…" went up first and hung
 * ~25 s over nothing: sandbox 2 Oct 18:03:56Z, the coaching survey "Yes, useful"
 * (`inbound_typing.done typing:shown lingered:true`). It was the fifth instance of one class
 * (TRIAGE #24, #36, #39, #41, #46), and each round had patched one handler. A reaction-only tap now
 * never arms the deadline at all: the webhook settles it the moment it reads the id.
 *
 * WHAT BELONGS HERE. An id is listed only if EVERY branch of its handler, in this request, answers
 * with a reaction (or with that reaction's own text when there is no wamid / Meta refuses it), or with
 * nothing. A tap that SOMETIMES answers with a message stays OUT and settles at its own branch point
 * instead — before its slow work. Today those are: coaching_fb_no_ (asks for a reason),
 * lp_feedback_yes_ (asks the usage question after a voice note), lp612_fb_ (usage question),
 * tq_no_ (an expired offer says so), photo_more_ (closed / at the cap says so), coaching_confirm_
 * (an exited or cancelled session says so), observe "Send now" (a failed queue apologises), and the
 * quiz / LP "No thanks" taps (they answer in text).
 *
 * Each pattern is anchored exactly as its handler's own regex, so an id the handler would reject
 * (and let fall through to other routing, which may reply) never settles here.
 * tests/meta-bill-cut/fx7-reaction-only-taps.test.js holds every pattern to the template its sender
 * emits — an unmatched pattern is this module's silent failure.
 */
const { logToFile } = require('../utils/logger');
const InboundTyping = require('./inbound-typing');

/**
 * name           — log + silentReason key
 * pattern        — the handler's own id grammar
 * reaction       — what the teacher sees (documentation; the handler sends it)
 * handler / sender — where the tap is answered / where the button is emitted
 */
const TAPS = [
  {
    name: 'coaching_survey_yes',
    pattern: /^coaching_fb_yes_[0-9a-fA-F-]{36}$/,
    reaction: '🙏',
    handler: 'coaching/coaching-feedback.service.js handleFeedbackButton (useful branch → _thank)',
    sender: 'coaching/coaching-feedback.service.js sendFeedbackPrompt',
    // triggerEarly() only QUEUES the transcript-quiz offer (SQS, delaySeconds 0); the worker sends it.
  },
  {
    name: 'commit_card',
    pattern: /^card_(yes|later|no)_[0-9a-fA-F-]{36}$/,
    reaction: '✅ / 👌 / 🙏',
    handler: 'coaching/coaching-card/card-response.service.js handleCardButton',
    sender: 'coaching/report-generator.service.js (commit prompt)',
  },
  {
    name: 'lp_usage',
    pattern: /^lp_used_(taught|planned|not_yet)_[0-9a-f-]{36}$/,
    reaction: '🙏',
    handler: 'lp-feedback.service.js handleUsageButton',
    sender: 'lp-feedback.service.js _usageButtons',
  },
  {
    name: 'lp612_usage',
    pattern: /^lp612_used_(taught|planned|not_yet)_(.+)$/,
    reaction: '🙏',
    handler: 'lp612-feedback.service.js handleUsageButton',
    sender: 'lp612-feedback.service.js handleFeedbackButton (👍 → usage question)',
  },
];

/** The registry entry for this tap id, or null. Never throws. */
function match(tapId) {
  if (typeof tapId !== 'string' || !tapId) return null;
  return TAPS.find((t) => t.pattern.test(tapId)) || null;
}

/**
 * Called by the webhook the moment it knows the tap id: a registry hit settles this request's typing
 * scope ("nothing coming"), so "typing…" never goes up however long the handler then takes. Logs
 * `inbound_typing.reaction_only_tap` { name, msSinceInbound } so a run can prove the door fired.
 *
 * @returns {object|null} the entry when it settled, else null. Never throws.
 */
function settleAtDoor(tapId) {
  try {
    const hit = match(tapId);
    if (!hit) return null;
    logToFile('inbound_typing.reaction_only_tap', {
      name: hit.name,
      msSinceInbound: InboundTyping.msSinceInbound(),
    });
    InboundTyping.nothingComing({ reason: `reaction_only_tap:${hit.name}` });
    return hit;
  } catch (_) {
    return null;   // typing is a courtesy; never break the request over it
  }
}

module.exports = { TAPS, match, settleAtDoor };
