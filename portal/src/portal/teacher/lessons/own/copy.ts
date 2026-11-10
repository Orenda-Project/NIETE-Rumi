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
  /* bd-snkn32.15 — Change this plan (up to two changes; the bot refuses what is not worth a new plan) */
  changeThisPlan: (n: number) => `Change this plan (${n} left)`,
  changeTitle: 'Change this plan',
  whichPart: 'Which part?',
  whatToChange: 'What should change?',
  changeHint: 'Say what to do differently, in your own words.',
  changeMyPlan: 'Change my plan',
  partNames: {
    hook: 'Hook', i_do: 'I do', we_do: 'We do', you_do: 'You do', wrap: 'Wrap-up',
    objectives: 'Objectives', introduction: 'Introduction', development: 'Development', activity: 'Activity',
    conclusion: 'Conclusion', homework: 'Homework', whole: 'The whole plan',
  },
  usedBoth: "You've used both changes. To start fresh, make a new plan from the chapter.",
  refusals: {
    too_short: 'Please say a little more about what should change.',
    too_small: 'Small fixes like this you can make by hand on the plan.',
    repeat: 'You asked for this change already. Ask for something different.',
    in_flight: 'Your plan is still being changed. Please wait for it.',
    cap_reached: "You've used both changes. To start fresh, make a new plan from the chapter.",
    daily_limit: "You've made 5 plans today. You can make more tomorrow.",
  },
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
  },
  yourPlan: 'آپ کا لیسن پلان',
  note: 'کچھ اور',
  optional: 'اختیاری',
  makeMyPlan: 'میرا لیسن پلان بنائیں',
  couldNotMake: 'نہیں بن سکا',
  tryAgain: 'دوبارہ کوشش کریں',
  changeThisPlan: (n: number) => `یہ لیسن پلان تبدیل کریں (${n} باقی)`,
  changeTitle: 'یہ لیسن پلان تبدیل کریں',
  whichPart: 'کون سا حصہ؟',
  whatToChange: 'کیا تبدیل ہو؟',
  changeHint: 'اپنے الفاظ میں بتائیں کہ کیا مختلف کرنا ہے۔',
  changeMyPlan: 'میرا لیسن پلان تبدیل کریں',
  partNames: {
    hook: 'آغاز', i_do: 'میں کروں', we_do: 'ہم کریں', you_do: 'آپ کریں', wrap: 'اختتام',
    objectives: 'مقاصد', introduction: 'تعارف', development: 'تفصیل', activity: 'سرگرمی',
    conclusion: 'خلاصہ', homework: 'گھر کا کام', whole: 'پورا لیسن پلان',
  },
  usedBoth: 'آپ دونوں تبدیلیاں کر چکی ہیں۔ نئے سرے سے شروع کرنے کے لیے باب سے نیا لیسن پلان بنائیں۔',
  refusals: {
    too_short: 'براہ مہربانی تھوڑا اور بتائیں کہ کیا تبدیل ہو۔',
    too_small: 'ایسی چھوٹی درستیاں آپ لیسن پلان پر خود کر سکتی ہیں۔',
    repeat: 'آپ یہ تبدیلی پہلے مانگ چکی ہیں۔ کچھ مختلف مانگیں۔',
    in_flight: 'آپ کا لیسن پلان ابھی تبدیل ہو رہا ہے۔ براہ مہربانی انتظار کریں۔',
    cap_reached: 'آپ دونوں تبدیلیاں کر چکی ہیں۔ نئے سرے سے شروع کرنے کے لیے باب سے نیا لیسن پلان بنائیں۔',
    daily_limit: 'آج آپ 5 لیسن پلان بنا چکی ہیں۔ کل مزید بنا سکیں گی۔',
  },
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
