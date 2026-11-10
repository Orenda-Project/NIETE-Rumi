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
  /* grades 1–5 (bd-snkn32.4, the product reviewer's call): step 1 picks a day, as the chapter page lists them */
  day: 'Which day?',
  dayLabel: 'Day',
  dayN: (n: number) => `Day ${n}`,
  /* grades 1–5 book pages (bd-snkn32.17): the day's own, ready to change */
  pagesHint: 'Change them if you will teach other pages.',
  pageFrom: 'From page',
  pageTo: 'To page',
  addNextDay: (r: string) => `Add the next day's pages (p.${r})`,
  badPages: 'Check the pages: first page, then last, 10 pages at most.',
  pagesShort: (r: string) => `p.${r}`,
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
    /* grades 6–12 (bd-snkn32.13) */
    worked: 'Worked examples', numericals: 'Numericals step by step', practical: 'Demonstration or practical',
    inquiry: 'Inquiry', concept_map: 'Concept map', discussion: 'Structured discussion', reading: 'Close reading',
    past_paper: 'Past-paper practice',
  },
  /* grades 6–12: what the lesson is for, and (a mixed lesson) which outcomes first (bd-snkn32.13) */
  purpose: 'What is this lesson for?',
  purposeLabel: 'Lesson for',
  purposes: { new: 'Teach new', revise: 'Revise', board: 'Board exam practice', reteach: 'Re-teach' },
  focus: 'Which outcomes first?',
  focusLabel: 'Outcomes first',
  foci: { summative: 'Board exam (Summative)', formative: 'Classroom (Formative)' },
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
  day: 'کون سا دن؟',
  dayLabel: 'دن',
  dayN: (n: number) => `دن ${n}`,
  pagesHint: 'اگر آپ دوسرے صفحات پڑھائیں گی تو بدل دیں۔',
  pageFrom: 'صفحہ سے',
  pageTo: 'صفحہ تک',
  addNextDay: (r: string) => `اگلے دن کے صفحات بھی (ص ${r})`,
  badPages: 'صفحات دیکھیں: پہلا صفحہ، پھر آخری، زیادہ سے زیادہ 10 صفحات۔',
  pagesShort: (r: string) => `ص ${r}`,
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
    tarl: 'ہر بچے کی سطح پر پڑھائیں', cpa: 'چیزیں ← تصویریں ← اعداد', phonics: 'پہلے آوازیں',
    games: 'کھیل اور حرکت', story: 'کہانی اور بات چیت',
    worked: 'حل شدہ مثالیں', numericals: 'سوالات مرحلہ وار', practical: 'عملی مظاہرہ',
    inquiry: 'سوال اور تحقیق', concept_map: 'تصوراتی نقشہ', discussion: 'منظم بحث', reading: 'غور سے پڑھنا',
    past_paper: 'پچھلے پرچوں کی مشق',
  },
  purpose: 'یہ سبق کس لیے ہے؟',
  purposeLabel: 'سبق کا مقصد',
  purposes: { new: 'نیا پڑھائیں', revise: 'دہرائی', board: 'بورڈ امتحان کی تیاری', reteach: 'دوبارہ پڑھائیں' },
  focus: 'پہلے کون سے نتائج؟',
  focusLabel: 'پہلے نتائج',
  foci: { summative: 'بورڈ امتحان (Summative)', formative: 'کلاس روم (Formative)' },
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
  // A step's question ("Which day?", "What is this lesson for?") is a title, not a label (bd-snkn32.13).
  longOk: ['ways.tarl', 'ways.cpa', 'suggested', 'resourceNames.charts', 'objectsHint', 'level', 'makeMyPlan', 'day', 'purpose', 'focus',
    'pagesHint', 'badPages', 'addNextDay'],
};
