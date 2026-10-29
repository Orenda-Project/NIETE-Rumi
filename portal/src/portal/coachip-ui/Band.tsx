import type { ReactNode } from "react";
import mark from "@/assets/niete-logo.png";

/**
 * bd-sex15q.42 — the band (phone homes: S1, S8, and every top-level tab): the navy-slate gradient with the NIETE lattice
 * at 10 %, the lockup (the diamond-nuqta mark on dark + "NIETE") and the date on one line, the title 24/800, an
 * optional line under it, then its body (the ring, the sentence, the window pill). The content after it rides up 24 px
 * over it (`cp-overlap`). On a laptop (≥ 1024) the same markup is the page head on the ground and its body becomes the
 * one elevated hero card (tokens.css), so a page writes ONE header for both widths. `trailing` sits at the top's end
 * (the RM's EN | اردو on a phone).
 */
export function Band({ title, date, sub, trailing, foot, children, testId = "cp-band" }: {
  title?: ReactNode; date?: ReactNode; sub?: ReactNode; trailing?: ReactNode; foot?: ReactNode; children?: ReactNode; testId?: string;
}) {
  return (
    <header data-testid={testId} className="cp-band">
      <div className="cp-lattice" aria-hidden="true" />
      <div className="cp-band__top mb-2.5 flex min-h-[28px] items-center justify-between gap-3">
        <span className="cp-band__lockup flex items-center gap-2 text-[12px] font-extrabold tracking-[0.14em]" dir="ltr">
          <img src={mark} alt="" className="block h-[22px] w-auto" />
          NIETE
        </span>
        <span className="flex items-center gap-2">
          {date && <span className="cp-band__date text-[13px] font-semibold">{date}</span>}
          {trailing}
        </span>
      </div>
      {title && <h1 className="cp-band__title text-[24px] font-extrabold leading-[1.2] tracking-[-0.01em] lg:text-[30px]">{title}</h1>}
      {sub && <div className="cp-on-band-2 mt-1 text-[14px] leading-snug">{sub}</div>}
      {children && <div className="cp-band__body mt-3">{children}</div>}
      {foot && <div data-testid={`${testId}-foot`} className="cp-band__date mt-3 text-[12px] leading-[1.45] lg:hidden">{foot}</div>}
    </header>
  );
}

/** The cycle word on the band or a card: NOTICE · MOVE 1 OF 2 (12/700 caps; green on navy, green-ink on white). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`cp-eyebrow text-[12px] font-bold uppercase leading-snug tracking-[0.08em] text-cp-green-ink ${className ?? ""}`}>{children}</p>;
}
