/**
 * bd-fmf24g.4 — every word the teacher v2 Digital Coaching screens show, in the feature's own copy file.
 *
 * bd-fmf24g.13.2 — bilingual: COACHING = { en, ur }, read with useCopy(COACHING); plain helpers (api.ts,
 * report.ts) take the words as a parameter, English by default. The Urdu is MACHINE-DRAFTED from the bot's
 * existing Urdu (ux-strings.js: سبق ریکارڈ کروں, تصویر … از …, مکمل, جاری, the score bands; coaching-messages.js:
 * تدریس کا تجزیہ, غور کا سوال; observe-strings.js: ڈی بریف) and awaits a human review
 * (workbench/teacher-v2-impl/urdu-review/).
 *
 * Same rules as the new UI's copy (newui/copy.ts, DESIGN.md): 1–3 words, 4 at most, no sentences, no
 * question marks. The one exception the operator asked for is the English Photos hint, one short line; its
 * Urdu fits the 4 words. DATA is not copy: a plan's title, a subject's name and a lesson's topic come from
 * the API as they are.
 */

import { BAND_THRESHOLDS, type BandKey } from '../../lib/scoreBands';
import { bilingual, type Bilingual, type Words } from '../i18n';
import type { CopyEntry } from '../copyRegistry';
import { PICKER_WORDS_EN } from '../../newui/coaching/pickerWords';
import type { PickerWords } from '../../newui/coaching/pickerWords';

/** A band's word, by BandKey. English is lib/scoreBands' own, so the two can never drift. */
const BANDS_EN = Object.fromEntries(BAND_THRESHOLDS.map((b) => [b.key, b.label])) as Record<BandKey, string>;

import { DC_MIN_SECONDS } from '../../lib/coachingUpload';

/** bd-fgj73x.7 — the minimum, said in minutes, from the one constant. */
const MIN_MINUTES = DC_MIN_SECONDS / 60;

