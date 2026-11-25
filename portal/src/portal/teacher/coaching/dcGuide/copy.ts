/**
 * bd-ra8xu.64.3 (queue #282) — the words of the teacher's indicator guide: the "?" on her own Digital Coach report and
 * the tray it opens. The card headings are the teacher guide draft's `ui_labels_proposed` (bd-ra8xu.64 work folder,
 * outputs/teacher-guide), written for a teacher reading the report on her own recording, not for the observer (whose
 * words stay in help/copy.ts). The tray's heading and the credit are new: Dr Rifat Yasmeen has not reviewed the teacher
 * version, so the credit says "Adapted from", not "Designed and reviewed by". MACHINE-DRAFTED Urdu: needs a human read.
 *
 * Registered through coaching/copy.ts's COPY_ENTRIES (the registry's glob finds teacher/<folder>/copy.ts only), so the
 * Urdu completeness, label and vocabulary guards walk it. DATA is not copy: the indicators' own words come from
 * fico_v6_dc.guide.json.
 */
import { bilingual, type Bilingual, type Words } from '../../i18n';
import type { CopyEntry } from '../../copyRegistry';

export const DC_GUIDE_COPY = {
  /** The tray's heading. */
  heading: 'Understand your report',
  /** The code chips' heading: a noun (niete-portal §3b.1), the observer guide's word. */
  indicators: 'Indicators',
  credit: "Adapted from Dr Rifat Yasmeen's guide",
  /** Who sets the level (every one of the 11): the observer's "Digital Coach suggests · you check", for her. */
  whoDc: 'Set by the Digital Coach from your recording',
  measures: 'What it means',
  howScored: 'What the Digital Coach listens for',
  levels: 'Levels',
  example: 'Example',
  why: 'Why this level',
  watchOut: 'Try next time',
  failed: 'Could not load',
};

export const DC_GUIDE_COPY_UR: Words<typeof DC_GUIDE_COPY> = {
  heading: 'اپنی رپورٹ سمجھیں',
  indicators: 'انڈیکیٹرز',
  credit: 'ڈاکٹر رفعت یاسمین کی گائیڈ سے ماخوذ',
  whoDc: 'یہ لیول ڈیجیٹل کوچ آپ کی ریکارڈنگ سے دیتا ہے',
  measures: 'اس کا مطلب',
  howScored: 'ڈیجیٹل کوچ کیا سنتا ہے',
  levels: 'لیول',
  example: 'مثال',
  why: 'یہ لیول کیوں',
  watchOut: 'اگلی بار آزمائیں',
  failed: 'لوڈ نہیں ہو سکا',
};

export const DC_GUIDE = bilingual(DC_GUIDE_COPY, DC_GUIDE_COPY_UR);

export const DC_GUIDE_ENTRY: CopyEntry = {
  screen: 'Digital Coaching · indicator guide',
  module: DC_GUIDE as Bilingual<unknown>,
  // The who-sets-it line, the "listens for" heading and the credit are the guide's own legend, said once (the draft's words).
  longOk: ['whoDc', 'howScored', 'credit'],
};
