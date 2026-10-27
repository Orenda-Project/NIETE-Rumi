import { Languages } from "lucide-react";
import { TEACHER_FRAME } from "../../copy";
import { useCopy } from "../../i18n";
import type { useLanguageSwitch } from "../../useLanguageSwitch";

/**
 * The look's language switch: ONE pill in the band naming the language the teacher is NOT on ("اردو" on an English
 * page, "English" on an Urdu one), each word in its own language as More's tabs draw it. A tap saves through the one
 * writer (useLanguageSwitch → PUT /me/language) and only then switches the page; it is disabled while that save is in
 * flight, so a second tap writes nothing. The band draws "Not saved" when the server refuses (it owns `lang`).
 *
 * The visual pill is 32 px; the target around it is 44×44. Its spoken name is "Language: <the other language>", from
 * the frame's existing words (more.language, more.switchTo), so it adds no string.
 */
export function LanguagePill({ lang }: { lang: ReturnType<typeof useLanguageSwitch> }) {
  const C = useCopy(TEACHER_FRAME);
  const word = C.more.switchTo[lang.target];
  return (
    <button
      type="button"
      data-testid="home-look-lang"
      aria-label={`${C.more.language}: ${word}`}
      disabled={lang.status === "saving"}
      onClick={() => { void lang.toggle(); }}
      className="relative flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center disabled:opacity-70"
    >
      <span className="flex min-h-[32px] items-center gap-1.5 rounded-full border border-white/40 bg-white/10 px-3 text-[14px] font-semibold text-white">
        <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{word}</span>
      </span>
    </button>
  );
}
