import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { coach } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { LESSONS } from "../../teacher/lessons/copy";
import { dayName, pkToday } from "../../teacher/lessons/days";
import { LoadState } from "../../teacher/lessons/LoadState";
import { dataOf, useLoad } from "../../newui/lessons/shared";
import { FOCUS, OUTLINE_WIDE } from "../../teacher/ui/styles";
import { HistoryList } from "../../teacher/ui";
import { SectionLabel } from "../ui";
import ReportsFrame from "../reports/ReportsFrame";
import { ReportCard, reportGroups } from "../reports/ReportRows";
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
  const { days } = useCopy(LESSONS);
  const [params] = useSearchParams();
  const waitingOnly = params.get("show") === "waiting";
  const [load, retry] = useLoad(() => coach.getReports({ page: 1 }), "coach:reports:recent");
  const data = dataOf(load);

  const today = pkToday();
  const groups = useMemo(
    () => reportGroups(dayGroups((data?.all.items ?? []).slice(0, RECENT_COUNT)), (d) => dayName(d, today, days), C),
    [data, days, C, today],
  );

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

              <div data-testid="reports-recent">
                <HistoryList heading={C.recent} collapsible defaultOpen groups={groups} showMore={false} seeAllTo={ALL_PATH} emptyLabel={C.noObservations} />
              </div>
            </>
          )}
        </>
      )}
    </ReportsFrame>
  );
};

export default CoachReports;
