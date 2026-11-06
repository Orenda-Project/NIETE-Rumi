import { Link } from "react-router-dom";
import { ChevronRight, Crosshair, Lock } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { WHERE } from "./whereCopy";

/**
 * The door to a coach-only page (bd-17v39c.4.14): "Where to coach →" on her Teacher page, "Who to coach first" on the
 * School card. A tappable row with a chevron, and "Only you see this" under its name: what it opens is never shared.
 */
export function WhereDoor({ to, label, testId, state }: { to: string; label: string; testId: string; state?: unknown }) {
  const W = useCopy(WHERE);
  return (
    <Link to={to} state={state} data-testid={testId}
      className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-2.5 text-[#1d2025] shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f4f5f8] text-[#33374a]">
        <Crosshair className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]">{label}</b>
        <small className="flex items-center gap-1 text-[13px] font-semibold text-[#6b7280]">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />{W.onlyYou}
        </small>
      </span>
      <ChevronRight className="h-[22px] w-[22px] shrink-0 text-[#9ca3af] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
    </Link>
  );
}
