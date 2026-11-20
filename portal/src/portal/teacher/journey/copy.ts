/**
 * My journey — the teacher's own steps, newest first (spec §4). Every word here; data (a plan's topic, a tip's text,
 * a subject's name) comes from the server as it is. The Urdu is MACHINE-DRAFTED and needs a human read before it goes
 * live. Western digits (the guard). New words, proposed in the PR: My journey, the step lines, Not ready yet, the
 * updated lines. Existing words reused: Nothing yet, Lesson Plans, Show more, Could not load (kit and lessons copy).
 */
import { bilingual, type Bilingual, type Words } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'] as const;

export const JOURNEY_COPY = {
  title: 'My journey',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  /** "3 – 9 Nov", or "27 Oct – 2 Nov" across a month. */
  weekRange: (d1: number, m1: number, d2: number, m2: number) => (m1 === m2
    ? `${d1} – ${d2} ${MONTHS[m2]}` : `${d1} ${MONTHS[m1]} – ${d2} ${MONTHS[m2]}`),
  steps: {
    plan_opened: 'Opened a lesson plan',
    taught: 'Taught in class',
    coached: 'DC observation',
    report: 'Report ready',
    tip: 'Try next class',
    quiz: 'Sent a quiz',
    exam: 'Made a paper',
  },
  opened: 'Opened',
  played: (n: number) => `${n} played`,
  notReady: 'Not ready yet',
  updatedLastNight: 'Updated last night',
  updatedToday: (time: string) => `Updated today, ${time}`,
  updatedYesterday: (time: string) => `Updated yesterday, ${time}`,
} as const;

export const JOURNEY_COPY_UR: Words<typeof JOURNEY_COPY> = {
  title: 'میرا سفر',
  thisWeek: 'اس ہفتے',
  lastWeek: 'پچھلا ہفتہ',
  weekRange: (d1: number, m1: number, d2: number, m2: number) => (m1 === m2
    ? `${d1} – ${d2} ${MONTHS_UR[m2]}` : `${d1} ${MONTHS_UR[m1]} – ${d2} ${MONTHS_UR[m2]}`),
  steps: {
    plan_opened: 'لیسن پلان کھولا',
    taught: 'کلاس میں پڑھایا',
    coached: 'ڈیجیٹل کوچنگ مشاہدہ',
    report: 'رپورٹ تیار',
    tip: 'اگلی کلاس میں آزمائیں',
    quiz: 'کوئز بھیجا گیا',
    exam: 'پرچہ بنایا',
  },
  opened: 'کھولا گیا',
  played: (n: number) => `${n} نے کھیلا`,
  notReady: 'ابھی تیار نہیں',
  updatedLastNight: 'اپ ڈیٹ: کل رات',
  updatedToday: (time: string) => `اپ ڈیٹ: آج، ${time}`,
  updatedYesterday: (time: string) => `اپ ڈیٹ: کل، ${time}`,
};

export const JOURNEY = bilingual(JOURNEY_COPY, JOURNEY_COPY_UR);

export const COPY_ENTRY: CopyEntry = {
  screen: 'My journey',
  module: JOURNEY as Bilingual<unknown>,
  // A time inside a label (spec §3): the Urdu updated lines run to 5–6 words.
  longOk: ['updatedToday', 'updatedYesterday', 'updatedLastNight'],
};
