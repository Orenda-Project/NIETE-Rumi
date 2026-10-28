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
        {eyebrow && <div className="text-[13px] leading-snug text-cp-ink-3">{eyebrow}</div>}
        {title && <h1 className="break-words text-[24px] font-extrabold leading-[1.2] tracking-[-0.01em] text-cp-navy [overflow-wrap:anywhere] lg:text-[30px]">{title}</h1>}
        {sub && <div className="mt-1.5 text-[13px] leading-[1.4] text-cp-ink-3">{sub}</div>}
      </div>
      {trailing}
    </header>
  );
}
