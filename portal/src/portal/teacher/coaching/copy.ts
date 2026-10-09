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

export const COACHING_V2_COPY = {
  title: 'Digital Coaching',
  home: 'Home',
  /* the hub */
  yourClass: 'Your class',
  selectClass: 'Select your class',
  lessonPlan: 'Lesson plan',
  optional: 'Optional',
  selectPlan: 'Select lesson plan',
  planPhoto: 'Plan photo',
  planFallback: 'Lesson plan',
  change: 'Change',
  photos: 'Photos',
  photosHint: 'Board work, charts or your classroom',
  noFaces: 'No faces',
  addPhoto: 'Add photo',
  removePhoto: (n: number) => `Remove photo ${n}`,
  upToThree: 'Up to 3 photos',
  notAPhoto: 'Not a photo',
  startRecording: 'Start recording',
  uploadRecording: 'Upload recording',
  recent: 'Recent DC Observations',
  noneYet: 'No DC observations yet',
  analysing: 'Analysing',
  /* record */
  recordTitle: 'Record lesson',
  starting: 'Starting',
  recording: 'Recording',
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
  tryAgain: 'Try again',
  /* check and send */
  checkTitle: 'Check and send',
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
  stepReport: 'Report ready',
  subReflection: 'Answer by text',
  subReport: 'Report and voice note',
  yourTurn: 'Your turn',
  now: 'Now',
  voiceNote: 'Voice note',
  yourRecording: 'Your recording',
  yourAnswer: 'Your answer',
  answerSent: 'Answer sent',
  couldNotSend: 'Could not send',
  download: 'Download',
  stopped: 'Could not analyse',
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
  home: 'ہوم',
  yourClass: 'آپ کی کلاس',
  selectClass: 'اپنی کلاس چنیں',
  lessonPlan: 'لیسن پلان',
  optional: 'اختیاری',
  selectPlan: 'لیسن پلان چنیں',
  planPhoto: 'پلان کی تصویر',
  planFallback: 'لیسن پلان',
  change: 'تبدیل کریں',
  photos: 'تصاویر',
  photosHint: 'بورڈ، چارٹ، کلاس روم',
  noFaces: 'چہرے نہ دکھائیں',
  addPhoto: 'تصویر شامل کریں',
  removePhoto: (n: number) => `تصویر ${n} ہٹائیں`,
  upToThree: '3 تک تصاویر',
  notAPhoto: 'یہ تصویر نہیں',
  startRecording: 'ریکارڈنگ شروع کریں',
  uploadRecording: 'ریکارڈنگ اپ لوڈ کریں',
  recent: 'حالیہ ڈیجیٹل کوچنگ مشاہدات',
  noneYet: 'ابھی کوئی ڈیجیٹل کوچنگ مشاہدہ نہیں',
  analysing: 'تجزیہ جاری',
  recordTitle: 'سبق ریکارڈ کریں',
  starting: 'شروع ہو رہا ہے',
  recording: 'ریکارڈنگ جاری',
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
  tryAgain: 'دوبارہ کوشش کریں',
  checkTitle: 'دیکھیں اور بھیجیں',
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
  sending: 'بھیجا جا رہا ہے',
  sent: 'بھیجا گیا',
  openLesson: 'ڈیجیٹل کوچنگ مشاہدہ کھولیں',
  noInternet: 'انٹرنیٹ نہیں',
  savedOnPhone: 'فون میں محفوظ',
  planNotUsed: 'پلان استعمال نہیں ہوا',
  changePlan: 'لیسن پلان تبدیل کریں',
  notAccepted: 'قبول نہیں ہوا',
  busy: 'دوسرا سبق زیرِ تجزیہ',
  openThat: 'ڈیجیٹل کوچنگ مشاہدہ کھولیں',
  grade: (g: number) => `جماعت ${g}`,
  progress: 'پیش رفت',
  done: 'مکمل',
  reportReady: 'رپورٹ تیار',
  stepReflection: 'غور کا سوال',
  stepReport: 'رپورٹ تیار',
  subReflection: 'لکھ کر جواب دیں',
  subReport: 'رپورٹ اور وائس نوٹ',
  yourTurn: 'آپ کی باری',
  now: 'ابھی',
  voiceNote: 'وائس نوٹ',
  yourRecording: 'آپ کی ریکارڈنگ',
  yourAnswer: 'آپ کا جواب',
  answerSent: 'جواب بھیجا گیا',
  couldNotSend: 'بھیجا نہیں جا سکا',
  download: 'ڈاؤن لوڈ',
  stopped: 'تجزیہ نہیں ہو سکا',
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
    failed: 'تیار نہیں ہو سکا',
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
  longOk: ['noneYet', 'notFound', 'openLesson', 'openThat'],
};
