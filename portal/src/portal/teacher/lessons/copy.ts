/**
 * bd-fmf24g.3 — every word the teacher v2 Lesson Plans screens show, in one place (the feature's own
 * copy file, so parallel feature PRs never collide on a shared one).
 *
 * bd-fmf24g.13 — bilingual: LESSONS = { en, ur }, read with useCopy(LESSONS); plain helpers take the words as
 * a parameter. The Urdu is MACHINE-DRAFTED from the bot's existing Urdu (ux-strings.js: لیسن پلان, اسباق,
 * کھولیں, ورک شیٹ…) and awaits a human review (workbench/teacher-v2-impl/urdu-review/).
 *
 * Same rules as the new UI's copy (newui/copy.ts, DESIGN.md): an icon carries the meaning, the word
 * names it — 1–3 words, 4 at most, no sentences, no question marks. English only for now; the Urdu
 * pass gives each key an Urdu value. DATA is not copy: a plan's title, a subject's name, a chapter's
 * title come from the API as they are.
 */

import { bilingual, type Words } from '../i18n';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export const LESSONS_V2_COPY = {
  title: 'Lesson Plans',
  back: 'Back',
  /* the main page */
  home: 'Home',
  selectClass: 'Select your class',
  or: 'or',
  anyGradeOrSubject: 'Any grade or subject',
  open: 'Open',
  recent: 'Recent Lesson Plans',
  noLessonPlansYet: 'No lesson plans yet',
  ready: 'Ready',
  /** A plan the catalogue no longer names. */
  planFallback: 'Lesson plan',
  grade: (g: number) => `Grade ${g}`,
  /** Over a chapter's number in its row ("CHAP" over 1). */
  chapterPrefix: 'Chap',
  /** Over a lesson's number in its row ("LP #" over 4). */
  lessonPrefix: 'LP #',
  lessonsCount: (n: number) => (n === 1 ? '1 lesson' : `${n} lessons`),
  part: (n: number) => `Part ${n}`,
  worksheet: 'Worksheet',
  revision: 'Revision',
  /** The breadcrumb over a page: its parts joined ("Math · Chap 1"). */
  crumb: (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · '),
  /* loading */
  loadFailed: 'Could not load',
  tryAgain: 'Try again',
  nothingHere: 'Nothing here yet',
  /* opening */
  notReady: 'Not ready yet',
  notAvailable: 'Not available',
  couldNotOpen: 'Could not open',
  /* preparing */
  preparing: 'Preparing',
  aboutTwoMinutes: '~2 min',
  opensByItself: 'Opens by itself',
  notPrepared: 'Could not prepare',
  otherLessons: 'Other lessons',
  /* the viewer */
  startDc: 'Start DC observation',
  answerKey: 'Answer key',
  openOutside: 'Open in another app',
  all: {
    title: 'All lesson plans',
    filterLabel: 'Filter by class',
    showAllClasses: 'Show all classes',
    empty: 'No lesson plans here',
    opened: 'Opened',
    whatsapp: 'WhatsApp',
    chapter: (n: number) => `Chap ${n}`,
    kpis: {
      lessonPlans: 'Lesson plans',
      classesCovered: 'Classes covered',
      sentOnWhatsapp: 'Sent on WhatsApp',
      daysActive: 'Days active',
    },
  },
  days: {
    today: 'Today',
    yesterday: 'Yesterday',
    /** "Mon 5 Oct". */
    date: (weekday: number, day: number, month: number) => `${WEEKDAYS[weekday]} ${day} ${MONTHS[month]}`,
  },
} as const;

const WEEKDAYS_UR = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'] as const;
const MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'] as const;

/** bd-fmf24g.13 — Lesson Plans' words in Urdu (MACHINE-DRAFTED; review pending). Western digits, as the bot. */
export const LESSONS_V2_COPY_UR: Words<typeof LESSONS_V2_COPY> = {
  title: 'لیسن پلان',
  back: 'واپس',
  home: 'ہوم',
  selectClass: 'اپنی کلاس چنیں',
  or: 'یا',
  anyGradeOrSubject: 'کوئی جماعت یا مضمون',
  open: 'کھولیں',
  recent: 'حالیہ لیسن پلان',
  noLessonPlansYet: 'کوئی لیسن پلان نہیں',
  ready: 'تیار',
  planFallback: 'لیسن پلان',
  grade: (g: number) => `جماعت ${g}`,
  chapterPrefix: 'باب',
  lessonPrefix: 'سبق #',
  lessonsCount: (n: number) => (n === 1 ? '1 سبق' : `${n} اسباق`),
  part: (n: number) => `حصہ ${n}`,
  worksheet: 'ورک شیٹ',
  revision: 'دہرائی',
  crumb: (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · '),
  loadFailed: 'لوڈ نہیں ہو سکا',
  tryAgain: 'دوبارہ کوشش کریں',
  nothingHere: 'ابھی یہاں کچھ نہیں',
  notReady: 'ابھی تیار نہیں',
  notAvailable: 'دستیاب نہیں',
  couldNotOpen: 'کھل نہیں سکا',
  preparing: 'تیار ہو رہا ہے',
  aboutTwoMinutes: '~2 منٹ',
  opensByItself: 'خود کھل جائے گا',
  notPrepared: 'تیار نہیں ہو سکا',
  otherLessons: 'دوسرے اسباق',
  startDc: 'ڈیجیٹل کوچنگ شروع کریں',
  answerKey: 'جوابات کی کنجی',
  openOutside: 'دوسری ایپ میں کھولیں',
  all: {
    title: 'تمام لیسن پلان',
    filterLabel: 'کلاس سے چھانٹیں',
    showAllClasses: 'تمام کلاسیں دکھائیں',
    empty: 'کوئی لیسن پلان نہیں',
    opened: 'کھولا گیا',
    whatsapp: 'واٹس ایپ',
    chapter: (n: number) => `باب ${n}`,
    kpis: {
      lessonPlans: 'لیسن پلان',
      classesCovered: 'کلاسیں شامل',
      sentOnWhatsapp: 'واٹس ایپ پر بھیجے',
      daysActive: 'سرگرم دن',
    },
  },
  days: {
    today: 'آج',
    yesterday: 'کل',
    date: (weekday: number, day: number, month: number) => `${WEEKDAYS_UR[weekday]} ${day} ${MONTHS_UR[month]}`,
  },
};

/** Lesson Plans' words in both languages. */
export const LESSONS = bilingual(LESSONS_V2_COPY, LESSONS_V2_COPY_UR);
export type LessonsCopy = Words<typeof LESSONS_V2_COPY>;
