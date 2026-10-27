import { Link, useLocation } from "react-router-dom";
import { BarChart3, Headphones } from "lucide-react";
import nieteLogo from "@/assets/niete-logo.png";
import { cn } from "@/lib/utils";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy, useLang } from "../../teacher/i18n";
import { FeatureGlyph } from "../../teacher/icons";
import { t } from "./text";
import { currentInsightsItem, INSIGHTS_NAV, type InsightsNavKey } from "./paths";

/**
 * bd-sex15q.15 — the bottom menu of a coach with portal_coachip on (DESIGN §2, O4): This week · Schools · Listen · Stats ·
 * More. The same bar as the coach v2 menu (teacher/TeacherNavigation: white, 58px targets, green current item, the
 * top bar on a desktop); only the items differ. Training and Lesson Plans are reached from More.
 */
function Glyph({ k, size }: { k: InsightsNavKey; size: number }) {
  if (k === "listen") return <Headphones size={size} strokeWidth={2} aria-hidden="true" />;
  if (k === "stats") return <BarChart3 size={size} strokeWidth={2} aria-hidden="true" />;
  return <FeatureGlyph name={k === "thisWeek" ? "home" : k} size={size} />;
}

export default function InsightsNav() {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const { pathname } = useLocation();
  const current = currentInsightsItem(pathname);
  const items = INSIGHTS_NAV.map((i) => ({ ...i, label: t(i.copy, lang) }));
  return (
    <>
      <nav aria-label={C.menu} data-testid="insights-top-nav" className="hidden border-b border-[#e5e7eb] bg-white md:block">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <img src={nieteLogo} alt={C.logoAlt} className="h-8 w-8 rounded object-contain" />
            <span className="text-lg font-bold text-[#1d2025]">{C.brand}</span>
          </div>
          <div className="flex flex-1 items-center gap-1">
            {items.map(({ key, to, label }) => (
              <Link
                key={key}
                to={to}
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
          </div>
        </div>
      </nav>
      <nav
        aria-label={C.menu}
        data-testid="insights-nav"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[#e5e7eb] bg-white px-1 pb-[calc(14px+env(safe-area-inset-bottom))] pt-1.5 md:hidden"
      >
        {items.map(({ key, to, label }) => (
          <Link
            key={key}
            to={to}
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
