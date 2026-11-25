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
  reports: 'My observations',
  waitingN: (n = 0) => `${n} waiting`,
  inProgressN: (n = 0) => `${n} in progress`,
  leftToday: (n = 0) => `${n} left today`,
  nextVisit: 'Next visit',
  reportsWaiting: (n = 0) => (n === 1 ? '1 observation needs you' : `${n} observations need you`),
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
  daysLate: (n = 0) => (n === 1 ? '1 day late' : `${n} days late`),
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
  hitl: 'Observations',
  dc: 'Digital Coaching',
  avgHitl: 'Coach score (avg.)',
  training: 'Training',
  papersMade: 'Papers made',
  lpOpened: 'Lesson Plans opened',
  lastVisitOn: (date = '') => `Last observation · ${date}`.trim(),
  lastObservation: 'Last observation',
  hitlBy: (who = '') => `Observation · ${who}`.trim(),
  you: 'You',
  lastStep: { sent: 'Sent', report: 'Send report', draft: 'Feedback Form', talk: 'Debrief', analysing: 'Analysing', stopped: 'Analysis stopped' } as Record<string, string>,
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
  // bd-jjcofw.10 (M7): a length inside the sentence starts lower-case ("under 1 min", not "Under 1 min").
  recordedFor: (length: string | number = '') => { const s = String(length); return `You recorded ${s.charAt(0).toLowerCase()}${s.slice(1)}.`; },
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
  madeByTeacher: 'Made by the teacher',
  chapterN: (n: string | number) => `Ch ${n}`,
  yesterday: 'Yesterday',
  library: 'Library',
  planPhoto: 'Plan photo',
  takenNow: 'Taken just now',
  noRecentPlans: 'No recent plans',
  removePlan: 'Remove plan',
  planNotOk: 'Not a plan photo',
  /* bd-fmf24g.66 — the teacher's own plan as a file: the tile, its sheet, the bar, the observation page's row */
  ownPlan: 'Their own plan',
  camera: 'Camera',
  gallery: 'Gallery',
  files: 'Files',
  kindPdf: 'PDF',
  kindWord: 'Word',
  kindPhoto: 'Photo',
  upToMb: (n = 0) => `Up to ${n} MB`,
  notPlanFile: 'Not a plan file',
  /* bd-tymy1n (queue #179) — a file the phone will not open, refused when she picks it (the teacher app's words) */
  fileWontOpen: 'File will not open',
  /** bd-tymy1n — Send again without the photo or plan the phone could not read (the teacher app's words) */
  sendWithoutIt: 'Send without it',
  planChip: (kind = '') => `Plan · ${kind}`.trim(),
  lpReading: 'Reading',
  lpRead: 'Read',
  lpCantRead: "Couldn't read",
  lpNotScored: 'Not scored',
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
  /* bd-ra8xu.40 — the class taught (and, for grades 6-12, its subject), asked while FDE's tools are on for her: it
     chooses the observation form, as WhatsApp's visit planner asks after Start */
  classAndSubject: 'Class and subject',
  classField: 'Class',
  subjectField: 'Subject',
  gradePrimary: 'Grade 1-5',
  chooseClassFirst: 'Choose the class first',
  chooseSubjectFirst: 'Choose the subject first',
  subjects: {
    english: 'English', urdu: 'Urdu', maths: 'Maths', science: 'Science', social_studies: 'Social Studies',
    islamiat: 'Islamiat', computer: 'Computer', other: 'Other',
  },

  /* sending, in the background */
  sending: 'Sending',
  leaveSub: 'The observation keeps sending in the background.',
  goToReports: 'Go to My observations',
  sent: 'Observation sent',
  openObservation: 'Open observation',
  couldntSend: "Couldn't send",
  /** The real reason a send failed (the banner, the strip's page, the Sending page). */
  failure: {
    network: 'The internet stopped. The observation is safe on this phone.',
    plan: 'That lesson plan could not be used. Select another, or take a photo of the plan.',
    notYourTeacher: 'That teacher is not in your schools any more.',
    refused: 'Something was not accepted. Please try again.',
    /* bd-tymy1n — a file this phone could not read at Send: not the internet; say which, and the way on */
    photoUnreadable: (n = 0) => `Photo ${n} could not be read on this phone. Send without it.`,
    planUnreadable: 'The lesson plan could not be read on this phone. Send without it.',
    recordingUnreadable: 'The recording could not be read on this phone. Select the file again.',
    /* bd-tfya0m — every file arrived, the start got no answer after its own tries */
    startFailed: 'Your recording arrived, but the observation did not start. Tap Try again.',
  },

  /** Short weekday and month names, for "Tue 6 Oct" (index 0 = Sunday / January). */
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],

  /* bd-9652yj (queue #166) — the way back to WhatsApp: the strip on every Observe screen, and the line it types in the
   * chat (the bot reads it: bot/shared/services/coach-app-nudge.service.js). The operator's words (mockups, option B). */
  troubleAsk: 'Having trouble?',
  continueOnWhatsApp: 'Continue on WhatsApp',
  handoffLine: (code = '') => (code ? `Continue my visit on WhatsApp (code ${code})` : 'Continue my visit on WhatsApp'),
  /* bd-oe6r47 / bd-ih6cej (queue #278) — the recording steps' advice (the operator 25 Nov ~17:20: "advise whoever is using
   * to use their own recorders if their internet is not very good"), the upload-only line (a person the switch names),
   * and a recording kept on the phone for this teacher. "Upload recording" is the locked word. */
  weakInternet: "Weak internet? Record in your phone's Recorder app, then upload it here.",
  uploadOnlyLine: "Record the lesson in your phone's Recorder app, then upload it here.",
  savedOnPhone: (name = '') => `${name}’s recording is saved on this phone.`,
  sendKept: 'Send saved recording',
  openingFile: 'Opening the recording…',
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
  reports: 'میرے مشاہدات',
  waitingN: (n = 0) => `${n} منتظر`,
  inProgressN: (n = 0) => `${n} جاری`,
  leftToday: (n = 0) => `آج ${n} باقی`,
  nextVisit: 'اگلا دورہ',
  reportsWaiting: (n = 0) => (n === 1 ? '1 مشاہدہ منتظر' : `${n} مشاہدات منتظر`),
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
  hitl: 'مشاہدات',
  dc: 'ڈیجیٹل کوچنگ',
  avgHitl: 'کوچ اسکور (اوسط)',
  training: 'ٹریننگ',
  papersMade: 'بنائے گئے پرچے',
  lpOpened: 'کھولے گئے لیسن پلان',
  lastVisitOn: (date = '') => `آخری مشاہدہ · ${date}`.trim(),
  lastObservation: 'آخری مشاہدہ',
  hitlBy: (who = '') => `مشاہدہ · ${who}`.trim(),
  you: 'آپ',
  lastStep: { sent: 'بھیجا گیا', report: 'رپورٹ بھیجیں', draft: 'فیڈبیک فارم', talk: 'ڈی بریف', analysing: 'تجزیہ جاری', stopped: 'تجزیہ رک گیا' },
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
  madeByTeacher: 'ٹیچر کا بنایا ہوا',
  chapterN: (n: string | number) => `باب ${n}`,
  yesterday: 'کل',
  library: 'لائبریری',
  planPhoto: 'پلان کی تصویر',
  takenNow: 'ابھی لی گئی',
  noRecentPlans: 'کوئی حالیہ پلان نہیں',
  removePlan: 'پلان ہٹائیں',
  planNotOk: 'پلان کی تصویر نہیں',
  ownPlan: 'ان کا اپنا پلان',
  camera: 'کیمرا',
  gallery: 'گیلری',
  files: 'فائلیں',
  kindPdf: 'PDF',
  kindWord: 'ورڈ',
  kindPhoto: 'تصویر',
  upToMb: (n = 0) => `${n} MB تک`,
  notPlanFile: 'پلان کی فائل نہیں',
  fileWontOpen: 'فائل نہیں کھل رہی',
  sendWithoutIt: 'اس کے بغیر بھیجیں',
  planChip: (kind = '') => `پلان · ${kind}`.trim(),
  lpReading: 'پڑھا جا رہا ہے',
  lpRead: 'پڑھ لیا',
  lpCantRead: 'پڑھ نہیں سکے',
  lpNotScored: 'اسکور نہیں',
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
  classAndSubject: 'جماعت اور مضمون',
  classField: 'جماعت',
  subjectField: 'مضمون',
  gradePrimary: 'جماعت ۱ تا ۵',
  chooseClassFirst: 'پہلے جماعت چنیں',
  chooseSubjectFirst: 'پہلے مضمون چنیں',
  subjects: {
    english: 'انگریزی', urdu: 'اردو', maths: 'ریاضی', science: 'سائنس', social_studies: 'معاشرتی علوم',
    islamiat: 'اسلامیات', computer: 'کمپیوٹر', other: 'کوئی اور',
  },

  sending: 'بھیجا جا رہا ہے',
  leaveSub: 'مشاہدہ پس منظر میں بھیجا جاتا رہے گا۔',
  goToReports: 'میرے مشاہدات پر جائیں',
  sent: 'مشاہدہ بھیجا گیا',
  openObservation: 'مشاہدہ کھولیں',
  couldntSend: 'نہیں بھیجا جا سکا',
  failure: {
    network: 'انٹرنیٹ بند ہو گیا۔ مشاہدہ اس فون میں محفوظ ہے۔',
    plan: 'وہ لیسن پلان استعمال نہیں ہو سکا۔ دوسرا چنیں، یا پلان کی تصویر لیں۔',
    notYourTeacher: 'یہ ٹیچر اب آپ کے اسکولوں میں نہیں ہے۔',
    refused: 'کچھ قبول نہیں ہوا۔ براہ کرم دوبارہ کوشش کریں۔',
    photoUnreadable: (n = 0) => `تصویر ${n} اس فون پر نہیں کھل سکی۔ اس کے بغیر بھیجیں۔`,
    planUnreadable: 'لیسن پلان اس فون پر نہیں کھل سکا۔ اس کے بغیر بھیجیں۔',
    recordingUnreadable: 'ریکارڈنگ اس فون پر نہیں کھل سکی۔ فائل دوبارہ چنیں۔',
    startFailed: 'آپ کی ریکارڈنگ پہنچ گئی، مگر مشاہدہ شروع نہیں ہوا۔ دوبارہ کوشش کریں دبائیں۔',
  },

  weekdays: ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'],
  months: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'],

  troubleAsk: 'کوئی مسئلہ؟',
  // 4 words, the kit's limit: option A's Urdu for the same action in the mockups (the 5-word «… جاری رکھیں» is too long);
  // WhatsApp's two Urdu words are joined by U+00A0 so a narrow strip never splits them.
  continueOnWhatsApp: 'واٹس\u00A0ایپ پر کریں',
  // «واٹس ایپ» is one unit (U+00A0), as in the bot's copy; the bot reads the line with either space.
  handoffLine: (code = '') => (code ? `میرا دورہ واٹس\u00A0ایپ پر جاری رکھیں (کوڈ ${code})` : 'میرا دورہ واٹس\u00A0ایپ پر جاری رکھیں'),
  // bd-oe6r47 / bd-ih6cej — MACHINE-DRAFTED, awaiting a native check (NATIVE-CHECK); «اپ لوڈ» as in «ریکارڈنگ اپ لوڈ کریں».
  weakInternet: 'انٹرنیٹ کمزور ہے؟ فون کی ریکارڈر ایپ میں ریکارڈ کریں، پھر یہاں اپ لوڈ کریں۔',
  uploadOnlyLine: 'فون کی ریکارڈر ایپ میں سبق ریکارڈ کریں، پھر یہاں اپ لوڈ کریں۔',
  savedOnPhone: (name = '') => `${name} کی ریکارڈنگ اس فون میں محفوظ ہے۔`,
  sendKept: 'محفوظ ریکارڈنگ بھیجیں',
  openingFile: 'ریکارڈنگ کھل رہی ہے…',
};

/** The Observe screens' words in both languages. */
export const OBSERVE = bilingual(OBSERVE_COPY, OBSERVE_COPY_UR);
export type ObserveCopy = Words<typeof OBSERVE_COPY>;

/**
 * Paths that are rightly a sentence (more than 4 words) — the real reasons and the notes the design names. bd-9652yj:
 * the strip's question ("Having trouble?", the operator's words in the option B mockups) and the line typed into
 * WhatsApp, which the bot reads.
 */
export const SENTENCES = [
  'recordedFor', 'shortNote', 'screenOff', 'micAllow', 'shortWarning', 'leaveSub', 'failure', 'troubleAsk', 'handoffLine',
  // bd-oe6r47 / bd-ih6cej — the recording steps' one line (weak internet / upload-only) and the kept-copy sentence.
  'weakInternet', 'uploadOnlyLine', 'savedOnPhone',
] as const;
/** Paths that are rightly the same in both languages. */
export const SAME = ['dash', 'kindPdf'] as const;
