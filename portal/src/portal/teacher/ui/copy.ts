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

import { MONTHS } from '../../newui/copy';
import type { RangePreset } from '../../newui/range';

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
  close: string;
  gradeField: string;
  subjectField: string;
  selectGrade: string;
  selectSubject: string;
  search: string;
  yourClasses: string;
  otherClasses: string;
  noMatch: string;
  change: string;
  dateRange: string;
  presets: Record<RangePreset, string>;
  pickDates: string;
  pickedDates: string;
  from: string;
  to: string;
  everything: string;
  rangeError: string;
  showDates: string;
  showSpan: (span?: string) => string;
  compareWith: (span?: string) => string;
  months: readonly string[];
  same: string;
  sameAsBefore: string;
  upBy: (n?: string | number) => string;
  downBy: (n?: string | number) => string;
  noValue: string;
  progress: string;
  done: string;
  now: string;
  stepsCount: (done?: number, total?: number) => string;
  play: string;
  pause: string;
  report: ReportCopy;
}

/** ReportBody's words: the hero report PNG's own (bot report-v2/hero-report.template.js). */
export interface ReportCopy {
  report: string;
  eyebrow: string;
  brand: string;
  brandMark: string;
  scores: string;
  moment: string;
  strength: string;
  horizon: string;
  photos: string;
  journey: string;
  lastAsked: string;
  tryNext: string;
  commitment: string;
  why: string;
  notAssessed: string;
  marks: (score?: number, max?: number) => string;
  lessons: (n?: number) => string;
  journeyAria: (n?: number) => string;
  madeFor: (firstName?: string) => string;
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
  /** A tray's round close. */
  close: 'Close',
  /** GradeSubjectSelector: the fields' small labels (the grade one is also the pills' caption and group name). */
  gradeField: 'Grade',
  subjectField: 'Subject',
  /** …their empty values, and the trays' titles. */
  selectGrade: 'Select grade',
  selectSubject: 'Select subject',
  /** GradeSubjectPicker's sheet. */
  search: 'Search grade or subject',
  yourClasses: 'Your classes',
  otherClasses: 'Other classes',
  noMatch: 'No match',
  /** The picker's trigger, once picked. */
  change: 'Change',
  /** DateRangeBar (the presets are the portal's own range keys, newui/range.ts). */
  dateRange: 'Date range',
  presets: {
    this_week: 'This week',
    this_month: 'This month',
    last_3_months: 'Last 3 months',
    this_year: 'This year',
    all: 'All time',
  },
  pickDates: 'Pick dates',
  pickedDates: 'Picked dates',
  from: 'From',
  to: 'To',
  /** All time's dates. */
  everything: 'Everything so far',
  /** Pick dates with From after To. */
  rangeError: 'From after To',
  showDates: 'Show dates',
  showSpan: (span = '') => `Show ${span}`.trim(),
  /** Under KpiTiles: what the changes compare with ("vs 1 – 8 Sep 2026"). */
  compareWith: (span = '') => `vs ${span}`.trim(),
  months: MONTHS,
  /** KpiTiles' change pill at 0, and the screen-reader words for a change. */
  same: 'Same',
  sameAsBefore: 'same as before',
  upBy: (n = '') => `up ${n}`.trim(),
  downBy: (n = '') => `down ${n}`.trim(),
  noValue: '—',
  /** ProgressSteps. */
  progress: 'Progress',
  done: 'Done',
  now: 'Now',
  stepsCount: (done = 0, total = 0) => `${done} of ${total}`,
  /** VoiceNote's button. */
  play: 'Play',
  pause: 'Pause',
  report: {
    report: 'Report',
    eyebrow: 'Celebrating your teaching',
    brand: 'NIETE',
    brandMark: 'N',
    scores: 'Your scores',
    moment: 'Moments to remember',
    strength: 'Your strength',
    horizon: 'Your next horizon',
    photos: 'From your classroom',
    journey: 'Your journey',
    lastAsked: 'Last time we asked',
    tryNext: 'Try next class',
    commitment: 'Your commitment',
    why: 'Why:',
    notAssessed: 'Not assessed',
    marks: (score = 0, max = 0) => `${score}/${max} marks`,
    lessons: (n = 0) => `${n} lessons`,
    journeyAria: (n = 0) => `Scores over ${n} lessons`,
    /** The PNG's footer, word for word (5 words with a name: allowed in checks.test.tsx). */
    madeFor: (firstName = '') => `Made just for you, ${firstName}`.replace(/,\s*$/, '').trim(),
  },
};
