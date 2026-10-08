/**
 * bd-fmf24g.8 — every word the teacher v2 Analytics page shows (the feature's own copy file).
 *
 * Same rules as the new UI's copy: 1–3 words, 4 at most, no sentences, no question marks. English only
 * for now. DATA is not copy: a remark's comment, an area's name, a cycle's name come from the API as
 * they are. Ratings are BANDS (lib/scoreBands), never numbers.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export const ANALYTICS_V2_COPY = {
  title: 'Analytics',
  more: 'More',
  activity: 'Activity',
  lessonPlansUsed: 'Lesson plans used',
  modulesDone: 'Modules done',
  papersMade: 'Papers made',
  attendanceDays: 'Attendance days',
  observationsHeading: 'Observations',
  observations: 'Observations',
  digitalCoaching: 'Digital Coaching',
  allLessonPlans: 'All lesson plans',
  allDigitalCoaching: 'All Digital Coaching',
  ratingOverTime: 'Rating over time',
  noRatingsYet: 'No ratings yet',
  strongestToWeakest: 'Strongest to weakest',
  focus: 'Focus',
  attendance: 'Attendance',
  youWerePresent: 'You were present',
  yourStudents: 'Your students',
  pct: (n: number) => `${Math.round(n)}%`,
  daysOf: (present: number, of: number) => `${present} of ${of} days`,
  present: 'present',
  principalRemarks: 'Principal remarks',
  noRemarksYet: 'No remarks yet',
  /** A day as the canvas writes it: "28 Sep". */
  day: (d: number, m: number) => `${d} ${MONTHS[m] ?? ''}`.trim(),
  loading: 'Loading',
} as const;
