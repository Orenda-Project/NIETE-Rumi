/**
 * The words of the survey bar at the end of a lesson plan ("This plan": Useful / Not useful, then In class or What was
 * wrong). Its own small catalogue beside the viewer (like own/rateCopy.ts), registered through lessons/copy.ts
 * COPY_ENTRIES. In class uses the bot's own survey words, so one answer means one thing in the app and on WhatsApp.
 * The Urdu is MACHINE-DRAFTED and needs a human read before it goes live.
 */
import { bilingual, type Bilingual, type Words } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

export const FEEDBACK_COPY = {
  thisPlan: 'This plan',
  useful: 'Useful',
  notUseful: 'Not useful',
  inClass: 'In class',
  taught: 'Taught it today',
  planned: 'Planning to',
  notYet: 'Not yet',
  whatWrong: 'What was wrong',
  send: 'Send',
  thanks: 'Thanks',
  notSaved: 'Not saved',
  noInternet: 'No internet',
  tryAgain: 'Try again',
};

const FEEDBACK_COPY_UR: Words<typeof FEEDBACK_COPY> = {
  thisPlan: 'یہ لیسن پلان',
  useful: 'مفید',
  notUseful: 'مفید نہیں',
  inClass: 'کلاس میں',
  taught: 'آج پڑھا دیا',
  planned: 'ارادہ ہے',
  notYet: 'ابھی نہیں',
  whatWrong: 'کیا کمی تھی',
  send: 'بھیجیں',
  thanks: 'شکریہ',
  notSaved: 'محفوظ نہیں ہوا',
  noInternet: 'انٹرنیٹ نہیں',
  tryAgain: 'دوبارہ کوشش کریں',
};

export const FEEDBACK = bilingual(FEEDBACK_COPY, FEEDBACK_COPY_UR);
export type FeedbackCopy = Words<typeof FEEDBACK_COPY>;

export const FEEDBACK_COPY_ENTRY: CopyEntry = {
  screen: 'Lesson Plans · viewer · survey bar',
  module: FEEDBACK as Bilingual<unknown>,
  same: [],
};
