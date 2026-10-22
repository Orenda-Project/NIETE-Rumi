/**
 * Every word of Share, Send to teacher, the "Send a lesson plan" builder and the sign-in banner, EN + UR
 * (DESIGN v2 §1 Share/Send/Builder/Kicker rows, §7 Send/builder states).
 *
 * NIETE is flat en/ur (language-protocol): the chrome follows the user's `preferred_language` (GET /fln/me `ui_lang`);
 * a plan's title keeps its own language. Urdu chrome: the separator is «—», never «·»; Urdu digits ۰–۹ (`num`).
 * A `{n}`-style slot is filled by the component (`Fill`), which draws the value inside <bdi>, so no string here holds
 * a number. Gender-neutral throughout. Components never hold a literal or an `ur ? … : …`: they ask `shareStrings(lang)`.
 */
export type ShareLang = 'en' | 'ur';
export type ShareSubject = 'rh-en' | 'rh-ur' | 'num';
export type HasChip = 'screener' | 'sounds' | 'narration' | 'additional';

const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** A number in the chrome's digits: Urdu ۰–۹ in Urdu chrome, as-is in English. */
export function num(n: number | string, lang: ShareLang): string {
  const s = String(n);
  return lang === 'ur' ? s.replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]) : s;
}

export interface ShareStrings {
  /** Separator between the parts of one chrome line. */
  sep: string;
  subject: Record<ShareSubject, string>;
  /** "Level {n}" — `{n}` filled with the chrome's digits. */
  level: string;
  /** Kicker part "Lesson {pos}/{count}" / «سبق {pos} (کل {count})». */
  lesson: string;
  minutes: string;
  sounds: string;
  /** The singular of `sounds` (n = 1): never "1 sounds". */
  soundOne: string;
  chip: { narration: string; textbook: string; additional: string; screener: string; guide: string; answerKey: string };

  // Share bar + share sheet
  share: string;
  shareTitle: string;
  sendOnWhatsapp: string;
  copyLink: string;
  linkCopied: string;
  copyFailed: string;
  theLink: string;
  close: string;

  // Send to teacher
  sendToTeacher: string;
  chooseTeachers: string;
  searchTeachers: string;
  selected: string;
  maxTeachers: string;
  send: string;
  sending: string;
  sent: string;
  sentOne: string;
  sentPartial: string;
  sentPartialOne: string;
  sendFailed: string;
  rateLimited: string;
  noTeachers: string;
  noTeacherMatch: string;
  sendUnavailable: string;
  sendNeedsSignIn: string;
  shareLink: string;
  loadingTeachers: string;
  teachersFailed: string;

  // Builder
  builderTitle: string;
  builderIntro: string;
  back: string;
  grade: string;
  subjectLabel: string;
  searchLessons: string;
  filters: Record<HasChip, string>;
  filtersLabel: string;
  pickGrade: string;
  pickSubject: string;
  screenerFirst: string;
  noMatch: string;
  clearFilters: string;
  loading: string;
  unavailable: string;
  tryAgain: string;
  notAvailableTitle: string;
  notAvailableBody: string;
  /** A leader (coach, principal…) whose sending is not switched on yet: not "this page is for leaders". */
  notSwitchedOnBody: string;
  goHome: string;
  whatsapp: string;
  /** bd-4joiqz — a builder row's link to the plan's own page, to read it before sending. */
  view: string;

  // Entry points
  cardTitle: string;
  cardBody: string;

  // Sign-in banner (both languages are always shown, so the banner reads both catalogues)
  signInToOpen: string;
}

