import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { TEACHER_FRAME } from "../teacher/copy";
import { useCopy } from "../teacher/i18n";
import { BackLink } from "../lib/useBack";

/**
 * bd-sex15q.42 — the slim app bar of every inner screen (S2–S7, S9, S10: a destination, not a home, so no band): the
 * 44 px back circle, an eyebrow line ("Move 1 of 2 · this month"), the title 24/800 navy, and the screen's ONE window
 * line. White with a hairline under it on a phone; on a laptop it is the page head on the ground. Back is the app's
 * Back (lib/useBack: the screen before, else `backTo`).
 *
 * R6 fix cycle 1 (FIX_R6 A1, design-qa 224142: the body dropped ~76 px as the title landed): a line that is coming but
 * not known yet is drawn as a placeholder bar in the live line's own box (same size, leading and Urdu leading), so the
 * bar is as tall before the read as after it. A line that is `null` is still coming; `undefined` (or "") means this bar
 * has no such line (a page that failed to load passes `undefined`, so no bar pulses beside the error).
 */
export function AppBar({ backTo, backLabel, eyebrow, title, sub, trailing, testId = "cp-appbar" }: {
  backTo?: string; backLabel?: string; eyebrow?: ReactNode; title?: ReactNode; sub?: ReactNode; trailing?: ReactNode; testId?: string;
}) {
  const C = useCopy(TEACHER_FRAME);
  return (
    <header data-testid={testId} className="flex items-start gap-3 border-b border-cp-hairline bg-cp-surface px-5 pb-3 pt-4 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-4 lg:pt-0">
      {backTo && (
        <BackLink
          to={backTo}
          aria-label={backLabel ?? C.back}
          className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-cp-hairline bg-white text-cp-navy outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green"
        >
          <ChevronLeft size={20} strokeWidth={1.5} className="rtl:rotate-180" aria-hidden="true" />
        </BackLink>
      )}
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="text-[13px] leading-snug text-cp-ink-3">{eyebrow}</div> : eyebrow === null && <Placeholder k="eyebrow" className="text-[13px] leading-snug" w="w-32" />}
        {title
          ? <h1 className="break-words text-[24px] font-extrabold leading-[1.2] tracking-[-0.01em] text-cp-navy [overflow-wrap:anywhere] lg:text-[30px]">{title}</h1>
          : title === null && <Placeholder k="title" className="cp-ph-title text-[24px] leading-[1.2] lg:text-[30px]" w="w-3/4" />}
        {sub ? <div className="mt-1.5 text-[13px] leading-[1.4] text-cp-ink-3">{sub}</div> : sub === null && <Placeholder k="sub" className="mt-1.5 text-[13px] leading-[1.4]" w="w-1/2" />}
      </div>
      {trailing}
    </header>
  );
}

/**
 * A line still to come: one no-break space in the live line's own size and leading (so its box is the live line's, in
 * Urdu too), with a pulsing bar across it.
 */
function Placeholder({ k, className, w }: { k: string; className: string; w: string }) {
  return (
    <div data-cp-ph={k} aria-hidden="true" className={`cp-skeleton ${className}`}>
      <span className={`inline-block h-[0.62em] ${w} rounded-full bg-cp-hairline align-middle`} />{"\u00a0"}
    </div>
  );
}
