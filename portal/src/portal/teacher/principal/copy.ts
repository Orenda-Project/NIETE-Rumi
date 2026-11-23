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
 *   noSchoolTitle  bd-r2uzg1.21.4 — her account names no school (users.school_id empty): the title of the one notice
 *   noSchoolAsk    shown instead of zeros on My Patch, Teachers, Analytics, Observed lessons and the app's My school.
 *                  The way forward the product has today: a coach adds her number to her school (the coach's Add a
 *                  teacher, portal or WhatsApp /observe; it keeps her a principal). A sentence on purpose (longOk):
 *                  it is what to do. Urdu MACHINE-DRAFTED: NATIVE-CHECK
 */
import { bilingual, type Bilingual, type Words } from '../i18n';
import type { CopyEntry } from '../copyRegistry';
import { COPY_ENTRY as V6_ENTRY } from './copyV6';

export const PRINCIPAL_COPY = {
  ownLesson: 'My own lesson',
  oneTeacher: 'One of my teachers',
  lastObserved: (day: string) => `last observed ${day}`,
  notObserved: 'not observed yet',
  noSchoolTitle: 'No school linked yet',
  noSchoolAsk: 'Ask your coach to add you to your school.',
};

export const PRINCIPAL_COPY_UR: Words<typeof PRINCIPAL_COPY> = {
  ownLesson: 'میرا اپنا سبق',
  oneTeacher: 'کسی ٹیچر کا سبق',
  lastObserved: (day) => `آخری مشاہدہ ⁨${day}⁩`,
  notObserved: 'ابھی مشاہدہ نہیں ہوا',
  noSchoolTitle: 'اسکول ابھی منسلک نہیں',
  noSchoolAsk: 'اپنے کوچ سے کہیں کہ آپ کو آپ کے اسکول میں شامل کر دیں۔',
};

export const PRINCIPAL: Bilingual<typeof PRINCIPAL_COPY> = bilingual(PRINCIPAL_COPY, PRINCIPAL_COPY_UR);

export const COPY_ENTRY: CopyEntry = { screen: 'Principal app', module: PRINCIPAL as Bilingual<unknown>, longOk: ['noSchoolAsk'] };

// bd-o15qnr.28 — the v6/v7 Home, Observe and My observations words (copyV6.ts), under the same Urdu checks.
export const COPY_ENTRIES: readonly CopyEntry[] = [V6_ENTRY as CopyEntry];