const EN: ShareStrings = {
  sep: ' · ',
  subject: { 'rh-en': 'Reading Hour · English', 'rh-ur': 'Reading Hour · Urdu', num: 'Numeracy' },
  level: 'Level {n}',
  lesson: 'Lesson {pos}/{count}',
  minutes: '{n} min',
  sounds: '{n} sounds',
  soundOne: '{n} sound',
  chip: {
    narration: 'Story audio',
    textbook: 'Needs the textbook',
    additional: 'Additional practice',
    screener: 'Screener',
    guide: 'Guide',
    answerKey: 'Answer key audio · teacher only',
  },

  share: 'Share',
  shareTitle: 'Share this lesson plan',
  sendOnWhatsapp: 'Send on WhatsApp',
  copyLink: 'Copy link',
  linkCopied: 'Link copied ✓',
  copyFailed: "Couldn't copy. Press and hold the link to copy it.",
  theLink: 'Link',
  close: 'Close',

  sendToTeacher: 'Send to teacher',
  chooseTeachers: 'Choose teachers',
  searchTeachers: 'Search teachers',
  selected: '{n} selected',
  maxTeachers: 'Up to {n} teachers at a time',
  send: 'Send',
  sending: 'Sending…',
  sent: 'Sent ✓ · {n} teachers',
  sentOne: 'Sent ✓ · {n} teacher',
  sentPartial: "Couldn't send to {n} teachers. Try again",
  sentPartialOne: "Couldn't send to {n} teacher. Try again",
  sendFailed: "Couldn't send. Try again",
  rateLimited: 'You can send to {n} teachers an hour. Try again later.',
  noTeachers: 'No teachers are assigned to you yet',
  noTeacherMatch: 'No teacher matches that name',
  sendUnavailable: "Sending isn't available yet. Use Share link.",
  sendNeedsSignIn: 'To send to teachers, sign in to the app with your phone number. You can still use Share link.',
  shareLink: 'Share link',
  loadingTeachers: 'Loading your teachers…',
  teachersFailed: "Couldn't load your teachers. Try again",

  builderTitle: 'Send a lesson plan',
  builderIntro: 'Reading Hour & Numeracy',
  back: 'Back',
  grade: 'Grade',
  subjectLabel: 'Subject',
  searchLessons: 'Search lessons',
  filters: { screener: 'Screener', sounds: 'Has sounds', narration: 'Story audio', additional: 'Additional practice' },
  filtersLabel: 'Filters',
  pickGrade: 'Choose a grade',
  pickSubject: 'Choose a subject',
  screenerFirst: 'Start with the screener',
  noMatch: 'No lessons match. Clear the filters.',
  clearFilters: 'Clear the filters',
  loading: 'Loading…',
  unavailable: "Reading Hour plans aren't available right now",
  tryAgain: 'Try again',
  notAvailableTitle: "Sending lesson plans isn't available",
  notAvailableBody: 'This page is for coaches, principals and other school leaders.',
  notSwitchedOnBody: "Sending isn't switched on for your account yet.",
  goHome: 'Go home',
  whatsapp: 'WhatsApp',
  view: 'View',

  cardTitle: 'Send a lesson plan',
  cardBody: 'Reading Hour & Numeracy · send a plan to your teachers',

  signInToOpen: 'Sign in to open',
};

