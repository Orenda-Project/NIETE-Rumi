/**
 * The teacher Home's "Evening reminder" card (notices/RemindCard.tsx; switch portal_push_remind, OFF by default):
 * one web-push reminder at 6 pm with tomorrow's plan, on a plain browser only. Both languages from day one
 * (language-protocol: NIETE is flat en/ur), gender-neutral. The words are the design's own (notify-org SPEC §4);
 * the Urdu awaits the same human review as the rest.
 */
import { bilingual, type Bilingual } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

export const REMIND_COPY = {
  title: 'Evening reminder',
  body: 'Get one reminder at 6 pm with your plan for tomorrow. Works in Chrome on this phone.',
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  test: 'Send a test now',
} as const;

export const REMIND_COPY_UR = {
  title: 'شام کی یاد دہانی',
  body: 'کل کے منصوبے کی ایک یاد دہانی شام چھ بجے پائیں۔ اس فون پر کروم میں چلتی ہے۔',
  turnOn: 'آن کریں',
  turnOff: 'بند کریں',
  test: 'ابھی ایک ٹیسٹ بھیجیں',
};

export const REMIND = bilingual(REMIND_COPY, REMIND_COPY_UR);

/** Registered for the completeness checks and the review file (copyRegistry finds ./remind/copy.ts). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'Home (evening reminder)',
  module: REMIND as Bilingual<unknown>,
  // The card's one sentence, as the design words it.
  longOk: ['body'],
};
