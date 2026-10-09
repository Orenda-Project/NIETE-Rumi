import { useMemo, useState } from "react";
import { DateRangeBar, HistoryList, KpiTiles, type KpiItem } from "../../teacher/ui";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { resolveRange } from "../../teacher/ui/range";
import { DEFAULT_RANGE, pkToday, type DateRange } from "../../newui/range";
import { useCopy } from "../../teacher/i18n";
import { LESSONS } from "../../teacher/lessons/copy";
import { dayName } from "../../teacher/lessons/days";
import { SearchBox } from "../ui";
import { LoadState } from "../../teacher/lessons/LoadState";
import ReportsFrame from "./ReportsFrame";
import { reportGroups } from "./ReportRows";
import { REPORTS } from "./copy";
import { dayGroups, inSpan, kpiNumbers } from "./data";
import { useAllReports } from "./useAllReports";

/**
 * bd-4404s7.5 — All Observations (Blueprint Coach_ReportsAll), from Recent Observations' See all:
 *
 *   DateRangeBar  This month by default; the numbers compare with the same stretch one step back
 *   search        kept here, under the range: narrowing a month of observations to one of ~84 teachers by buttons is
 *                 the "a little complex" case (COACH.md §0)
 *   KpiTiles      Observations, Avg. HITL Score (a percentage), Waiting for you, Sent: each counted from the
 *                 reports the server returned, none invented
 *   the list      every observation in the range by Pakistan day
 */
export default function CoachReportsAll() {
  const C = useCopy(REPORTS);
  const { days } = useCopy(LESSONS);
  const kit = useKitCopy();
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const [q, setQ] = useState("");

  const span = useMemo(() => resolveRange(range, pkToday(), kit.months), [range, kit]);
  const compareLabel = span.prevSpan ? kit.compareWith(span.prevSpan) : "";
  const data = useAllReports(q, span);

  const rows = useMemo(() => data.items.filter((r) => inSpan(r, span.from, span.to)), [data.items, span]);
  const today = pkToday();
  const groups = useMemo(() => reportGroups(dayGroups(rows), (d) => dayName(d, today, days), C), [rows, days, C, today]);
  const kpi = useMemo(() => kpiNumbers(data.items, span, data.waiting), [data.items, span, data.waiting]);

  const items: KpiItem[] = [
    { value: kpi.observations.value, label: C.kpiObservations, delta: kpi.observations.delta },
    { value: kpi.avg.value == null ? null : C.pct(kpi.avg.value), label: C.kpiAvg, delta: kpi.avg.delta },
    { value: kpi.waiting.value, label: C.kpiWaiting },
    { value: kpi.sent.value, label: C.kpiSent, delta: kpi.sent.delta },
  ];

  return (
    <ReportsFrame title={C.allTitle} crumb={C.title} backTo="/portal/coach/reports" testId="reports-all">
      <DateRangeBar value={range} onChange={(r) => setRange(r)} />
      <SearchBox value={q} onChange={setQ} placeholder={C.searchPlaceholder} />
      <LoadState status={data.status === "failed" ? "error" : data.status === "loading" && data.items.length === 0 ? "loading" : "ok"} empty={false} onRetry={data.retry} />
      {data.status !== "failed" && (data.status === "ready" || data.items.length > 0) && (
        <>
          <KpiTiles items={items} compareLabel={compareLabel} />
          <HistoryList heading="" groups={groups} showMore={false} emptyLabel={C.noneInRange} />
        </>
      )}
    </ReportsFrame>
  );
}
