/**
 * bd-5rz1v.19 — EVERY word the new UI shows, in one place.
 *
 * Two reasons it is one object rather than literals in each screen:
 *   1. It is checkable. checks/copy.test.ts lints every string here (and what every function
 *      here returns): at most 4 words, never ending like a sentence. The same check refuses
 *      words written straight into a new-UI component, so nothing reaches the screen around it.
 *   2. It is translatable. The Urdu work (bd-5rz1v.20) gives each key an Urdu value; the kit
 *      already takes every word through props, so a screen passes `copy.x` and nothing else
 *      changes. English only for now, as the menu was.
 *
 * DATA is not copy: a lesson's title, her name, a school — those come from the API and are
 * shown as they are.
 *
 * Rules for a value here (DESIGN.md): an icon carries the meaning, the word names it.
 * 1–3 words; 4 at most. No sentences, no instructions, no question marks.
 */

/** Short month names, for dates on chips ("3 Oct"). */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The kit's own words — defaults for its props. */
export const KIT_COPY = {
  back: 'Back',
  close: 'Close',
  /** Shown where a number is not there (loading, or it failed to load). */
  noValue: '—',
  dateRange: {
    title: 'Date range',
    presets: {
      this_week: 'This week',
      this_month: 'This month',
      last_3_months: 'Last 3 months',
      this_year: 'This year',
      all: 'All time',
    },
    pick: 'Pick dates',
    from: 'From',
    to: 'To',
    done: 'Done',
  },
} as const;

/** The new menu (NewUiNavigation.tsx, bd-5rz1v.12). */
export const NAV_COPY = {
  menu: 'Menu',
  brand: 'NIETE',
  logoAlt: 'NIETE logo',
  account: 'Account',
  myAccount: 'My account',
  signedIn: 'Signed in',
  more: 'More',
  logout: 'Logout',
  close: 'Close',
  items: {
    home: 'Home',
    lessons: 'Lessons',
    lessonPlans: 'Lesson Plans',
    assessment: 'Assessment',
    training: 'Training',
    coaching: 'Coaching',
  },
  accountRows: {
    myClasses: 'My Classes',
    analytics: 'Analytics',
    certificates: 'Certificates',
  },
} as const;

/** n and the word for one or many: "1 Visit", "2 Visits". */
const count = (one: string, many: string) => (n: number) => `${n} ${n === 1 ? one : many}`;

/** Home = My progress (bd-5rz1v.17; deep-screens.html, Home). */
export const HOME_COPY = {
  /** The band's title: "Salaam, Hataf". */
  greeting: (firstName?: string | null) => {
    const name = String(firstName || '').trim().split(/\s+/)[0];
    return name ? `Salaam, ${name}` : 'Salaam';
  },
  /** The breadcrumb of Home's inner pages. */
  home: 'Home',
  tiles: {
    lessonPlans: 'Lesson plans used',
    training: 'Training modules done',
    assessments: 'Assessments made',
    attendance: 'Attendance marked',
    coaching: 'Coaching & observations',
  },
  digitalCoach: (n: number) => `${n} Digital Coach`,
  visits: count('Visit', 'Visits'),
  plans: count('plan', 'plans'),
  days: count('day', 'days'),
  grade: (n: number | string) => `Grade ${n}`,
  /** A plan whose name the catalogue no longer has. */
  planFallback: 'Lesson plan',
  /** A 6-12 plan that has to be written again before it opens. */
  preparing: 'Preparing',
  filters: {
    all: (n: number) => `All ${n}`,
    digitalCoach: 'Digital Coach',
    coach: 'Coach',
    principal: 'Principal',
  },
  rows: {
    digitalCoach: 'Digital Coach',
    coach: 'Coach visit',
    principal: 'Principal visit',
    other: 'Visit',
  },
  /** The rating, only inside the coaching list, and only as a band (lib/scoreBands.ts). */
  bands: {
    excellent: 'Excellent',
    good: 'Good',
    average: 'Average',
    below_average: 'Below average',
    needs_support: 'Needs support',
  },
  loading: 'Loading…',
  notLoaded: 'Not loaded',
  retry: 'Try again',
  empty: 'Nothing yet',
} as const;

/** Lesson Plans (bd-5rz1v.14; deep-screens.html, Lesson Plans): one flow for grades 1–12. */
export const LESSONS_COPY = {
  title: 'Lesson Plans',
  /** The band's chip: her most recent plan ("Last: Day 2 · Plants"). What follows is data. */
  last: (what?: string | null) => (what ? `Last: ${what}` : 'Last'),
  /** "Lesson Plans · Grade 4", "Lesson Plans · Plants": where an inner page sits. */
  crumb: (...parts: Array<string | null | undefined>) => ['Lesson Plans', ...parts.filter(Boolean)].join(' · '),
  rows: { grade: 'Grade', subject: 'Subject', chapter: 'Chapter', lesson: 'Lesson' },
  /** The Grade row before a grade is picked. */
  choose: 'Choose',
  /** A row whose step is not reached yet. */
  none: '—',
  sheets: { grade: 'Grade', subject: 'Subject' },
  grade: (n: number | string) => `Grade ${n}`,
  day: (n: number | string) => `Day ${n}`,
  /** The day badge on a lesson row: D1, D2… */
  dayBadge: (n: number | string) => `D${n}`,
  part: (n: number | string) => `Part ${n}`,
  /** A grades 6–12 lesson, by its place in the chapter. */
  lesson: (n: number | string) => `Lesson ${n}`,
  worksheet: 'Worksheet',
  revision: 'Revision',
  sent: 'Sent',
  open: 'Open',
  answerKey: 'Answer key',
  openOutside: 'Open in another app',
  preparing: 'Preparing…',
  aboutTwoMinutes: '~2 min',
  opensByItself: 'Opens by itself',
  otherLessons: 'Other lessons',
  failed: 'Failed',
  notPrepared: 'Could not prepare',
  tryAgain: 'Try again',
  loading: 'Loading…',
  notLoaded: 'Not loaded',
  empty: 'Nothing yet',
  /** Toasts. */
  notAvailable: 'Not available yet',
  notReady: 'Not ready yet',
  couldNotOpen: 'Could not open',
  planFallback: 'Lesson plan',
} as const;
