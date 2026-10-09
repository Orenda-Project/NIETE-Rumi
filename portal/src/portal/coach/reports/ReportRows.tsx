import { cn } from "@/lib/utils";
import { HistoryRow, type ChipData, type HistoryGroup, type HistoryItem } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import type { CoachReport } from "../types";
import { REPORTS, type ReportsCopy } from "./copy";
import { pkTime, stepIndex, type DayGroup } from "./data";

/**
 * bd-4404s7.5 — the Reports lists, on the kit's coach rows (HistoryRow lead="person": the round 48px avatar, the
 * time on the first line). Every report — portal or WhatsApp, waiting or sent — opens the one v2 observation page.
 */
export const reportHref = (r: Pick<CoachReport, "id">) => `/portal/coach/observation/${r.id}`;

/** The chip on a row: the score once there is one, else where the report is. */
export function reportChip(r: CoachReport, C: ReportsCopy): ChipData {
  if (r.step === "sent" && r.score != null) return { text: C.pct(r.score), tone: "score" };
  const text = C.chip[r.step] ?? C.chip.analysing;
  return { text, tone: r.step === "analysing" || r.step === "sent" ? "info" : "waiting" };
}

/** One report as a HistoryRow's props (the school on line 2, the time above the name). */
export function reportItem(r: CoachReport, C: ReportsCopy): HistoryItem {
  return {
    id: r.id,
    lead: "person",
    title: r.teacherName || C.dash,
    extra: r.schoolName || undefined,
    time: pkTime(r.createdAt),
    chip: reportChip(r, C),
    to: reportHref(r),
  };
}

/** The day groups HistoryList takes: `dayName` is the screen's words ("Today", "Mon 5 Oct"). */
export function reportGroups(groups: DayGroup[], dayName: (day: string) => string, C: ReportsCopy): HistoryGroup[] {
  return groups.map((g) => ({ day: dayName(g.day), items: g.items.map((r) => reportItem(r, C)) }));
}

/**
 * The four labelled segments under a waiting / in-progress card: done green, current amber, later grey.
 * INTERIM: the kit's StepBar (PR 2b) draws these; this is replaced by it.
 */
export function ReportSegments({ step }: { step: string }) {
  const C = useCopy(REPORTS);
  const at = stepIndex(step);
  return (
    <span className="grid grid-cols-4 gap-1.5 px-3.5 pb-3" aria-hidden="true" data-testid="report-segments">
      {C.segments.map((label, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <span key={label} className="flex flex-col gap-1">
            <i className="block h-1.5 rounded-full" style={{ background: done ? "#48b078" : current ? "#f59e0b" : "#e5e7eb" }} />
            <span className="text-[11px] font-semibold" style={{ color: done ? "#2f7a52" : current ? "#b45309" : "#9ca3af" }}>
              {current && step === "analysing" ? C.analysing : label}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** One report that needs her, or is being analysed: the row and its segments in one card (amber edge when it waits on her). */
export function ReportCard({ r, waiting = false }: { r: CoachReport; waiting?: boolean }) {
  const C = useCopy(REPORTS);
  const { id, ...row } = reportItem(r, C);
  return (
    <section data-testid="report-card" data-report={id}
      className={cn("overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]", waiting ? "border-2 border-[#f59e0b]" : "border border-[#e5e7eb]")}>
      <HistoryRow {...row} first />
      <ReportSegments step={r.step} />
    </section>
  );
}
