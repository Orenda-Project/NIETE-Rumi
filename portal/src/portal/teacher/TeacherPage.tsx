import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import PortalLayout from "../components/PortalLayout";
import { TEACHER_COPY as C } from "./copy";

/**
 * bd-fmf24g.1 — the teacher v2 page frame (canvas v28), for every teacher v2 page.
 *
 *   top-level page   a 32px light title (Home's greeting, "More"), optional chips under it
 *   inner page       a 56px back target around a 40px white circle, a 13px crumb and a
 *                    26px light title (`backTo`, or `onBack` when Back must ask first)
 *
 * Grey page (#f3f4f6), one phone-width column (max-w-xl) on a desktop too. The bottom
 * menu comes from PortalLayout (PortalNavigation → TeacherNavigation for a flagged
 * teacher); `bare` hides it on a screen where one stray tap must not leave (recording).
 * The flag gate is App.tsx's (every registered route is wrapped in TeacherGate).
 */
export default function TeacherPage({
  title, crumb, backTo, onBack, chips, action, dock, bare = false, testId, children,
}: {
  title: ReactNode;
  crumb?: ReactNode;
  backTo?: string;
  onBack?: () => void;
  chips?: ReactNode;
  /** A control at the right of an inner page's header. */
  action?: ReactNode;
  /** The page's bottom action(s), kept above the menu. */
  dock?: ReactNode;
  bare?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const circle = (
    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#33374a]">
      <ChevronLeft className="h-[22px] w-[22px] rtl:rotate-180" aria-hidden="true" />
    </span>
  );
  const inner = !!(backTo || onBack);
  return (
    <PortalLayout bare={bare}>
      <div data-testid={testId} className="mx-auto flex w-full max-w-xl flex-col text-[#1d2025]">
        {inner ? (
          <header className="flex items-center gap-1 pb-1.5 pt-2">
            {onBack
              ? <button type="button" onClick={onBack} aria-label={C.back} className="flex h-14 w-14 shrink-0 items-center justify-center">{circle}</button>
              : <Link to={backTo as string} aria-label={C.back} className="flex h-14 w-14 shrink-0 items-center justify-center">{circle}</Link>}
            <div className="min-w-0 flex-1">
              {crumb && <div className="truncate text-[13px] font-medium text-[#6b7280]">{crumb}</div>}
              <h1 className="truncate text-[26px] font-light leading-tight tracking-[-0.01em]">{title}</h1>
            </div>
            {action}
          </header>
        ) : (
          <header className="flex flex-col gap-3 px-1 pb-1.5 pt-6">
            <h1 className="break-words text-[32px] font-light leading-[1.15] tracking-[-0.015em]">{title}</h1>
            {chips && <div className="flex flex-wrap gap-2">{chips}</div>}
          </header>
        )}
        {inner && chips && <div className="flex flex-wrap gap-2 px-1 pb-2">{chips}</div>}
        <div className="flex flex-col gap-2.5 pb-4 pt-3">{children}</div>
        {dock && (
          <div className="sticky bottom-[calc(88px+env(safe-area-inset-bottom))] z-10 -mx-4 flex gap-2.5 bg-[#f3f4f6]/95 px-4 pb-2 pt-3 md:bottom-4 md:mx-0 md:px-0">
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
