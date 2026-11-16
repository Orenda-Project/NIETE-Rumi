/**
 * bd-snkn32.42 — every word of "Made by a teacher": the chapter page's shelf of teacher plans that met the lesson-plan
 * standard, and the staff page where a person can still reject one.
 *
 * NEW VOCABULARY, PENDING THE OPERATOR: "Made by a teacher" and the check page's words are not in the ontology yet.
 * bd-snkn32.46 reviewed the Urdu with the language-protocol skill and the vocabulary guard: ٹیچر (never استاد/اساتذہ),
 * grade ranges «1 تا 5» (a hyphen range after an Urdu word paints reversed), gender-neutral imperatives, no literal
 * «جانچیں» as a plural noun. Since bd-snkn32.46 the AI reviewer's pass lists a plan (lp_own_library_rule = 'ai'), so the
 * hint no longer says "checked by our team".
 * Registered through lessons/copy.ts COPY_ENTRIES (the registry globs only teacher/<feature>/copy.ts).
 */

import { bilingual, type Bilingual, type Words } from '../../i18n';
import type { CopyEntry } from '../../copyRegistry';

export const SHELF_COPY = {
  /* the chapter page: plans other teachers made that met the standard (never who made them) */
  shelfTitle: 'Made by a teacher',
  shelfHint: 'Plans other teachers made for these lessons that meet our lesson-plan standard.',
  lessonN: (n: number) => `Lesson ${n}`,
  dayN: (n: number) => `Day ${n}`,
  langs: { en: 'English', ur: 'Urdu' },
  bands: { k5: 'Grades 1–5', g612: 'Grades 6–12' },
  /* the staff check: a person can still reject a listed plan */
  reviewTitle: 'Teacher plans to check',
  reviewEmpty: 'Nothing to check now.',
  score: (n: number) => `Score ${n}`,
  below: 'Checks below the standard',
  noneBelow: 'Every check met the standard',
  notAssessed: 'Not checked at this grade',
  openPdf: 'Open the PDF',
  approve: 'Approve',
  reject: 'Reject',
  reason: 'Why is it rejected?',
  sendReject: 'Reject this plan',
  approved: 'Approved',
  rejected: 'Rejected',
  failed: "Couldn't save that. Try again.",
};

const SHELF_COPY_UR: Words<typeof SHELF_COPY> = {
  shelfTitle: 'ٹیچر کا بنایا ہوا',
  shelfHint: 'دوسرے ٹیچرز کے بنائے ہوئے لیسن پلان، جو ہمارے لیسن پلان کے معیار پر پورے اترتے ہیں۔',
  lessonN: (n: number) => `سبق ${n}`,
  dayN: (n: number) => `دن ${n}`,
  langs: { en: 'انگریزی', ur: 'اردو' },
  bands: { k5: 'جماعت 1 تا 5', g612: 'جماعت 6 تا 12' },
  reviewTitle: 'ٹیچرز کے لیسن پلان جن کی جانچ باقی ہے',
  reviewEmpty: 'ابھی جانچ کے لیے کوئی لیسن پلان نہیں۔',
  score: (n: number) => `اسکور ${n}`,
  below: 'جو نکات معیار سے کم رہے',
  noneBelow: 'تمام نکات معیار کے مطابق ہیں',
  notAssessed: 'اس جماعت کے لیے نہیں جانچا جاتا',
  openPdf: 'پی ڈی ایف کھولیں',
  approve: 'منظور کریں',
  reject: 'مسترد کریں',
  reason: 'مسترد کرنے کی وجہ',
  sendReject: 'یہ لیسن پلان مسترد کریں',
  approved: 'منظور',
  rejected: 'مسترد',
  failed: 'محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔',
};

export const SHELF = bilingual(SHELF_COPY, SHELF_COPY_UR);
export type ShelfCopy = Words<typeof SHELF_COPY>;

export const SHELF_COPY_ENTRY: CopyEntry = {
  screen: 'Lesson Plans · Made by a teacher',
  module: SHELF as Bilingual<unknown>,
  // The hint, the page titles and the check page's lines are sentences, not labels. The shelf's name is the one the
  // brief gave ("Made by a teacher"); in Urdu it is five words.
  longOk: ['shelfTitle', 'shelfHint', 'reviewTitle', 'reviewEmpty', 'noneBelow', 'notAssessed', 'sendReject', 'failed', 'below', 'reason'],
};
