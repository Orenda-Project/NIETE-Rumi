/**
 * bd-4404s7.3 — every word the coach's Schedule area shows (the hub, My schedule, Team schedule, New visit with its
 * three steps, the clash and the Done page), in English and Urdu. Read with `useCopy(SCHEDULE)` (teacher/i18n):
 * `ur` is typed to `en`'s exact shape, so a missing key or a function with another signature fails the build, and
 * schedule/copy.test.ts fails on any Urdu that is empty or still English (nothing falls back to English silently).
 *
 * The Urdu is MACHINE-DRAFTED and awaits a native check (workbench/teacher-v2-impl/urdu-review/urdu-review.tsv,
 * verdict NATIVE-CHECK). It reuses the locked words: Visit دورہ, Observation مشاہدہ, Teacher ٹیچر, School اسکول,
 * and COACH.md §5's list (Schedule شیڈول, New visit نیا دورہ, Already booked پہلے سے بک, Clash ٹکراؤ).
 * Western digits, as the bot. DATA is not copy: names, schools and phones come from the API as they are, and a time of
 * day is the kit's TimeStamp (its AM/PM are the kit's words).
 */
import { bilingual, type Bilingual, type Words } from '../../teacher/i18n';

export const SCHEDULE_COPY = {
  home: 'Home',
  back: 'Back',
  dash: '—',
  loadFailed: 'Could not load',
  retry: 'Try again',

  /* the hub */
  title: 'Schedule',
  newVisit: 'New visit',
  mySchedule: 'My schedule',
  teamSchedule: 'Team schedule',
  newVisitChip: 'School · teacher · time',
  thisWeekN: (n: number) => `${n} this week`,
  overdueN: (n: number) => `${n} overdue`,

  /* My schedule */
  overdue: 'Overdue',
  today: 'Today',
  done: 'Done',
  next: 'Next',
  noVisits: 'No visits',
  daysLate: (n: number) => `${n} days late`,
  week: 'Week',
  /** "Wed 7": a day's short name and its number. */
  dayShort: (weekday: string, n: number) => `${weekday} ${n}`,
  /** The crumb over My schedule: "Schedule · 4–10 Oct". */
  weekCrumb: (from: number, to: number) => `Schedule · ${from}–${to}`,
  weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  weekdaysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  /** Whole month names, for "October 2026" over the day strip and "Wednesday 7 October". */
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],

  /* Team schedule */
  totals: { today: 'Today', week: 'This week', month: 'This month' },
  coach: 'Coach',
  allCoaches: 'All coaches',
  coachesN: (n: number) => `${n} coaches`,
  you: 'You',
  visitsN: (n: number) => `${n} visits`,
  showAllN: (n: number) => `Show all ${n}`,
  showFewer: 'Show fewer',

  /* New visit */
  crumb: 'Schedule',
  reschedule: 'Reschedule',
  stepOf: (n: number) => `Step ${n} of 3`,
  pickSchool: 'Pick a school',
  pickTeacher: 'Pick a teacher',
  pickDayTime: 'Pick day and time',
  lastVisit: 'Last visit',
  legendOld: 'Over 30 days, or none',
  legendMid: '8 to 30 days',
  legendNew: 'Within a week',
  noVisitsYet: 'No visits yet',
  daysAgo: (n: number) => (n === 1 ? '1 day ago' : `${n} days ago`),
  teachersCount: (n: number) => `${n} teachers`,
  chosenSoFar: 'Chosen so far',
  school: 'School',
  teacher: 'Teacher',
  change: 'Change',
  profile: 'Profile',
  searchPlaceholder: 'Name or phone',
  hitl: 'HITL',
  dc: 'DC',
  avgHitl: 'Avg. HITL Score',
  training: 'Training',

  /* day and time */
  day: 'Day',
  time: 'Time',
  hour: 'Hour',
  minutes: 'Minutes',
  amPm: 'AM / PM',
  laterHour: 'Later hour',
  earlierHour: 'Earlier hour',
  earlierDays: 'Earlier days',
  laterDays: 'Later days',
  alreadyBooked: 'Already booked',
  clash: 'Clash',
  /** The time is already worded ("8:30 AM"). */
  clashTitle: (time: string) => `You already have a visit at ${time}`,
  clashStill: 'You can still book it.',
  schedule: 'Schedule',
  saving: 'Saving',

  /* Done */
  visitScheduled: 'Visit scheduled',
  scheduled: 'Scheduled',
  oneVisitAdded: 'One visit added',
} as const;

