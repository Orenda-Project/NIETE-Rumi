import { useLang } from "../teacher/i18n";
import { useLanguageSwitch } from "../teacher/useLanguageSwitch";
import { t } from "../coach/insights/text";

/**
 * bd-sex15q.42 — EN | اردو (DESIGN_SYSTEM §7): a 44 px pill pair, the current language filled navy (on the band: the
 * current one white with a navy label). It writes through the one writer (useLanguageSwitch → PUT /me/language →
 * setUserLanguage; language-protocol), and changes the page only once the server accepted it. Always LTR: the pair
 * reads EN then اردو in both languages. `prefix` names the two buttons' test ids (`rm-lang` keeps the RM's ids).
 */
export function LangToggle({ prefix = "cp-lang", tone = "light", className, sw: shared }: {
  prefix?: string; tone?: "light" | "dark"; className?: string; sw?: ReturnType<typeof useLanguageSwitch>;
}) {
  const lang = useLang();
  // a row that shows the switch's state (More's "Not saved") passes its own switch, so both read one status
  const own = useLanguageSwitch();
  const sw = shared ?? own;
  const on = tone === "dark" ? "bg-white text-cp-navy" : "bg-cp-navy text-white";
  const off = tone === "dark" ? "text-white/80" : "text-cp-ink-2";
  const btn = (k: "en" | "ur") => (
    <button
      key={k}
      type="button"
      data-testid={`${prefix}-${k}`}
      aria-pressed={lang === k}
      onClick={() => { if (lang !== k) void sw.toggle(); }}
      className={`min-h-[44px] min-w-[48px] rounded-full px-3 text-[14px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green ${lang === k ? on : off}`}
    >
      {t(k === "en" ? "lang.en" : "lang.ur", lang)}
    </button>
  );
  return (
    <div dir="ltr" data-lang-toggle="" className={`flex shrink-0 items-center gap-1 rounded-full p-1 ${tone === "dark" ? "bg-white/10" : "border border-cp-hairline bg-white"} ${className ?? ""}`}>
      {btn("en")}{btn("ur")}
    </div>
  );
}
