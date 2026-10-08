import type { Bilingual } from './i18n';
import { TEACHER_UI } from './ui/copy';
import { TEACHER_FRAME } from './copy';
import { LESSONS } from './lessons/copy';

/**
 * bd-fmf24g.13 — every teacher v2 copy module that is bilingual, with the screen it serves and the keys that
 * are rightly the same in both languages. copyRegistry.test.ts holds each one to: no empty or still-English
 * Urdu, every Urdu value a label. The same list writes the Urdu review file (urdu-review.export.test.ts).
 * A feature's Urdu PR adds its module here.
 */
export type CopyEntry = {
  screen: string;
  module: Bilingual<unknown>;
  /** Paths rightly the same in both languages (a brand, "—"). */
  same?: readonly string[];
  /** Paths allowed past the 4-word label rule (words that mirror another surface word for word). */
  longOk?: readonly string[];
};

export const COPY_MODULES: readonly CopyEntry[] = [
  {
    screen: 'kit (shared components)',
    module: TEACHER_UI as Bilingual<unknown>,
    same: ['noValue', 'report.brand', 'report.brandMark'],
    longOk: ['report.madeFor', 'report.eyebrow', 'report.lastAsked'],
  },
  {
    screen: 'frame (menu, Home, More, My profile)',
    module: TEACHER_FRAME as Bilingual<unknown>,
    // The brand, and the Language row's names, each written in its own script in both languages.
    same: ['brand', 'more.switchTo.ur', 'more.switchTo.en'],
    // "Salaam, Ayesha!" — a greeting, with its "!" as in English.
    longOk: ['home.greeting'],
  },
  {
    screen: 'Lesson Plans',
    module: LESSONS as Bilingual<unknown>,
    // crumb only joins its parts ("Math · Chap 1"): the same in both languages.
    same: ['crumb'],
  },
];
