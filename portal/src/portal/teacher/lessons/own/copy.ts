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
  lessonPlanFive: 'Lesson plan · about 1 minute',
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
  sizeSecondary: 'Students in class',
  sizes: { up30: 'Up to 30', '31_50': '31 – 50', '51_70': '51 – 70', over70: 'More than 70' },
  resources: 'What you have',
  resourceNames: {
    textbook: 'Textbook', board: 'Board', charts: 'Charts or flashcards', objects: 'Things from around', audio: 'Phone or speaker',
  },
  objectsHint: 'Stones, sticks, bottle caps',
  /* grades 6–12: the same codes, named for a subject classroom */
  resourceNames612: {
    textbook: 'Textbook', board: 'Board', charts: 'Charts or diagrams', objects: 'Lab things or models', audio: 'Phone (video or audio)',
  },
  objectsHint612: 'Magnets, beakers, a globe, a ruler',
  tickAll: 'Tick all you have',
  level: 'Where is your class on these pages?',
  levels: { behind: 'Behind', on_track: 'On track', ahead: 'Ahead', mixed: 'Mixed' },
  way: 'Teaching way',
  suggested: 'Suggested for your class',
  ways: {
    tarl: "Teach at each child's level", cpa: 'Things → pictures → numbers (CPA)', phonics: 'Sounds first (phonics)',
    games: 'Games and movement', story: 'Story and talk',
    /* grades 6–12 (bd-snkn32.13) */
    worked: 'Worked examples', numericals: 'Numericals step by step', practical: 'Demonstration or practical',
    inquiry: 'Inquiry', concept_map: 'Concept map', discussion: 'Structured discussion', reading: 'Close reading',
    writing: 'Model, plan, write', past_paper: 'Past-paper practice', exam_fde: 'Exam practice (FDE)',
  },
  /* GRR is never an option: a fixed line on the way screen and the plan */
  grrLine: 'I do → We do → You do stays in every plan. No rote drill.',
  /* grades 6–12: what the lesson is for, and (a mixed lesson) which outcomes first (bd-snkn32.13) */
  purpose: 'What is this lesson for?',
  purposeLabel: 'Lesson for',
  purposes: { new: 'Teach new', revise: 'Revise', board: 'Board exam practice', reteach: 'Re-teach' },
  purposeHints: { revise: 'Go over it before a test', reteach: "They didn't get it the first time" },
  purposeBoardFde: 'Exam practice (FDE)',
  focus: 'Which outcomes first?',
  focusLabel: 'Outcomes first',
  foci: { summative: 'Board exam outcomes first', formative: 'Classroom outcomes first' },
  focusCount: (n: number) => (n === 1 ? '1 outcome' : `${n} outcomes`),
  /* step 1 for every band: the lesson, its pages, and the book itself */
  whichLesson: 'Which lesson?',
  lessonN: (n: number) => `Lesson ${n}`,
  change: 'Change',
  pagesOneHint: 'For one page, put the same number in both.',
  badPages612: "Check the pages: inside this lesson, or to the end of the next lesson's.",
  addNextLesson: (r: string) => `Add the next lesson's pages (p.${r})`,
  bothHow: 'How will you teach both?',
  fromYourBook: 'From your book',
  pageN: (n: number) => `Page ${n}`,
  pageMissing: (n: number) => `Page ${n} is missing from our copy of the book`,
  bookNotLoaded: 'Book text not loaded for this book yet',
  picturesPending: 'Text from your book. Page pictures: design pending.',
  showAll: 'Show all',
  showLess: 'Show less',
  /* bd-snkn32.14 — add the next lesson's pages (step 1, grades 6–12, not on a chapter's last lesson) */
  addNext: "Add the next lesson's pages",
  nextLesson: 'Next lesson',
  extendNone: 'No, just these pages',
  extends: { one_period: 'Cover more in one period', double: 'Double period' },
  extendHints: { one_period: 'Both lessons in one period', double: 'Two periods together' },
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
  /* her plan, section by section */
  changeSection: (n: number) => `Change this section (${n} left)`,
  changed: 'Changed',
  unchanged: 'Unchanged',
  before: 'Before',
  after: 'After',
  partNames: {
    hook: 'Hook', i_do: 'I do', we_do: 'We do', you_do: 'You do', wrap: 'Wrap-up',
    objectives: 'Objectives', introduction: 'Introduction', development: 'Development', activity: 'Activity',
    conclusion: 'Conclusion', homework: 'Homework',
  },
  /* bd-snkn32.20 — her plans for this chapter, reopened from step 1 */
  myPlans: 'Your plans for this chapter',
  changesLeft: (n: number) => (n === 0 ? 'No more changes' : n === 1 ? '1 more change' : `${n} more changes`),
  beingMade: 'Being made',
  usedBoth: "You've used both changes. To start fresh, make a new plan from the chapter.",
  refusals: {
    too_short: 'Please say a little more about what should change.',
    too_small: 'Small fixes like this you can make by hand on the plan.',
    repeat: 'You asked for this change already. Ask for something different.',
    in_flight: 'Your plan is still being changed. Please wait for it.',
    cap_reached: "You've used both changes. To start fresh, make a new plan from the chapter.",
    daily_limit: "You've made 5 plans today. You can make more tomorrow.",
    grr: 'Each lesson keeps I do, We do and You do. Change how it is taught, not whether.',
    rote: "Plans don't use rote drill. Say what children should understand or do instead.",
  },
} as const;

