'use strict';
/**
 * What opens the class manager.
 *
 * Reported from staging: `/classes` worked and `/class` did not. Rather than
 * bolting on one more alternative each time someone types a near miss, the rule
 * lives here, with the near misses as tests.
 *
 * THE RULE
 *
 *   - a SLASH command matches as a prefix: `/class`, `/classes`, `/classes please`
 *   - a PLAIN word matches only as the WHOLE message: `class`, `my classes`,
 *     `add a class`
 *
 * The whole-message restriction is the load-bearing half. "my class is too noisy"
 * is a teacher talking, and answering it by opening a form is a hijack — she asked
 * a question and got a spreadsheet. Substring matching would do exactly that.
 *
 * TWO COLLISIONS THIS RESPECTS
 *
 *   1. The attendance router is checked LATER in the text handler than this is, so
 *      anything matched here shadows attendance. Attendance keys off `attendance`,
 *      `roll call` and `حاضری` (+ transliterations); none of those may match here.
 *   2. "Classroom Management" is a real training course title, so the pattern is
 *      anchored on the word `class`/`classes` and never the substring — which also
 *      rules out `classy`, `subclass` and `first class`.
 */

/** Slash form: prefix match, but `\b` so `/classroom` is not a class command. */
const SLASH = /^\/class(es)?\b/i;

/**
 * Plain form: the entire message. An optional verb AND an optional possessive,
 * independently, because "show my classes" carries both — and a trailing
 * "list" so "class list" and "my class list" need no separate rule.
 */
const PLAIN = /^(?:(?:view|show|see|open)\s+)?(?:my\s+)?class(?:es)?(?:\s+list)?\s*[.!?]*$/i;

/** "add a class", "add new class", "add classes". */
const ADD = /^add\s+(?:a\s+|new\s+|a\s+new\s+)?class(?:es)?\s*[.!?]*$/i;

/**
 * Urdu. جماعت is "class"; جماعتیں is the plural. Whole-message only, same as the
 * English plain form, and for the same reason.
 */
const URDU = /^(?:میری\s+|میرے\s+)?(?:جماعت|جماعتیں|jamaat|jamat)\s*[.!?]*$/i;

/**
 * Does this message ask for the class manager?
 *
 * @param {*} text raw message body; non-strings are safely false
 * @returns {boolean}
 */
function isClassesCommand(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  return SLASH.test(trimmed)
    || PLAIN.test(trimmed)
    || ADD.test(trimmed)
    || URDU.test(trimmed);
}

module.exports = { isClassesCommand };
