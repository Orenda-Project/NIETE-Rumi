/**
 * bd-fmf24g.4 — every word the teacher v2 Observations screens show (the feature's own copy file).
 * Labels only: 1–3 words, 4 at most, no sentences.
 *
 * bd-fmf24g.13.2 — bilingual: OBSERVATIONS = { en, ur }, read with useCopy(OBSERVATIONS). The Urdu is
 * MACHINE-DRAFTED from the bot's existing Urdu (ux-strings.js: مشاہدہ, جاری, کلاس کے دورے; observe-strings.js:
 * تعمیری گفتگو for a debrief) and awaits a human review (workbench/teacher-v2-impl/urdu-review/). A report's band is Digital
 * Coaching's word (coaching/copy.ts `bands`), as the report page itself is.
 *
 * DATA is not copy: a coach's name, a school, a visit's slot, a lesson's topic come from the API as they are.
 */

import { bilingual, type Bilingual, type Words } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

export const OBSERVATIONS_COPY = {
  title: 'Observations',
  home: 'Home',
  nextVisit: 'Next visit',
  noVisit: 'No visit planned',
  inProgress: 'In progress',
  coachVisit: 'Coach visit',
  stages: {
    reviewing: 'Coach reviewing',
    debrief: 'Debrief with coach',
    report: 'Report coming',
  },
  reports: 'Reports',
  noReports: 'No reports yet',
};

/** bd-fmf24g.13.2 — Observations' words in Urdu (MACHINE-DRAFTED; review pending). */
export const OBSERVATIONS_COPY_UR: Words<typeof OBSERVATIONS_COPY> = {
  title: 'مشاہدات',
  home: 'ہوم',
  nextVisit: 'اگلا دورہ',
  noVisit: 'کوئی دورہ طے نہیں',
  inProgress: 'جاری',
  coachVisit: 'کوچ کا دورہ',
  stages: {
    reviewing: 'کوچ کا جائزہ جاری',
    // The bot names a debrief تعمیری گفتگو (ڈی بریف); "کوچ کے ساتھ ڈی بریف" is five words, over the label's 4.
    debrief: 'کوچ سے گفتگو',
    report: 'رپورٹ آ رہی ہے',
  },
  reports: 'رپورٹس',
  noReports: 'ابھی کوئی رپورٹ نہیں',
};

/** Observations' words in both languages. */
export const OBSERVATIONS = bilingual(OBSERVATIONS_COPY, OBSERVATIONS_COPY_UR);
export type ObservationsCopy = Words<typeof OBSERVATIONS_COPY>;

/** Registered for the completeness checks and the review file (copyRegistry). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'Observations',
  module: OBSERVATIONS as Bilingual<unknown>,
};
