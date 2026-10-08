/**
 * bd-fmf24g.3 — every word the teacher v2 Lesson Plans screens show, in one place (the feature's own
 * copy file, so parallel feature PRs never collide on a shared one).
 *
 * Same rules as the new UI's copy (newui/copy.ts, DESIGN.md): an icon carries the meaning, the word
 * names it — 1–3 words, 4 at most, no sentences, no question marks. English only for now; the Urdu
 * pass gives each key an Urdu value. DATA is not copy: a plan's title, a subject's name, a chapter's
 * title come from the API as they are.
 */

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
