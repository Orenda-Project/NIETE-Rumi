import { useCallback } from 'react';
import { useLang } from '../i18n';

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

/** A Latin/digit token: "p.1", "4", "~2", "1/2", "Science". */
const TOKEN = '[A-Za-z0-9~][A-Za-z0-9.~/]*';
/** Tokens joined by a space or a dash/colon (with or without spaces): "1 – 12", "4-A", "General Science". */
const RUN = new RegExp(`${TOKEN}(?:(?:\\s*[–\\-:]\\s*|\\s+)${TOKEN})*`, 'g');
/** A run that is already isolated is left alone. */
const ISOLATED = /(⁦[^⁩]*⁩)/;

export function isolateRuns(text: string): string {
  return String(text)
    .split(ISOLATED)
    .map((part) => (part.startsWith(LRI) ? part : part.replace(RUN, (run) => `${LRI}${run}${PDI}`)))
    .join('');
}

/** The kit's text egress: isolate on an Urdu page, untouched on an English one. */
export function useBidi(): (text: string | null | undefined) => string {
  const ur = useLang() === 'ur';
  return useCallback((text) => {
    const s = text == null ? '' : String(text);
    return ur ? isolateRuns(s) : s;
  }, [ur]);
}
