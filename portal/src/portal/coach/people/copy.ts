/**
 * bd-4404s7.6 — every word of the coach's Schools and Teachers area (the list, a school, a teacher, Edit teacher),
 * in English and Urdu. Read with `useCopy(PEOPLE)` (teacher/i18n); `ur` is typed to `en`'s exact shape, so a missing
 * key fails the build. Names, numbers and dates are DATA and are not here (a month name is: `months`).
 *
 * Words follow the ontology (ict-niete-ontology.md): Teacher ٹیچر, Principal ہیڈ ٹیچر, Teaching level تدریسی سطح,
 * Courses done مکمل کورسز, Papers made بنائے گئے پرچے. The Urdu is MACHINE-DRAFTED and waits for a native check
 * (workbench/teacher-v2-impl/urdu-review/urdu-review.tsv, verdict NATIVE-CHECK). New coach words are also in
 * COACH.md §5.
 */
import { bilingual, type Bilingual, type Words } from '../../teacher/i18n';
import type { CopyEntry } from '../../teacher/copyRegistry';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'] as const;
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAYS_UR = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'] as const;
const SHORT_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export const PEOPLE_EN = {
  title: 'Schools & teachers',
  home: 'Home',
  back: 'Back',
  dash: '—',
  loadFailed: 'Could not load',
  retry: 'Try again',

  schoolsTab: 'Schools',
  teachersTab: 'Teachers',
  sort: 'Sort',
  sortDays: 'Days since visit',
  sortAvg: 'Avg. HITL Score',
  sortAz: 'A–Z',
  sortLeast: 'Least visited',
  sortMost: 'Most visited',
  visitsLast3: 'Visits · last 3 months',

  // The visit-status legend and chips (status tones: waiting, info, done)
  lastVisit: 'Last visit',
  legendOver: 'Over 30 days, or none',
  legendMid: '8 to 30 days',
  legendRecent: 'Within a week',
  noVisitsYet: 'No visits yet',
  today: 'Today',
  daysAgo: (n: number) => (n === 1 ? '1 day ago' : `${n} days ago`),

  // The numbers under a row
  visitsCol: 'Visits',
  sinceVisit: 'Since visit',
  teachersCol: 'Teachers',
  avgHitl: 'Avg. HITL Score',
  hitl: 'HITL',
  dc: 'DC',
  trainingCol: 'Training',
  daysShort: (d: number | null) => (d == null ? '—' : `${d}d`),
  pct: (n: number | null) => (n == null ? '—' : `${Math.round(n * 10) / 10}%`),
  teachersN: (n: number) => (n === 1 ? '1 teacher' : `${n} teachers`),
  lastVisitDays: (d: number | null) => (d == null ? 'No visits yet' : `Last visit ${d}d`),

  // A school, in the grouped Teachers list
  showAllN: (n: number) => `Show all ${n}`,
  noTeachers: 'No teachers',

  // A school, and a teacher
  scheduleVisitHere: 'Schedule visit here',
  scheduleVisit: 'Schedule visit',
  edit: 'Edit',
  hitlVisits: 'HITL visits',
  dcObservations: 'DC observations',
  papersMade: 'Papers made',
  lpOpened: 'Lesson Plans opened',
  coursesDone: 'Courses done',
  lastTraining: 'Last training',
  history: 'History',
  nextVisitOn: 'Next visit',
  monthOf: (year: number, month: number) => `${MONTHS_EN[month] ?? ''} ${year}`.trim(),
  dayMonth: (d: number, m: number) => `${d} ${SHORT_MONTHS_EN[m] ?? ''}`.trim(),
  weekdayDayMonth: (wd: number, d: number, m: number) => `${DAYS_EN[wd] ?? ''} ${d} ${SHORT_MONTHS_EN[m] ?? ''}`.trim(),
  stepLabel: { draft: 'Feedback Form', talk: 'Debrief' },

  // Edit teacher
  editTeacher: 'Edit teacher',
  nameLabel: 'Name',
  phoneLabel: 'Phone',
  roleLabel: 'Role',
  roleTeacher: 'Teacher',
  rolePrincipal: 'Principal',
  schoolLabel: 'School',
  save: 'Save',
  removeFromSchool: 'Remove from school',
  remove: 'Remove',
  keep: 'Keep',
  notYourSchool: 'Not your school',
  teachingLevel: 'Teaching level',
  levelNames: { PRIMARY: 'Primary', MIDDLE: 'Middle', HIGH: 'High' },
  canObserve: 'Can observe teachers',
  checkNumber: 'Check number',
  changeNumber: 'Change number',
  phoneFree: 'Number is free',
  phoneShell: 'Old account folded in',
  phoneSame: 'Same number',
  phoneInvalid: 'Not a valid number',
  editNotYours: 'Not your teacher',
  nameNeeded: 'Name needed',
  pickLevel: 'Pick a level',
  levelLocked: (h: number | null | undefined) => (h ? `Level locked · ${h} h` : 'Level locked'),
  saveFailed: 'Could not save',
};

