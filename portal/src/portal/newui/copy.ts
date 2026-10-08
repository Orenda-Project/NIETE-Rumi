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

/** Short day names, Sunday first, for "when" on a chip ("Mon"). */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

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
  /** AudioPlayer (bd-5rz1v.26.4): its button, and the chip when a file will not play. */
  audio: {
    play: 'Play',
    pause: 'Pause',
    cantPlay: "Can't play",
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
    myGrades: 'My grades',
  },
  /** bd-5rz1v.18 — the pull-up menu: the bar's grab handle, the who row, the Language tile. */
  openMenu: 'Open menu',
  teacher: 'Teacher',
  /**
   * The Language tile names the language it switches TO, in that language's own script (the
   * offer is flat en/ur in NIETE — language-protocol §1). The words of the new UI are still
   * English (bd-5rz1v.20 translates them), so today a switch turns the page's direction.
   */
  languages: { ur: 'اردو', en: 'English' },
  notSaved: 'Not saved',
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
  /** bd-5rz1v.17.2 — the Training, Assessments and Attendance lists' counts. */
  modules: count('module', 'modules'),
  made: (n: number) => `${n} made`,
  registers: count('register', 'registers'),
  /** A module whose title the catalogue no longer has. */
  moduleFallback: 'Training module',
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
  /** bd-k23p38 — her last 10 plans, any grade, under the four rows (it replaced "Last: …"). */
  recent: {
    label: 'Recent',
    /** The row's tile: her plan's grade. */
    grade: (n: number | string) => `G${n}`,
    /** How she last had it — for a screen reader; the chip shows an icon and when. */
    opened: 'Opened',
    onWhatsApp: 'On WhatsApp',
    ready: 'Ready',
    when: {
      justNow: 'Just now',
      minutesAgo: (n: number) => `${n}m ago`,
      hoursAgo: (n: number) => `${n}h ago`,
      yesterday: 'Yesterday',
      weekdays: WEEKDAYS,
      months: MONTHS,
    },
  },
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

/**
 * Coaching (bd-5rz1v.26). deep-screens.html has no Coaching section: these follow the other
 * screens' patterns. A lesson's topic, its subject and the coach's words are data, not copy.
 */
