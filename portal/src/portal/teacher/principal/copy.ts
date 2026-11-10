/**
 * bd-33wxxi.4 — the principal app's own words (#55 P3, Observations A). Everything else on its screens is the teacher
 * app's and the coach app's own copy. Labels only.
 *
 *   ownLesson      "My own lesson" — the bot's /observe word for the same choice (observe-strings.js bind_row_self_dc,
 *                  bd-o8nt4), so WhatsApp and the app say one thing
 *   oneTeacher     the other choice; Urdu «کسی ٹیچر کا سبق» pairs with «میرا اپنا سبق» (4 words: the mockup's 5-word draft
 *                  broke the label rule; MACHINE-DRAFTED, review pending)
 *   lastObserved   "last observed Mon 5 Oct" under a teacher in Pick the teacher (the day is the screen's own words);
 *                  the Urdu isolates the day (FSI … PDI: its direction is the day's own)
 *   notObserved    the same line for a teacher she has not observed (MACHINE-DRAFTED)
 */
import { bilingual, type Bilingual, type Words } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

export const PRINCIPAL_COPY = {
  ownLesson: 'My own lesson',
  oneTeacher: 'One of my teachers',
  lastObserved: (day: string) => `last observed ${day}`,
  notObserved: 'not observed yet',
};

export const PRINCIPAL_COPY_UR: Words<typeof PRINCIPAL_COPY> = {
  ownLesson: 'میرا اپنا سبق',
  oneTeacher: 'کسی ٹیچر کا سبق',
  lastObserved: (day) => `آخری مشاہدہ ⁨${day}⁩`,
  notObserved: 'ابھی مشاہدہ نہیں ہوا',
};

export const PRINCIPAL: Bilingual<typeof PRINCIPAL_COPY> = bilingual(PRINCIPAL_COPY, PRINCIPAL_COPY_UR);

export const COPY_ENTRY: CopyEntry = { screen: 'Principal app', module: PRINCIPAL as Bilingual<unknown> };