export const COACHING_V2_COPY = {
  title: 'Digital Coaching',
  /* the main page and its one screen (Assessment's flow, design v6): Start DC observation, then step by step on one
     screen — Grade and subject, Recording, Lesson plan, Photos — Submit, and the progress on that same screen */
  startObservation: 'Start DC observation',
  gradeAndSubject: 'Grade and subject',
  summary: 'Summary',
  summaryCount: (n: number) => (n === 1 ? '1 DC observation' : `${n} DC observations`),
  home: 'Home',
  /* the hub (bd-fmf24g.76: no class; Record lesson and Upload recording first, then the rest once a recording is on the page) */
  lessonPlan: 'Lesson plan',
  optional: 'Optional',
  /** The empty lesson plan row: a noun, as every prompt (niete-portal: never "Select ..."). */
  selectPlan: 'Lesson plan',
  viewPlan: 'View lesson plan',
  planFallback: 'Lesson plan',
  change: 'Change',
  photos: 'Photos',
  /* bd-r5ckgn — ICT feedback (IAB Experience View, row 4): the three photos to take. bd-rt8wky (operator, 19 Oct):
     one running paragraph, (2) starting where (1) ends, in both languages. */
  photosHint:
    "(1) A photo of the board with today's objective or task " +
    "(2) A photo of a student's notebook or worksheet " +
    '(3) A photo of teaching aids, e.g. drawings, charts or cards',
  noFaces: 'No faces',
  addPhoto: 'Add photo',
  /* bd-rt8wky — the teacher's photos: the phone camera, or the gallery (one or several), up to ten in all. */
  takePhoto: 'Take photo',
  fromGallery: 'From gallery',
  photoCount: (n: number, max: number) => `${n} of ${max} photos`,
  removePhoto: (n: number) => `Remove photo ${n}`,
  /** The photo cap said aloud: ten here, three for the coach (one grid, parts.tsx PhotoGrid). */
  upToPhotos: (n: number) => `Up to ${n} photos`,
  atLeastMinutes: `At least ${MIN_MINUTES} min`,
  tooShort: `Too short. Recordings must be at least ${MIN_MINUTES} minutes.`,
  notAPhoto: 'Not a photo',
  uploadRecording: 'Upload recording',
  recent: 'Recent DC Observations',
  noneYet: 'No DC observations yet',
  analysing: 'Analysing',
  /* record */
  recordTitle: 'Record lesson',
  starting: 'Starting',
  recording: 'Recording',
  /* bd-dpen4t — ICT IAB rows 22/26: step headings with their own words (the live indicator and the chip keep theirs). */
  stepRecording: 'Class recording',
  stepAnalysis: 'Lesson analysis',
  paused: 'Paused',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  finishTitle: 'Finish lesson',
  yesFinish: 'Yes, finish',
  keepRecording: 'Keep recording',
  openPlan: 'Open lesson plan',
  lessonPlans: 'Lesson Plans',
  keepAppOpen: 'Keep app open',
  micBlocked: 'Microphone blocked',
  /* bd-idkgm2 — ICT feedback (IAB Experience View, row 18): what to do, under the title (operator-approved mockup). */
  micBlockedHint: 'Tap Try again and allow the microphone to record your lesson.',
  /* bd-qccbrv — the same card, when the browser reports the mic blocked, and when Try again was refused again. */
  micBrowserBlocked: 'Your browser has blocked the microphone. Click the 🔒 icon next to the web address, allow the microphone, then tap Try again.',
  micStillBlockedWhatsApp: 'Still blocked? Allow the microphone for WhatsApp in your phone’s settings, or upload a recording instead.',
  micStillBlocked: 'Still blocked? Allow the microphone in your browser or phone settings, or upload a recording instead.',
  tryAgain: 'Try again',
  /* the recording on the page, and the page's one Submit */
  submit: 'Submit',
  /** A DC observation with no topic or subject: its own name. */
  dcObservation: 'DC observation',
  minutes: (n: number) => `${n} min`,
  listen: 'Listen',
  stopListening: 'Stop',
  redo: 'Redo',
  changeFile: 'Change file',
  attached: 'Attached',
  none: 'None',
  photosCount: (n: number) => (n === 1 ? '1 photo' : `${n} photos`),
  send: 'Send',
  tooLarge: 'File too large',
  notAudio: 'Not a recording',
  /* bd-i0u6n2 — Digital Coaching is audio only: a video in the recording slot says so. */
  notVideo: 'This is a video. Upload an audio recording.',
  /* after */
  sending: 'Sending',
  sent: 'Sent',
  openLesson: 'Open DC observation',
  noInternet: 'No internet',
  savedOnPhone: 'Saved on phone',
  planNotUsed: 'Lesson plan not used',
  changePlan: 'Change lesson plan',
  notAccepted: 'Not accepted',
  busy: 'Another lesson analysing',
  openThat: 'Open DC observation',
  grade: (g: number) => `Grade ${g}`,
  /* the report page */
  progress: 'Progress',
  done: 'Done',
  reportReady: 'Report ready',
  stepReflection: 'Reflection question',
  /* bd-dpen4t — ICT IAB row 25. */
  stepReport: 'Feedback',
  /* bd-eygg2f — ICT feedback (IAB Experience View, row 5): she answers by writing or by speaking. */
  subReflection: 'Write or speak',
  recordAnswer: 'Record answer',
  removeRecording: 'Remove recording',
  subReport: 'Report and voice note',
  yourTurn: 'Your turn',
  now: 'Now',
  /* bd-9d1cmi — ICT feedback (IAB Experience View, row 9), ICT's own words: the debrief is her lesson report's audio summary, not a
     random voice message. Past the 4-word rule on purpose (longOk + the checks' exemption). */
  voiceNote: 'Audio Summary of Your Lesson Report',
  /* bd-kn3m1a — ICT feedback row 10: the heading over the DC report, after the audio summary. */
  fullReport: 'Your Comprehensive Lesson Report',
  yourRecording: 'Your recording',
  yourAnswer: 'Your answer',
  answerSent: 'Answer sent',
  couldNotSend: 'Could not send',
  download: 'Download',
  /* bd-gzfdu9 (VIDREC, SPEC §4.2/§4.7) — the recommended clip's card under "Try next class"; the /cr card's words. */
  videoRecoCardTitle: '🎬 Watch this next',
  videoRecoCardButton: (n: number) => `Watch (${n} min)`,
  videoRecoCardButtonPlain: 'Watch',
  videoRecoMinutes: (n: number) => `⏱ ${n} min`,
  videoRecoLanguage: { ur: 'Urdu', en: 'English' } as Record<string, string>,
  stopped: 'Could not analyse',
  /* bd-z3cadk — ICT IAB row 23: the same recording sent again. The bot's own words (coaching-messages.js
     duplicateRecording), so the portal says what WhatsApp says. */
  duplicateRecordingLead: "📋 I've heard this recording before \u2014 it's the same one you sent me earlier, so here is the report I already made for it.",
  duplicateRecordingNext: "Send a new recording whenever you'd like fresh feedback.",
  /* bd-c5reix — a classroom recording sent on WhatsApp, kept and waiting here; and the repeat caught before it is sent
     (the same voice as the bot's duplicateRecording). */
  fromWhatsApp: 'Recording from WhatsApp',
  addDetailsSend: 'Add details & send',
  sentBefore: 'Sent before',
  openReport: 'Open report',
  alreadySent: 'Already sent',
  selectAnother: 'Select another recording',
  checking: 'Checking…',
  duplicateBeforeLead: "📋 I've heard this recording before \u2014 it's the same one you sent me earlier.",
  /* bd-aqotzx — ICT IAB row 16: the recording did not sound like a class being taught. */
  classNeedsAnswer: 'Needs your answer',
  classQuestion: 'Is this the recording of your class?',
  classWhy: "Your recording doesn't sound like a class being taught.",
  classYes: 'Yes, my class',
  classNo: 'No, record again',
  classDeadline: "No answer in 24 hours? This recording will be closed and won't count.",
  classNoAnswerNote: "Not carried forward: this recording didn't sound like a class being taught and we didn't get your answer within 24 hours, so no report was made.",
  classRecordAgainNote: 'Not carried forward: you chose to record this class again, so no report was made.',
  stoppedChip: 'Stopped',
  notFound: 'DC observation not found',
  loading: 'Loading',
  retry: 'Try again',
  fromCoach: (name: string) => `From ${name}`,
  /** Her recording's player (newui AudioPlayer's own words, passed in so they follow the page). */
  audio: {
    play: 'Play',
    pause: 'Pause',
    cantPlay: "Can't play",
  },
  /* All DC observations */
  allTitle: 'All DC Observations',
  kpiSessions: 'DC observations',
  kpiLatestBand: 'Latest band',
  kpiMinutes: 'Minutes recorded',
  kpiReports: 'Reports received',
  noneInRange: 'None in these dates',
  /** A lesson's band (never its number) — on its chip and the Latest band tile; Observations' reports too. */
  bands: BANDS_EN,
  /** The lesson-plan picker (the new UI's PlanSheet and LibraryStep, passed in so they follow the page):
   *  its English is the new UI's own, word for word. */
  picker: {
    ...PICKER_WORDS_EN,
    // The ontology's words for the v2 picker; the older UI keeps its own (newui/coaching/pickerWords.ts).
    chooseFile: 'Select file',
    preparing: 'Being made',
    nothingHere: 'Nothing yet',
    notLoaded: 'Could not load',
  } satisfies PickerWords,
};

