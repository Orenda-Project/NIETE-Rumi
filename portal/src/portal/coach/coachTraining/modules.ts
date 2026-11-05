/**
 * Coach Training: the ICT HITL owner's nine coaching modules, one per behaviour of the coach-debrief rubric (the eight the
 * coach's debrief is judged on, in the rubric's order) and a ninth, the full debrief. Each module is a page she hosts
 * (a claude.ai artifact, checked to open signed out on a phone); moving them to the portal later is a change to this
 * file only. The programme's overview page asks for a sign-in, so it is not linked.
 *
 * BEHAVIOUR_MODULE maps the judge's rubric keys (bot observe-coach-feedback RUBRIC_KEYS + rehearsed_the_step) to their
 * module: the coach's Feedback Report links a missed behaviour to it.
 *
 * The bot holds the same map (bot/shared/config/coach-training-modules.js, for the Feedback Report's link); change both
 * or neither: modules.pin.test.ts fails the moment they disagree.
 */
/** `artifact` is the module's page; `video` its video lesson (the owner's DM, 5 Nov 2026: every module has both). */
export type CoachModule = { n: number; key: string; artifact: string; video: string; title: { en: string; ur: string } };

export const COACH_TRAINING_PATH = "/portal/coach/coach-training";
/** bd-rlxkkt.6 — a module's own screen: the choice between its PDF (the module page) and its Video. */
export const COACH_MODULE_PATH = `${COACH_TRAINING_PATH}/:n`;

export const COACH_MODULES: readonly CoachModule[] = [
  { n: 1, key: "praise", artifact: "Kfy7kDWtaZ4gQ2wX5BHceu", video: "TZdNqRi29i4mw3meZqDLFj", title: { en: "Open with specific praise", ur: "مخصوص تعریف سے آغاز" } },
  { n: 2, key: "moment", artifact: "NdMiwNiFxU5vcxfj8nFGmV", video: "BcHByTAsY9Ze1g146gaerz", title: { en: "Anchor it in a real moment", ur: "سبق کے اصل لمحے سے جوڑیں" } },
  { n: 3, key: "asked", artifact: "DSJ3usPDiwBEnTNc8jU4qz", video: "Jckd2SBKn38TwCRpwVXFeb", title: { en: "Ask, then wait", ur: "سوال پوچھیں، پھر انتظار کریں" } },
  { n: 4, key: "one", artifact: "V7XLdPCcyUZu1v1PGrZF9H", video: "WFug7nbTqtZDHc4pyDvTWL", title: { en: "One improvement, not a list", ur: "ایک بہتری، فہرست نہیں" } },
  { n: 5, key: "moves", artifact: "1wkxNT3zTTKSrEAwMV5VPN", video: "V8Z8G4UTREoXrzvdMRHPwG", title: { en: "The moves, not the person", ur: "طریقہ، ذات نہیں" } },
  { n: 6, key: "own", artifact: "CaqizBAbzEiAwMdKK2mNfx", video: "8PfwS2qKp3rtuwCJ1GiwAZ", title: { en: "The teacher’s own next step", ur: "استاد کا اپنا اگلا قدم" } },
  { n: 7, key: "less", artifact: "SBrvLUoSySSXCKVyshX72q", video: "GgzCzuPjSBYNFH7qspadNy", title: { en: "Talk less", ur: "کم بولیں، استاد کو بولنے دیں" } },
  { n: 8, key: "rehearse", artifact: "MGVm5YMAdQhRCrWRWWg65C", video: "FnhqM4ae3uV1XwwwgSYfYs", title: { en: "Rehearse it aloud", ur: "جانے سے پہلے زبانی پریکٹس" } },
  { n: 9, key: "full", artifact: "SZyvWZYrmMFn1XrhtnFGL8", video: "MUxJFCkertstuJXnNNF9LC", title: { en: "The full debrief", ur: "مکمل ڈی بریف" } },
];

/** The judge's rubric key → its module number. */
export const BEHAVIOUR_MODULE: Readonly<Record<string, number>> = {
  opened_with_specific_praise: 1,
  anchored_in_real_moment: 2,
  asked_and_waited: 3,
  one_improvement_only: 4,
  moves_not_teacher: 5,
  elicited_if_then: 6,
  righting_reflex_held: 7,
  rehearsed_the_step: 8,
};

export const moduleUrl = (m: CoachModule): string => `https://claude.ai/artifact/${m.artifact}`;
export const videoUrl = (m: CoachModule): string => `https://claude.ai/artifact/${m.video}`;
export const modulePath = (m: CoachModule): string => `${COACH_TRAINING_PATH}/${m.n}`;
export const moduleByNumber = (n: number): CoachModule | null => COACH_MODULES.find((m) => m.n === n) ?? null;

export function moduleFor(behaviour: string): CoachModule | null {
  const n = BEHAVIOUR_MODULE[behaviour];
  return n ? COACH_MODULES.find((m) => m.n === n) ?? null : null;
}