export const COACHING_COPY = {
  title: 'Coaching',
  /** Band chips: "8 lessons", "1 analysing". */
  lessons: count('lesson', 'lessons'),
  analysingCount: (n: number) => `${n} analysing`,
  /** What is waiting for her, above the list. */
  answer: 'Answer your question',
  waiting: (n: number) => `${n} waiting`,
  continue: 'Continue',
  notSent: 'Not sent',
  delete: 'Delete',
  /** "31 min" */
  minutes: (n: number) => `${n} min`,
  /** A row's title when the lesson has no topic yet. */
  newRecording: 'New recording',
  yourLesson: 'Your lesson',
  observation: 'Coach observation',
  coachVisit: 'Coach visit',
  /** Where a lesson on its way is (amber), and a lesson with no band. */
  states: {
    analysing: 'Analysing',
    yourAnswer: 'Your answer',
    onWhatsApp: 'On WhatsApp',
    notRated: 'Not rated',
  },
  /** The band, as a word (lib/scoreBands.ts); the same words as Home. */
  bands: HOME_COPY.bands,
  subjects: 'Subjects',
  all: 'All',
  recordings: 'Recordings',
  more: 'More',
  empty: 'No lessons yet',
  loading: 'Loading…',
  notLoaded: 'Not loaded',
  retry: 'Try again',
  /** The one button, and its sheet. */
  send: 'Send a lesson',
  record: 'Record live lecture',
  upload: 'Upload recording',
  cancel: 'Cancel',
  notAudio: 'Not a recording',
  tooLarge: 'Too large',

  /* ── /portal/coaching/new: record ─────────────────────────────────────── */
  recordTitle: 'Record live lecture',
  recording: 'Recording',
  paused: 'Paused',
  screenWentOff: 'Screen went off',
  keepAppOpen: 'Keep app open',
  lessonPlans: 'Lesson plans',
  continues: 'Recording continues',
  finish: 'Finish',
  pause: 'Pause',
  resume: 'Continue',
  finishTitle: 'Finish recording',
  yesFinish: 'Yes, finish',
  keepRecording: 'Keep recording',
  shortLesson: 'Short lesson',
  /**
   * Logout while recording (bd-5rz1v.10's question in the kit, bd-5rz1v.26.4). The title is the
   * operator's words and the one question in the new UI: it is on COPY_ALLOWLIST, with why.
   */
  stopRecordingTitle: 'Stop recording?',
  stopAndLogout: 'Stop & log out',
  /** The microphone was refused: where to allow it, as a path, never instructions. */
  micBlocked: 'Microphone blocked',
  micApp: ['Settings › Apps › NIETE', 'Microphone › Allow'],
  micWeb: ['Lock › Microphone › Allow'],
  tryAgain: 'Try again',

  /* ── check and send ──────────────────────────────────────────────────── */
  checkTitle: 'Check and send',
  yourRecording: 'Your recording',
  justNow: 'Just now',
  listen: 'Listen',
  stopListening: 'Pause',
  recordAgain: 'Record again',
  changeFile: 'Change file',
  optional: 'Optional',
  lessonPlan: 'Lesson plan',
  add: 'Add',
  photo: 'Photo',
  file: 'File',
  boardPhotos: 'Board photos',
  /** "2/3" */
  photosOf: (n: number, max: number) => `${n}/${max}`,
  removePhoto: (name: string) => `Remove ${name}`,
  notAPlan: 'Not a lesson plan',
  notAPhoto: 'Not a photo',
  upToThree: 'Up to 3',
  sendToCoach: 'Send to Digital Coach',
  /** The lesson plan sheet. */
  recent: 'Recent lesson plans',
  fromLibrary: 'From the library',
  takePhoto: 'Take a photo',
  chooseFile: 'Choose a file',
  /** The library, one step at a time; the crumb says what she chose. */
  steps: { grade: 'Grade', subject: 'Subject', chapter: 'Chapter', lesson: 'Lesson' },
  grade: (n: number | string) => `Grade ${n}`,
  used: 'Used',
  notWritten: 'Not written',
  preparing: 'Preparing…',
  failed: 'Failed',
  nothingHere: 'Nothing here',
  planFallback: 'Lesson plan',

  /* ── sending, and after ──────────────────────────────────────────────── */
  sending: 'Sending',
  sent: 'Sent',
  aboutTen: '~10 min',
  aboutOne: '~1 min',
  whatsAppToo: 'WhatsApp too',
  openLesson: 'Open lesson',
  noInternet: 'No internet',
  savedOnPhone: 'Saved on phone',
  planNotUsed: 'Lesson plan not used',
  changePlan: 'Change lesson plan',
  notAccepted: 'Not accepted',
  busy: 'Another lesson analysing',
  openThat: 'Open that lesson',

  /* ── a lesson's page ─────────────────────────────────────────────────── */
  stepAnalysing: 'Analysing',
  stepAnalysed: 'Analysed',
  stepQuestion: 'Your question',
  stepAnswered: 'Answered',
  stepReport: 'Report',
  stepMaking: 'Making report',
  answerOnWhatsApp: 'Answer on WhatsApp',
  yourAnswer: 'Your answer',
  sendAnswer: 'Send',
  nextQuestion: 'Next question',
  notAnalysed: 'Not analysed',
  sendAgain: 'Send again',
  notFound: 'Not found',
  /** One short heading per section of the report. */
  sections: {
    digitalCoach: 'Digital Coach',
    tryNext: 'Try next time',
    wentWell: 'Went well',
    rubric: 'Rubric',
    reflection: 'Your reflection',
    recording: 'Your recording',
    allTips: 'All tips',
    said: 'What was said',
    report: 'Report',
  },
  reportPicture: 'Report picture',
  showAll: 'Show all',
} as const;

/**
 * Training (bd-5rz1v.25; deep-screens.html, Training). Teachers see "Part"; the code's word is
 * "module". Provider, level, course and part names are data, shown as the server sends them.
 */
