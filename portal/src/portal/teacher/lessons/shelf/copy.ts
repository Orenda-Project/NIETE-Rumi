/**
 * bd-snkn32.42 — every word of "Made by a teacher": the chapter page's shelf of approved teacher plans, and the staff
 * page that checks a plan before it is listed.
 *
 * NEW VOCABULARY, PENDING THE OPERATOR: "Made by a teacher" and the check page's words are not in the ontology yet.
 * The Urdu is MACHINE-DRAFTED from the ontology's existing words (لیسن پلان, سبق, دن, منظور) and awaits a human review.
 * Registered through lessons/copy.ts COPY_ENTRIES (the registry globs only teacher/<feature>/copy.ts).
 */

import { bilingual, type Bilingual, type Words } from '../../i18n';
import type { CopyEntry } from '../../copyRegistry';

export const SHELF_COPY = {
  /* the chapter page: plans other teachers made, approved by a person (never who made them) */
  shelfTitle: 'Made by a teacher',
  shelfHint: 'Plans other teachers made for these lessons, checked by our team.',
  lessonN: (n: number) => `Lesson ${n}`,
  dayN: (n: number) => `Day ${n}`,
  langs: { en: 'English', ur: 'Urdu' },
  bands: { k5: 'Grades 1–5', g612: 'Grades 6–12' },
  /* the staff check before a plan is listed */
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
  shelfTitle: 'ایک ٹیچر کا بنایا ہوا',
  shelfHint: 'دوسرے اساتذہ کے بنائے ہوئے لیسن پلان، جنہیں ہماری ٹیم نے جانچا ہے۔',
  lessonN: (n: number) => `سبق ${n}`,
  dayN: (n: number) => `دن ${n}`,
  langs: { en: 'انگریزی', ur: 'اردو' },
  bands: { k5: 'جماعت 1–5', g612: 'جماعت 6–12' },
  reviewTitle: 'جانچنے کے لیے اساتذہ کے لیسن پلان',
  reviewEmpty: 'ابھی جانچنے کے لیے کچھ نہیں۔',
  score: (n: number) => `اسکور ${n}`,
  below: 'معیار سے کم جانچیں',
  noneBelow: 'ہر جانچ معیار کے مطابق ہے',
  notAssessed: 'اس جماعت میں نہیں جانچا گیا',
  openPdf: 'پی ڈی ایف کھولیں',
  approve: 'منظور کریں',
  reject: 'مسترد کریں',
  reason: 'کیوں مسترد کیا؟',
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
