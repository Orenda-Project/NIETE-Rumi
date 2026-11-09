/**
 * bd-snkn32 — every word the "Make my own" lesson plan screens show (the flow draft, artifact KbsvCwJgs6QWy1DQmGjfzi).
 *
 * NEW VOCABULARY, PENDING THE OPERATOR (the draft's "Still open" 5): "Make my own", "Make my plan", "Mine" and the five
 * question names are not in the ontology yet. The English is the draft's; the Urdu is MACHINE-DRAFTED from the
 * ontology's existing words (صفحات Pages, تبدیل کریں Change, لیسن پلان, نہیں بن سکا) and awaits a human review.
 * Registered through lessons/copy.ts COPY_ENTRIES (the registry globs only teacher/<feature>/copy.ts).
 */

import { bilingual, type Bilingual, type Words } from '../../i18n';
import type { CopyEntry } from '../../copyRegistry';

export const OWN_COPY = {
  /* the chapter page's card (bd-oitowp: first on the page, no heading; "Lesson plan" says what she makes) */
  makeMyOwn: 'Make my own',
  lessonPlanFive: 'Lesson plan · 5 questions',
  /* the steps */
  title: 'Make my own',
  ok: 'OK',
  pages: 'Book pages',
  size: 'Children in class',
  sizes: { up30: 'Up to 30', '31_50': '31 – 50', '51_70': '51 – 70', over70: 'More than 70' },
  resources: 'What you have',
  resourceNames: {
    textbook: 'Textbook', board: 'Board', charts: 'Charts or flashcards', objects: 'Things from around', audio: 'Phone or speaker',
  },
  objectsHint: 'Stones, sticks, bottle caps',
  level: 'Your class and the book',
  levels: { behind: 'Behind', on_track: 'On track', ahead: 'Ahead', mixed: 'Mixed' },
  way: 'Teaching way',
  suggested: 'Suggested for your class',
  ways: {
    tarl: "Teach at each child's level", cpa: 'Things → pictures → numbers', phonics: 'Sounds first',
    games: 'Games and movement', story: 'Story and talk',
  },
  /* the check screen */
  yourPlan: 'Your plan',
  note: 'Anything else',
  optional: 'optional',
  makeMyPlan: 'Make my plan',
  /* failures */
  couldNotMake: "Couldn't make it",
  tryAgain: 'Try again',
} as const;

const OWN_COPY_UR: Words<typeof OWN_COPY> = {
  makeMyOwn: 'اپنا بنائیں',
  lessonPlanFive: 'لیسن پلان · 5 سوال',
  title: 'اپنا بنائیں',
  ok: 'ٹھیک ہے',
  pages: 'کتاب کے صفحات',
  size: 'کلاس میں بچے',
  sizes: { up30: '30 تک', '31_50': '31 – 50', '51_70': '51 – 70', over70: '70 سے زیادہ' },
  resources: 'آپ کے وسائل',
  resourceNames: {
    textbook: 'نصابی کتاب', board: 'بورڈ', charts: 'چارٹ یا فلیش کارڈ', objects: 'آس پاس کی چیزیں', audio: 'فون یا اسپیکر',
  },
  objectsHint: 'کنکر، تیلیاں، ڈھکن',
  level: 'آپ کی کلاس اور کتاب',
  levels: { behind: 'پیچھے', on_track: 'ساتھ ساتھ', ahead: 'آگے', mixed: 'ملی جلی' },
  way: 'پڑھانے کا طریقہ',
  suggested: 'آپ کی کلاس کے لیے تجویز',
  ways: {
    tarl: 'درست سطح پر پڑھائیں', cpa: 'چیزیں ← تصویریں ← اعداد', phonics: 'پہلے آوازیں',
    games: 'کھیل اور حرکت', story: 'کہانی اور بات چیت',
  },
  yourPlan: 'آپ کا لیسن پلان',
  note: 'کچھ اور',
  optional: 'اختیاری',
  makeMyPlan: 'میرا لیسن پلان بنائیں',
  couldNotMake: 'نہیں بن سکا',
  tryAgain: 'دوبارہ کوشش کریں',
};

export const OWN = bilingual(OWN_COPY, OWN_COPY_UR);
export type OwnCopy = Words<typeof OWN_COPY>;

export const OWN_COPY_ENTRY: CopyEntry = {
  screen: 'Lesson Plans · Make my own',
  module: OWN as Bilingual<unknown>,
  // Digits and dashes read the same in both languages.
  same: ['sizes.31_50', 'sizes.51_70'],
  // A suggestion's name mirrors the FLN strategy's own name word for word.
  longOk: ['ways.tarl', 'ways.cpa', 'suggested', 'resourceNames.charts', 'objectsHint', 'level', 'makeMyPlan'],
};
