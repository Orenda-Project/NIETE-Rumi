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

import { bilingual, type Bilingual, type Words } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export const LESSONS_V2_COPY = {
  title: 'Lesson Plans',
  back: 'Back',
  /* the main page */
  home: 'Home',
  /** The one grade·subject control (bd-fmf24g.14): any grade and subject, so not "your class". */
  selectGradeSubject: 'Select grade and subject',
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
  lessonsCount: (n: number) => (n === 1 ? '1 lesson plan' : `${n} lesson plans`),
  part: (n: number) => `Part ${n}`,
  worksheet: 'Worksheet',
  revision: 'Revision',
  /** The breadcrumb over a page: its parts joined ("Math · Chap 1"). */
  crumb: (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · '),
  /* loading */
  loadFailed: 'Could not load',
  tryAgain: 'Try again',
  nothingHere: 'Nothing yet',
  /* opening */
  notReady: 'Not ready yet',
  notAvailable: 'Not available',
  couldNotOpen: 'Could not open',
  /* the waiting page */
  preparing: 'Being made',
  /** The waiting page's title (operator, 2026-10-08: "Please hold while we fetch your lp"). */
  pleaseHold: 'Please hold while we fetch your lesson plan',
  aboutTwoMinutes: '~2 min',
  opensByItself: 'Opens by itself',
  notPrepared: "Couldn't make it",
  otherLessons: 'Other lesson plans',
  /* the viewer */
  startDc: 'Start DC observation',
  answerKey: 'Answer key',
  openOutside: 'Open in another app',
  all: {
    title: 'All Lesson Plans',
    filterLabel: 'Filter by class',
    showAllClasses: 'Show all classes',
    empty: 'No lesson plans here',
    opened: 'Opened',
    whatsapp: 'Sent on WhatsApp',
    chapter: (n: number) => `Chap ${n}`,
    kpis: {
      lessonPlans: 'Lesson plans',
      classesCovered: 'Classes covered',
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
  selectGradeSubject: 'جماعت اور مضمون چنیں',
  recent: 'حالیہ لیسن پلان',
  noLessonPlansYet: 'کوئی لیسن پلان نہیں',
  ready: 'تیار',
  planFallback: 'لیسن پلان',
  grade: (g: number) => `جماعت ${g}`,
  chapterPrefix: 'باب',
  lessonPrefix: 'پلان #',
  lessonsCount: (n: number) => `${n} لیسن پلان`,
  part: (n: number) => `حصہ ${n}`,
  worksheet: 'ورک شیٹ',
  revision: 'دہرائی',
  crumb: (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · '),
  loadFailed: 'لوڈ نہیں ہو سکا',
  tryAgain: 'دوبارہ کوشش کریں',
  nothingHere: 'ابھی کچھ نہیں',
  notReady: 'ابھی تیار نہیں',
  notAvailable: 'دستیاب نہیں',
  couldNotOpen: 'کھل نہیں سکا',
  preparing: 'تیار ہو رہا ہے',
  pleaseHold: 'براہ کرم انتظار کریں، ہم آپ کا لیسن پلان لا رہے ہیں',
  aboutTwoMinutes: '~2 منٹ',
  opensByItself: 'خود کھل جائے گا',
  notPrepared: 'نہیں بن سکا',
  otherLessons: 'دوسرے لیسن پلان',
  startDc: 'ڈیجیٹل کوچنگ مشاہدہ شروع کریں',
  answerKey: 'جوابی کلید',
  openOutside: 'دوسری ایپ میں کھولیں',
  all: {
    title: 'تمام لیسن پلان',
    filterLabel: 'کلاس سے چھانٹیں',
    showAllClasses: 'تمام کلاسیں دکھائیں',
    empty: 'کوئی لیسن پلان نہیں',
    opened: 'کھولا گیا',
    whatsapp: 'واٹس ایپ پر بھیجا گیا',
    chapter: (n: number) => `باب ${n}`,
    kpis: {
      lessonPlans: 'لیسن پلان',
      classesCovered: 'کلاسیں شامل',
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

/** Registered for the completeness checks and the review file (copyRegistry). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'Lesson Plans',
  module: LESSONS as Bilingual<unknown>,
  // crumb only joins its parts ("Math · Chap 1"): the same in both languages.
  same: ['crumb'],
  // The waiting page's title is the operator's own sentence (2026-10-08), not a label.
  // Urdu: "Sent on WhatsApp" is five words (واٹس ایپ is one name), and the DC observation's own name is three words.
  longOk: ['pleaseHold', 'all.whatsapp', 'startDc'],
};
