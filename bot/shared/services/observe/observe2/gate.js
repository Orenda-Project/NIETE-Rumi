'use strict';

/**
 * /observe2 — who may start it, and whether this deployment can run it.
 *
 * Pure, like evaluateObserveTrigger next door. /observe2 is the FICO ICT field-form pilot: the coach
 * fills a live form during the lesson, seals it, and then checks what Rumi heard in the recording.
 * It reuses the /observe visit planner to pick the teacher, so it needs that Flow as well as its own
 * two (feature-availability.js, FEATURE_GATES.observe2). Missing any of the three → no match, and
 * the message falls through to normal chat exactly as if the command did not exist.
 */

const { isSchoolLeader } = require('../observe-gate');
const { isFeatureRunnable } = require('../../../config/feature-availability');

// "/observe2" as a command. /^\/observe\b/ does not match it ("e2" has no word boundary), and this
// does not match "/observe", so the two commands never shadow each other.
const OBSERVE2_TRIGGER_RX = /^\/observe2\b/i;

/**
 * @param {{messageBody: string, user: object|null}} input
 * @returns {{match:false} | {match:true, action:'deny_no_user'|'deny_role'|'start'}}
 */
function evaluateObserve2Trigger({ messageBody, user }) {
  if (!OBSERVE2_TRIGGER_RX.test((messageBody || '').trim())) return { match: false };
  if (!isFeatureRunnable('observe2')) return { match: false };
  if (!user) return { match: true, action: 'deny_no_user' };
  if (!isSchoolLeader(user)) return { match: true, action: 'deny_role' };
  return { match: true, action: 'start' };
}

module.exports = { OBSERVE2_TRIGGER_RX, evaluateObserve2Trigger };
