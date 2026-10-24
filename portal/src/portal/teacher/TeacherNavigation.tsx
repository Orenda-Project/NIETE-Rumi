import { useContext } from "react";
import { Link, useLocation } from "react-router-dom";
import nieteLogo from "@/assets/niete-logo.png";
import { cn } from "@/lib/utils";
import { TEACHER_FRAME } from "./copy";
import { useCopy } from "./i18n";
import { teacherPath } from "./routes";
import { FeatureGlyph, type GlyphName } from "./icons";
import { AuthContext } from "../hooks/authContext";
import { useHomeLook } from "./home/useHomeData";
import { LOOK_ICONS } from "./home/look/lookIcons";
import { COACH_MENU_PATHS, COACH_NAV_KEYS, coachNavKeysFor, currentCoachMenuItem, currentMenuItem, type CoachNavKey, type NavFeature } from "./menu";

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
  training: "training",
  lessons: "lessons",
  more: "more",
};

export type MenuRole = "teacher" | "coach";

/**
 * The phone item under the Home look (portal_teacher_home_look): a label may wrap at its spaces (a word splits only when
 * it cannot fit a line of its own), 11px on a 1.15 line (Urdu on 1.5, so two lines stay short), at least 56px tall.
 */
const LOOK_ITEM =
  "flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 min-h-[56px] rounded-xl text-[11px] leading-[1.15] rtl:!leading-[1.5] font-medium text-center whitespace-normal [overflow-wrap:anywhere] hyphens-auto outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]";

/** `ready` (coach only): the features that are ready, others are left out (bd-s42dye.2). `role` picks the items (default: the teacher's); the bar, the glyphs and the current-item rule are the same. */
const TeacherNavigation = ({ role = "teacher", ready }: { role?: MenuRole; ready?: readonly string[] } = {}) => {
  const C = useCopy(TEACHER_FRAME);
  const { pathname } = useLocation();
  const items: { feature: string; label: string; to: string; glyph: GlyphName }[] = role === "coach"
    ? (ready ? coachNavKeysFor(ready) : COACH_NAV_KEYS).map((k) => ({ feature: k, label: C.coachNav[k], to: COACH_MENU_PATHS[k], glyph: COACH_ICONS[k] }))
    : ITEMS.map((f) => ({ feature: f, label: C.nav[f], to: teacherPath(f), glyph: NAV_ICONS[f] }));
  const current: string | null = role === "coach" ? currentCoachMenuItem(pathname) : currentMenuItem(pathname);
  // The Home look reaches the teacher's phone bar only; a coach's menu never reads it (nothing is asked, always off).
  const userKey = useContext(AuthContext)?.user?.phoneNumber;
  const look = useHomeLook(role === "teacher" ? userKey : null, role === "teacher");

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
        className={look
          // Under the look the bar has no side padding, so each of the five items is a full fifth (64px at 320).
          ? "fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[#e5e7eb] bg-white px-0 pb-[calc(14px+env(safe-area-inset-bottom))] pt-1.5 md:hidden"
          : "fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[#e5e7eb] bg-white px-1 pb-[calc(14px+env(safe-area-inset-bottom))] pt-1.5 md:hidden"}
      >
        {items.map(({ feature, label, to, glyph }) => {
          const on = current === feature;
          if (look) {
            // The look: the current item is a green pill with a green glyph and an ink bold label; the others muted.
            const Icon = LOOK_ICONS[feature as NavFeature];
            return (
              <Link
                key={feature}
                to={to}
                aria-current={on ? "page" : undefined}
                className={cn(LOOK_ITEM, on ? "text-[#333748] font-bold" : "text-[#636878]")}
              >
                <span data-look-pill aria-hidden="true" className={cn("flex h-7 w-[52px] items-center justify-center rounded-full", on && "bg-[#e7f5ed] text-[#2e7d57]")}>
                  <Icon size={22} data-look-glyph={feature} />
                </span>
                {/* index.css gives every Urdu element line-height 2, so the label carries its own 1.5 (inherited from the item it would never land). */}
                <span className="max-w-full rtl:!leading-[1.5]">{label}</span>
              </Link>
            );
          }
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
