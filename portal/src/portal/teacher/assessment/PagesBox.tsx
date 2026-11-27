import { useEffect, useState } from 'react';
import { readConfigShared } from '../../lib/useNewUi';
import { NumberField } from '../ui';
import type { AssessmentV2Copy } from './copy';
import { isPageCount } from './model';

/**
 * bd-nr8mrm.4 — FEAT-209 (Ramisha Riaz): how many pages the paper may take, on Check and make. Empty = no limit. The bot
 * tightens the print step by step to fit, never cutting a question. Only while assessment_page_fit is on.
 */

/** GET /config features.assessmentPageFit. Off while reading and on any failure (fail closed). */
export function usePageFitSwitch(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(cfg?.features?.assessmentPageFit === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

/** Why Make waits on the Pages box: her number is not 1–5. null = nothing to fix (empty is no limit). */
export function pagesWhy(pageCount: number | null | undefined, C: AssessmentV2Copy): string | null {
  if (pageCount === null || pageCount === undefined) return null;
  return isPageCount(pageCount) ? null : C.pagesLimitError;
}

/**
 * bd-nr8mrm.8 — her questions need more pages than she set (pageEstimate.ts): say so before the paper is made. A
 * warning, not a block: Make still sends, and the bot still fits it as tight as it can.
 */
export function pagesOver(pageCount: number | null | undefined, need: number | null | undefined, C: AssessmentV2Copy): string | null {
  if (!isPageCount(pageCount ?? NaN) || !need || need <= (pageCount as number)) return null;
  return C.pagesNeed(need);
}

export function PagesBox({ value, onChange, C, need }: {
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  C: AssessmentV2Copy;
  /** Pages her questions need (pageEstimate.ts); null = no estimate. */
  need?: number | null;
}) {
  const why = pagesWhy(value, C);
  const over = why ? null : pagesOver(value, need, C);
  return (
    <div className="rounded-2xl bg-white p-3.5">
      <NumberField
        label={C.pagesLimit}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(d) => onChange(d === '' ? null : Number(d))}
        error={!!why}
        describedBy="pages-limit-note"
        maxLength={2}
        testId="pages-limit"
      />
      <p id="pages-limit-note" role="status"
        className={why ? 'mt-2 text-[15px] text-[#c8331f]' : over ? 'mt-2 text-[15px] text-[#8a5a00]' : 'mt-2 text-[13px] text-[#6b7280]'}>
        {why ?? over ?? C.pagesLimitHint}
      </p>
    </div>
  );
}
