/**
 * bd-fmf24g.5 — every word the teacher v2 Training screens show, in the feature's own copy file (so parallel
 * feature PRs never collide on a shared one). Same rules as the new UI's copy: an icon carries the meaning,
 * the word names it — 1–3 words, 4 at most, no sentences. English only for now; the Urdu pass gives each
 * key an Urdu value. DATA is not copy: a provider's, level's or course's name comes from the API as it is.
 * The training screens reused from the new UI (a course, a part, the quick check, the exams, certificates,
 * My grades) keep their own words in newui/copy.ts.
 */
export const TRAINING_V2_COPY = {
  title: 'Training',
  home: 'Home',
  back: 'Back',
  /* the hub */
  teachingLevel: 'Teaching level',
  edit: 'Edit',
  editLevel: 'Edit teaching level',
  continue: 'Continue',
  certificates: 'Certificates',
  earned: (n: number) => `${n} earned`,
  courses: 'Courses',
  pct: (n: number) => `${n}%`,
  noValue: '—',
  done: 'Done',
  levelOf: (n: number, of: number) => `Level ${n} of ${of}`,
  coursesOf: (done: number, total: number) => `${done} of ${total} courses`,
  nothingYet: 'No training yet',
  /* the level page */
  levels: 'Levels',
  levelTitle: (n: number | null, name: string | null) => [n != null ? `Level ${n}` : null, name].filter(Boolean).join(' · '),
  level: (n: number) => `Level ${n}`,
  of: (done: number, total: number) => `${done} of ${total}`,
  partsOf: (done: number, total: number) => `${done} of ${total} parts`,
  levelExam: 'Level exam',
  ready: 'Ready',
  passed: 'Passed',
  certified: 'Certified',
  waitHours: (h: number) => `Wait ${h}h`,
  moreCourses: (n: number) => (n === 1 ? '1 more course' : `${n} more courses`),
  locked: 'Locked',
  passLevel: (n: number) => `Pass Level ${n}`,
  subjects: 'Subjects',
  /** The breadcrumb over a page: its parts joined ("Training · NIETE"). */
  crumb: (...parts: Array<string | null | undefined>) => ['Training', ...parts.filter(Boolean)].join(' · '),
  /* loading */
  loading: 'Loading',
  loadFailed: 'Could not load',
  tryAgain: 'Try again',
} as const;
