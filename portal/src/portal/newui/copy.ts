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
  /** Stepper's buttons (bd-5rz1v.13); a screen passes its own ("Fewer questions"). */
  stepper: {
    decrease: 'Minus',
    increase: 'Plus',
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

/** "Science · Ch 2 · v2": data joined, with the words that are ours. */
const joined = (...parts: Array<string | number | null | undefined>) =>
  parts.filter((p) => p !== null && p !== undefined && String(p).trim() !== '').join(' · ');

/**
 * Assessment (bd-5rz1v.13; deep-screens.html, Assessment). "Tests" and "Assessment Generator"
 * are called Assessment now (bd-5rz1v.16).
 */
export const ASSESSMENT_COPY = {
  title: 'Assessment',
  /** Band chips: "12 made", "Last: 3 Oct". */
  made: (n: number) => `${n} made`,
  last: (day?: string) => `Last: ${day ?? ''}`.trim(),
  rows: {
    class: 'Class',
    subject: 'Subject',
    chapter: 'Chapter',
    more: 'More',
    mine: 'My assessments',
  },
  /** A row with nothing picked yet. */
  pick: 'Pick',
  questions: 'Questions',
  fewer: 'Fewer questions',
  moreQuestions: 'More questions',
  make: 'Make assessment',
  /** The More sheet. */
  types: 'Question types',
  mixed: 'Mixed',
  source: 'Questions come from',
  sources: {
    seen: 'The book',
    unseen: 'New questions',
    both: 'Both',
  },
  answerLines: 'Answer lines',
  done: 'Done',
  /** Chips: "Grade 4", "15 Q", "30 marks", "p.11–20". */
  grade: (n?: number | string) => `Grade ${n ?? ''}`.trim(),
  q: (n?: number) => `${n ?? ''} Q`.trim(),
  marks: (n?: number) => `${n ?? ''} marks`.trim(),
  pages: (from?: number | null, to?: number | null) => (from != null && to != null ? `p.${from}–${to}` : ''),
  /** "Science · Plants" — a subject and a chapter's title, both from the API. */
  paperTitle: (subject?: string | null, chapterTitle?: string | null) => joined(subject, chapterTitle),
  /** "Science · Ch 2", "Science · Ch 2 · v2". */
  paperName: (subject?: string | null, chapterNumber?: number | null, version?: number | null) =>
    joined(subject, chapterNumber != null ? `Ch ${chapterNumber}` : null, version != null && version > 1 ? `v${version}` : null),
  writing: 'Writing…',
  ready: 'Ready',
  download: 'Download',
  answerKey: 'Answer key',
  makeAnother: 'Make another',
  mine: 'My assessments',
  /** My assessments' filters. */
  all: 'All',
  allSubjects: 'All subjects',
  /** The row that loads more of the list. */
  moreRows: 'More',
  comingSoon: 'Coming soon',
  loading: 'Loading…',
  notLoaded: 'Not loaded',
  retry: 'Try again',
  empty: 'Nothing yet',
  /** Failure states: chips and buttons, never a sentence. */
  notMade: 'Not made',
  notStarted: 'Not started',
  notFound: 'Not found',
  stillWriting: 'Still writing',
  checkLater: 'Check later',
  changeChoices: 'Change choices',
  noKey: 'No answer key',
  unavailable: 'Not available',
  notOpened: 'Not opened',
  /**
   * The server's failure codes (AssessmentGeneratorPanel's eleven toasts), as labels.
   * bot/shared/services/assessment writes them on assessment_papers.error_code.
   */
  failures: {
    BOOK_NOT_FOUND: 'No book yet',
    CHAPTER_NOT_FOUND: 'Chapter not found',
    NO_CONTENT: 'No chapter text',
    PAGE_OUT_OF_RANGE: 'Pages outside book',
    INVALID_PAGE_RANGE: 'Wrong pages',
    TRUNCATED: 'Too many questions',
    MODEL_UNAVAILABLE: 'Busy now',
    BAD_JSON: 'Came out wrong',
    NO_QUESTIONS: 'No questions written',
    RENDER_FAILED: 'File not made',
    UPLOAD_FAILED: 'Not saved',
  },
  failureFallback: 'Something went wrong',
  /**
   * Question types are the server's (data), shown as it sends them; a few long ones are
   * shortened for a chip (deep-screens.html: "MCQ", "Fill in", "Short").
   */
  typeShort: {
    MCQs: 'MCQ',
    MSQs: 'MSQ',
    'Fill in the Blanks': 'Fill in',
    'Short Questions': 'Short',
    'Long Question': 'Long',
    'Brief Answers': 'Brief',
    'Match the Column': 'Match',
    'Circle the Correct Answer': 'Circle',
    'Restricted Response Question': 'Restricted',
    'Graphs & Geometric Problems': 'Graphs',
    'Mental Math (Viva)': 'Mental Math',
    'Label the Diagram': 'Label diagram',
    'Comprehension Passage': 'Comprehension',
  } as Record<string, string>,
} as const;
