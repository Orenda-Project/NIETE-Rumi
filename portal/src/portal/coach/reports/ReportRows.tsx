import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Initials } from "../ui";
import { StatusChip, TimeStamp, type ChipData } from "../../teacher/ui";
import { CHEVRON, FOCUS, LIST_CARD, ROW_DIVIDER, ROW_SUB, ROW_TITLE } from "../../teacher/ui/styles";
import { useCopy } from "../../teacher/i18n";
import type { CoachReport } from "../types";
import { REPORTS, type ReportsCopy } from "./copy";
import { pkTime, stepIndex, type DayGroup } from "./data";

/**
 * bd-4404s7.5 — the rows of the Reports lists.
 *
 * INTERIM: the kit's HistoryRow has no coach lead yet (the kit agent is adding `lead="person"` and `time`); until
 * it lands these rows are the coach-local ones (ui.tsx's Initials) with the kit's TimeStamp and StatusChip. They
 * are drawn in one place, `ReportRow`, so the switch to HistoryList is a one-file change.
 *
 * Every report — portal or WhatsApp, waiting or sent — opens the one v2 observation page.
 */
export const reportHref = (r: Pick<CoachReport, "id">) => `/portal/coach/observation/${r.id}`;

/** The chip on a row: the score once there is one, else where the report is. */
export function reportChip(r: CoachReport, C: ReportsCopy): ChipData {
  if (r.step === "sent" && r.score != null) return { text: C.pct(r.score), tone: "score" };
  const text = C.chip[r.step] ?? C.chip.analysing;
  return { text, tone: r.step === "analysing" || r.step === "sent" ? "info" : "waiting" };
}

export function ReportRow({ r, first = true, line }: { r: CoachReport; first?: boolean; line?: "school" | "school-time" }) {
  const C = useCopy(REPORTS);
  const time = pkTime(r.createdAt);
  return (
    <Link to={reportHref(r)} data-history-row data-testid="report-row"
      className={cn("flex min-h-[76px] w-full items-center gap-3 px-3.5 py-2.5 text-start", !first && ROW_DIVIDER, FOCUS)}>
      <Initials name={r.teacherName} size={48} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className={cn(ROW_TITLE, "line-clamp-2")} dir="auto">{r.teacherName || C.dash}</span>
        <span className={cn(ROW_SUB, "flex min-w-0 flex-wrap items-center gap-x-1.5")}>
          {r.schoolName ? <span className="truncate" dir="auto">{r.schoolName}</span> : null}
          {line === "school-time" && time ? <TimeStamp time={time} size={13} /> : null}
        </span>
      </span>
      <StatusChip {...reportChip(r, C)} />
      <ChevronRight data-chevron className={cn("h-[22px] w-[22px]", CHEVRON)} strokeWidth={2.4} aria-hidden="true" />
    </Link>
  );
}

/** The four labelled segments under a waiting / in-progress card: done green, current amber, later grey. */
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
  return (
    <section data-testid="report-card"
      className={cn("overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]", waiting ? "border-2 border-[#f59e0b]" : "border border-[#e5e7eb]")}>
      <ReportRow r={r} line="school-time" />
      <ReportSegments step={r.step} />
    </section>
  );
}

/** Days of rows: a light day heading with its count, then one white card of rows. `dayName` is the screen's words. */
export function ReportDays({ groups, dayName, line = "school" }: { groups: DayGroup[]; dayName: (day: string) => string; line?: "school" | "school-time" }) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.day} className="flex flex-col gap-1.5" data-testid="report-day" data-day={g.day}>
          <h3 className="mx-1 mb-0 mt-2 flex items-center gap-2 text-[20px] font-light leading-[1.2]">
            <span>{dayName(g.day)}</span>
            <span data-testid="section-count" className="inline-flex shrink-0 items-center rounded-full bg-[#e5e7eb] px-2 text-[12px] font-semibold text-[#374151]">{g.items.length}</span>
          </h3>
          <div className={LIST_CARD}>
            {g.items.map((r, i) => <ReportRow key={r.id} r={r} first={i === 0} line={line} />)}
          </div>
        </div>
      ))}
    </>
  );
}
