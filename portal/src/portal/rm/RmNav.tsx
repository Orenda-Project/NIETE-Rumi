import { Link, useLocation } from "react-router-dom";
import { BarChart3, CircleDot, Home, LayoutGrid, Users } from "lucide-react";
import { TEACHER_FRAME } from "../teacher/copy";
import { useCopy, useLang } from "../teacher/i18n";
import { COACH_INSIGHTS_BASE } from "../coach/training/appReady";
import { NavBar } from "../coachip-ui/NavBar";
import { Rail } from "../coachip-ui/Rail";
import { LangToggle } from "../coachip-ui/LangToggle";
import { currentRmItem, RM_NAV, type RmNavKey } from "./paths";
import { useRmSession } from "./RmGate";
import { RmLogoutRow } from "./RmLogout";
import { rt } from "./text";

/**
 * bd-sex15q.17, restyled bd-sex15q.42 (R6) — the RM's menu (COPY §N): Sector · Coaches · Circle · Stats. The same
 * NavBar (phone) and Rail (laptop, ≥ 1024) as the coach's menu (CODE_MAP C1: one owner keeps them one pattern), lucide
 * 20 px line icons. The rail carries EN | اردو at its foot; on a phone it sits in the page's band or app bar (RmFrame).
 * A user who is also a flagged coach gets "This week" back to their own S1. The language toggle writes through the one
 * writer (useLanguageSwitch → setUserLanguage). fix-r5 s6 (a): the rail's foot also carries Log out (RmLogout).
 */
function Glyph({ k }: { k: RmNavKey }) {
  const p = { size: 20, strokeWidth: 1.5, "aria-hidden": true as const };
  if (k === "coaches") return <Users {...p} />;
  if (k === "circle") return <CircleDot {...p} />;
  if (k === "stats") return <BarChart3 {...p} />;
  return <LayoutGrid {...p} />;
}

/** The RM's EN | اردو (kept for callers of the old name; the toggle itself is coachip-ui's). */
export function LangSwitch({ tone = "light" }: { tone?: "light" | "dark" }) {
  return <LangToggle prefix="rm-lang" tone={tone} />;
}

export default function RmNav() {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const { pathname } = useLocation();
  const { isCoach } = useRmSession();
  const current = currentRmItem(pathname);
  const items = RM_NAV.map((i) => ({ key: i.key, to: i.to, dataNav: i.key, label: rt(i.copy, lang), icon: <Glyph k={i.key} />, current: current === i.key }));
  return (
    <>
      <Rail
        testId="rm-top-nav"
        ariaLabel={C.menu}
        logoAlt={C.logoAlt}
        items={items}
        extra={isCoach && (
          <Link to={COACH_INSIGHTS_BASE} data-nav="this_week" className="mt-3 flex min-h-[44px] items-center whitespace-nowrap rounded-[10px] border-t border-cp-hairline px-3 pt-3 text-[15px] font-medium text-cp-ink-2 hover:text-cp-ink">
            {rt("nav.this_week", lang)}
          </Link>
        )}
        lang={<><LangSwitch /><RmLogoutRow /></>}
      />
      {/* bd-sex15q.47 (ux-lead-2 164236): a dual's way back to their own S1 on a phone is the bar's first item */}
      <NavBar testId="rm-nav" ariaLabel={C.menu} items={isCoach
        ? [{ key: "this_week", to: COACH_INSIGHTS_BASE, dataNav: "this_week", label: rt("nav.this_week", lang), icon: <Home size={20} strokeWidth={1.5} aria-hidden />, current: false }, ...items]
        : items} />
    </>
  );
}
