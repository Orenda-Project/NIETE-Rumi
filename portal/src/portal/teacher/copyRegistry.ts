import type { Bilingual } from './i18n';
import { COPY_ENTRY as FRAME_ENTRY } from './copy';

/**
 * bd-fmf24g.13 — every teacher v2 copy module that is bilingual, with the screen it serves and the keys that
 * are rightly the same in both languages. copyRegistry.test.ts holds each one to: no empty or still-English
 * Urdu, every Urdu value a label. The same list writes the Urdu review file (urdu-review.export.test.ts).
 *
 * A FEATURE REGISTERS ITSELF — nothing shared to edit: its `teacher/<folder>/copy.ts` exports
 *
 *   export const COPY_ENTRY: CopyEntry = { screen: 'Lesson Plans', module: LESSONS, same: [...] };
 *
 * and it is found here at build time (import.meta.glob), as routes are (teacher/routes.tsx).
 */
export type CopyEntry = {
  screen: string;
  module: Bilingual<unknown>;
  /** Paths rightly the same in both languages (a brand, "—", a separator-only function). */
  same?: readonly string[];
  /** Paths allowed past the 4-word label rule (words that mirror another surface word for word). */
  longOk?: readonly string[];
};

const found = import.meta.glob<{ COPY_ENTRY?: CopyEntry; COPY_ENTRIES?: readonly CopyEntry[] }>('./*/copy.ts', { eager: true });

/** A folder registers one module (COPY_ENTRY) or several (COPY_ENTRIES). */
export const COPY_MODULES: readonly CopyEntry[] = [
  FRAME_ENTRY,
  ...Object.keys(found).sort().flatMap((k) => [found[k].COPY_ENTRY, ...(found[k].COPY_ENTRIES ?? [])])
    .filter((e): e is CopyEntry => !!e),
];
