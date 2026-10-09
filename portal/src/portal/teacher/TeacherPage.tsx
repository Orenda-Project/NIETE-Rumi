import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import PortalLayout from "../components/PortalLayout";
import { TEACHER_FRAME } from "./copy";
import { useCopy } from "./i18n";
import { FeatureArt, type AnyFeature } from "./icons";

/**
 * bd-fmf24g.1 — the teacher v2 page frame (canvas v28), for every teacher v2 page.
 *
 *   top-level page   a 32px light title (Home's greeting, "More"), optional chips under it
 *   inner page       a 56px back target around a 40px white circle, a 13px crumb and a
 *                    26px light title (`backTo`, or `onBack` when Back must ask first)
 *   `feature`        the page's feature tile beside the title: its D2 illustration at 40px inside
 *                    a 52px white card (radius 14, 1px #e5e7eb border), the Blueprint's ScreenHeader
 *                    tile="card" (bd-fmf24g.23)
 *
 * Titles and crumbs WRAP — a long lesson-plan title shows in full, never cut to one line.
 *
 * Grey page (#f3f4f6), one phone-width column (max-w-xl) on a desktop too. The bottom
 * menu comes from PortalLayout (PortalNavigation → TeacherNavigation for a flagged
 * teacher); `bare` hides it on a screen where one stray tap must not leave (recording).
 * The flag gate is App.tsx's (every registered route is wrapped in TeacherGate).
 */
export default function TeacherPage({
  title, hero, crumb, backTo, onBack, feature, chips, action, dock, bare = false, testId, children,
}: {
  /** Not needed when `hero` draws the heading. */
  title?: ReactNode;
  /** bd-fmf24g.22 — a top-level page's own heading block (Home's NIETE band) instead of the plain title + chips. Full-bleed on a phone. */
  hero?: ReactNode;
  /** The page's feature: its illustration sits beside the title. */
  feature?: AnyFeature;
  crumb?: ReactNode;
  backTo?: string;
  onBack?: () => void;
  chips?: ReactNode;
  /** A control at the end of the header (right in English, left in Urdu), inner or top-level: a coach's "New visit", an Edit. */
  action?: ReactNode;
  /** The page's bottom action(s), kept above the menu. */
  dock?: ReactNode;
  bare?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const C = useCopy(TEACHER_FRAME);
  const circle = (
    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#33374a]">
      <ChevronLeft className="h-[22px] w-[22px] rtl:rotate-180" aria-hidden="true" />
    </span>
  );
  const inner = !!(backTo || onBack);
  const tile = feature ? (
    <span data-testid="page-feature-tile" className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] border border-[#e5e7eb] bg-white">
      <FeatureArt feature={feature} size={40} />
    </span>
  ) : null;
  return (
    <PortalLayout bare={bare}>
      <div data-testid={testId} className="mx-auto flex w-full max-w-xl flex-col text-[#1d2025]">
        {inner ? (
          <header className="flex items-start gap-1 pb-1.5 pt-2">
            {onBack
              ? <button type="button" onClick={onBack} aria-label={C.back} className="flex h-14 w-14 shrink-0 items-center justify-center">{circle}</button>
              : <Link to={backTo as string} aria-label={C.back} className="flex h-14 w-14 shrink-0 items-center justify-center">{circle}</Link>}
            {tile}
            <div className={tile ? "ms-2 min-w-0 flex-1" : "min-w-0 flex-1"}>
              {crumb && <div data-testid="page-crumb" className="break-words text-[13px] font-medium leading-snug text-[#6b7280] [overflow-wrap:anywhere]">{crumb}</div>}
              <h1 className="break-words text-[26px] font-light leading-tight tracking-[-0.01em] [overflow-wrap:anywhere]">{title}</h1>
            </div>
            {action}
          </header>
        ) : hero ? (
          <div data-testid="page-hero" className="-mx-4 -mt-4 min-[576px]:mx-0 min-[576px]:mt-0 min-[576px]:overflow-hidden min-[576px]:rounded-[28px]">{hero}</div>
        ) : (
          <header className="flex flex-col gap-3 px-1 pb-1.5 pt-6">
            <div className="flex items-center gap-3">
              {tile}
              <h1 className="min-w-0 flex-1 break-words text-[32px] font-light leading-[1.15] tracking-[-0.015em] [overflow-wrap:anywhere]">{title}</h1>
              {action}
            </div>
            {chips && <div className="flex flex-wrap gap-2">{chips}</div>}
          </header>
        )}
        {inner && chips && <div className="flex flex-wrap gap-2 px-1 pb-2">{chips}</div>}
        <div className="flex flex-col gap-2.5 pb-4 pt-3">{children}</div>
        {dock && (
          // `bare`: no menu under the dock (a recording), so it stands at the bottom edge, not 88px up.
          <div className={`sticky ${bare ? 'bottom-[calc(8px+env(safe-area-inset-bottom))]' : 'bottom-[calc(88px+var(--notice-h,0px)+env(safe-area-inset-bottom))]'} z-10 -mx-4 flex gap-2.5 bg-[#f3f4f6]/95 px-4 pb-2 pt-3 md:bottom-4 md:mx-0 md:px-0`}>
            {dock}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

/** A flat information chip under a page title (the date, her school). Never a button. */
export function PageChip({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 text-[13px] font-semibold text-[#4b5563]">
      {children}
    </span>
  );
}
