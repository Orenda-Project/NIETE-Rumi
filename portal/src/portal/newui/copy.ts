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
