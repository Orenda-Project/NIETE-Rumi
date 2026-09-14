/**
 * Text that might be Urdu, rendered per FIELD rather than per page.
 *
 * A coaching session is genuinely mixed, and measuring it settled the design:
 * across 300 recent completed sessions the transcript is Urdu on 97%, and the
 * prioritized action and reflective Q&A are Urdu — but the analysis narrative
 * (executive summary, strengths, recommendations) is written in ENGLISH.
 *
 * So a page-level `dir="rtl"` would be wrong, and so would leaving everything
 * LTR: her own words would render in a Latin face, left-aligned, with the
 * punctuation drifting to the wrong end of the line.
 *
 * Detection is by SCRIPT, not by a language column, because the columns
 * disagree with the content — `transcript_language` describes the audio, and
 * the analysis of an Urdu lesson is stored in English on the same row. Only
 * the characters know.
 */

import { createElement } from 'react';

/**
 * Arabic-script ranges, which is what Urdu uses:
 *   0600–06FF Arabic · 0750–077F Supplement · 08A0–08FF Extended-A
 *   FB50–FDFF Presentation Forms-A · FE70–FEFF Presentation Forms-B
 */
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;

/**
 * Is this text mostly Urdu?
 *
 * A ratio, not a boolean test for "contains", because coaching evidence quotes
 * are routinely code-switched — an English sentence citing a few Urdu words is
 * still an English sentence and must stay LTR. The threshold is measured
 * against the letters only, so digits, timestamps and punctuation (which the
 * evidence quotes are full of) do not drag the ratio either way.
 */
export function isUrdu(text: string | null | undefined): boolean {
  if (!text) return false;
  const letters = String(text).replace(/[^\p{L}]/gu, '');
  if (!letters.length) return false;
  const arabic = (letters.match(ARABIC_SCRIPT) || []).length;
  return arabic / letters.length > 0.4;
}

type Props = {
  text: string | null | undefined;
  /** Defaults to a <p>; pass 'span' or 'div' where the context needs it. */
  as?: 'p' | 'span' | 'div';
  className?: string;
};

/**
 * Renders `text`, switching direction, alignment and typeface only when the
 * content is actually Urdu.
 *
 * `font-urdu` and the leading bump are applied together on purpose: Nastaliq
 * has deep descenders and clips at normal line-height.
 */
export function UrduAware({ text, as = 'p', className = '' }: Props) {
  if (!text) return null;
  const urdu = isUrdu(text);

  return createElement(
    as,
    {
      dir: urdu ? 'rtl' : 'ltr',
      lang: urdu ? 'ur' : undefined,
      className: [className, urdu ? 'font-urdu text-right leading-loose' : ''].filter(Boolean).join(' '),
    },
    text,
  );
}

export default UrduAware;