export const PEOPLE_UR: Words<typeof PEOPLE_EN> = {
  title: 'اسکول اور ٹیچرز',
  home: 'ہوم',
  back: 'واپس',
  dash: '—',
  loadFailed: 'لوڈ نہیں ہو سکا',
  retry: 'دوبارہ کوشش کریں',

  schoolsTab: 'اسکول',
  teachersTab: 'ٹیچرز',
  sort: 'ترتیب',
  sortDays: 'آخری دورے کو دن',
  sortAvg: 'اوسط HITL اسکور',
  sortAz: 'الف سے ی',
  sortLeast: 'سب سے کم دورے',
  sortMost: 'سب سے زیادہ دورے',
  visitsLast3: 'دورے · پچھلے 3 ماہ',

  lastVisit: 'آخری دورہ',
  legendOver: '30 دن سے زیادہ، یا کوئی نہیں',
  legendMid: '8 سے 30 دن',
  legendRecent: 'ایک ہفتے کے اندر',
  noVisitsYet: 'ابھی کوئی دورہ نہیں',
  today: 'آج',
  daysAgo: (n: number) => (n === 1 ? '1 دن پہلے' : `${n} دن پہلے`),

  visitsCol: 'دورے',
  sinceVisit: 'آخری دورے کے بعد',
  teachersCol: 'ٹیچرز',
  avgHitl: 'اوسط HITL اسکور',
  hitl: 'HITL',
  dc: 'DC',
  trainingCol: 'ٹریننگ',
  daysShort: (d: number | null) => (d == null ? '—' : `${d} دن`),
  pct: (n: number | null) => (n == null ? '—' : `${Math.round(n * 10) / 10}%`),
  teachersN: (n: number) => `${n} ٹیچرز`,
  lastVisitDays: (d: number | null) => (d == null ? 'ابھی کوئی دورہ نہیں' : `آخری دورہ ${d} دن`),

  showAllN: (n: number) => `سب ${n} دکھائیں`,
  noTeachers: 'کوئی ٹیچر نہیں',

  scheduleVisitHere: 'یہاں دورہ شیڈول کریں',
  scheduleVisit: 'دورہ شیڈول کریں',
  edit: 'ترمیم',
  hitlVisits: 'HITL دورے',
  dcObservations: 'ڈیجیٹل کوچنگ مشاہدات',
  papersMade: 'بنائے گئے پرچے',
  lpOpened: 'کھولے گئے لیسن پلان',
  coursesDone: 'مکمل کورسز',
  lastTraining: 'آخری ٹریننگ',
  history: 'تاریخ',
  nextVisitOn: 'اگلا دورہ',
  monthOf: (year: number, month: number) => `${MONTHS_UR[month] ?? ''} ${year}`.trim(),
  dayMonth: (d: number, m: number) => `${d} ${MONTHS_UR[m] ?? ''}`.trim(),
  weekdayDayMonth: (wd: number, d: number, m: number) => `${DAYS_UR[wd] ?? ''} ${d} ${MONTHS_UR[m] ?? ''}`.trim(),
  stepLabel: { draft: 'فیڈبیک فارم', talk: 'تعمیری گفتگو' },

  editTeacher: 'ٹیچر میں ترمیم',
  nameLabel: 'نام',
  phoneLabel: 'فون',
  roleLabel: 'کردار',
  roleTeacher: 'ٹیچر',
  rolePrincipal: 'ہیڈ ٹیچر',
  schoolLabel: 'اسکول',
  save: 'محفوظ کریں',
  removeFromSchool: 'اسکول سے ہٹائیں',
  remove: 'ہٹائیں',
  keep: 'رہنے دیں',
  notYourSchool: 'آپ کا اسکول نہیں',
  teachingLevel: 'تدریسی سطح',
  levelNames: { PRIMARY: 'پرائمری', MIDDLE: 'مڈل', HIGH: 'ہائی' },
  canObserve: 'مشاہدے کی اجازت',
  checkNumber: 'نمبر چیک کریں',
  changeNumber: 'نمبر تبدیل کریں',
  phoneFree: 'نمبر دستیاب ہے',
  phoneShell: 'پرانا اکاؤنٹ شامل',
  phoneSame: 'وہی نمبر',
  phoneInvalid: 'نمبر درست نہیں',
  editNotYours: 'آپ کی ٹیچر نہیں',
  nameNeeded: 'نام ضروری ہے',
  pickLevel: 'سطح چنیں',
  levelLocked: (h: number | null | undefined) => (h ? `سطح مقفل · ${h} گھنٹے` : 'سطح مقفل'),
  saveFailed: 'محفوظ نہیں ہو سکا',
};

export const PEOPLE = bilingual(PEOPLE_EN, PEOPLE_UR);

/** Registered for the completeness checks (the teacher registry finds `teacher/*` only; this is its own test). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'coach · schools and teachers',
  module: PEOPLE as Bilingual<unknown>,
  // HITL and DC stay Latin in both languages (the coach's own words for them); "—" is a dash.
  same: ['dash', 'hitl', 'dc', 'pct'],
  // The legend's top band, word for word as drawn on the Blueprint ("Over 30 days, or none").
  longOk: ['legendOver'],
};
