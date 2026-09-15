'use strict';
/**
 * Pure, dependency-free decision helper for the coaching hot-trigger.
 * Mirrors homework-trigger.js — kept separate from text-message.handler so it
 * is unit-testable without the handler's full dependency graph.
 *
 * There was no interceptor at all for a typed coaching command —
 * only the tapped ice-breaker chip and the numeric menu choice reached
 * `_handleClassroomCoachingChoice`. A typed "/coaching" fell through to
 * general chat, which always includes the teacher's own conversation
 * history, so any /coaching after her first in a session got answered as if
 * continuing her last classroom recording instead of asking for a new one
 * (DC tracker row 84).
 */

// The command STEM at the START of the message: "coaching", "/coaching",
// "/coach" (any case, optional stray whitespace around the slash, as real
// teachers type it), or the Urdu equivalent — and it may carry a tail, because
// teachers write one.
//
// Nine days of inbound text on the live deployment, role='user':
//   content ilike '/coaching'   1,463
//   content ilike '/coach%'     1,573   (+110, +7.5%)
//   content ilike 'coach%'        197   (no slash at all)
// A whole-message matcher takes the first bucket and drops the other two. The
// no-slash bucket is not prose that happens to mention coaching — a 60-row
// sample is "Coaching report plz", "Coaching class 1 urdu", "Coaching about
// lesson", "Coach". Every one of those wanted this door.
//
// This is also the /observe lesson: an exactly-anchored `/^\/observe\b/i`
// matched ZERO of 54 real leader attempts in 30 days, because every one of them
// carried a tail.
//
// Still anchored at the START, so a sentence that merely mentions coaching
// ("my coaching report", "Class room coaching get teacher feedback...") is not
// eaten. The \b after the English stem is what keeps "coaches meeting at 3"
// out; the Urdu stem carries no \b on purpose — JS \w is ASCII-only, so a \b
// after گ never matches before a space and the Urdu arm would never fire.
const COACHING_TRIGGER_RX = /^\s*\/?\s*(?:coach(?:ing)?\b|کوچنگ)/i;

/**
 * @returns {{match:boolean}}
 */
function evaluateCoachingTrigger({ messageBody }) {
  return { match: COACHING_TRIGGER_RX.test(String(messageBody || '')) };
}

module.exports = { COACHING_TRIGGER_RX, evaluateCoachingTrigger };