const UR: ShareStrings = {
  sep: ' — ',
  subject: { 'rh-en': 'ریڈنگ آور — انگریزی', 'rh-ur': 'ریڈنگ آور — اردو', num: 'بنیادی حساب' },
  level: 'سطح {n}',
  lesson: 'سبق {pos} (کل {count})',
  minutes: '{n} منٹ',
  sounds: '{n} آوازیں',
  soundOne: '{n} آواز',
  chip: {
    narration: 'کہانی کی آواز',
    textbook: 'درسی کتاب درکار',
    additional: 'اضافی مشق',
    screener: 'اسکرینر',
    guide: 'رہنمائی',
    answerKey: 'جوابی کلید کی آواز — صرف استاد کے لیے',
  },

  share: 'شیئر کریں',
  shareTitle: 'یہ سبق کا منصوبہ شیئر کریں',
  sendOnWhatsapp: 'واٹس ایپ پر بھیجیں',
  copyLink: 'لنک کاپی کریں',
  linkCopied: 'لنک کاپی ہو گیا ✓',
  copyFailed: 'لنک کاپی نہیں ہو سکا۔ لنک کو دبا کر رکھیں اور کاپی کریں۔',
  theLink: 'لنک',
  close: 'بند کریں',

  sendToTeacher: 'استاد کو بھیجیں',
  chooseTeachers: 'اساتذہ منتخب کریں',
  searchTeachers: 'استاد کا نام تلاش کریں',
  selected: '{n} منتخب',
  maxTeachers: 'ایک وقت میں زیادہ سے زیادہ {n} اساتذہ',
  send: 'بھیجیں',
  sending: 'بھیجا جا رہا ہے…',
  sent: 'بھیج دیا گیا ✓ — {n} اساتذہ',
  sentOne: 'بھیج دیا گیا ✓ — {n} استاد',
  sentPartial: '{n} اساتذہ کو نہیں بھیجا جا سکا۔ دوبارہ کوشش کریں',
  sentPartialOne: '{n} استاد کو نہیں بھیجا جا سکا۔ دوبارہ کوشش کریں',
  sendFailed: 'نہیں بھیجا جا سکا۔ دوبارہ کوشش کریں',
  rateLimited: 'ایک گھنٹے میں {n} اساتذہ کو بھیجا جا سکتا ہے۔ کچھ دیر بعد دوبارہ کوشش کریں۔',
  noTeachers: 'ابھی آپ کے ساتھ کوئی استاد منسلک نہیں',
  noTeacherMatch: 'اس نام کا کوئی استاد نہیں ملا',
  sendUnavailable: 'ابھی یہاں سے بھیجنا ممکن نہیں۔ لنک شیئر کریں۔',
  sendNeedsSignIn: 'اساتذہ کو بھیجنے کے لیے اپنے فون نمبر سے ایپ میں سائن اِن کریں۔ لنک شیئر کرنا اب بھی ممکن ہے۔',
  shareLink: 'لنک شیئر کریں',
  loadingTeachers: 'آپ کے اساتذہ لوڈ ہو رہے ہیں…',
  teachersFailed: 'اساتذہ کی فہرست نہیں کھلی۔ دوبارہ کوشش کریں',

  builderTitle: 'سبق کا منصوبہ بھیجیں',
  builderIntro: 'ریڈنگ آور اور بنیادی حساب',
  back: 'واپس',
  grade: 'جماعت',
  subjectLabel: 'مضمون',
  searchLessons: 'سبق تلاش کریں',
  filters: { screener: 'اسکرینر', sounds: 'آوازوں والے', narration: 'کہانی کی آواز', additional: 'اضافی مشق' },
  filtersLabel: 'فلٹر',
  pickGrade: 'جماعت منتخب کریں',
  pickSubject: 'مضمون منتخب کریں',
  screenerFirst: 'اسکرینر سے شروع کریں',
  noMatch: 'کوئی سبق نہیں ملا — فلٹر ہٹا دیں',
  clearFilters: 'فلٹر ہٹا دیں',
  loading: 'لوڈ ہو رہا ہے…',
  unavailable: 'ریڈنگ آور کے اسباق ابھی دستیاب نہیں — دوبارہ کوشش کریں',
  tryAgain: 'دوبارہ کوشش کریں',
  notAvailableTitle: 'سبق کے منصوبے بھیجنا دستیاب نہیں',
  notAvailableBody: 'یہ صفحہ کوچ، پرنسپل اور اسکول کے دوسرے رہنماؤں کے لیے ہے۔',
  notSwitchedOnBody: 'آپ کے اکاؤنٹ کے لیے بھیجنا ابھی شروع نہیں ہوا۔',
  goHome: 'ہوم پر جائیں',
  whatsapp: 'واٹس ایپ',
  view: 'دیکھیں',

  cardTitle: 'سبق کا منصوبہ بھیجیں',
  cardBody: 'ریڈنگ آور اور بنیادی حساب — اپنے اساتذہ کو سبق بھیجیں',

  signInToOpen: 'کھولنے کے لیے سائن اِن کریں',
};

const CATALOGUE: Record<ShareLang, ShareStrings> = { en: EN, ur: UR };

export function shareStrings(lang: ShareLang): ShareStrings {
  return CATALOGUE[lang] ?? EN;
}

export const SHARE_DIR: Record<ShareLang, 'ltr' | 'rtl'> = { en: 'ltr', ur: 'rtl' };

/** Fill `{key}` slots with plain values (the message text, which is not HTML). Digits follow `lang`. */
export function fillText(template: string, values: Record<string, number | string>, lang: ShareLang): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? num(values[k], lang) : `{${k}}`));
}

/** Most recipients per send, and per leader per hour (contracts/api.md v2). */
export const MAX_RECIPIENTS = 30;
