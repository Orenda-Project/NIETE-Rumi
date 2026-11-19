import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Clock, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { coach } from "../../services/api";
import { useCopy, useLang } from "../../teacher/i18n";
import { HistoryRow } from "../../teacher/ui";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { todayLabel } from "../../teacher/format";
import { Chevron, Failed, Loading, SectionLabel, useLoad } from "../ui";
import { karachiDay } from "../time";
import type { CoachReport, CoachVisit } from "../types";
import ObservePage from "../observe/ObservePage";
import { OBSERVE } from "../observe/copy";
import { SCHEDULE } from "../schedule/copy";
import { recordPath } from "../schedule/VisitCard";
import { REPORTS } from "../reports/copy";
import { reportChip, reportHref } from "../reports/ReportRows";
import { trackFlow } from "../flow/track";

/**
 * bd-o15qnr.26 (queue #177, rebuilt to #188's Concept 1 "Today and Needs you"; the operator 19 Nov ~19:45: "right now the
 * main thing is the coach app redesign") — the coach's ONE Observe screen, behind portal_coach_flow_v2. One phone screen
 * tall, in the order a coach works (#188's facts: 92% of visits are booked the same day; 3-6 observations wait on each):
 *
 *   Start an observation   the big button: New visit in book-now mode (school, teacher, then record; no day and time)
 *   Booked for today       today's visits still to do, each with Record (one tap to its record step)
 *   Needs you              observations waiting on her, OLDEST first: three, then See all N (Reports' waiting list)
 *   two rows               Booked visits (late, today, ahead; its late count) and History (her observations; how many)
 *
 * It asks for today only (the server adds every late visit) and the first reports page: light on a slow link. The way
 * back to WhatsApp (#166) is on top, as on every Observe screen (ObservePage).
 */

const NEEDS_SHOWN = 3;

/** Whole days between two Pakistan days (YYYY-MM-DD). */
function dayDiff(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000));
}

const ROW_LINK = cn("flex min-h-[60px] items-center gap-3 px-4 text-[16px] font-semibold", FOCUS);