const OWN_COPY_UR: Words<typeof OWN_COPY> = {
  makeMyOwn: 'اپنا بنائیں',
  lessonPlanFive: 'لیسن پلان · تقریباً 1 منٹ',
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
  sizeSecondary: 'کلاس میں طلبہ',
  sizes: { up30: '30 تک', '31_50': '31 – 50', '51_70': '51 – 70', over70: '70 سے زیادہ' },
  resources: 'آپ کے وسائل',
  resourceNames: {
    textbook: 'نصابی کتاب', board: 'بورڈ', charts: 'چارٹ یا فلیش کارڈ', objects: 'آس پاس کی چیزیں', audio: 'فون یا اسپیکر',
  },
  objectsHint: 'کنکر، تیلیاں، ڈھکن',
  resourceNames612: {
    textbook: 'نصابی کتاب', board: 'بورڈ', charts: 'چارٹ یا خاکے', objects: 'لیب کا سامان یا ماڈل', audio: 'فون (ویڈیو یا آڈیو)',
  },
  objectsHint612: 'مقناطیس، بیکر، گلوب، فٹا',
  tickAll: 'جو کچھ آپ کے پاس ہے، سب پر نشان لگائیں',
  level: 'ان صفحات پر آپ کی کلاس کہاں ہے؟',
  levels: { behind: 'پیچھے', on_track: 'ساتھ ساتھ', ahead: 'آگے', mixed: 'ملی جلی' },
  way: 'پڑھانے کا طریقہ',
  suggested: 'آپ کی کلاس کے لیے تجویز',
  ways: {
    tarl: 'ہر بچے کی سطح پر پڑھائیں', cpa: 'چیزیں ← تصویریں ← اعداد (CPA)', phonics: 'پہلے آوازیں (phonics)',
    games: 'کھیل اور حرکت', story: 'کہانی اور بات چیت',
    worked: 'حل شدہ مثالیں', numericals: 'سوالات مرحلہ وار', practical: 'عملی مظاہرہ',
    inquiry: 'سوال اور تحقیق', concept_map: 'تصوراتی نقشہ', discussion: 'منظم بحث', reading: 'غور سے پڑھنا',
    writing: 'نمونہ، خاکہ، تحریر', past_paper: 'پچھلے پرچوں کی مشق', exam_fde: 'امتحان کی تیاری (FDE)',
  },
  grrLine: 'میں کروں ← ہم کریں ← آپ کریں ہر لیسن پلان میں رہتا ہے۔ رٹا نہیں۔',
  purpose: 'یہ سبق کس لیے ہے؟',
  purposeLabel: 'سبق کا مقصد',
  purposes: { new: 'نیا پڑھائیں', revise: 'دہرائی', board: 'بورڈ امتحان کی تیاری', reteach: 'دوبارہ پڑھائیں' },
  purposeHints: { revise: 'ٹیسٹ سے پہلے دہرائی', reteach: 'پہلی بار سمجھ نہیں آیا' },
  purposeBoardFde: 'امتحان کی تیاری (FDE)',
  focus: 'پہلے کون سے نتائج؟',
  focusLabel: 'پہلے نتائج',
  foci: { summative: 'پہلے بورڈ امتحان کے نتائج', formative: 'پہلے کلاس روم کے نتائج' },
  focusCount: (n: number) => `${n} نتائج`,
  whichLesson: 'کون سا سبق؟',
  lessonN: (n: number) => `سبق ${n}`,
  change: 'تبدیل کریں',
  pagesOneHint: 'ایک صفحے کے لیے دونوں میں ایک ہی نمبر لکھیں۔',
  badPages612: 'صفحات دیکھیں: اسی سبق کے اندر، یا اگلے سبق کے آخر تک۔',
  addNextLesson: (r: string) => `اگلے سبق کے صفحات بھی (ص ${r})`,
  bothHow: 'دونوں کیسے پڑھائیں گی؟',
  fromYourBook: 'آپ کی کتاب سے',
  pageN: (n: number) => `صفحہ ${n}`,
  pageMissing: (n: number) => `صفحہ ${n} ہماری کتاب کی کاپی میں نہیں ہے`,
  bookNotLoaded: 'اس کتاب کا متن ابھی شامل نہیں ہوا',
  picturesPending: 'متن آپ کی کتاب سے ہے۔ صفحات کی تصویریں: ڈیزائن زیر غور۔',
  showAll: 'سب دکھائیں',
  showLess: 'کم دکھائیں',
  addNext: 'اگلے سبق کے صفحات بھی شامل کریں',
  nextLesson: 'اگلا سبق',
  extendNone: 'نہیں، صرف یہی صفحات',
  extends: { one_period: 'ایک پیریڈ میں زیادہ پڑھائیں', double: 'ڈبل پیریڈ' },
  extendHints: { one_period: 'دونوں سبق ایک پیریڈ میں', double: 'دو پیریڈ اکٹھے' },
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
  changeSection: (n: number) => `یہ حصہ تبدیل کریں · ${n} باقی`,
  changed: 'تبدیل شدہ',
  unchanged: 'بغیر تبدیلی',
  before: 'پہلے',
  after: 'بعد میں',
  partNames: {
    hook: 'آغاز', i_do: 'میں کروں', we_do: 'ہم کریں', you_do: 'آپ کریں', wrap: 'اختتام',
    objectives: 'مقاصد', introduction: 'تعارف', development: 'تفصیل', activity: 'سرگرمی',
    conclusion: 'خلاصہ', homework: 'گھر کا کام',
  },
  myPlans: 'اس باب کے آپ کے لیسن پلان',
  changesLeft: (n: number) => (n === 0 ? 'کوئی تبدیلی باقی نہیں' : n === 1 ? '1 تبدیلی باقی' : `${n} تبدیلیاں باقی`),
  beingMade: 'بن رہا ہے',
  usedBoth: 'آپ دونوں تبدیلیاں کر چکی ہیں۔ نئے سرے سے شروع کرنے کے لیے باب سے نیا لیسن پلان بنائیں۔',
  refusals: {
    too_short: 'براہ مہربانی تھوڑا اور بتائیں کہ کیا تبدیل ہو۔',
    too_small: 'ایسی چھوٹی درستیاں آپ لیسن پلان پر خود کر سکتی ہیں۔',
    repeat: 'آپ یہ تبدیلی پہلے مانگ چکی ہیں۔ کچھ مختلف مانگیں۔',
    in_flight: 'آپ کا لیسن پلان ابھی تبدیل ہو رہا ہے۔ براہ مہربانی انتظار کریں۔',
    cap_reached: 'آپ دونوں تبدیلیاں کر چکی ہیں۔ نئے سرے سے شروع کرنے کے لیے باب سے نیا لیسن پلان بنائیں۔',
    daily_limit: 'آج آپ 5 لیسن پلان بنا چکی ہیں۔ کل مزید بنا سکیں گی۔',
    grr: 'ہر سبق میں میں کروں، ہم کریں اور آپ کریں رہتے ہیں۔ یہ بدلیں کہ کیسے پڑھایا جائے، یہ نہیں کہ پڑھایا جائے یا نہیں۔',
    rote: 'لیسن پلان رٹا نہیں لگواتے۔ بتائیں کہ بچے کیا سمجھیں یا کریں۔',
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
  // A step's question ("Which day?", "What is this lesson for?") is a title, not a label (bd-snkn32.13).
  longOk: ['ways.tarl', 'ways.cpa', 'suggested', 'resourceNames.charts', 'objectsHint', 'level', 'makeMyPlan', 'day', 'purpose', 'focus',
    'pagesHint', 'badPages', 'addNextDay',
    // bd-snkn32.14 — the two shapes are named in full: "one period" vs "double" is the whole choice.
    'addNext', 'extends.one_period', 'extendHints',
    // bd-snkn32.15 — Change this plan: its titles and questions, and each refusal she is told about, are sentences.
    'changeThisPlan', 'changeTitle', 'whichPart', 'whatToChange', 'changeHint', 'changeMyPlan', 'usedBoth', 'refusals',
    // the unified flow: questions, hints, guardrail lines and the book's states are sentences; a resource
    // or way named for a subject classroom, and a label carrying its method in brackets, run past four words.
    'tickAll', 'resourceNames612', 'objectsHint612', 'ways.writing', 'ways.phonics', 'ways.exam_fde', 'grrLine', 'purposeHints',
    'purposeBoardFde', 'foci', 'whichLesson', 'pagesOneHint', 'badPages612', 'addNextLesson', 'bothHow', 'fromYourBook',
    'pageMissing', 'bookNotLoaded', 'picturesPending', 'changeSection', 'lessonPlanFive', 'sizeSecondary',
    'myPlans', 'changesLeft'],
};
