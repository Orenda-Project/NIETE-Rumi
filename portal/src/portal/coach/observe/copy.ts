/**
 * bd-4404s7.4 — every word the coach's Observe screens show (the hub, Pick the teacher, the visit, Record, Upload,
 * Check and send, and the observation being sent in the background), English and Urdu from day one.
 *
 * Read through the teacher app's `useCopy(OBSERVE)`; plain helpers take the words as a parameter. `ur` is typed to
 * the exact shape of `en` (teacher/i18n `bilingual`): a missing or extra key fails the build, and
 * `copy.test.ts` fails on any Urdu that is empty or still English.
 *
 * The Urdu is MACHINE-DRAFTED (rows in workbench/teacher-v2-impl/urdu-review/urdu-review.tsv, marked NATIVE-CHECK),
 * from the ontology's locked words (Start recording ریکارڈنگ شروع کریں, Upload recording ریکارڈنگ اپ لوڈ کریں, Redo, Pause,
 * Stop ختم کریں, Send بھیجیں, Sent بھیجا گیا, Try again) and the coach words in COACH.md §5.
 *
 * "observation" is the coach's observation of a teacher (operator, 9 Oct); "lesson" stays only for the lesson the
 * teacher taught, and "Lesson plan" is a thing. Names, schools, times and numbers are DATA: they come from the API.
 */
import { bilingual, type Words } from '../../teacher/i18n';

