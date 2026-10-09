/**
 * bd-fmf24g.8 — every word the teacher v2 Analytics page shows (the feature's own copy file).
 *
 * Same rules as the new UI's copy: 1–3 words, 4 at most, no sentences, no question marks. English only
 * for now. DATA is not copy: a remark's comment, an area's name, a cycle's name come from the API as
 * they are. Ratings are BANDS (lib/scoreBands), never numbers.
 *
 * bd-fmf24g.13 — bilingual: ANALYTICS = { en, ur }, read with useCopy(ANALYTICS); the model's helpers take
 * the words as a parameter. Band names are the bot's own (ux-strings.js scoreBand*). The Urdu is
 * MACHINE-DRAFTED from the bot's existing Urdu and awaits a human review (workbench/…/urdu-review/).
 */
import type { BandKey } from '../../lib/scoreBands';
import { bilingual, type Bilingual, type Words } from '../i18n';
import type { CopyEntry } from '../copyRegistry';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export const ANALYTICS_V2_COPY = {
  title: 'Analytics',
  more: 'More',
  activity: 'Activity',
  lessonPlansUsed: 'Lesson Plans',
  modulesDone: 'Courses done',
  papersMade: 'Assessments',
  attendanceDays: 'Attendance days',
  observationsHeading: 'Observations',
  observations: 'Coach Observations',
  digitalCoaching: 'Digital Coaching',
  allLessonPlans: 'All Lesson Plans',
  allDigitalCoaching: 'All DC Observations',
  ratingOverTime: 'Rating over time',
  noRatingsYet: 'No ratings yet',
  strongestToWeakest: 'Strongest to weakest',
  focus: 'Focus',
  attendance: 'Attendance',
  youWerePresent: 'Present',
  yourStudents: 'Students',
  pct: (n: number) => `${Math.round(n)}%`,
  daysOf: (present: number, of: number) => `${present} of ${of} days`,
  present: 'present',
  principalRemarks: 'Principal remarks',
  noRemarksYet: 'No remarks yet',
  /** A day as the canvas writes it: "28 Sep". */
  day: (d: number, m: number) => `${d} ${MONTHS[m] ?? ''}`.trim(),
  loading: 'Loading',
  mySchool: 'My school',
  me: 'Me',
  teachers: 'Teachers',
  teachersN: (n: number) => `${n} teachers`,
  teacherCounts: (obs: number, dc: number) => `${obs} Observations · ${dc} DC`,
  noTeachers: 'No teachers yet',
  notFound: 'Not found',
  /** The rating bands, best first (lib/scoreBands keys) — the chart's rows and the area chips. */
  bands: {
    excellent: 'Excellent',
    good: 'Good',
    average: 'Average',
    below_average: 'Below average',
    needs_support: 'Needs support',
  } satisfies Record<BandKey, string>,
} as const;

const MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'] as const;

/** bd-fmf24g.13 — Analytics' words in Urdu (MACHINE-DRAFTED; review pending). Western digits, as the bot. */
export const ANALYTICS_V2_COPY_UR: Words<typeof ANALYTICS_V2_COPY> = {
  title: 'تجزیہ',
  more: 'مزید',
  activity: 'سرگرمی',
  lessonPlansUsed: 'لیسن پلان',
  modulesDone: 'مکمل کورسز',
  papersMade: 'پرچہ',
  attendanceDays: 'حاضری کے دن',
  observationsHeading: 'مشاہدات',
  observations: 'مشاہدات',
  digitalCoaching: 'ڈیجیٹل کوچنگ',
  allLessonPlans: 'تمام لیسن پلان',
  allDigitalCoaching: 'تمام ڈیجیٹل کوچنگ مشاہدات',
  ratingOverTime: 'وقت کے ساتھ کارکردگی',
  noRatingsYet: 'ابھی کارکردگی دستیاب نہیں',
  strongestToWeakest: 'مضبوط سے کمزور',
  focus: 'توجہ طلب',
  attendance: 'حاضری',
  youWerePresent: 'حاضر',
  yourStudents: 'طلبہ',
  pct: (n: number) => `${Math.round(n)}%`,
  daysOf: (present: number, of: number) => `${present}/${of} دن`,
  present: 'حاضر',
  principalRemarks: 'ہیڈ ٹیچر کے تبصرے',
  noRemarksYet: 'ابھی کوئی تبصرہ نہیں',
  day: (d: number, m: number) => `${d} ${MONTHS_UR[m] ?? ''}`.trim(),
  loading: 'لوڈ ہو رہا ہے',
  mySchool: 'میرا اسکول',
  me: 'میں',
  teachers: 'ٹیچرز',
  teachersN: (n: number) => `${n} ٹیچرز`,
  teacherCounts: (obs: number, dc: number) => `${obs} مشاہدات · ${dc} DC`,
  noTeachers: 'ابھی کوئی ٹیچر نہیں',
  notFound: 'نہیں ملا',
  bands: {
    excellent: 'بہترین',
    good: 'اچھا',
    average: 'اوسط',
    below_average: 'اوسط سے کم',
    needs_support: 'مدد درکار',
  },
};

/** Analytics' words in both languages. */
export const ANALYTICS = bilingual(ANALYTICS_V2_COPY, ANALYTICS_V2_COPY_UR);
export type AnalyticsCopy = Words<typeof ANALYTICS_V2_COPY>;

/** Registered for the completeness checks and the review file (copyRegistry). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'Analytics',
  module: ANALYTICS as Bilingual<unknown>,
  // "95%" — a number and a sign, the same in both languages.
  same: ['pct'],
};
