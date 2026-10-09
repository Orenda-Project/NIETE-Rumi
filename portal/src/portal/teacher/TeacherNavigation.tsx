import { Link, useLocation } from "react-router-dom";
import nieteLogo from "@/assets/niete-logo.png";
import { cn } from "@/lib/utils";
import { TEACHER_FRAME } from "./copy";
import { useCopy } from "./i18n";
import { teacherPath } from "./routes";
import { FeatureGlyph, type GlyphName } from "./icons";
import { COACH_MENU_PATHS, COACH_NAV_KEYS, currentCoachMenuItem, currentMenuItem, type CoachNavKey, type NavFeature } from "./menu";

/**
 * bd-fmf24g.1 — the teacher v2 menu (canvas v28): a white bottom bar on a phone with
 * Home, Lesson Plans, Digital Coaching, Training, More — single-line 11.5px labels, 64px
 * minimum width, 58px tall targets, the current item green. On a desktop the same
 * five items sit in a white bar at the top.
 *
 * Each item goes to the feature's v2 page once it is registered (routes.tsx) and to
 * today's page until then. Glyphs: the kit's D2 menu glyphs (teacher/icons).
 */

/** The kit's D2 menu glyphs (teacher/icons, bd-fmf24g.2): Digital Coaching is the phone. */
const NAV_ICONS: Record<NavFeature, GlyphName> = {
  home: "home",
  lessons: "lessons",
  coaching: "coaching",
  training: "training",
  more: "more",
};

/** The menu, in order; each item's word is C.nav[feature] in the page's language. */
const ITEMS: NavFeature[] = ["home", "lessons", "coaching", "training", "more"];

/** bd-4404s7.1 — the coach's items: her own words and glyphs (Observe is the observations glyph), the same still bar. */
const COACH_ICONS: Record<CoachNavKey, GlyphName> = {
  home: "home",
  schedule: "schedule",
  observe: "observations",
  schools: "schools",
  more: "more",
};

export type MenuRole = "teacher" | "coach";

/** `role` picks the items (default: the teacher's); the bar, the glyphs and the current-item rule are the same. */
const TeacherNavigation = ({ role = "teacher" }: { role?: MenuRole } = {}) => {
  const C = useCopy(TEACHER_FRAME);
  const { pathname } = useLocation();
  const items: { feature: string; label: string; to: string; glyph: GlyphName }[] = role === "coach"
    ? COACH_NAV_KEYS.map((k) => ({ feature: k, label: C.coachNav[k], to: COACH_MENU_PATHS[k], glyph: COACH_ICONS[k] }))
    : ITEMS.map((f) => ({ feature: f, label: C.nav[f], to: teacherPath(f), glyph: NAV_ICONS[f] }));
  const current: string | null = role === "coach" ? currentCoachMenuItem(pathname) : currentMenuItem(pathname);

  return (
    <>
      {/* Desktop: the same items in a white bar at the top. */}
      <nav aria-label={C.menu} data-testid="teacher-top-nav" className="hidden border-b border-[#e5e7eb] bg-white md:block">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <img src={nieteLogo} alt={C.logoAlt} className="h-8 w-8 rounded object-contain" />
            <span className="text-lg font-bold text-[#1d2025]">{C.brand}</span>
          </div>
          <div className="flex flex-1 items-center gap-1">
            {items.map(({ feature, label, to, glyph }) => {
              const on = current === feature;
              return (
                <Link
                  key={feature}
                  to={to}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex min-h-[56px] items-center gap-2 whitespace-nowrap rounded-xl px-3 text-[15px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]",
                    on ? "text-[#48b078]" : "text-[#6b7280] hover:text-[#1d2025]",
                  )}
                >
                  <FeatureGlyph name={glyph} size={20} className="shrink-0" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Phone: the white bottom bar. */}
      <nav
        aria-label={C.menu}
        data-testid="teacher-nav"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[#e5e7eb] bg-white px-1 pb-[calc(14px+env(safe-area-inset-bottom))] pt-1.5 md:hidden"
      >
        {items.map(({ feature, label, to, glyph }) => {
          const on = current === feature;
          return (
            <Link
              key={feature}
              to={to}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-[58px] min-w-[64px] flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl text-[11.5px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]",
                on ? "text-[#48b078]" : "text-[#6b7280]",
              )}
            >
              <FeatureGlyph name={glyph} size={24} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
};

export default TeacherNavigation;