/**
 * bd-fmf24g.13.2 — Digital Coaching's words in Urdu (MACHINE-DRAFTED; review pending). Western digits, as the
 * bot. The bands are the bot's own words (ux-strings.js scoreBand*), the same as Analytics'.
 */
export const COACHING_V2_COPY_UR: Words<typeof COACHING_V2_COPY> = {
  title: 'ڈیجیٹل کوچنگ',
  // The Lesson Plans page's own words for Start DC observation and Grade and subject (lessons/copy.ts), and the
  // ontology's خلاصہ for Summary. Machine-drafted where new; review pending.
  startObservation: 'ڈیجیٹل کوچنگ مشاہدہ شروع کریں',
  gradeAndSubject: 'جماعت اور مضمون',
  summary: 'خلاصہ',
  summaryCount: (n: number) => (n === 1 ? '1 ڈیجیٹل کوچنگ مشاہدہ' : `${n} ڈیجیٹل کوچنگ مشاہدات`),
  home: 'ہوم',
  lessonPlan: 'لیسن پلان',
  optional: 'اختیاری',
  selectPlan: 'لیسن پلان',
  viewPlan: 'لیسن پلان دیکھیں',
  planFallback: 'لیسن پلان',
  change: 'تبدیل کریں',
  photos: 'تصاویر',
  /* bd-r5ckgn — ICT feedback (IAB Experience View, row 4): the three photos to take. Human-written Urdu, not
     machine-drafted. bd-rt8wky (operator, 19 Oct): one running paragraph, (2) starting where (1) ends. */
  photosHint:
    '(1) بورڈ کی تصویر جس پر آج کا مقصد یا کام لکھا ہو ' +
    '(2) کسی طالب علم کی کاپی یا ورک شیٹ کی تصویر ' +
    '(3) تدریسی معاون مواد، مثلاً ڈرائنگ، چارٹ یا کارڈز کی تصویر',
  noFaces: 'چہرے نہ دکھائیں',
  addPhoto: 'تصویر شامل کریں',
  takePhoto: 'تصویر لیں',
  fromGallery: 'گیلری سے',
  photoCount: (n: number, max: number) => `${max} میں سے ${n} تصاویر`,
  removePhoto: (n: number) => `تصویر ${n} ہٹائیں`,
  upToPhotos: (n: number) => `${n} تصاویر تک`,
  atLeastMinutes: `${MIN_MINUTES} منٹ یا زیادہ`,
  tooShort: `بہت مختصر۔ ریکارڈنگ کم از کم ${MIN_MINUTES} منٹ کی ہونی چاہیے۔`,
  notAPhoto: 'یہ تصویر نہیں',
  uploadRecording: 'ریکارڈنگ اپ لوڈ کریں',
  recent: 'حالیہ ڈیجیٹل کوچنگ مشاہدات',
  noneYet: 'ابھی کوئی ڈیجیٹل کوچنگ مشاہدہ نہیں',
  analysing: 'تجزیہ جاری',
  recordTitle: 'سبق ریکارڈ کریں',
  starting: 'شروع ہو رہا ہے',
  recording: 'ریکارڈنگ جاری',
  stepRecording: 'کلاس کی ریکارڈنگ',
  stepAnalysis: 'سبق کا تجزیہ',
  paused: 'رکی ہوئی',
  pause: 'روکیں',
  resume: 'جاری رکھیں',
  stop: 'ختم کریں',
  finishTitle: 'سبق ختم کریں',
  yesFinish: 'جی، ختم کریں',
  keepRecording: 'ریکارڈنگ جاری رکھیں',
  openPlan: 'لیسن پلان کھولیں',
  lessonPlans: 'لیسن پلان',
  keepAppOpen: 'ایپ کھلی رکھیں',
  micBlocked: 'مائیک کی اجازت نہیں',
  micBlockedHint: '«دوبارہ کوشش کریں» دبائیں اور مائیک کی اجازت دیں، تاکہ آپ کا سبق ریکارڈ ہو سکے۔',
  micBrowserBlocked: 'آپ کے براؤزر نے مائیک بند کر دیا ہے۔ ویب ایڈریس کے ساتھ 🔒 پر کلک کریں، مائیک کی اجازت دیں، پھر «دوبارہ کوشش کریں» دبائیں۔',
  micStillBlockedWhatsApp: 'اب بھی بند ہے؟ فون کی سیٹنگز میں WhatsApp کو مائیک کی اجازت دیں، یا ریکارڈنگ اپ لوڈ کریں۔',
  micStillBlocked: 'اب بھی بند ہے؟ براؤزر یا فون کی سیٹنگز میں مائیک کی اجازت دیں، یا ریکارڈنگ اپ لوڈ کریں۔',
  tryAgain: 'دوبارہ کوشش کریں',
  // The training portal's own word for Submit (teacher/training/copy.ts submit).
  submit: 'جمع کرائیں',
  dcObservation: 'ڈیجیٹل کوچنگ مشاہدہ',
  minutes: (n: number) => `${n} منٹ`,
  listen: 'سنیں',
  stopListening: 'ختم کریں',
  redo: 'دوبارہ ریکارڈ کریں',
  changeFile: 'فائل تبدیل کریں',
  attached: 'منسلک',
  none: 'کوئی نہیں',
  photosCount: (n: number) => (n === 1 ? '1 تصویر' : `${n} تصاویر`),
  send: 'بھیجیں',
  tooLarge: 'فائل بہت بڑی ہے',
  notAudio: 'یہ ریکارڈنگ نہیں',
  notVideo: 'یہ ویڈیو ہے۔ آڈیو ریکارڈنگ اپ لوڈ کریں۔',
  sending: 'بھیجا جا رہا ہے',
  sent: 'بھیجا گیا',
  openLesson: 'ڈیجیٹل کوچنگ مشاہدہ کھولیں',
  noInternet: 'انٹرنیٹ نہیں',
  savedOnPhone: 'فون میں محفوظ',
  planNotUsed: 'لیسن پلان استعمال نہیں',
  changePlan: 'لیسن پلان تبدیل کریں',
  notAccepted: 'قبول نہیں ہوا',
  busy: 'دوسرا سبق زیرِ تجزیہ',
  openThat: 'ڈیجیٹل کوچنگ مشاہدہ کھولیں',
  grade: (g: number) => `جماعت ${g}`,
  progress: 'پیش رفت',
  done: 'مکمل',
  reportReady: 'رپورٹ تیار',
  /* bd-dpen4t — ICT IAB row 27: the English word in an Urdu line, as ICT wrote it. */
  stepReflection: 'Reflection کا سوال',
  stepReport: 'فیڈ بیک',
  subReflection: 'لکھ کر یا بول کر جواب دیں',
  recordAnswer: 'جواب ریکارڈ کریں',
  removeRecording: 'ریکارڈنگ ہٹائیں',
  subReport: 'رپورٹ اور وائس نوٹ',
  yourTurn: 'آپ کی باری',
  now: 'ابھی',
  voiceNote: 'آپ کے سبق کی رپورٹ کا آڈیو خلاصہ',
  fullReport: 'آپ کے سبق کی مکمل رپورٹ',
  yourRecording: 'آپ کی ریکارڈنگ',
  yourAnswer: 'آپ کا جواب',
  answerSent: 'جواب بھیجا گیا',
  couldNotSend: 'بھیجا نہیں جا سکا',
  download: 'ڈاؤن لوڈ',
  videoRecoCardTitle: '🎬 اگلا یہ دیکھیں',
  videoRecoCardButton: (n: number) => `دیکھیں (${n} منٹ)`,
  videoRecoCardButtonPlain: 'دیکھیں',
  videoRecoMinutes: (n: number) => `⏱ ${n} منٹ`,
  videoRecoLanguage: { ur: 'اردو', en: 'انگریزی' } as Record<string, string>,
  stopped: 'تجزیہ نہیں ہو سکا',
  duplicateRecordingLead: '📋 میں نے یہ ریکارڈنگ پہلے بھی سنی ہے — یہ وہی ریکارڈنگ ہے جو آپ نے پہلے بھیجی تھی، اس لیے اس کی پہلے سے تیار کردہ رپورٹ یہ رہی۔',
  duplicateRecordingNext: 'جب بھی نئی رائے چاہیے ہو، نئی ریکارڈنگ بھیج دیجیے۔',
  // bd-c5reix — machine-drafted (review pending), from the bot's own words.
  fromWhatsApp: 'واٹس ایپ سے ریکارڈنگ',
  addDetailsSend: 'تفصیل ڈال کر بھیجیں',
  sentBefore: 'پہلے بھیجی گئی',
  openReport: 'رپورٹ کھولیں',
  alreadySent: 'بھیجی جا چکی',
  selectAnother: 'دوسری ریکارڈنگ چنیں',
  checking: 'جانچ ہو رہی ہے…',
  duplicateBeforeLead: '📋 میں نے یہ ریکارڈنگ پہلے بھی سنی ہے — یہ وہی ریکارڈنگ ہے جو پہلے بھیجی گئی تھی۔',
  classNeedsAnswer: 'آپ کا جواب چاہیے',
  classQuestion: 'کیا یہ آپ کی کلاس کی ریکارڈنگ ہے؟',
  classWhy: 'آپ کی ریکارڈنگ کلاس میں پڑھائی جیسی نہیں لگتی۔',
  classYes: 'جی، میری کلاس',
  classNo: 'نہیں، دوبارہ ریکارڈ',
  classDeadline: '24 گھنٹے میں جواب نہ دیا تو یہ ریکارڈنگ بند ہو جائے گی اور شمار نہیں ہوگی۔',
  classNoAnswerNote: 'آگے نہیں بڑھایا گیا: یہ ریکارڈنگ کلاس میں پڑھائی جیسی نہیں لگی اور 24 گھنٹے میں آپ کا جواب نہیں ملا، اس لیے رپورٹ نہیں بنی۔',
  classRecordAgainNote: 'آگے نہیں بڑھایا گیا: آپ نے یہ کلاس دوبارہ ریکارڈ کرنے کا انتخاب کیا، اس لیے رپورٹ نہیں بنی۔',
  stoppedChip: 'روک دیا گیا',
  notFound: 'ڈیجیٹل کوچنگ مشاہدہ نہیں ملا',
  loading: 'لوڈ ہو رہا ہے',
  retry: 'دوبارہ کوشش کریں',
  fromCoach: (name: string) => `${name} کی طرف سے`,
  audio: {
    play: 'چلائیں',
    pause: 'روکیں',
    cantPlay: 'چل نہیں سکا',
  },
  allTitle: 'تمام ڈیجیٹل کوچنگ مشاہدات',
  kpiSessions: 'ڈیجیٹل کوچنگ مشاہدات',
  kpiLatestBand: 'تازہ ترین کارکردگی',
  kpiMinutes: 'ریکارڈ شدہ منٹ',
  kpiReports: 'موصول شدہ رپورٹس',
  noneInRange: 'اس دوران کوئی نہیں',
  bands: {
    excellent: 'بہترین',
    good: 'اچھا',
    average: 'اوسط',
    below_average: 'اوسط سے کم',
    needs_support: 'مدد درکار',
  },
  picker: {
    lessonPlan: 'لیسن پلان',
    recent: 'حالیہ لیسن پلان',
    planFallback: 'لیسن پلان',
    fromLibrary: 'لائبریری سے',
    takePhoto: 'تصویر لیں',
    chooseFile: 'فائل چنیں',
    notAPlan: 'یہ لیسن پلان نہیں',
    steps: { grade: 'جماعت', subject: 'مضمون', chapter: 'باب', lesson: 'سبق' },
    grade: (n: number | string) => `جماعت ${n}`,
    used: 'استعمال شدہ',
    notWritten: 'ابھی لکھا نہیں گیا',
    preparing: 'تیار ہو رہا ہے',
    failed: 'نہیں بن سکا',
    nothingHere: 'ابھی کچھ نہیں',
    notLoaded: 'لوڈ نہیں ہو سکا',
    retry: 'دوبارہ کوشش کریں',
    loading: 'لوڈ ہو رہا ہے',
  },
};