export const OBSERVE_COPY = {
  home: 'Home',
  back: 'Back',
  dash: '—',
  loadFailed: 'Could not load',
  tryAgain: 'Try again',
  close: 'Close',

  /* the hub */
  observe: 'Observe',
  /** The visit's Observation box (a region name for a screen reader; it shows no heading). */
  observation: 'Observation',
  takeObservation: 'Take observation',
  reports: 'Reports',
  waitingN: (n = 0) => `${n} waiting`,
  inProgressN: (n = 0) => `${n} in progress`,
  leftToday: (n = 0) => `${n} left today`,
  nextVisit: 'Next visit',
  reportsWaiting: (n = 0) => (n === 1 ? '1 report waiting' : `${n} reports waiting`),
  inHours: (h = 0) => (h <= 0 ? 'Now' : `In ${h} h`),

  /* pick the teacher */
  pickTheTeacher: 'Pick the teacher',
  school: 'School',
  selectSchool: 'Select school',
  allSchools: 'All schools',
  earlier: 'Earlier',
  today: 'Today',
  next: 'Next',
  done: 'Done',
  overdueN: (n = 0) => `${n} overdue`,
  daysLate: (n = 0) => `${n} days late`,
  scheduleFirst: 'Schedule a visit first',
  nothingYet: 'No visits yet',

  /* the visit */
  startRecording: 'Start recording',
  uploadRecording: 'Upload recording',
  reschedule: 'Reschedule',
  cancelVisit: 'Cancel visit',
  keepVisit: 'Keep visit',
  teacher: 'Teacher',
  teacherProfile: 'Teacher profile',
  hitl: 'HITL',
  dc: 'DC',
  avgHitl: 'Avg. HITL Score',
  training: 'Training',
  papersMade: 'Papers made',
  lpOpened: 'Lesson Plans opened',
  lastVisitOn: (date = '') => `Last visit · ${date}`.trim(),
  hitlBy: (who = '') => `HITL · ${who}`.trim(),
  you: 'You',
  lastStep: { sent: 'Sent', report: 'Send report', draft: 'Feedback Form', talk: 'Debrief', analysing: 'Analysing' } as Record<string, string>,
  sendingNow: 'Sending',

  /* record */
  recordTitle: 'Record observation',
  recording: 'Recording',
  paused: 'Paused',
  recordingTime: 'Recording time',
  visitAt: (time = '') => `Visit · ${time}`.trim(),
  linked: 'Linked',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  stopAsk: 'Stop recording',
  recordedFor: (length = '') => `You recorded ${length}.`,
  yesStop: 'Yes, stop',
  keepRecording: 'Keep recording',
  shortNote: 'That is short. The report works best on a whole lesson.',
  screenOff: 'The screen went off for a while. Part of it may be silent. Keep this screen open.',
  micBlocked: 'Microphone blocked',
  micAllow: 'When the phone asks, tap Allow.',

  /* upload */
  chooseFile: 'Select file',
  notAudio: 'Not a recording',
  tooLarge: 'File too large',
  next2: 'Next',

  /* check and send */
  checkAndSend: 'Check and send',
  observationOf: (name = '') => `${name}’s observation`.trim(),
  justNow: 'just now',
  minShort: (n = 0) => `${n} min`,
  underMinute: 'Under 1 min',
  redo: 'Redo',
  shortWarning: 'This is under 10 minutes. You can still send it, but the report may be thin.',
  lessonPlan: 'Lesson plan',
  optional: 'Optional',
  theirRecentPlans: 'Their recent plans',
  library: 'Library',
  planPhoto: 'Plan photo',
  takenNow: 'Taken just now',
  noRecentPlans: 'No recent plans',
  removePlan: 'Remove plan',
  planNotOk: 'Not a plan photo',
  photos: 'Photos',
  upToN: (n = 0) => `Up to ${n}`,
  noFaces: 'No faces',
  addPhoto: 'Add photo',
  removePhoto: (name = '') => `Remove ${name}`.trim(),
  tooManyPhotos: (n = 0) => `Up to ${n} photos`,
  notAPhoto: 'Not a photo',
  sendObservation: 'Send observation',
  noRecording: 'No recording yet',
  grade: (g = 0) => `Grade ${g}`,

  /* sending, in the background */
  sending: 'Sending',
  leaveSub: 'The observation keeps sending in the background.',
  goToReports: 'Go to Reports',
  sent: 'Observation sent',
  openObservation: 'Open observation',
  couldntSend: "Couldn't send",
  /** The real reason a send failed (the banner, the strip's page, the Sending page). */
  failure: {
    network: 'The internet stopped. The observation is safe on this phone.',
    plan: 'That lesson plan could not be used. Select another, or take a photo of the plan.',
    notYourTeacher: 'That teacher is not in your schools any more.',
    refused: 'Something was not accepted. Please try again.',
  },

  /** Short weekday and month names, for "Tue 6 Oct" (index 0 = Sunday / January). */
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

export const OBSERVE_COPY_UR: Words<typeof OBSERVE_COPY> = {
  home: 'ہوم',
  back: 'واپس',
  dash: '—',
  loadFailed: 'لوڈ نہیں ہو سکا',
  tryAgain: 'دوبارہ کوشش کریں',
  close: 'بند کریں',

  observe: 'مشاہدہ',
  observation: 'مشاہدہ',
  takeObservation: 'مشاہدہ لیں',
  reports: 'رپورٹس',
  waitingN: (n = 0) => `${n} منتظر`,
  inProgressN: (n = 0) => `${n} جاری`,
  leftToday: (n = 0) => `آج ${n} باقی`,
  nextVisit: 'اگلا دورہ',
  reportsWaiting: (n = 0) => (n === 1 ? '1 رپورٹ منتظر' : `${n} رپورٹیں منتظر`),
  inHours: (h = 0) => (h <= 0 ? 'ابھی' : `${h} گھنٹے میں`),

  pickTheTeacher: 'ٹیچر چنیں',
  school: 'اسکول',
  selectSchool: 'اسکول چنیں',
  allSchools: 'تمام اسکول',
  earlier: 'پہلے',
  today: 'آج',
  next: 'اگلا',
  done: 'مکمل',
  overdueN: (n = 0) => `${n} تاخیر`,
  daysLate: (n = 0) => `${n} دن لیٹ`,
  scheduleFirst: 'پہلے دورہ شیڈول کریں',
  nothingYet: 'ابھی کوئی دورہ نہیں',

  startRecording: 'ریکارڈنگ شروع کریں',
  uploadRecording: 'ریکارڈنگ اپ لوڈ کریں',
  reschedule: 'دوبارہ شیڈول کریں',
  cancelVisit: 'دورہ منسوخ کریں',
  keepVisit: 'دورہ رہنے دیں',
  teacher: 'ٹیچر',
  teacherProfile: 'ٹیچر پروفائل',
  hitl: 'HITL',
  dc: 'DC',
  avgHitl: 'اوسط HITL اسکور',
  training: 'ٹریننگ',
  papersMade: 'بنائے گئے پرچے',
  lpOpened: 'کھولے گئے لیسن پلان',
  lastVisitOn: (date = '') => `آخری دورہ · ${date}`.trim(),
  hitlBy: (who = '') => `HITL · ${who}`.trim(),
  you: 'آپ',
  lastStep: { sent: 'بھیجا گیا', report: 'رپورٹ بھیجیں', draft: 'فیڈبیک فارم', talk: 'ڈی بریف', analysing: 'تجزیہ جاری' },
  sendingNow: 'بھیجا جا رہا ہے',

  recordTitle: 'مشاہدہ ریکارڈ کریں',
  recording: 'ریکارڈنگ جاری',
  paused: 'رکی ہوئی',
  recordingTime: 'ریکارڈنگ کا وقت',
  visitAt: (time = '') => `دورہ · ${time}`.trim(),
  linked: 'جڑا ہوا',
  pause: 'روکیں',
  resume: 'جاری رکھیں',
  stop: 'ختم کریں',
  stopAsk: 'ریکارڈنگ ختم کریں',
  recordedFor: (length = '') => `آپ نے ${length} ریکارڈ کیا۔`,
  yesStop: 'جی، ختم کریں',
  keepRecording: 'ریکارڈنگ جاری رکھیں',
  shortNote: 'یہ مختصر ہے۔ رپورٹ پورے سبق پر بہتر بنتی ہے۔',
  screenOff: 'اسکرین کچھ دیر بند رہی۔ کچھ حصہ خاموش ہو سکتا ہے۔ یہ اسکرین کھلی رکھیں۔',
  micBlocked: 'مائیک کی اجازت نہیں',
  micAllow: 'فون پوچھے تو اجازت دیں پر ٹیپ کریں۔',

  chooseFile: 'فائل چنیں',
  notAudio: 'یہ ریکارڈنگ نہیں',
  tooLarge: 'فائل بہت بڑی ہے',
  next2: 'آگے بڑھیں',

  checkAndSend: 'دیکھیں اور بھیجیں',
  observationOf: (name = '') => `${name} کا مشاہدہ`.trim(),
  justNow: 'ابھی',
  minShort: (n = 0) => `${n} منٹ`,
  underMinute: 'ایک منٹ سے کم',
  redo: 'دوبارہ ریکارڈ کریں',
  shortWarning: 'یہ 10 منٹ سے کم ہے۔ آپ پھر بھی بھیج سکتے ہیں، مگر رپورٹ مختصر ہو سکتی ہے۔',
  lessonPlan: 'لیسن پلان',
  optional: 'اختیاری',
  theirRecentPlans: 'ان کے حالیہ پلان',
  library: 'لائبریری',
  planPhoto: 'پلان کی تصویر',
  takenNow: 'ابھی لی گئی',
  noRecentPlans: 'کوئی حالیہ پلان نہیں',
  removePlan: 'پلان ہٹائیں',
  planNotOk: 'پلان کی تصویر نہیں',
  photos: 'تصاویر',
  upToN: (n = 0) => `${n} تک`,
  noFaces: 'چہرے نہ دکھائیں',
  addPhoto: 'تصویر شامل کریں',
  removePhoto: (name = '') => `${name} ہٹائیں`.trim(),
  tooManyPhotos: (n = 0) => `${n} تک تصاویر`,
  notAPhoto: 'یہ تصویر نہیں',
  sendObservation: 'مشاہدہ بھیجیں',
  noRecording: 'ابھی کوئی ریکارڈنگ نہیں',
  grade: (g = 0) => `جماعت ${g}`,

  sending: 'بھیجا جا رہا ہے',
  leaveSub: 'مشاہدہ پس منظر میں بھیجا جاتا رہے گا۔',
  goToReports: 'رپورٹس پر جائیں',
  sent: 'مشاہدہ بھیجا گیا',
  openObservation: 'مشاہدہ کھولیں',
  couldntSend: 'نہیں بھیجا جا سکا',
  failure: {
    network: 'انٹرنیٹ بند ہو گیا۔ مشاہدہ اس فون میں محفوظ ہے۔',
    plan: 'وہ لیسن پلان استعمال نہیں ہو سکا۔ دوسرا چنیں، یا پلان کی تصویر لیں۔',
    notYourTeacher: 'یہ ٹیچر اب آپ کے اسکولوں میں نہیں ہے۔',
    refused: 'کچھ قبول نہیں ہوا۔ براہ کرم دوبارہ کوشش کریں۔',
  },

  weekdays: ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'],
  months: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'],
};

/** The Observe screens' words in both languages. */
export const OBSERVE = bilingual(OBSERVE_COPY, OBSERVE_COPY_UR);
export type ObserveCopy = Words<typeof OBSERVE_COPY>;

/** Paths that are rightly a sentence (more than 4 words) — the real reasons and the notes the design names. */
export const SENTENCES = ['recordedFor', 'shortNote', 'screenOff', 'micAllow', 'shortWarning', 'leaveSub', 'failure'] as const;
/** Paths that are rightly the same in both languages. */
export const SAME = ['dash', 'hitl', 'dc', 'hitlBy'] as const;
