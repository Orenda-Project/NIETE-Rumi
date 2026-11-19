/**
 * bd-snkn32.56 (queue #134 E) — the words of "Start from a learning goal or topic" (every grade since bd-snkn32.57,
 * behind the list-only portal_lp_own_goal_start). Its own small catalogue (own/copy.ts is at the 300-line limit), registered through
 * lessons/copy.ts COPY_ENTRIES like OWN. The Urdu is MACHINE-DRAFTED from the words own/copy.ts already uses
 * (سبق, لیسن پلان, صفحات) and needs a human read before this is switched on for anyone beyond the pilot.
 */
import { bilingual, type Bilingual, type Words } from '../../i18n';
import type { CopyEntry } from '../../copyRegistry';

export const GOAL_COPY = {
  /* step 1's second way in (the #134 mockup: "Start from… A learning goal / Type a topic") */
  startFromGoal: 'Start from a learning goal or topic',
  startFromGoalHint: 'No textbook needed in class',
  /* the goal screen */
  title: 'Learning goal',
  outcomes: 'Learning goals for your grade',
  noOutcomes: 'No learning goals listed for this subject yet.',
  orTopic: 'Or type a topic',
  topicPlaceholder: 'e.g. Saving water at home',
  find: 'Find',
  closest: (t: string) => `Closest lesson: ${t}`,
  noMatch: 'Not found in your grade’s lessons. Try other words, or select a learning goal.',
  checkLabel: 'Learning goal',
  noBook: 'Written for a class with no textbook.',
  /* bd-snkn32.57 — "What you have" on the Check screen when, with no book, she ticked nothing */
  nothingExtra: 'Nothing extra',
};

const GOAL_COPY_UR: typeof GOAL_COPY = {
  startFromGoal: 'سیکھنے کے مقصد یا موضوع سے شروع کریں',
  startFromGoalHint: 'کلاس میں کتاب کی ضرورت نہیں',
  title: 'سیکھنے کا مقصد',
  outcomes: 'آپ کی جماعت کے سیکھنے کے مقاصد',
  noOutcomes: 'اس مضمون کے سیکھنے کے مقاصد ابھی موجود نہیں۔',
  orTopic: 'یا موضوع لکھیں',
  topicPlaceholder: 'مثلاً گھر میں پانی بچانا',
  find: 'تلاش کریں',
  closest: (t: string) => `قریب ترین سبق: ${t}`,
  noMatch: 'آپ کی جماعت کے لیسن پلان میں نہیں ملا۔ دوسرے الفاظ لکھیں، یا سیکھنے کا مقصد چنیں۔',
  checkLabel: 'سیکھنے کا مقصد',
  noBook: 'بغیر کتاب والی کلاس کے لیے لکھا گیا۔',
  nothingExtra: 'کچھ اضافی نہیں',
};

export const GOAL = bilingual(GOAL_COPY, GOAL_COPY_UR);
export type GoalCopy = Words<typeof GOAL_COPY>;

export const GOAL_COPY_ENTRY: CopyEntry = {
  screen: 'Lesson Plans · Make my own · learning goal',
  module: GOAL as Bilingual<unknown>,
  same: [],
  // The way in, its hint, the list's heading, the empty and not-found states and the Check line are sentences.
  longOk: ['startFromGoal', 'startFromGoalHint', 'outcomes', 'noOutcomes', 'orTopic', 'topicPlaceholder', 'closest', 'noMatch', 'noBook', 'title', 'checkLabel'],
};
