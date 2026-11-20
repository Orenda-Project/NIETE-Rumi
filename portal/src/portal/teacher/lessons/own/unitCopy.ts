/**
 * bd-snkn32.59.1 (queue #165) — the words of "Make my own → A whole unit" (behind the list-only portal_lp_own_unit).
 * English and Urdu from the approved mockups (task page plan-a-unit). The Urdu is MACHINE-DRAFTED and needs a human
 * read before this is switched on for anyone beyond the pilot. Registered through lessons/copy.ts COPY_ENTRIES.
 */
import { bilingual, type Bilingual, type Words } from '../../i18n';
import type { CopyEntry } from '../../copyRegistry';

export const UNIT_COPY = {
  /* Make my own's first screen: the third card */
  wholeUnit: 'A whole unit',
  wholeUnitHint: 'Several days, planned together',
  myUnits: 'My units',
  unitDays: (n: number) => `${n} days`,
  /* chapters, period, pace */
  chapters: 'Chapters',
  chapterN: (n: number) => `Chap ${n}`,
  from: 'From',
  to: 'To',
  bookDays: (n: number) => `${n} days`,
  pickHint: 'Tap the first and last chapter. At most 3 chapters.',
  periodQ: 'How long is your period?',
  minutes: (n: number) => `${n} min`,
  periodSaved: 'Saved for this class. You can change it later.',
  pace: 'Pace',
  paces: { recommended: 'Recommended', slower: 'Slower', faster: 'Faster' },
  paceHints: {
    recommended: "Book's days, with its review and test days",
    slower: '+1 practice day after each topic',
    faster: 'Practice days joined to the day before. Review and test kept.',
  },
  paceDays: (pace: string, n: number) => `${pace} · ${n} days`,
  seeDays: 'See the days',
  couldNotMake: 'Could not make the unit. Try again.',
  /* the unit page */
  yourDays: 'Your days',
  summary: (days: number, min: number, pace: string) => `${days} days · ${min} min · ${pace}`,
  dayN: (n: number) => `Day ${n}`,
  part: (p: number) => (p === 1 ? '(1 of 2)' : '(2 of 2)'),
  kinds: { lesson: 'Lesson', practice: 'Practice', review: 'Review', test: 'Test' },
  progress: (made: number, total: number) => `${made} of ${total} days made`,
  next: 'Next',
  openPlan: 'Open plan',
  notMade: 'Not made',
  made: 'Made',
  saveUnit: 'Save unit',
  saved: 'Saved',
  undo: 'Undo',
  madeHint: "Each day's plan is made when you open it.",
  locked: 'A plan is made, so the days stay as they are.',
  couldNotSave: 'Could not save. Try again.',
  couldNotOpen: 'Could not open that day. Try again.',
  limit: 'You have made today’s plans. Try again tomorrow.',
  /* the ⋯ menu */
  more: 'Change this day',
  moveUp: 'Move up',
  moveDown: 'Move down',
  join: 'Join with next day',
  split: 'Split into 2 days',
  close: 'Close',
  /* your class, for the plans */
  yourClass: 'Your class',
};

export const UNIT_COPY_UR: Words<typeof UNIT_COPY> = {
  wholeUnit: 'پورا یونٹ',
  wholeUnitHint: 'کئی دن کے لیسن پلان، ایک ساتھ',
  myUnits: 'میرے یونٹ',
  unitDays: (n: number) => `${n} دن`,
  chapters: 'ابواب',
  chapterN: (n: number) => `باب ${n}`,
  from: 'سے',
  to: 'تک',
  bookDays: (n: number) => `${n} دن`,
  pickHint: 'پہلا اور آخری باب چنیں۔ زیادہ سے زیادہ 3 ابواب۔',
  periodQ: 'آپ کا پیریڈ کتنا لمبا ہے؟',
  minutes: (n: number) => `${n} منٹ`,
  periodSaved: 'اس کلاس کے لیے محفوظ۔ بعد میں تبدیل ہو سکتا ہے۔',
  pace: 'رفتار',
  paces: { recommended: 'تجویز کردہ', slower: 'آہستہ', faster: 'تیز' },
  paceHints: {
    recommended: 'کتاب کے دن، دہرائی اور ٹیسٹ کے ساتھ',
    slower: 'ہر موضوع کے بعد ایک مشق کا دن',
    faster: 'مشق کے دن پچھلے دن میں شامل۔ دہرائی اور ٹیسٹ باقی۔',
  },
  paceDays: (pace: string, n: number) => `${pace} · ${n} دن`,
  seeDays: 'دن دیکھیں',
  couldNotMake: 'یونٹ نہیں بن سکا۔ دوبارہ کوشش کریں۔',
  yourDays: 'آپ کے دن',
  summary: (days: number, min: number, pace: string) => `${days} دن · ${min} منٹ · ${pace}`,
  dayN: (n: number) => `دن ${n}`,
  part: (p: number) => (p === 1 ? '(2 میں سے 1)' : '(2 میں سے 2)'),
  kinds: { lesson: 'سبق', practice: 'مشق', review: 'دہرائی', test: 'ٹیسٹ' },
  progress: (made: number, total: number) => `${total} میں سے ${made} دن بنے`,
  next: 'اگلا',
  openPlan: 'لیسن پلان کھولیں',
  notMade: 'ابھی نہیں بنا',
  made: 'بن گیا',
  saveUnit: 'یونٹ محفوظ کریں',
  saved: 'محفوظ ہو گیا',
  undo: 'واپس',
  madeHint: 'ہر دن کا لیسن پلان اسے کھولنے پر بنتا ہے۔',
  locked: 'ایک لیسن پلان بن چکا ہے، اس لیے دن اب تبدیل نہیں ہوں گے۔',
  couldNotSave: 'محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔',
  couldNotOpen: 'یہ دن نہیں کھل سکا۔ دوبارہ کوشش کریں۔',
  limit: 'آج کے لیسن پلان بن چکے ہیں۔ کل دوبارہ کوشش کریں۔',
  more: 'یہ دن تبدیل کریں',
  moveUp: 'اوپر کریں',
  moveDown: 'نیچے کریں',
  join: 'اگلے دن سے ملائیں',
  split: 'دو دنوں میں بانٹیں',
  close: 'بند کریں',
  yourClass: 'آپ کی کلاس',
};

export const UNIT = bilingual(UNIT_COPY, UNIT_COPY_UR);
export type UnitCopy = Words<typeof UNIT_COPY>;

export const UNIT_COPY_ENTRY: CopyEntry = {
  screen: 'Lesson Plans · Make my own · a whole unit',
  module: UNIT as Bilingual<unknown>,
  same: [],
  longOk: ['wholeUnitHint', 'pickHint', 'periodQ', 'periodSaved', 'paceHints', 'couldNotMake', 'madeHint', 'locked', 'couldNotSave', 'couldNotOpen', 'limit', 'join', 'split', 'progress', 'summary', 'part', 'paceDays'],
};
