'use strict';
/**
 * The chat breadcrumb sent after a /roster Flow closes.
 *
 * The Flow's own terminal screen already showed the coach the result; this is the
 * one line she can scroll back to later, so it has to say what happened — a save,
 * a correction, a hand-over to a class teacher, or nothing — rather than "saved"
 * for all of them. Keyed off `roster_action`, which the SAVED screen puts at the
 * top level of its `complete` payload (see roster-completion-contract.test.js).
 */

/** Every value the endpoint emits as roster_action, and what to say for each. */
const SENTENCES = {
  saved: (cls, n) => (n
    ? `📋 ${cls} saved — ${n} students on the roster. Send /roster again for the next class.`
    : `📋 ${cls} saved. Send /roster again for the next class.`),
  edited: (cls, n) => (n
    ? `📋 ${cls} updated — ${n} students on the roster now.`
    : `📋 ${cls} updated.`),
  unchanged: (cls) => `📋 ${cls} — nothing was changed.`,
  teacher_set: (cls, n) => (n
    ? `📋 ${cls} — class teacher set. The ${n} students are in their attendance list now.`
    : `📋 ${cls} — class teacher set.`),
  details_changed: (cls, n) => (n
    ? `📋 Class details changed — it is ${cls} now, ${n} students on the roster.`
    : `📋 Class details changed — it is ${cls} now.`),
  merged: (cls, n) => (n
    ? `📋 Merged into ${cls} — ${n} students on that roster now. Nothing was deleted.`
    : `📋 Merged into ${cls}. Nothing was deleted.`),
};

const ROSTER_ACTIONS = Object.freeze(Object.keys(SENTENCES));

function rosterAckText(responseJson = {}) {
  const cls = responseJson.roster_class || 'That class';
  const n = responseJson.roster_count;
  const say = SENTENCES[responseJson.roster_action] || SENTENCES.saved;
  return say(cls, n);
}

module.exports = { rosterAckText, ROSTER_ACTIONS };