export type ScheduleCopy = Words<typeof SCHEDULE_COPY>;

export const SCHEDULE_COPY_UR: ScheduleCopy = {
  home: 'ہوم',
  back: 'واپس',
  dash: '—',
  loadFailed: 'لوڈ نہیں ہو سکا',
  retry: 'دوبارہ کوشش کریں',

  title: 'شیڈول',
  newVisit: 'نیا دورہ',
  mySchedule: 'میرا شیڈول',
  teamSchedule: 'ٹیم کا شیڈول',
  newVisitChip: 'اسکول · ٹیچر · وقت',
  thisWeekN: (n: number) => `اس ہفتے ${n}`,
  overdueN: (n: number) => `${n} تاخیر`,

  overdue: 'تاخیر',
  today: 'آج',
  done: 'مکمل',
  next: 'اگلا',
  noVisits: 'کوئی دورہ نہیں',
  daysLate: (n: number) => `${n} دن لیٹ`,
  week: 'ہفتہ',
  dayShort: (weekday: string, n: number) => `${weekday} ${n}`,
  weekCrumb: (from: number, to: number) => `شیڈول · ${from}–${to}`,
  weekdaysShort: ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'],
  weekdaysLong: ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'],
  months: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'],

  totals: { today: 'آج', week: 'اس ہفتے', month: 'اس مہینے' },
  coach: 'کوچ',
  allCoaches: 'تمام کوچ',
  coachesN: (n: number) => `${n} کوچ`,
  you: 'آپ',
  visitsN: (n: number) => `${n} دورے`,
  showAllN: (n: number) => `تمام ${n} دکھائیں`,
  showFewer: 'کم دکھائیں',

  crumb: 'شیڈول',
  reschedule: 'دوبارہ شیڈول کریں',
  stepOf: (n: number) => `مرحلہ ${n} از 3`,
  pickSchool: 'اسکول چنیں',
  pickTeacher: 'ٹیچر چنیں',
  pickDayTime: 'دن اور وقت چنیں',
  lastVisit: 'آخری دورہ',
  legendOld: '30 دن سے زیادہ، یا کوئی نہیں',
  legendMid: '8 سے 30 دن',
  legendNew: 'ایک ہفتے کے اندر',
  noVisitsYet: 'ابھی کوئی دورہ نہیں',
  daysAgo: (n: number) => `${n} دن پہلے`,
  teachersCount: (n: number) => `${n} ٹیچرز`,
  chosenSoFar: 'اب تک کا انتخاب',
  school: 'اسکول',
  teacher: 'ٹیچر',
  change: 'تبدیل کریں',
  profile: 'پروفائل',
  searchPlaceholder: 'نام یا فون',
  hitl: 'HITL',
  dc: 'ڈیجیٹل کوچ',
  avgHitl: 'اوسط HITL اسکور',
  training: 'ٹریننگ',

  day: 'دن',
  time: 'وقت',
  hour: 'گھنٹہ',
  minutes: 'منٹ',
  amPm: 'صبح / شام',
  laterHour: 'اگلا گھنٹہ',
  earlierHour: 'پچھلا گھنٹہ',
  earlierDays: 'پچھلے دن',
  laterDays: 'اگلے دن',
  alreadyBooked: 'پہلے سے بک',
  clash: 'ٹکراؤ',
  clashTitle: (time: string) => `آپ کا ${time} پر پہلے سے دورہ ہے`,
  clashStill: 'آپ پھر بھی اسے بک کر سکتے ہیں۔',
  schedule: 'شیڈول کریں',
  saving: 'محفوظ ہو رہا ہے',

  visitScheduled: 'دورہ شیڈول ہو گیا',
  scheduled: 'شیڈول',
  oneVisitAdded: 'ایک دورہ شامل ہوا',
};

export const SCHEDULE = bilingual(SCHEDULE_COPY, SCHEDULE_COPY_UR);

/** Paths rightly the same in both languages. */
export const SAME: readonly string[] = ['dash', 'hitl', 'dayShort'];

export const COPY_ENTRY = { screen: 'Coach · Schedule', module: SCHEDULE as Bilingual<unknown>, same: SAME } as const;