const CoachObserveToday = () => {
  const S = useCopy(SCHEDULE);
  const O = useCopy(OBSERVE);
  const R = useCopy(REPORTS);
  const lang = useLang();
  const today = karachiDay();
  const schedule = useLoad(() => coach.getSchedule({ from: today, to: today }), [today]);
  const reports = useLoad(() => coach.getReports({ page: 1 }), []);

  const todays = useMemo(() => (schedule.data?.visits || [])
    .filter((v) => v.scheduledFor === today && v.status === "upcoming")
    .sort((a, b) => ((a.scheduledSlot || "~") < (b.scheduledSlot || "~") ? -1 : 1)), [schedule.data, today]);
  const late = useMemo(() => {
    const seen = new Set<string>();
    return (schedule.data?.overdue || []).filter((v) => !seen.has(v.id) && seen.add(v.id) && (v.scheduledFor || "") < today).length;
  }, [schedule.data, today]);
  const waiting = useMemo(() => [...(reports.data?.waiting || [])]
    .sort((a, b) => ((a.createdAt || "") < (b.createdAt || "") ? -1 : 1)), [reports.data]);

  const waitedDays = (r: CoachReport) => (r.createdAt ? dayDiff(karachiDay(new Date(r.createdAt)), today) : 0);

  return (
    <ObservePage title={O.observe} crumb={todayLabel(new Date(), lang)} backTo="/portal/coach" feature="observations">
      <div data-testid="observe-today" className="flex flex-col gap-3">
        {/* Start an observation, with today's booked teachers one tap away */}
        <section className={cn(LIST_CARD, "flex flex-col")}>
          <div className="flex flex-col gap-2 p-3">
            <Link to="/portal/coach/new-visit?now=1" onClick={() => trackFlow("observe.start")}
              className={cn("flex min-h-[64px] items-center justify-center gap-3 rounded-2xl bg-[#33374a] px-4 py-2 text-[18px] font-semibold leading-tight text-white rtl:leading-[1.8]", FOCUS)}>
              <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full bg-[#ff4d3d] shadow-[0_0_0_4px_rgba(255,77,61,0.25)]" />
              {S.startObservation}
            </Link>
            <p className="m-0 text-center text-[14px] text-[#6b7280]">{S.startSub}</p>
          </div>
          {todays.length > 0 && (
            <div data-testid="booked-today" className="border-t border-[#e5e7eb]">
              <h2 className="m-0 px-4 pb-1 pt-2.5 text-[13px] font-bold uppercase tracking-wide text-[#6b7280]">{S.bookedToday}</h2>
              {todays.map((v: CoachVisit) => (
                <div key={v.id} className="flex items-center gap-2 border-t border-[#f3f4f6] pe-3">
                  <div className="min-w-0 flex-1">
                    <HistoryRow lead="person" title={v.teacherName || S.dash} extra={v.schoolName || undefined} time={v.scheduledSlot} action="none" />
                  </div>
                  <Link to={recordPath(v.id)} onClick={() => trackFlow("schedule.start")}
                    className={cn("flex min-h-[48px] shrink-0 items-center gap-2 rounded-xl bg-[#33374a] px-3.5 text-[15px] font-semibold text-white", FOCUS)}>
                    <span aria-hidden="true" className="h-3 w-3 rounded-full bg-[#ff4d3d]" />{S.record}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
        {schedule.failed && <Failed onRetry={schedule.reload} />}

        {/* Needs you: oldest first */}
        <section data-testid="needs-you" className="flex flex-col gap-2">
          <SectionLabel count={reports.data ? waiting.length : undefined} countTone={waiting.length ? "warn" : "info"}>{S.needsYou}</SectionLabel>
          {reports.failed && <Failed onRetry={reports.reload} />}
          {!reports.data && !reports.failed && <Loading />}
          {reports.data && waiting.length === 0 && (
            <div className={cn(LIST_CARD, "flex min-h-[64px] items-center gap-3 px-4 text-[15px] font-semibold text-[#6b7280]")}>
              <Inbox className="h-5 w-5 shrink-0" aria-hidden="true" />{S.nothingWaiting}
            </div>
          )}
          {waiting.length > 0 && (
            <div className={LIST_CARD}>
              {waiting.slice(0, NEEDS_SHOWN).map((r, i) => (
                <HistoryRow key={r.id} lead="person" first={i === 0} title={r.teacherName || S.dash}
                  extra={S.waitingSince(waitedDays(r))} chip={reportChip(r, R)} to={reportHref(r)} />
              ))}
              {waiting.length > NEEDS_SHOWN && (
                <Link to="/portal/coach/reports?show=waiting" className={cn("flex min-h-[56px] items-center justify-center gap-1 border-t border-[#e5e7eb] text-[15px] font-semibold text-[#33374a]", FOCUS)}>
                  {S.seeAllN(waiting.length)}<Chevron />
                </Link>
              )}
            </div>
          )}
        </section>

        {/* Booked visits and History */}
        <nav aria-label={O.observe} className={LIST_CARD}>
          <Link to="/portal/coach/schedule" className={ROW_LINK}>
            <CalendarDays className="h-5 w-5 shrink-0 text-[#be185d]" aria-hidden="true" />
            <span className="flex-1">{S.bookedVisits}</span>
            {late > 0 && <StatusChip text={S.lateN(late)} tone="waiting" />}
            <Chevron />
          </Link>
          <Link to="/portal/coach/reports" className={cn(ROW_LINK, "border-t border-[#e5e7eb]")}>
            <Clock className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />
            <span className="flex-1">{S.history}</span>
            {reports.data && <span className="text-[14px] font-medium text-[#6b7280]">{S.inAllN(reports.data.all.total)}</span>}
            <Chevron />
          </Link>
        </nav>
      </div>
    </ObservePage>
  );
};

export default CoachObserveToday;
