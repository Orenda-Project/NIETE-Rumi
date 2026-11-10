'use strict';
/**
 * Coach Training — the coaching programme's nine modules, one per behaviour of the coach-debrief rubric (the eight a
 * coach's debrief is judged on, in the rubric's order) and a ninth, the full debrief. Each module is a page the ICT HITL
 * owner hosts (a claude.ai artifact, checked to open signed out on a phone); moving them is a change here only.
 *
 * Each module has its page (`artifact`) and its video lesson (`video`, the owner's DM 5 Nov 2026); the Coach Training
 * page offers both, and the Feedback Report links the module page.
 *
 * The coach's Feedback Report links its next focus to the module of that behaviour (observe-coach-rubric.js). The
 * portal holds the same map (portal/src/portal/coach/coachTraining/modules.ts, for the Coach Training page) and a test
 * there fails the moment the two disagree.
 */

const COACH_MODULES = Object.freeze([
  { n: 1, key: 'praise', artifact: 'Kfy7kDWtaZ4gQ2wX5BHceu', video: 'TZdNqRi29i4mw3meZqDLFj', title: { en: 'Open with specific praise', ur: 'مخصوص تعریف سے آغاز' } },
  { n: 2, key: 'moment', artifact: 'NdMiwNiFxU5vcxfj8nFGmV', video: 'BcHByTAsY9Ze1g146gaerz', title: { en: 'Anchor it in a real moment', ur: 'سبق کے اصل لمحے سے جوڑیں' } },
  { n: 3, key: 'asked', artifact: 'DSJ3usPDiwBEnTNc8jU4qz', video: 'Jckd2SBKn38TwCRpwVXFeb', title: { en: 'Ask, then wait', ur: 'سوال پوچھیں، پھر انتظار کریں' } },
  { n: 4, key: 'one', artifact: 'V7XLdPCcyUZu1v1PGrZF9H', video: 'WFug7nbTqtZDHc4pyDvTWL', title: { en: 'One improvement, not a list', ur: 'ایک بہتری، فہرست نہیں' } },
  { n: 5, key: 'moves', artifact: '1wkxNT3zTTKSrEAwMV5VPN', video: 'V8Z8G4UTREoXrzvdMRHPwG', title: { en: 'The moves, not the person', ur: 'طریقہ، ذات نہیں' } },
  { n: 6, key: 'own', artifact: 'CaqizBAbzEiAwMdKK2mNfx', video: '8PfwS2qKp3rtuwCJ1GiwAZ', title: { en: 'The teacher’s own next step', ur: 'استاد کا اپنا اگلا قدم' } },
  { n: 7, key: 'less', artifact: 'SBrvLUoSySSXCKVyshX72q', video: 'GgzCzuPjSBYNFH7qspadNy', title: { en: 'Talk less', ur: 'کم بولیں، استاد کو بولنے دیں' } },
  { n: 8, key: 'rehearse', artifact: 'MGVm5YMAdQhRCrWRWWg65C', video: 'FnhqM4ae3uV1XwwwgSYfYs', title: { en: 'Rehearse it aloud', ur: 'جانے سے پہلے زبانی پریکٹس' } },
  { n: 9, key: 'full', artifact: 'SZyvWZYrmMFn1XrhtnFGL8', video: 'MUxJFCkertstuJXnNNF9LC', title: { en: 'The full debrief', ur: 'مکمل ڈی بریف' } },
]);

/** The judge's rubric key → its module number. */
const BEHAVIOUR_MODULE = Object.freeze({
  opened_with_specific_praise: 1,
  anchored_in_real_moment: 2,
  asked_and_waited: 3,
  one_improvement_only: 4,
  moves_not_teacher: 5,
  elicited_if_then: 6,
  righting_reflex_held: 7,
  rehearsed_the_step: 8,
});

/** The capstone, for a debrief that missed nothing. */
const FULL_DEBRIEF_MODULE = 9;

const moduleUrl = (m) => `https://claude.ai/artifact/${m.artifact}`;
const moduleByNumber = (n) => COACH_MODULES.find((m) => m.n === n) || null;

/** @returns {object|null} the module for a rubric key, or null for anything else */
function moduleFor(behaviour) {
  const n = BEHAVIOUR_MODULE[behaviour];
  return n ? moduleByNumber(n) : null;
}

module.exports = { COACH_MODULES, BEHAVIOUR_MODULE, FULL_DEBRIEF_MODULE, moduleUrl, moduleFor, moduleByNumber };
