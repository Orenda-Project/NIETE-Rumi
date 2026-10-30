import { useLocation } from "react-router-dom";
import { BarChart3, Headphones, Home, MoreHorizontal, School } from "lucide-react";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy, useLang } from "../../teacher/i18n";
import { NavBar } from "../../coachip-ui/NavBar";
import { Rail } from "../../coachip-ui/Rail";
import { LangToggle } from "../../coachip-ui/LangToggle";
import { useLaptop } from "../../coachip-ui/useLaptop";
import "../../coachip-ui/tokens.css";
import { t } from "./text";
import { currentInsightsItem, INSIGHTS_NAV, type InsightsNavKey } from "./paths";

/**
 * bd-sex15q.15, restyled bd-sex15q.42 (R6) — the menu of a coach with portal_coachip on (DESIGN §2, O4): This week ·
 * Schools · Listen · Stats · More. coachip-ui's NavBar on a phone (opaque, z-50, lucide 20 px line icons, the current
 * item green) and its Rail on a laptop (≥ 1024: the wordmark, the menu, EN | اردو and the trust line at its foot).
 * Training and Lesson Plans are reached from More; on a phone the language lives in More (the kit's Language row).
 *
 * It imports the tokens itself: PortalLayout draws it before the page's chunk (which carries the Shell) is in.
 */
function Glyph({ k }: { k: InsightsNavKey }) {
  const p = { size: 20, strokeWidth: 1.5, "aria-hidden": true as const };
  if (k === "schools") return <School {...p} />;
  if (k === "listen") return <Headphones {...p} />;
  if (k === "stats") return <BarChart3 {...p} />;
  if (k === "more") return <MoreHorizontal {...p} />;
  return <Home {...p} />;
}

export default function InsightsNav() {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const { pathname } = useLocation();
  // the toggle reads /me/language when it mounts: only where it is seen (a laptop), never on a phone
  const laptop = useLaptop();
  const current = currentInsightsItem(pathname);
  const items = INSIGHTS_NAV.map((i) => ({ key: i.key, to: i.to, label: t(i.copy, lang), icon: <Glyph k={i.key} />, current: current === i.key }));
  return (
    <>
      <Rail
        testId="insights-top-nav"
        ariaLabel={C.menu}
        logoAlt={C.logoAlt}
        items={items}
        lang={laptop ? <LangToggle /> : null}
        trust={t("trust.coach", lang)}
      />
      <NavBar testId="insights-nav" ariaLabel={C.menu} items={items} />
    </>
  );
}
