/**
 * The words of Home's "Last 30 days" block (portal_teacher_home_activity) and its My journey row
 * (portal_teacher_journey). Both languages; the Urdu is machine-drafted and needs a human read. Registered through
 * home/copy.ts (COPY_ENTRIES), since the registry finds only teacher/<feature>/copy.ts.
 *
 * DATA is not copy: the numbers, an indicator's name, the tip and the time come from GET /me/home. The time sits in a
 * left-to-right isolate inside the Urdu line (Western digits, the kit's AM/PM words). Band words are Coaching's
 * (coaching/copy.ts `bands`), never a second set.
 */
import { bilingual, type Bilingual } from '../../i18n';
import type { CopyEntry } from '../../copyRegistry';

const LRI = '⁦';
const PDI = '⁩';
const time = (t: string) => `${LRI}${t}${PDI}`;

export const ACTIVITY_COPY = {
  lastDays: 'Last 30 days',
  updatedNight: 'Updated last night',
  updatedToday: (t: string) => `Updated today, ${t}`,
  updatedYesterday: (t: string) => `Updated yesterday, ${t}`,
  opened: 'Plans opened',
  taught: 'Taught in class',
  toldUs: 'You told us',
  coached: 'DC observations',
  quizPapers: 'Quizzes · Papers',
  quizzes: 'Quizzes',
  papers: 'Papers',
  ratingOverTime: 'Rating over time',
  tryNext: 'Try next class',
  myJourney: 'My journey',
};

export const ACTIVITY_COPY_UR: typeof ACTIVITY_COPY = {
  lastDays: 'پچھلے 30 دن',
  updatedNight: 'اپ ڈیٹ: کل رات',
  updatedToday: (t: string) => `اپ ڈیٹ: آج، ${time(t)}`,
  updatedYesterday: (t: string) => `اپ ڈیٹ: کل، ${time(t)}`,
  opened: 'کھولے گئے لیسن پلان',
  taught: 'کلاس میں پڑھایا',
  toldUs: 'آپ نے بتایا',
  coached: 'ڈیجیٹل کوچنگ مشاہدات',
  quizPapers: 'کوئز · پرچے',
  quizzes: 'کوئز',
  papers: 'پرچے',
  ratingOverTime: 'وقت کے ساتھ کارکردگی',
  tryNext: 'اگلی کلاس میں آزمائیں',
  myJourney: 'میرا سفر',
};

export const ACTIVITY = bilingual(ACTIVITY_COPY, ACTIVITY_COPY_UR);
export type ActivityCopy = typeof ACTIVITY_COPY;

export const ACTIVITY_COPY_ENTRY: CopyEntry = {
  screen: 'Home activity',
  module: ACTIVITY as Bilingual<unknown>,
  same: [],
  // A time inside a label: the Urdu lines are 5–6 words.
  longOk: ['updatedNight', 'updatedToday', 'updatedYesterday'],
};
