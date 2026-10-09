import { CalendarDays, School } from "lucide-react";
import { cn } from "@/lib/utils";
import nieteLogo from "@/assets/niete-logo.png";
import { NieteLattice } from "../icons/NieteLattice";

/**
 * bd-fmf24g.22 — HomeGreeting: the top of the teacher Home, option C of the canvas's "Home top · options" (chosen by
 * the operator, 9 Oct 2026). A NIETE band in the brand book's navy-slate (#333748): the N/ن mark and "NIETE", a faint
 * diamond lattice at the far end, her whole name with "!" as the page's h1, then today's date and her school as PLAIN
 * text (the two white pills this replaces looked tappable; nothing here is a control).
 *
 * Words come in by props (`title` is "Salaam, {full name}!" already composed, `brand`/`logoAlt` from the frame copy);
 * data (her name, school, the date) is shown as it comes. Real fields only: GET /api/portal/me (`firstName`,
 * `schoolName`) and the clock. The bottom padding (52px) leaves room for the first thing under the band to climb 28px
 * into it; Home does that with a `-mt-10` body (TeacherPage's `hero` slot supplies the full-bleed edges).
 * Start/end spacing only, so it mirrors for Urdu. Canvas: the `HomeGreeting` component board, variant `brand`.
 */
export interface HomeGreetingProps {
  title: string;
  /** Today, already in her language ("Thursday 8 October"). */
  date: string;
  /** Her school; null or empty shows no school row. */
  school?: string | null;
  brand: string;
  logoAlt: string;
  /** The mark; the NIETE logo by default. */
  markSrc?: string;
  className?: string;
}

export function HomeGreeting({ title, date, school, brand, logoAlt, markSrc = nieteLogo, className }: HomeGreetingProps) {
  return (
    <header
      data-testid="home-greeting"
      className={cn("relative flex flex-col gap-3.5 overflow-hidden bg-[#333748] px-5 pb-[52px] pt-[calc(18px+env(safe-area-inset-top))] text-white", className)}
    >
      <NieteLattice className="absolute inset-y-0 end-0 w-[70%]" strength={0.5} />
      <div className="relative flex min-h-[44px] items-center gap-2.5">
        <img src={markSrc} alt={logoAlt} className="ms-[-6px] h-11 w-11 object-contain" />
        <span dir="ltr" className="text-[17px] font-bold tracking-[0.14em]">{brand}</span>
      </div>
      <div className="relative flex flex-col gap-3">
        <h1 className="break-words text-[32px] font-light leading-[1.15] tracking-[-0.015em] [overflow-wrap:anywhere] rtl:leading-[1.5]">{title}</h1>
        <div className="flex flex-col gap-2">
          <p data-testid="home-date" className="flex items-start gap-2 text-[17px] font-medium leading-[1.35] text-[#d5d9e4] rtl:leading-[1.6]">
            <CalendarDays className="mt-[3px] h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{date}</span>
          </p>
          {school ? (
            <p data-testid="home-school" className="flex min-w-0 items-start gap-2 text-[17px] font-medium leading-[1.35] text-[#d5d9e4] [overflow-wrap:anywhere] rtl:leading-[1.6]">
              <School className="mt-[3px] h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 [unicode-bidi:isolate]">{school}</span>
            </p>
          ) : null}
        </div>
      </div>
    </header>
  );
}
