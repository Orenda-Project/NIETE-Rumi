import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * bd-4404s7.5 — one labelled line of the Debrief guide, her feedback and the report preview (Blueprint `.gi`): a round
 * 36px icon in the line's tone, a bold label, and its words. The tone is the line's meaning (green went well, amber
 * to grow, violet the one action, blue the question), never decoration.
 *
 * Candidate for the kit (coach + teacher reports): used on three coach screens; held here until the kit agent decides.
 */
export type InsightTone = "good" | "grow" | "action" | "ask";

const TONE: Record<InsightTone, string> = {
  good: "bg-[#eaf6ef] text-[#2f7a52]",
  grow: "bg-[#fef3c7] text-[#b45309]",
  action: "bg-[#eeeafd] text-[#6e52e0]",
  ask: "bg-[#e3eefc] text-[#1d6fd8]",
};

export function InsightRow({ tone, icon, label, children, className }: { tone: InsightTone; icon: ReactNode; label: string; children?: ReactNode; className?: string }) {
  return (
    <div data-insight={tone} className={cn("flex items-start gap-3", className)}>
      <span aria-hidden="true" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", TONE[tone])}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
        <b className="text-[16px] font-semibold leading-[1.3]">{label}</b>
        {children ? <span className="text-[15px] leading-[1.45] text-[#374151]" dir="auto">{children}</span> : null}
      </span>
    </div>
  );
}
