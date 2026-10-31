import type { ReactNode } from "react";
import { CalendarDays, School } from "lucide-react";
import { cn } from "@/lib/utils";
import nieteLogo from "@/assets/niete-logo.png";
import { latinDir } from "@/lib/textDir";
import { NieteLattice } from "../icons/NieteLattice";

/**
 * bd-fmf24g.22 — HomeGreeting: the top of the teacher Home, option C of the canvas's "Home top · options" (chosen by
 * the operator, 9 Oct 2026). A NIETE band in the brand book's navy-slate (#333748): the N/ن mark and "NIETE", a faint
 * diamond lattice at the far end, the teacher's whole name with "!" as the page's h1, then today's date and their school as PLAIN
 * text (the two white pills this replaces looked tappable; nothing here is a control).
 *
 * Words come in by props (`title` is "Salaam, {full name}!" already composed, `brand`/`logoAlt` from the frame copy);
 * data (the name, school, the date) is shown as it comes. Real fields only: GET /api/portal/me (`firstName`,
 * `schoolName`) and the clock. The bottom padding (52px) leaves room for the first thing under the band to climb 28px
 * into it; Home does that with a `-mt-10` body (TeacherPage's `hero` slot supplies the full-bleed edges).
 * Start/end spacing only, so it mirrors for Urdu. Canvas: the `HomeGreeting` component board, variant `brand`.
 *
 * `footer`: one control at the foot of the band, under the date and school: Home's English | اردو switch (operator,
 * 2026-10-14, design doc option B). It sits inside the band, so the tiles still climb into it. The band's own lines
 * stay plain text; only what is passed here is tappable.
 *
 * `name`: the teacher's name as it appears in `title`. It is drawn with the "!" after it as ONE isolate (`<bdi>`), so in Urdu
 * the "!" stays right after the name instead of taking the RTL paragraph's side ("!Testwala"; language-protocol §9.6:
 * the atom keeps its punctuation inside its isolate). A Latin name is set in the English font with an English line
 * height (`!leading-[1.15]`, important because index.css gives every Urdu span line-height 2): mixed into the
 * Nastaliq h1 it used to stretch each line box, and the Urdu band stood ~30 px taller than it should. In Urdu it is
 * 22 px: at 32 px a Latin name is far wider than the Nastaliq around it and pushed the greeting onto a second line
 * at 360 px (another ~50 px of band).
 *
 * The Urdu greeting is 24 px, not the English 32 px: Nastaliq at the same size draws far taller letters (ا ل ک reach
 * well above a Latin capital) and has no light weight, so it read much bigger than the English (operator, 31 Oct 2026:
 * "the urdu Assalamoalikum font is so big"; mockup v10, "i like smaller font").
 */
export interface HomeGreetingProps {
  title: string;
  /** The teacher's name as it appears in `title` (isolated with its "!"); empty or absent draws the title as it is. */
  name?: string | null;
  /** Today, already in the teacher's language ("Thursday 8 October"). */
  date: string;
  /** The teacher's school; null or empty shows no school row. */
  school?: string | null;
  brand: string;
  logoAlt: string;
  /** The mark; the NIETE logo by default. */
  markSrc?: string;
  /** A control under the date and school, inside the band (Home's language switch). */
  footer?: ReactNode;
  /** A small control at the end of the logo row (the Home look's language pill: operator, 30 Oct 2026). */
  corner?: ReactNode;
  /** The header's test id; `home-greeting` by default. */
  testId?: string;
  className?: string;
}

export function HomeGreeting({ title, name, date, school, brand, logoAlt, markSrc = nieteLogo, footer, corner, testId = "home-greeting", className }: HomeGreetingProps) {
  return (
    <header
      data-testid={testId}
      className={cn("relative flex flex-col gap-3.5 overflow-hidden bg-[#333748] px-5 pb-[52px] pt-[calc(18px+env(safe-area-inset-top))] text-white", className)}
    >
      <NieteLattice className="absolute inset-y-0 end-0 w-[70%]" strength={0.5} />
      <div className="relative flex min-h-[44px] items-center gap-2.5">
        <img src={markSrc} alt={logoAlt} className="ms-[-6px] h-11 w-11 object-contain" />
        <span dir="ltr" className="text-[17px] font-bold tracking-[0.14em]">{brand}</span>
        {corner ? <span className="ms-auto flex">{corner}</span> : null}
      </div>
      <div className="relative flex flex-col gap-3">
        <h1 className="break-words text-[32px] font-light leading-[1.15] tracking-[-0.015em] [overflow-wrap:anywhere] rtl:text-[24px] rtl:leading-[1.5]">{greetingParts(title, name)}</h1>
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
        {footer ? <div data-testid="home-greeting-footer" className="mt-1">{footer}</div> : null}
      </div>
    </header>
  );
}

/**
 * How the name's isolate wraps, for a caller that decides it (the look's band): "nowrap" keeps the name whole (it moves
 * to the next line as one piece), "words" lets it wrap at its own spaces and break a word only when that word alone is
 * wider than the line. Absent: the name inherits the heading's wrapping (HomeGreeting).
 */
const WRAP = { inherit: "", nowrap: "whitespace-nowrap", words: "break-words" } as const;

export interface GreetingPartsOptions {
  nameWrap?: "nowrap" | "words";
}

/** The title with `name` and the "!" after it as one isolate; the title as it is when the name is not in it. */
export function greetingParts(title: string, name?: string | null, options: GreetingPartsOptions = {}): ReactNode {
  const at = name ? title.lastIndexOf(name) : -1;
  if (!name || at < 0) return title;
  const end = at + name.length + (title.charAt(at + name.length) === "!" ? 1 : 0);
  const latin = latinDir(name) === "ltr";
  return (
    <>
      {title.slice(0, at)}
      <bdi data-testid="home-greeting-name" {...(latin ? { "data-latin": "" } : {})} className={cn(latin ? "!leading-[1.15] rtl:text-[22px]" : "!leading-[1.15]", WRAP[options.nameWrap ?? "inherit"])}>
        {title.slice(at, end)}
      </bdi>
      {title.slice(end) || null}
    </>
  );
}
