/**
 * bd-fmf24g.5 — every word the teacher v2 Training screens show, in the feature's own copy file (so parallel
 * feature PRs never collide on a shared one). Same rules as the new UI's copy: an icon carries the meaning,
 * the word names it — 1–3 words, 4 at most, no sentences. English only for now; the Urdu pass gives each
 * key an Urdu value. DATA is not copy: a provider's, level's or course's name comes from the API as it is.
 * The training screens reused from the new UI (a course, a part, the quick check, the exams, certificates,
 * My grades) keep their own words in newui/copy.ts.
 *
 * bd-fmf24g.13 — bilingual: TRAINING = { en, ur } (these words) and TRAINING_INNER = { en, ur } (the new UI's
 * TRAINING_COPY keys, translated HERE so today's new-UI pages stay as they are), read with useCopy(). The
 * Urdu is MACHINE-DRAFTED from the bot's existing Urdu (ux-strings.js: ٹریننگ، کورس، امتحان، کوئز، جاری
 * رکھیں، درجہ) and awaits a human review (workbench/teacher-v2-impl/urdu-review/).
 */
import { TRAINING_COPY, type TrainingWords } from '../../newui/copy';
import { bilingual, type Bilingual, type Words } from '../i18n';
import type { CopyEntry } from '../copyRegistry';
export const TRAINING_V2_COPY = {
  title: 'Training',
  home: 'Home',
  back: 'Back',
  /* the hub */
  teachingLevel: 'Teaching level',
  edit: 'Change',
  editLevel: 'Change teaching level',
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
  /* the inner screens (bd-fmf24g.12); their other words are the new UI's TRAINING_COPY */
  partPrefix: 'Part',
  more: 'More',
  best: (score: string) => `Best ${score}`,
  audio: 'Audio',
  video: 'Video',
  upNext: 'Up next',
  joined: (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · '),
  /* loading */
  loading: 'Loading',
  loadFailed: 'Could not load',
  tryAgain: 'Try again',
} as const;

/** bd-fmf24g.13 — the v2 Training pages' words in Urdu (MACHINE-DRAFTED; review pending). Western digits. */
export const TRAINING_V2_COPY_UR: Words<typeof TRAINING_V2_COPY> = {
  title: 'ٹریننگ',
  home: 'ہوم',
  back: 'واپس',
  teachingLevel: 'تدریسی سطح',
  edit: 'تبدیل کریں',
  editLevel: 'تدریسی سطح تبدیل کریں',
  continue: 'جاری رکھیں',
  certificates: 'سرٹیفکیٹ',
  earned: (n: number) => `${n} حاصل کیے`,
  courses: 'کورسز',
  pct: (n: number) => `${n}%`,
  noValue: '—',
  done: 'مکمل',
  levelOf: (n: number, of: number) => `درجہ ${n}/${of}`,
  coursesOf: (done: number, total: number) => `${done}/${total} کورس`,
  nothingYet: 'ابھی کوئی ٹریننگ نہیں',
  levels: 'درجے',
  levelTitle: (n: number | null, name: string | null) => [n != null ? `درجہ ${n}` : null, name].filter(Boolean).join(' · '),
  level: (n: number) => `درجہ ${n}`,
  of: (done: number, total: number) => `${total} میں سے ${done}`,
  partsOf: (done: number, total: number) => `${done}/${total} حصے`,
  levelExam: 'درجے کا امتحان',
  ready: 'تیار',
  passed: 'پاس',
  certified: 'سرٹیفکیٹ ملا',
  waitHours: (h: number) => `${h} گھنٹے انتظار`,
  moreCourses: (n: number) => `${n} مزید کورس`,
  locked: 'مقفل',
  passLevel: (n: number) => `درجہ ${n} پاس کریں`,
  subjects: 'مضامین',
  crumb: (...parts: Array<string | null | undefined>) => ['ٹریننگ', ...parts.filter(Boolean)].join(' · '),
  partPrefix: 'حصہ',
  more: 'مزید',
  best: (score: string) => `بہترین ${score}`,
  audio: 'آڈیو',
  video: 'ویڈیو',
  upNext: 'اگلا',
  joined: (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · '),
  loading: 'لوڈ ہو رہا ہے',
  loadFailed: 'لوڈ نہیں ہو سکا',
  tryAgain: 'دوبارہ کوشش کریں',
};

/** The v2 Training pages' words in both languages. */
export const TRAINING = bilingual(TRAINING_V2_COPY, TRAINING_V2_COPY_UR);
export type TrainingV2Copy = Words<typeof TRAINING_V2_COPY>;

const joinUr = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · ');

/** bd-fmf24g.13 — the new UI's training words (TRAINING_COPY), in Urdu for the v2 pages only. */
export const TRAINING_INNER_UR: TrainingWords = {
  title: 'ٹریننگ',
  providers: 'ادارے',
  levels: 'درجے',
  courses: 'کورسز',
  parts: 'حصے',
  certificates: 'سرٹیفکیٹ',
  myGrades: 'میری جماعتیں',
  noTraining: 'ابھی کوئی ٹریننگ نہیں',
  done: 'مکمل',
  certified: 'سرٹیفکیٹ ملا',
  ready: 'تیار',
  next: 'اگلا',
  locked: 'مقفل',
  passed: 'پاس',
  notPassed: 'پاس نہیں',
  beingGraded: 'جانچ ہو رہی ہے',
  continue: 'جاری رکھیں',
  continueTo: (name?: string | null) => `${name ?? ''} جاری رکھیں`.trim(),
  continueLevel: (n?: number) => `درجہ ${n ?? ''} جاری رکھیں`.replace(/\s+/g, ' ').trim(),
  pct: (n?: number) => `${n ?? 0}%`,
  providerPct: (name?: string | null, n?: number) => `${name ?? ''} ${n ?? 0}%`.trim(),
  of: (done?: number | null, total?: number | null) => `${done ?? 0}/${total ?? 0}`,
  pass: (n?: number) => `${n ?? ''} پاس کریں`.trim(),
  passLevel: (n?: number) => `درجہ ${n ?? ''} پاس کریں`.replace(/\s+/g, ' ').trim(),
  levelN: (n?: number) => `درجہ ${n ?? ''}`.trim(),
  levelTitle: (n?: number, name?: string | null) => joinUr(n != null ? `درجہ ${n}` : null, name),
  crumb: (...parts: Array<string | null | undefined>) => joinUr('ٹریننگ', ...parts),
  minutes: (seconds?: number | null) => {
    const sec = Math.max(0, Math.round(Number(seconds) || 0));
    return sec > 0 && sec < 60 ? `${sec} سیکنڈ` : `${Math.round(sec / 60)} منٹ`;
  },
  levelExam: 'درجے کا امتحان',
  moreCourses: (n?: number) => `${n ?? 0} مزید کورس`,
  waitHours: (h?: number) => `${h ?? 0} گھنٹے انتظار`,
  moduleExam: 'کورس کا امتحان',
  reading: 'لازمی مطالعہ',
  available: (n?: number) => `${n ?? 0} دستیاب`,
  readings: (n?: number) => (n === 1 ? '1 مطالعہ' : `${n ?? 0} مطالعے`),
  comingSoon: 'جلد آ رہا ہے',
  writtenQuiz: 'تحریری امتحان',
  onWhatsApp: 'واٹس ایپ پر',
  outOfFive: (n?: number | null) => `${n ?? '—'}/5`,
  levelCertificate: 'درجے کا سرٹیفکیٹ',
  exams: (done?: number, total?: number) => `${done ?? 0}/${total ?? 0} امتحان`,
  receive: 'حاصل کریں',
  download: 'ڈاؤن لوڈ',
  myScores: 'میرے اسکور',
  notTaken: 'نہیں دیا',
  written: (earned?: number | null, max?: number | null) => `تحریری ${earned ?? '—'}/${max ?? 0}`,
  choice: (earned?: number | null, possible?: number | null) => `معروضی ${earned ?? 0}/${possible ?? 0}`,
  part: (n?: number, total?: number) => `حصہ ${n ?? 0}/${total ?? 0}`,
  handout: 'ہینڈ آؤٹ',
  pdf: 'PDF',
  quickCheck: 'فوری جانچ',
  questions: (n?: number) => `${n ?? 0} سوال`,
  startQuickCheck: 'فوری جانچ شروع کریں',
  markDone: 'مکمل کریں',
  upNext: 'اگلا',
  notSaved: 'محفوظ نہیں ہوا',
  answers: 'جوابات',
  questionOf: (n?: number, total?: number) => `سوال ${n ?? 0}/${total ?? 0}`,
  pickAll: 'سب چنیں',
  check: 'جانچیں',
  correct: 'درست',
  notCorrect: 'درست نہیں',
  questionN: (n?: number) => `سوال ${n ?? 0}`,
  submit: 'جمع کرائیں',
  sending: 'بھیجا جا رہا ہے…',
  notSent: 'نہیں بھیجا گیا',
  levelExamTitle: (n?: number) => `درجہ ${n ?? ''} کا امتحان`.replace(/\s+/g, ' ').trim(),
  examOf: (name?: string | null) => `${name ?? ''} امتحان`.trim(),
  moduleExamN: (n?: number | null) => (n != null ? `کورس ${n} کا امتحان` : 'کورس کا امتحان'),
  startExam: 'امتحان شروع کریں',
  toPass: (pct?: number) => `پاس کے لیے ${pct ?? 0}%`,
  waitIfFailed: (h?: number) => `فیل پر ${h ?? 0} گھنٹے`,
  wait: 'انتظار',
  noExam: 'کوئی امتحان نہیں',
  writtenAnswer: 'تحریری جواب',
  certificate: 'سرٹیفکیٹ',
  myAnswers: 'میرے جوابات',
  earlier: 'پہلے والے',
  saving: 'محفوظ ہو رہا ہے…',
  saved: 'محفوظ ہو گیا',
  mcq: (correct?: number, served?: number) => `معروضی ${correct ?? 0}/${served ?? 0}`,
  need: (n?: number) => `${n ?? 0} درکار`,
  all: (n?: number) => `تمام ${n ?? 0}`,
  providerCount: (name?: string | null, n?: number) => `${name ?? ''} ${n ?? 0}`.trim(),
  view: 'دیکھیں',
  notAvailable: 'دستیاب نہیں',
  certTitle: (provider?: string | null, levelName?: string | null) => joinUr(provider, levelName),
  grades: 'جماعتیں',
  range: (from?: number | string, to?: number | string) => `${from ?? ''}–${to ?? ''}`,
  lockedAfterSave: '48 گھنٹے تک مقفل',
  lockedFor: (h?: number) => `مقفل · ${h ?? 0} گھنٹے`,
  save: 'محفوظ کریں',
  loading: 'لوڈ ہو رہا ہے…',
  notLoaded: 'لوڈ نہیں ہو سکا',
  retry: 'دوبارہ کوشش کریں',
  empty: 'ابھی کچھ نہیں',
  notFound: 'نہیں ملا',
};

/** The new UI's training words in both languages, for the v2 pages that reuse them. */
/**
 * The new UI's English, with the ontology's words where the old UI differs (bd-fmf24g.17): Select (not Pick),
 * Could not load (not Not loaded), N questions (not N Q), Written exam (not quiz). newui/copy.ts keeps its own
 * words for today's pages.
 */
const TRAINING_INNER_EN: TrainingWords = {
  ...(TRAINING_COPY as TrainingWords),
  pickAll: 'Select all',
  notLoaded: 'Could not load',
  questions: (n?: number) => (n === 1 ? '1 question' : `${n ?? 0} questions`),
  writtenQuiz: 'Written exam',
  // The teacher sees Course and Part, never Module (operator, 2026-10-09). The API field stays module_no.
  moduleExam: 'Course exam',
  moduleExamN: (n?: number | null) => (n != null ? `Course ${n} exam` : 'Course exam'),
};

export const TRAINING_INNER = bilingual<TrainingWords>(TRAINING_INNER_EN, TRAINING_INNER_UR);

/** Registered for the completeness checks and the review file (copyRegistry). */
export const COPY_ENTRIES: readonly CopyEntry[] = [
  {
    screen: 'Training',
    module: TRAINING as Bilingual<unknown>,
    // A percentage, "—", and a join of data: the same in both languages.
    same: ['pct', 'noValue', 'joined'],
  },
  {
    screen: 'Training (new-UI words reused)',
    module: TRAINING_INNER as Bilingual<unknown>,
    // Numbers, fractions, a range, "PDF", and joins of data (names): the same in both languages.
    same: ['pct', 'providerPct', 'of', 'outOfFive', 'pdf', 'certTitle', 'providerCount', 'range'],
  },
];
