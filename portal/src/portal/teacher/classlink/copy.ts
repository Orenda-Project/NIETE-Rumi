/**
 * The teacher Home's class link card (notices/ClassLinkCard.tsx; switches web_quiz_class_link and, for tonight's line,
 * web_quiz_evening_round, both OFF by default). Both languages from day one (language-protocol: NIETE is flat en/ur),
 * gender-neutral. The class label is the class link's one form, "Class 3 A" / «کلاس 3 A», the section only when the
 * class has one. Teacher-facing Urdu keeps Western digits (vocabulary.guard.test.ts; only child-read text uses Urdu
 * digits), so this is formatted here, not taken from the child pages' label. A count is isolated (LRI … PDI) and a lesson
 * title, which is DATA, too (FSI … PDI), inside the Urdu sentence; never translated. The Urdu awaits human review.
 */
import { bilingual, type Bilingual } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

const LRI = String.fromCharCode(0x2066);
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
const section = (s?: string | null) => (s && String(s).trim() ? ` ${String(s).trim()}` : '');

export const CLASS_LINK_COPY = {
  title: 'Your class link',
  classLabel: (grade: string | number, sec?: string | null) => `Class ${grade}${section(sec)}`,
  body: 'One link for this term. Send it once to your class group.',
  theLink: 'The class link',
  send: 'Send to class group',
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Hold link to copy',
  sent: 'Class link sent',
  sendAgain: 'Send again',
  ready: (lesson: string) => `Tonight's class quiz is ready, from today's lesson: ${lesson}. It is on your class link: nothing to send.`,
  readyNoLesson: "Tonight's class quiz is ready, from today's lesson. It is on your class link: nothing to send.",
  played: (n: number) => `${n} ${n === 1 ? 'child' : 'children'} played tonight's quiz`,
  seeRounds: 'See evening rounds',
};

export const CLASS_LINK_COPY_UR = {
  title: 'آپ کا کلاس لنک',
  classLabel: (grade: string | number, sec?: string | null) => `کلاس ${grade}${section(sec)}`,
  body: 'اس ٹرم کے لیے ایک لنک۔ اسے ایک بار کلاس گروپ میں بھیجیں۔',
  theLink: 'کلاس کا لنک',
  send: 'کلاس گروپ میں بھیجیں',
  copy: 'کاپی کریں',
  copied: 'کاپی ہو گیا',
  copyFailed: 'دبا کر کاپی کریں',
  sent: 'کلاس لنک بھیجا گیا',
  sendAgain: 'دوبارہ بھیجیں',
  ready: (lesson: string) => `آج شام کا کلاس کوئز تیار ہے، آج کے سبق سے: ${FSI}${lesson}${PDI}۔ یہ آپ کے کلاس لنک پر ہے، کچھ بھیجنا نہیں۔`,
  readyNoLesson: 'آج شام کا کلاس کوئز آج کے سبق سے تیار ہے۔ یہ آپ کے کلاس لنک پر ہے، کچھ بھیجنا نہیں۔',
  played: (n: number) => `${LRI}${n}${PDI} ${n === 1 ? 'بچے' : 'بچوں'} نے آج شام کا کوئز کھیلا`,
  seeRounds: 'شام کے راؤنڈ دیکھیں',
};

export const CLASS_LINK = bilingual(CLASS_LINK_COPY, CLASS_LINK_COPY_UR);

/** Registered for the completeness checks and the review file (copyRegistry finds ./classlink/copy.ts). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'Home (class link)',
  module: CLASS_LINK as Bilingual<unknown>,
  // The card's sentences, as the brief words them (the body, and tonight's ready line with and without a lesson title).
  longOk: ['body', 'ready', 'readyNoLesson', 'played'],
};
