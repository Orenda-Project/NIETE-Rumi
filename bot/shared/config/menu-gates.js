'use strict';
/**
 * Which features this deployment can actually START, as booleans the row
 * builder can filter on.
 *
 * Presence-based, read at CALL time — the architecture rule. A row whose Flow id
 * is not set does not appear, and a row that does appear can be started, which
 * is the property reading assessment lost: it stayed on the menu for twenty days
 * after it stopped being able to run, and failed 57 times out of 57.
 *
 * Split in two on purpose:
 *   · `envMenuGates` is pure and synchronous — env only, no IO, no requires that
 *     touch the database. This is the floor the sender falls back to.
 *   · `menuGates` adds the one gate that is a DATABASE row (the assessment
 *     generator's shared switch, fail-closed). It is awaited by `sendMenu`,
 *     which already does IO, and passed down — so the sender itself stays
 *     synchronous-safe and testable without a database.
 *
 * Fail-closed on the async gate is deliberate here and NOT the same call as on
 * the audio hot path: a lookup blip costs a teacher one menu row she can still
 * reach by typing /assess, whereas fail-closed on the audio router would park
 * her recording.
 */

const isSet = (v) => typeof v === 'string' && v.trim() !== '';

/** Env-only gates. Pure. */
function envMenuGates(env = process.env) {
  return {
    // Training and lesson plans have Flow ids of their own; they were always
    // rows, and they stay rows only while their Flow exists.
    trainingEnabled: isSet(env.TEACHER_TRAINING_FLOW_ID),
    lessonPlanEnabled: isSet(env.PAKISTAN_LP_FLOW_ID),
    observeEnabled: isSet(env.OBSERVE_MEWAKA_FLOW_ID),
    rosterEnabled: isSet(env.ROSTER_FLOW_ID),
    classesEnabled: isSet(env.CLASS_MANAGER_FLOW_ID),
    videosEnabled: isSet(env.STUDENT_VIDEOS_FLOW_ID),
    // The quiz needs BOTH: the feature flag and the Flow the row opens.
    quizEnabled: env.TRANSCRIPT_QUIZ_ENABLED === 'true' && isSet(env.TRANSCRIPT_QUIZ_FLOW_ID),
  };
}

/** Env gates plus the assessment generator's database switch. */
async function menuGates(env = process.env) {
  const gates = envMenuGates(env);
  if (!isSet(env.ASSESSMENT_GEN_FLOW_ID)) return { ...gates, assessmentEnabled: false };
  try {
    const { isAssessmentGeneratorEnabled } = require('./feature-flags');
    return { ...gates, assessmentEnabled: Boolean(await isAssessmentGeneratorEnabled()) };
  } catch (err) {
    // A menu is still worth sending without one row.
    return { ...gates, assessmentEnabled: false };
  }
}

module.exports = { envMenuGates, menuGates };
