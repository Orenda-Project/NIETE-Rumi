/**
 * Coaching Debrief Configuration
 *
 * Single source of truth for the post-analysis reflective debrief's
 * COACHING MODEL, the meta-prompt rules/avoid lists, and the number of
 * reflective questions asked in a debrief.
 *
 * NUM_REFLECTIVE_QUESTIONS is the single source for:
 *  - the "< N" loop bound in reflective-conversation.service.js
 *  - the "question X of N" string in the meta-prompt
 *  - the number of few-shot example arms wired into the meta-prompt
 * Changing it here MUST keep all three in lockstep (enforced by
 * tests/coaching/coaching-debrief-config.test.js).
 *
 * NOTE — `coachingModel`, `rules`, and `avoid` below feed the LEGACY
 * one-shot reflective-question prompt in `gpt5-mini.service.js`
 * (`generateReflectiveQuestion`). The v12 reflective chain
 * (`extractReflectiveCorpus` + `_generateReflectiveQuestionV12`)
 * does NOT consume these — its prompts live in
 * `coaching/reflective-questions/`. Both paths currently coexist; the
 * legacy fields stay because `reflective-conversation.service.js` still
 * dispatches to `generateReflectiveQuestion` and the existing test
 * `coaching-debrief-config.test.js` asserts their shape. The consumer
 * flip to the v12 chain is a follow-up PR.
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
