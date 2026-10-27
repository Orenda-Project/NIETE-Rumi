import { useLang, type Lang } from "../../../teacher/i18n";
import { mmss } from "../format";
import { tx } from "../text";

/**
 * bd-sex15q.16 — the player's clocks. A clock is ASCII in both languages and an LTR atom inside Urdu (COPY §0.2-3,
 * §F `{mm:ss}`); it carries `data-clock`, which is how the DOM count contract (count.tsx `domContract`) tells a clock
 * from a bare number, the way MomentSlot, ListenRow and WCard mark theirs.
 */
export function ClockText({ seconds, lang }: { seconds: number; lang: Lang }) {
  return (
    <span data-clock="" dir="ltr" className="font-semibold tabular-nums [unicode-bidi:isolate]">
      {mmss(seconds, lang)}
    </span>
  );
}

/** "in the lesson 18:42": the clip's start in the lesson plus how far the player is into it, moving on `timeupdate`. */
export default function LessonClock({ seconds }: { seconds: number }) {
  const lang = useLang();
  return (
    <p data-testid="lesson-clock" className="text-[13px] leading-snug text-[#6b7280]">
      {tx("s4.in_lesson", lang, { "mm:ss": <ClockText seconds={seconds} lang={lang} /> })}
    </p>
  );
}
