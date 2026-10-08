import type { ComponentType, SVGProps } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, GraduationCap, Home, MoreHorizontal, Smartphone } from "lucide-react";
import nieteLogo from "@/assets/niete-logo.png";
import { cn } from "@/lib/utils";
import { TEACHER_COPY as C } from "./copy";
import { teacherPath } from "./routes";
import { currentMenuItem, type NavFeature } from "./menu";

/**
 * bd-fmf24g.1 — the teacher v2 menu (canvas v28): a white bottom bar on a phone with
 * Home, Lessons, Digital Coaching, Training, More — single-line 11.5px labels, 64px
 * minimum width, 58px tall targets, the current item green. On a desktop the same
 * five items sit in a white bar at the top.
 *
 * Each item goes to the feature's v2 page once it is registered (routes.tsx) and to
 * today's page until then. The glyphs are stand-ins until the kit's D2 menu glyphs
 * (teacher/icons, bd-fmf24g.2) land; swap them in NAV_ICONS only.
 */

type Glyph = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

const NAV_ICONS: Record<NavFeature, Glyph> = {
  home: Home,
  lessons: BookOpen,
  coaching: Smartphone,
  training: GraduationCap,
  more: MoreHorizontal,
};

const ITEMS: { feature: NavFeature; label: string }[] = [
  { feature: "home", label: C.nav.home },
  { feature: "lessons", label: C.nav.lessons },
  { feature: "coaching", label: C.nav.coaching },
  { feature: "training", label: C.nav.training },
  { feature: "more", label: C.nav.more },
];

const TeacherNavigation = () => {
  const { pathname } = useLocation();
  const current = currentMenuItem(pathname);

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
            {ITEMS.map(({ feature, label }) => {
              const Icon = NAV_ICONS[feature];
              const on = current === feature;
              return (
                <Link
                  key={feature}
                  to={teacherPath(feature)}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex min-h-[56px] items-center gap-2 whitespace-nowrap rounded-xl px-3 text-[15px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]",
                    on ? "text-[#48b078]" : "text-[#6b7280] hover:text-[#1d2025]",
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
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
        {ITEMS.map(({ feature, label }) => {
          const Icon = NAV_ICONS[feature];
          const on = current === feature;
          return (
            <Link
              key={feature}
              to={teacherPath(feature)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-[58px] min-w-[64px] flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl text-[11.5px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]",
                on ? "text-[#48b078]" : "text-[#6b7280]",
              )}
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
};

export default TeacherNavigation;
