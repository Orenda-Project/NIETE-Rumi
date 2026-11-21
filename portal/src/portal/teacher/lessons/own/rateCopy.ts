/**
 * bd-snkn32.11 (queue #134 C) — the words of the rating card on her own plan. Its own small catalogue (own/copy.ts is at
 * the 300-line limit), registered through lessons/copy.ts COPY_ENTRIES like OWN. The Urdu is MACHINE-DRAFTED from the
 * ontology's words (لیسن پلان, بھیجیں) and awaits the same human review as own/copy.ts.
 */
import { bilingual, type Bilingual, type Words } from '../../i18n';
import type { CopyEntry } from '../../copyRegistry';

export const RATE_COPY = {
  question: 'How good was this plan?',
  scaleName: 'Plan rating, 1 to 5',
  levels: { 1: 'Not useful', 2: 'Weak', 3: 'OK', 4: 'Good', 5: 'Very good' },
  confusing: 'What was confusing?',
  optional: 'optional',
  send: 'Send',
  thanks: 'Thank you. Your rating is saved.',
  failed: "Couldn't save it. Please try again.",
};

const RATE_COPY_UR: typeof RATE_COPY = {
  question: 'یہ لیسن پلان کیسا تھا؟',
  scaleName: 'لیسن پلان کی درجہ بندی، 1 سے 5',
  levels: { 1: 'مفید نہیں', 2: 'کمزور', 3: 'ٹھیک', 4: 'اچھا', 5: 'بہت اچھا' },
  confusing: 'کیا بات سمجھ نہیں آئی؟',
  optional: 'اختیاری',
  send: 'بھیجیں',
  thanks: 'شکریہ۔ آپ کی درجہ بندی محفوظ ہو گئی۔',
  failed: 'محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔',
};

export const RATE = bilingual(RATE_COPY, RATE_COPY_UR);
export type RateCopy = Words<typeof RATE_COPY>;

export const RATE_COPY_ENTRY: CopyEntry = {
  screen: 'Lesson Plans · Make my own · rating',
  module: RATE as Bilingual<unknown>,
  same: [],
  // The two questions, the scale's spoken name and the two replies are sentences.
  longOk: ['question', 'scaleName', 'confusing', 'thanks', 'failed'],
};
