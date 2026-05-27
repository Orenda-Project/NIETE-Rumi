/**
 * Coaching Debrief Configuration
 *
 * Single source of truth for the post-analysis reflective debrief's
 * COACHING MODEL, the meta-prompt rules/avoid lists, and the number of
 * reflective questions asked in a debrief.
 *
 * Lifted out of gpt5-mini.service.js (was hardcoded inline in the
 * reflective-question meta-prompt) so the coaching model can be swapped
 * or localized without touching service logic. The persona/examples
 * continue to live in language-config.js (reflectiveQuestions).
 *
 * NUM_REFLECTIVE_QUESTIONS is the single source for:
 *  - the "< N" loop bound in reflective-conversation.service.js
 *  - the "question X of N" string in the meta-prompt
 *  - the number of few-shot example arms wired into the meta-prompt
 * Changing it here MUST keep all three in lockstep (enforced by
 * tests/coaching/coaching-debrief-config.test.js).
 */

// Number of reflective questions in a debrief conversation.
const NUM_REFLECTIVE_QUESTIONS = 3;

/**
 * The coaching model that governs how reflective questions are framed.
 * Behavior-preserving lift of the inline S.T.I.C.K.S. text.
 */
const coachingModel = {
  name: 'S.T.I.C.K.S.',
  description:
    'S.T.I.C.K.S. framework (Specific, Timely, Inquiry-based, Collaborative, Kind, Strength-based)',
};

/**
 * Critical requirements for question specificity.
 * Behavior-preserving lift of the inline "CRITICAL REQUIREMENTS" list.
 * The coaching-model rule is rendered from `coachingModel.description`.
 */
const rules = [
  'YOU MUST quote actual dialogue from the transcript (e.g., "I noticed you asked students \'What time is Fajr prayer?\'")',
  'YOU MUST reference specific moments or patterns in the classroom (e.g., "At the 15-minute mark..." or "When you were explaining AM/PM...")',
  'DO NOT use generic phrases like "Reflecting on your lesson" - be conversational and specific',
  'Make it feel like you actually watched the entire class and observed specific moments',
  `Use ${coachingModel.description}`,
];

/**
 * Things the generated question must avoid.
 * Behavior-preserving lift of the inline "AVOID" list.
 */
const avoid = [
  'Starting with "Reflecting on your lesson..."',
  'Being vague or generic',
  'Questions that could apply to any lesson',
  'Questions not rooted in actual transcript evidence',
];

module.exports = {
  NUM_REFLECTIVE_QUESTIONS,
  coachingModel,
  rules,
  avoid,
};
