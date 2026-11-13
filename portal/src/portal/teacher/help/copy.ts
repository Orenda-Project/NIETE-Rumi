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
  longOk: ['start'],
};
