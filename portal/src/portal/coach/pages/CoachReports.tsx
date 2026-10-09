import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { coach } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { LESSONS } from "../../teacher/lessons/copy";
import { dayName, pkToday } from "../../teacher/lessons/days";
import { LoadState } from "../../teacher/lessons/LoadState";
import { dataOf, useLoad } from "../../newui/lessons/shared";
import { FOCUS, OUTLINE_WIDE } from "../../teacher/ui/styles";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { SectionLabel } from "../ui";
import ReportsFrame from "../reports/ReportsFrame";
import { ReportCard, ReportDays } from "../reports/ReportRows";
import { REPORTS } from "../reports/copy";
import { dayGroups } from "../reports/data";

/**
 * bd-o15qnr / bd-4404s7.5 — Reports, the teacher's pattern (Blueprint Coach_ReportsB):
 *
 *   Waiting for you   the observations at the Feedback Form or Debrief, each with its four labelled segments
 *   In progress       still being analysed
 *   Recent            her last few by day, collapsible, with See all, which opens the All page (a date range, the
 *                     numbers, and the search)
 *
 * Every card and row opens the v2 observation page. `?show=waiting` (the pending banner's "more than one") shows
 * only Waiting for you, with a way back to all of Reports.
 */

/** How many observations Recent shows before See all. */
const RECENT_COUNT = 5;
const ALL_PATH = "/portal/coach/reports/all";

const CoachReports = () => {
  const C = useCopy(REPORTS);
  const kit = useKitCopy();
  const { days } = useCopy(LESSONS);
  const [params] = useSearchParams();
  const waitingOnly = params.get("show") === "waiting";
  const [open, setOpen] = useState(true);
  const [load, retry] = useLoad(() => coach.getReports({ page: 1 }), "coach:reports:recent");
  const data = dataOf(load);

  const recent = useMemo(() => dayGroups((data?.all.items ?? []).slice(0, RECENT_COUNT)), [data]);
  const total = Math.min(RECENT_COUNT, data?.all.items.length ?? 0);
  const today = pkToday();

  return (
    <ReportsFrame title={C.title} crumb={C.observe} backTo="/portal/coach/observe" testId="coach-reports">
      <LoadState status={load.status} empty={false} onRetry={retry} />
      {data && (
        <>
          <div className="flex flex-col gap-2.5" data-testid="reports-waiting">
            <SectionLabel countStyle="count" count={data.waiting.length} countTone={data.waiting.length ? "warn" : "info"}>{C.waitingForYou}</SectionLabel>
            {data.waiting.map((r) => <ReportCard key={r.id} r={r} waiting />)}
          </div>

          {waitingOnly ? (
            <Link to="/portal/coach/reports" className={cn(OUTLINE_WIDE, FOCUS)}>{C.allReports}</Link>
          ) : (
            <>
              <div className="flex flex-col gap-2.5" data-testid="reports-in-progress">
                <SectionLabel countStyle="count" count={data.inProgress.length}>{C.inProgress}</SectionLabel>
                {data.inProgress.map((r) => <ReportCard key={r.id} r={r} />)}
              </div>

              <div className="flex flex-col gap-2.5" data-testid="reports-recent">
                <div className="mt-1.5 flex items-center gap-1">
                  <h2 className="m-0 min-w-0 flex-1">
                    <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                      className={cn("flex min-h-[56px] w-full min-w-0 items-center gap-2 px-1 text-start", FOCUS)}>
                      <span className="min-w-0 text-[22px] font-semibold leading-[1.2]">{C.recent}</span>
                      {total > 0 && <span className="inline-flex h-[26px] shrink-0 items-center rounded-full bg-[#e5e7eb] px-2.5 text-[12px] font-semibold text-[#374151]">{total}</span>}
                      <ChevronDown className={cn("h-[22px] w-[22px] shrink-0 text-[#33374a]", open && "rotate-180")} strokeWidth={2.6} aria-hidden="true" />
                    </button>
                  </h2>
                  <Link to={ALL_PATH} data-testid="see-all"
                    className={cn("flex min-h-[56px] min-w-[56px] shrink-0 items-center justify-end gap-0.5 whitespace-nowrap pe-0.5 ps-2.5 text-[16px] font-bold text-[#33374a]", FOCUS)}>
                    {kit.seeAll}
                    <ChevronRight className="h-[18px] w-[18px] rtl:rotate-180" strokeWidth={2.6} aria-hidden="true" />
                  </Link>
                </div>
                {open && (recent.length === 0
                  ? <p data-empty className="rounded-2xl border border-dashed border-[#d1d5db] bg-white px-4 py-6 text-center text-[16px] font-semibold text-[#6b7280]">{C.noObservations}</p>
                  : <ReportDays groups={recent} dayName={(d) => dayName(d, today, days)} line="school-time" />)}
              </div>
            </>
          )}
        </>
      )}
    </ReportsFrame>
  );
};

export default CoachReports;
