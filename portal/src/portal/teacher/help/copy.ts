/**
 * bd-ik5e8j.4 (queue #85) — every word of the help entry: the "?" on a feature's page, its tray, and More → How to use.
 * Both languages from day one (language-protocol: NIETE is flat en/ur). The operator, 11 Nov: never "app" (NIETE is
 * used through WhatsApp and the screen that opens inside it). MACHINE-DRAFTED Urdu, review pending like the rest.
 * DATA is not copy: a video's length and size come from the manifest as they are.
 */
import { bilingual, type Bilingual } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
const megabytes = (b: number) => `${Math.max(1, Math.round(b / 1_000_000))} MB`;

export const HELP_COPY = {
  /** The "?"'s name for a screen reader. */
  help: 'Help',
  /** The operator, 12 Nov 2026 (bd-ik5e8j.6): "How to Use might be a better name". */
  howTo: 'How to Use',
  watch: 'Watch video',
  smaller: 'Play a smaller copy',
  comingSoon: 'Video coming soon',
  allComingSoon: 'Videos coming soon',
  allVideos: 'All videos',
  /** Film 1's name in the list: how to use NIETE itself. */
  start: 'How to Use NIETE',
  /** bd-3xf7vb.1 (queue #217) — the "?" on the coach and principal Observe pages: its tray and the indicator guide. */
  observeHowTo: 'How to observe',
  guide: 'Indicator guide',
  grades15: 'Grades 1–5',
  grades612: 'Grades 6–12',
  indicators: (n: number) => `${n} indicators`,
  thisVisit: 'This visit',
  /** The chips' heading: a noun (niete-portal §3b.1). */
  pickIndicator: 'Indicators',
  searchGuide: 'Search: C2, question, group…',
  noIndicator: 'No indicator matches',
  /** #217, the operator 23 Nov: the guide is Dr Rifat Yasmeen's FICO Observer Manual; its headings are her words. */
  measures: 'What it measures',
  lookFor: 'What to look for',
  howScored: 'How it is scored',
  levels: 'Levels',
  example: 'Example',
  why: 'Why this level',
  watchOut: 'Watch out',
  whoDc: 'Digital Coach suggests · you check',
  whoRoom: 'Set from the room',
  /** Queue #259: Rifat's FICO M/H "who sets it" (her 24 Nov edit), her words: 21 indicators, then E2 and E3. */
  whoPre: 'Pre-filled in the app · you review',
  whoSelf: 'You fill this yourself',
  noNa: 'No N/A here: level 1 covers it',
  whereToLook: 'Where to look',
  fullManual: 'Open the full manual',
  inManual: 'This indicator in the manual',
  guideFailed: 'Could not load',
  length: (s: number) => clock(s),
  size: (b: number) => megabytes(b),
};

export const HELP_COPY_UR: typeof HELP_COPY = {
  help: 'مدد',
  howTo: 'استعمال کا طریقہ',
  watch: 'ویڈیو دیکھیں',
  smaller: 'ہلکی ویڈیو چلائیں',
  comingSoon: 'ویڈیو جلد آئے گی',
  allComingSoon: 'ویڈیوز جلد آئیں گی',
  allVideos: 'تمام ویڈیوز',
  start: '‏NIETE استعمال کرنے کا طریقہ',
  // #217: digits stay Western 0-9 in teacher-facing Urdu, as the bot (vocabulary.guard.test.ts).
  observeHowTo: 'مشاہدہ کیسے کریں',
  guide: 'انڈیکیٹر گائیڈ',
  grades15: 'جماعت 1 تا 5',
  grades612: 'جماعت 6 تا 12',
  indicators: (n: number) => `${n} انڈیکیٹر`,
  thisVisit: 'یہ وزٹ',
  pickIndicator: 'انڈیکیٹرز',
  searchGuide: 'تلاش: ⁦C2⁩، سوال، گروپ…',
  noIndicator: 'کوئی انڈیکیٹر نہیں ملا',
  measures: 'یہ کیا دیکھتا ہے',
  lookFor: 'کیا دیکھنا ہے',
  howScored: 'لیول کیسے لگتا ہے',
  levels: 'لیول',
  example: 'مثال',
  why: 'یہ لیول کیوں',
  watchOut: 'دھیان رہے',
  whoDc: 'ڈیجیٹل کوچ تجویز کرتا ہے · آپ جانچتے ہیں',
  whoRoom: 'کلاس میں دیکھ کر',
  whoPre: 'ایپ میں پہلے سے بھرا · آپ جانچتے ہیں',
  whoSelf: 'یہ آپ خود بھرتے ہیں',
  noNa: 'یہاں «لاگو نہیں» نہیں: لیول 1 میں شامل',
  whereToLook: 'کہاں دیکھیں',
  fullManual: 'پوری گائیڈ کھولیں',
  inManual: 'گائیڈ میں یہ انڈیکیٹر',
  guideFailed: 'لوڈ نہیں ہو سکا',
  length: (s: number) => clock(s),
  size: (b: number) => megabytes(b),
};

export const HELP = bilingual(HELP_COPY, HELP_COPY_UR);

/** Registered for the completeness checks and the review file (copyRegistry, found by its glob). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'Help (the "?" and How to use)',
  module: HELP as Bilingual<unknown>,
  // A length and a size are numbers and a unit, the same in both languages.
  same: ['length', 'size'],
  // Film 1's title is its film's own name, five words in both languages.
  // #217: the N/A line and who sets a level are the guide's own legend, said once per card (Rifat's words).
  longOk: ['start', 'noNa', 'whoDc', 'whoPre', 'whoSelf'],
};