export const TRAINING_COPY = {
  title: 'Training',
  providers: 'Providers',
  levels: 'Levels',
  courses: 'Courses',
  parts: 'Parts',
  certificates: 'Certificates',
  myGrades: 'My grades',
  noTraining: 'No training yet',
  done: 'Done',
  certified: 'Certified',
  ready: 'Ready',
  next: 'Next',
  locked: 'Locked',
  passed: 'Passed',
  notPassed: 'Not passed',
  beingGraded: 'Being graded',
  /** The bottom button: "Continue NIETE", "Continue Level 2", "Continue". */
  continue: 'Continue',
  continueTo: (name?: string | null) => `Continue ${name ?? ''}`.trim(),
  continueLevel: (n?: number) => `Continue Level ${n ?? ''}`.trim(),
  /** "24%" and, on the band, "NIETE 24%". */
  pct: (n?: number) => `${n ?? 0}%`,
  providerPct: (name?: string | null, n?: number) => `${name ?? ''} ${n ?? 0}%`.trim(),
  /** "2/5", "9/10". */
  of: (done?: number | null, total?: number | null) => `${done ?? 0}/${total ?? 0}`,
  /** A locked level: "Pass 2" (the level before it). On a level page: "Pass Level 1". */
  pass: (n?: number) => `Pass ${n ?? ''}`.trim(),
  passLevel: (n?: number) => `Pass Level ${n ?? ''}`.trim(),
  /** "Level 2 · Emerging"; the crumbs "Training · NIETE · Level 2". */
  levelN: (n?: number) => `Level ${n ?? ''}`.trim(),
  levelTitle: (n?: number, name?: string | null) => joined(n != null ? `Level ${n}` : null, name),
  crumb: (...parts: Array<string | null | undefined>) => joined('Training', ...parts),
  /** "12 min"; under a minute, "40 sec". */
  minutes: (seconds?: number | null) => {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    return s > 0 && s < 60 ? `${s} sec` : `${Math.round(s / 60)} min`;
  },
  levelExam: 'Level exam',
  moreCourses: (n?: number) => `${n ?? 0} more ${n === 1 ? 'course' : 'courses'}`,
  /** "Wait 18h": a failed exam's cooldown. */
  waitHours: (h?: number) => `Wait ${h ?? 0}h`,
  moduleExam: 'Module exam',
  reading: 'Required reading',
  available: (n?: number) => `${n ?? 0} available`,
  readings: (n?: number) => (n === 1 ? '1 reading' : `${n ?? 0} readings`),
  comingSoon: 'Coming soon',
  writtenQuiz: 'Written quiz',
  onWhatsApp: 'On WhatsApp',
  /** Beacon House capstone answers: "4/5" per answer. */
  outOfFive: (n?: number | null) => `${n ?? '—'}/5`,
  levelCertificate: 'Level certificate',
  exams: (done?: number, total?: number) => `${done ?? 0}/${total ?? 0} exams`,
  receive: 'Receive',
  download: 'Download',
  myScores: 'My scores',
  notTaken: 'Not taken',
  written: (earned?: number | null, max?: number | null) => `Written ${earned ?? '—'}/${max ?? 0}`,
  choice: (earned?: number | null, possible?: number | null) => `MCQ ${earned ?? 0}/${possible ?? 0}`,
  /** A part (bd-5rz1v.25.2): "Part 4/7", the handout, the quick check. */
  part: (n?: number, total?: number) => `Part ${n ?? 0}/${total ?? 0}`,
  handout: 'Handout',
  pdf: 'PDF',
  quickCheck: 'Quick check',
  questions: (n?: number) => `${n ?? 0} Q`,
  startQuickCheck: 'Start quick check',
  markDone: 'Mark done',
  upNext: 'Up next',
  notSaved: 'Not saved',
  /** One question per screen. */
  answers: 'Answers',
  questionOf: (n?: number, total?: number) => `Question ${n ?? 0}/${total ?? 0}`,
  pickAll: 'Pick all',
  /** bd-klecr.6 — each answer is checked as she gives it. */
  check: 'Check',
  correct: 'Correct',
  notCorrect: 'Not correct',
  questionN: (n?: number) => `Question ${n ?? 0}`,
  submit: 'Submit',
  sending: 'Sending…',
  notSent: 'Not sent',
  /** Exams (bd-5rz1v.25.3): "Level 2 exam", "English exam", "Module 1 exam". */
  levelExamTitle: (n?: number) => `Level ${n ?? ''} exam`.replace(/\s+/g, ' ').trim(),
  examOf: (name?: string | null) => `${name ?? ''} exam`.trim(),
  moduleExamN: (n?: number | null) => (n != null ? `Module ${n} exam` : 'Module exam'),
  startExam: 'Start exam',
  /** The rules, as chips — numbers only from the gate (bd-2489). */
  toPass: (pct?: number) => `${pct ?? 0}% to pass`,
  waitIfFailed: (h?: number) => `${h ?? 0}h wait if failed`,
  wait: 'Wait',
  noExam: 'No exam',
  writtenAnswer: 'Written answer',
  certificate: 'Certificate',
  myAnswers: 'My answers',
  earlier: 'Earlier',
  saving: 'Saving…',
  saved: 'Saved',
  /** The module exam's multiple-choice tally: "MCQ 1/2", "Need 2". */
  mcq: (correct?: number, served?: number) => `MCQ ${correct ?? 0}/${served ?? 0}`,
  need: (n?: number) => `Need ${n ?? 0}`,
  /** Certificates: filters "All 4", "Beacon 2"; a row "NIETE · Aspiring". */
  all: (n?: number) => `All ${n ?? 0}`,
  providerCount: (name?: string | null, n?: number) => `${name ?? ''} ${n ?? 0}`.trim(),
  view: 'View',
  notAvailable: 'Not available',
  /** "NIETE · Aspiring": the provider and the level, both data. */
  certTitle: (provider?: string | null, levelName?: string | null) => joined(provider, levelName),
  /** My grades: the band's grade range chip ("1–5"), the lock chips, Save. */
  grades: 'Grades',
  range: (from?: number | string, to?: number | string) => `${from ?? ''}–${to ?? ''}`,
  lockedAfterSave: 'Locked 48h after save',
  lockedFor: (h?: number) => `Locked · ${h ?? 0}h`,
  save: 'Save',
  loading: 'Loading…',
  notLoaded: 'Not loaded',
  retry: 'Try again',
  empty: 'Nothing yet',
  notFound: 'Not found',
} as const;
