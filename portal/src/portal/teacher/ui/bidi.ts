import { useMemo } from 'react';
import { useLang } from '../i18n';
import { latinAttrs, latinDir, type LatinAttrs } from '@/lib/textDir';

/**
 * bd-fmf24g.13 — mixed script on an Urdu page (language-protocol §8 rule 1). Inside RTL text a numeric range or
 * a Latin atom is reordered by what sits beside it: "1 – 8" shows as "8 – 1", "4-A" as "A-4". Each such run is
 * wrapped in LRI (U+2066) … PDI (U+2069) — an isolate, so it keeps its own order and cannot leak its direction
 * into the sentence. The bot's Urdu catalog does the same (⁦{n}⁩).
 *
 * It runs in the kit's ONE text egress (its text slots: ListRow, HistoryRow, StatusChip, GradeSubjectButton),
 * never at a call site, and only on an Urdu page — an English page's text is left exactly as it was.
 */

export const LRI = '⁦';
export const PDI = '⁩';

/**
 * A Latin/digit token: "p.1", "4", "~2", "1/2", "Science", and a number's own signs: "+3" (a plus before a digit),
 * "75%", "90%+". Without them the sign is left outside the isolate and lands on the wrong side ("%89–75").
 */
const TOKEN = '(?:\\+(?=[0-9]))?[A-Za-z0-9~][A-Za-z0-9.~/]*(?:%\\+?)?';
/** Tokens joined by a space or a dash/colon (with or without spaces): "1 – 12", "4-A", "General Science". */
const RUN = new RegExp(`${TOKEN}(?:(?:\\s*[–\\-:]\\s*|\\s+)${TOKEN})*`, 'g');
/** A run that is already isolated is left alone. */
const ISOLATED = /(⁦[^⁩]*⁩)/;

/** Isolate controls, ignored when asking what a string is. */
const CONTROLS = /[⁦⁩]/g;

export function isolateRuns(text: string): string {
  const s = String(text);
  // bd-fmf24g.62 / bd-fmf24g.48 — a string with no Urdu in it (an English lesson title, a subject, a name, a number) is
  // ONE run: isolated token by token, "Comparing & ordering numbers" left its "&" outside, between two LTR islands, and
  // the RTL row swapped them ("ordering numbers … & Comparing").
  const bare = s.replace(CONTROLS, '');
  if (latinDir(bare) === 'ltr') return `${LRI}${bare}${PDI}`;
  return s
    .split(ISOLATED)
    .map((part) => (part.startsWith(LRI) ? part : part.replace(RUN, (run) => `${LRI}${run}${PDI}`)))
    .join('');
}

export interface Bidi {
  /** The slot's text: isolated on an Urdu page, untouched on an English one. */
  (text: string | null | undefined): string;
  /**
   * The slot element's attributes (bd-fmf24g.62): `dir="ltr"` + `data-latin` for a string with no Urdu in it on an Urdu
   * page. It is its own LTR paragraph, so its words, its ellipsis and its line ends stay in English order and a clamp
   * cuts its END (an inline isolate alone left the RTL line's ellipsis eating the first word of line 2); `data-latin`
   * keeps it on the row's side (index.css). Nothing otherwise: Urdu text inherits the page, an English page is untouched.
   */
  ltr(text: string | null | undefined): LatinAttrs;
}

/** The kit's text egress: isolate on an Urdu page, untouched on an English one; `.ltr` for the element that draws it. */
export function useBidi(): Bidi {
  const ur = useLang() === 'ur';
  return useMemo(() => Object.assign(
    (text: string | null | undefined) => {
      const s = text == null ? '' : String(text);
      return ur ? isolateRuns(s) : s;
    },
    { ltr: (text: string | null | undefined) => (ur ? latinAttrs(text) : {}) },
  ), [ur]);
}
