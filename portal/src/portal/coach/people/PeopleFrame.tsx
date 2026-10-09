import type { ComponentProps } from "react";
import CoachGate from "../CoachGate";
import { PendingBanner } from "../ui";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy } from "../../teacher/i18n";
import { PEOPLE } from "./copy";

/**
 * bd-4404s7.6 — the Schools and Teachers pages' frame: the coach gate, the kit's page frame (`TeacherPage`: back
 * circle, feature art card, wrapping title, header action, dock above the menu) and the pending-reports banner as
 * the first thing in the body, as on every coach page.
 */
export default function PeopleFrame({ children, ...page }: Omit<ComponentProps<typeof TeacherPage>, "children"> & { children: React.ReactNode }) {
  return (
    <CoachGate>
      <TeacherPage {...page}>
        <PendingBanner />
        {children}
      </TeacherPage>
    </CoachGate>
  );
}

/** "Could not load" with Try again, in her language (the coach's `Failed` is English only). */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const C = useCopy(PEOPLE);
  return (
    <section role="alert" className="flex items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <span className="min-w-0 flex-1 text-[15px] font-semibold">{C.loadFailed}</span>
      <button type="button" onClick={onRetry} className="min-h-[56px] shrink-0 rounded-xl bg-[#f3f4f6] px-4 text-sm font-semibold text-[#33374a]">{C.retry}</button>
    </section>
  );
}
