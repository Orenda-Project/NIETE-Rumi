import nieteLogo from "@/assets/niete-logo.png";
import { cn } from "@/lib/utils";
import { useLatinAttrs } from "@/lib/textDir";
import { NieteLattice } from "../../icons/NieteLattice";
import { StatusChip } from "../../ui";
import { greetingParts } from "../../ui/HomeGreeting";
import { TEACHER_FRAME } from "../../copy";
import { useCopy, useLang } from "../../i18n";
import { shortDayLabel } from "../../format";
import { useLanguageSwitch } from "../../useLanguageSwitch";
import { LanguagePill } from "./LanguagePill";
import { bandShape, useViewportWidth } from "./bandShape";

/**
 * The look's navy band (portal_teacher_home_look): shorter than today's HomeGreeting, so the card and the rows start
 * higher on a small phone. Two shapes, picked by `bandShape` from the greeting's estimated width and the page width:
 *
 *   "two"  row 1: the mark · the short date and the school · the language pill; row 2: the greeting (the page's h1).
 *   "one"  one row: the mark · the greeting · the pill; the date and school under it from 344 px up, dropped below.
 *
 * Nothing here is cut: every box has a minimum height, never a fixed one, and the greeting wraps (the band grows) when
 * the estimate is wrong. The name and its "!" are one isolate (greetingParts): kept whole in shape "two", wrapped at its
 * own spaces in shape "one". The school is DATA: a Latin school keeps its order on an Urdu page (`<bdi dir="ltr">`).
 * The bottom padding leaves 10 px of navy under the first body element, which climbs 20 px into the band (`-mt-5`).
 * `vw` overrides the measured page width (tests).
 */
export interface HomeBandProps {
  /** "Salaam, {name}!", already composed in the page's language. */
  title: string;
  /** The teacher's name as it appears in `title`. */
  name: string;
  now: Date;
  /** The teacher's school (already cleaned); null shows the date alone. */
  school: string | null;
  vw?: number;
  /** Something climbs into the band (the card, or the strip): keep the 30 px it climbs into; else a short 8 px end. */
  climb?: boolean;
}

export function HomeBand({ title, name, now, school, vw, climb = true }: HomeBandProps) {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const measured = useViewportWidth();
  const width = vw ?? measured;
  const shape = bandShape(title, lang, width);
  const latinAttrs = useLatinAttrs();
  const switcher = useLanguageSwitch();
  const ur = lang === "ur";
  const date = shortDayLabel(now, lang);

  const mark = <img src={nieteLogo} alt={C.logoAlt} className="ms-[-2px] h-8 w-8 shrink-0 object-contain" />;
  const pill = <LanguagePill lang={switcher} />;
  const meta = (
    <p
      data-testid="home-look-meta"
      className={cn("flex min-w-0 text-[#d5d9e4]", ur ? "text-[13px]" : "text-[12.5px] leading-[1.3]", shape === "two" && "flex-1")}
    >
      {/* The date stays whole; the school is the one that is cut, at ITS end (a Latin school in Urdu keeps its start). */}
      <span className="shrink-0 whitespace-pre">
        {date}
        {date && school ? (ur ? "، " : " · ") : null}
      </span>
      {school ? <bdi {...latinAttrs(school)} className="block min-w-0 truncate">{school}</bdi> : null}
    </p>
  );
  const greeting = (
    <h1
      data-testid="home-look-greeting"
      className={cn(
        "min-w-0 break-words font-semibold text-white",
        shape === "two" ? "mt-1 text-[20px] leading-[26px] rtl:text-[19px]" : "flex-1 text-[17px] leading-[22px] rtl:text-[16px]",
      )}
    >
      {greetingParts(title, name, { nameWrap: shape === "two" ? "nowrap" : "words" })}
    </h1>
  );
  const notSaved = switcher.status === "failed"
    ? <div className="relative mt-1"><StatusChip text={C.more.notSaved} tone="error" className="bg-white/10 text-white" /></div>
    : null;

  return (
    <header
      data-testid="home-band"
      data-shape={shape}
      className={cn("relative overflow-hidden bg-[#333748] px-4 pt-[calc(6px+env(safe-area-inset-top))] text-white", climb ? "pb-[30px]" : "pb-[8px]")}
    >
      <NieteLattice className="absolute inset-y-0 end-0 w-[42%]" line="#48b078" strength={0.35} />
      {shape === "two" ? (
        <>
          <div data-band-row="" className="relative flex min-h-[44px] items-center gap-2.5">
            {mark}
            {meta}
            {pill}
          </div>
          {notSaved}
          <div className="relative">{greeting}</div>
        </>
      ) : (
        <>
          <div data-band-row="" className="relative flex min-h-[44px] items-center gap-2.5">
            {mark}
            {greeting}
            {pill}
          </div>
          {notSaved}
          {width >= 344 ? <div className="relative">{meta}</div> : null}
        </>
      )}
    </header>
  );
}
