/**
 * bd-fmf24g.2 — the teacher kit's OWN words: the defaults for its `copy` props. A feature's words live in that
 * feature's `copy.ts` (COORDINATION.md); a screen passes the kit any word it wants different, and the Urdu work
 * passes a whole translated object. English only for now, as newui/copy.ts is.
 *
 * DATA is not copy: a subject's name, a lesson's title, a day ("Today" is the screen's word, passed in a group).
 *
 * Every value is a label (newui DESIGN.md): 1–3 words, 4 at most, never a sentence — checks.test.tsx lints this
 * object, and what each function returns, with the new UI's own checker.
 */

export interface TeacherUiCopy {
  grade: (g?: string | number) => string;
  selected: string;
  newItem: string;
  download: string;
  locked: string;
  used: string;
  showMore: string;
  seeAll: string;
  seeAllNamed: (heading?: string) => string;
  nothingYet: string;
}

export const TEACHER_UI_COPY: TeacherUiCopy = {
  /** "Grade 4" — a grade on a button, a block lead, a field. */
  grade: (g: string | number = '') => `Grade ${g}`.trim(),
  /** The indigo check circle on a selected row (its name for a screen reader). */
  selected: 'Selected',
  /** The red dot on a row she has not opened yet. */
  newItem: 'New',
  download: 'Download',
  /** The lock at the end of a locked row. */
  locked: 'Locked',
  /** The green chip on a row she has used. */
  used: 'Used',
  showMore: 'Show more',
  seeAll: 'See all',
  /** A See all link's name: "See all" + the list it opens ("See all Recent Lesson Plans"). */
  seeAllNamed: (heading = '') => `See all ${heading}`.trim(),
  /** HistoryList with no rows. */
  nothingYet: 'Nothing yet',
};