/** Digital Coaching's words in both languages. */
export const COACHING = bilingual(COACHING_V2_COPY, COACHING_V2_COPY_UR);
export type CoachingCopy = Words<typeof COACHING_V2_COPY>;

/** Registered for the completeness checks and the review file (copyRegistry). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'Digital Coaching',
  module: COACHING as Bilingual<unknown>,
  // "DC observation" is ڈیجیٹل کوچنگ مشاہدہ (three words, the ontology's own name): it adds to a sentence of three.
  longOk: ['startObservation', 'summaryCount', 'noneYet', 'notFound', 'openLesson', 'openThat', 'photosHint', 'subReflection', 'voiceNote', 'fullReport', 'micBlockedHint', 'micBrowserBlocked', 'micStillBlockedWhatsApp', 'micStillBlocked',
    // bd-fgj73x.7: the operator asked for a short line that says why a recording under 15 minutes cannot be sent.
    'tooShort',
    // bd-aqotzx: the question, why it stopped, the 24-hour line and the two not-carried-forward notes are sentences on purpose.
    'classQuestion', 'classWhy', 'classDeadline', 'classNoAnswerNote', 'classRecordAgainNote',
    // bd-i0u6n2: why a video cannot go in the recording slot, and what to send instead.
    'notVideo',
    // bd-rt8wky/bd-hsgah5: the photo count is five words in Urdu («10 میں سے 4 تصاویر»).
    'photoCount',
    // bd-z3cadk: the bot's repeat-recording message, word for word.
    'duplicateRecordingLead', 'duplicateRecordingNext',
    // bd-c5reix: the same repeat line, said before she sends it.
    'duplicateBeforeLead'],
};
