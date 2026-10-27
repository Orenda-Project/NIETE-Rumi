import { Link, useLocation } from "react-router-dom";
import { BarChart3, Headphones, LayoutGrid, Users } from "lucide-react";
import nieteLogo from "@/assets/niete-logo.png";
import { cn } from "@/lib/utils";
import { TEACHER_FRAME } from "../teacher/copy";
import { useCopy, useLang } from "../teacher/i18n";
import { useLanguageSwitch } from "../teacher/useLanguageSwitch";
import { COACH_INSIGHTS_BASE } from "../coach/training/appReady";
import { currentRmItem, RM_NAV, type RmNavKey } from "./paths";
import { useRmSession } from "./RmGate";
import { rt } from "./text";

/**
 * bd-sex15q.17 — the RM's menu (COPY §N): Sector · Coaches · Circle · Stats · EN | اردو. A top bar on a laptop (the
 * RM's first device, S8 at 1440×900), a bottom bar on a phone. A user who is also a flagged coach gets "This week"
 * back to their own S1. The language toggle writes through the one writer (useLanguageSwitch → setUserLanguage).
 */
function Glyph({ k, size }: { k: RmNavKey; size: number }) {
  const p = { size, strokeWidth: 2, "aria-hidden": true as const };
  if (k === "coaches") return <Users {...p} />;
  if (k === "circle") return <Headphones {...p} />;
  if (k === "stats") return <BarChart3 {...p} />;
  return <LayoutGrid {...p} />;
}

export function LangSwitch() {
  const lang = useLang();
  const sw = useLanguageSwitch();
  const btn = (k: "en" | "ur") => (
    <button
      key={k}
      type="button"
      data-testid={`rm-lang-${k}`}
      aria-pressed={lang === k}
      onClick={() => { if (lang !== k) void sw.toggle(); }}
      className={cn("min-h-[40px] min-w-[48px] rounded-full px-3 text-[14px] font-semibold", lang === k ? "bg-[#333748] text-white" : "text-[#374151]")}
    >
      {rt(k === "en" ? "lang.en" : "lang.ur", lang)}
    </button>
  );
  return <div dir="ltr" className="flex items-center gap-1 rounded-full border border-[#e5e7eb] bg-white p-1">{btn("en")}{btn("ur")}</div>;
}

export default function RmNav() {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const { pathname } = useLocation();
  const { isCoach } = useRmSession();
  const current = currentRmItem(pathname);
  const items = RM_NAV.map((i) => ({ ...i, label: rt(i.copy, lang) }));
  return (
    <>
      <nav aria-label={C.menu} data-testid="rm-top-nav" className="hidden border-b border-[#e5e7eb] bg-white md:block">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <img src={nieteLogo} alt={C.logoAlt} className="h-8 w-8 rounded object-contain" />
            <span className="text-lg font-bold text-[#1d2025]">{C.brand}</span>
          </div>
          <div className="flex flex-1 items-center gap-1">
            {items.map(({ key, to, label }) => (
              <Link
                key={key}
                to={to}
                data-nav={key}
                aria-current={current === key ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] items-center gap-2 whitespace-nowrap rounded-xl px-3 text-[15px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]",
                  current === key ? "text-[#48b078]" : "text-[#6b7280] hover:text-[#1d2025]",
                )}
              >
                <Glyph k={key} size={20} />
                <span>{label}</span>
              </Link>
            ))}
            {isCoach && (
              <Link to={COACH_INSIGHTS_BASE} data-nav="this_week" className="ms-auto flex min-h-[56px] items-center whitespace-nowrap rounded-xl px-3 text-[15px] font-semibold text-[#6b7280] hover:text-[#1d2025]">
                {rt("nav.this_week", lang)}
              </Link>
            )}
          </div>
          <LangSwitch />
        </div>
      </nav>
      {/* fix-r5 s2 item 12 (qa-rm R7 FAIL 20261027T072545): the phone's own EN | اردو, in a slim bar above the page; the
          laptop keeps the one in its top nav (md and up). */}
      <div data-testid="rm-phone-bar" className="flex items-center justify-between gap-2 border-b border-[#e5e7eb] bg-white px-4 py-2 md:hidden">
        <img src={nieteLogo} alt={C.logoAlt} className="h-7 w-7 rounded object-contain" />
        <LangSwitch />
      </div>
      <nav
        aria-label={C.menu}
        data-testid="rm-nav"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[#e5e7eb] bg-white px-1 pb-[calc(14px+env(safe-area-inset-bottom))] pt-1.5 md:hidden"
      >
        {items.map(({ key, to, label }) => (
          <Link
            key={key}
            to={to}
            data-nav={key}
            aria-current={current === key ? "page" : undefined}
            className={cn(
              "flex min-h-[58px] min-w-[64px] flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl text-[11.5px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]",
              current === key ? "text-[#48b078]" : "text-[#6b7280]",
            )}
          >
            <Glyph k={key} size={24} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
