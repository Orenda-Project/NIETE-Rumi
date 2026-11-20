import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { coach } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { HistoryRow } from "../../teacher/ui";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { Chevron, Loading, SectionLabel, useLoad } from "../ui";
import { karachiDay } from "../time";
import { SCHEDULE } from "../schedule/copy";
import { REPORTS } from "../reports/copy";
import { reportChip, reportHref, ReportSegments } from "../reports/ReportRows";
import { BookedRow } from "./BookedRow";
import { FLOW_V6 } from "./copy";
import { groupBooked, oldestFirst, waitedDays } from "./model";
import { trackFlow } from "./track";
import { isPkMonday, useYourWeek, YourWeekCard } from "./YourWeek";

/**
 * bd-o15qnr.27 (queue #204, v6) — the Home's Focus card: ONE slot between the greeting and the tiles showing the one most
 * important thing (the operator on #188's round 5: "We will utilize this space to shwo the one most importatn thing to
 * the user ... if the coach has a pending debreif or something, that should be shown here instead. That is more
 * important. If no pending stuff, then we can show this. If none are booked, then we can show the Schedule an
 * Observation perhaps."). In order:
 *
 *   1 waiting   the observation waiting on her LONGEST: the teacher, how long, its step and the four segments, ONE button
 *               naming the next step ("Continue the Debrief"), and "N more waiting"
 *   2 booked    today's visits still to do, each with Record, then All booked (the late count) → Observe, opened
 *   3 nothing   "No visits booked today" and Schedule an observation
 *
 * A waiting review comes first even when a visit is due within the hour: #188's open question, answered with its current
 * pick, the operator's own order above (named in the #204 report). No "Start an observation" on Home ("That is too much").
 * Behind portal_coach_flow_v2 with the full coach app (SlimHome decides). Reads the first reports page and today's
 * schedule (the server adds the late visits); a read that fails shows nothing it cannot back.
 *
 * bd-o15qnr.28.1 (queue #204, v7; #188's c8-home-monday) — on a Monday, FIRST: "Your week" (YourWeek.tsx), while last
 * week's report is ready and not yet opened (her weekly report on). It opens the week page; once opened, the slot goes
 * back to the order above. Any other day: exactly as above.
 */
export function FocusCard() {
  const S = useCopy(SCHEDULE);
  const R = useCopy(REPORTS);
  const F = useCopy(FLOW_V6);
  const today = karachiDay();
  const reports = useLoad(() => coach.getReports({ page: 1 }), []);
  const schedule = useLoad(() => coach.getSchedule({ from: today, to: today }), [today]);
  const waiting = useMemo(() => oldestFirst(reports.data?.waiting), [reports.data]);
  const g = useMemo(() => groupBooked(schedule.data, today), [schedule.data, today]);
  const yourWeek = useYourWeek(isPkMonday());

  const reportsIn = !!reports.data || reports.failed;
  const scheduleIn = !!schedule.data || schedule.failed;

  let body: JSX.Element | null = null;
  if (yourWeek.state === "ready") {
    body = <YourWeekCard ready={yourWeek.ready} week={yourWeek.week} />;
  } else if (yourWeek.state === "loading") {
    body = <Loading />;
  } else if (waiting.length > 0) {
    const r = waiting[0];
    const step = (r.step in F.continueStep ? r.step : "analysing") as keyof typeof F.continueStep;
    body = (
      <section data-testid="focus-waiting" className="flex flex-col gap-2">
        <SectionLabel count={waiting.length} countTone="warn">{R.waitingForYou}</SectionLabel>
        <div className={cn(LIST_CARD, "border-2 border-[#f59e0b]")}>
          <HistoryRow lead="person" first title={r.teacherName || S.dash} action="none" chip={reportChip(r, R)}
            extra={[r.schoolName, S.waitingSince(waitedDays(r, today))].filter(Boolean).join(" · ")} />
          <ReportSegments step={r.step} />
          <div className="px-3 pb-3">
            <Link to={reportHref(r)} onClick={() => trackFlow("home.focus")}
              className={cn("flex min-h-[56px] items-center justify-center rounded-2xl bg-[#33374a] px-4 text-[16px] font-semibold leading-tight text-white rtl:leading-[1.8]", FOCUS)}>
              {F.continueStep[step]}
            </Link>
          </div>
          {waiting.length > 1 && (
            <Link to="/portal/coach/reports?show=waiting"
              className={cn("flex min-h-[52px] items-center justify-center gap-1 border-t border-[#e5e7eb] text-[15px] font-semibold text-[#33374a]", FOCUS)}>
              {F.moreWaiting(waiting.length - 1)}<Chevron />
            </Link>
          )}
        </div>
      </section>
    );
  } else if (!reportsIn || !scheduleIn) {
    body = <Loading />;
  } else if (g.today.length > 0) {
    body = (
      <section data-testid="focus-booked" className="flex flex-col gap-2">
        <SectionLabel count={g.today.length}>{S.bookedToday}</SectionLabel>
        <div className={LIST_CARD}>
          {g.today.map((v, i) => <BookedRow key={v.id} v={v} today={today} first={i === 0} />)}
          <Link to="/portal/coach/observe?booked=open"
            className={cn("flex min-h-[56px] items-center gap-2 border-t border-[#e5e7eb] px-4 text-[16px] font-semibold text-[#33374a]", FOCUS)}>
            <span className="flex-1">{F.allBooked}</span>
            {g.late.length > 0 && <StatusChip text={S.lateN(g.late.length)} tone="waiting" />}
            <Chevron />
          </Link>
        </div>
      </section>
    );
  } else if (schedule.data) {
    body = (
      <section data-testid="focus-empty" className="flex flex-col gap-2">
        <SectionLabel>{S.today}</SectionLabel>
        <div className={LIST_CARD}>
          <div className="flex min-h-[60px] items-center gap-3 px-4 text-[15px] font-semibold text-[#6b7280]">
            <CalendarClock className="h-5 w-5 shrink-0" aria-hidden="true" />{F.noVisitsToday}
          </div>
          <div className="px-3 pb-3">
            <Link to="/portal/coach/new-visit" onClick={() => trackFlow("home.focus")}
              className={cn("flex min-h-[56px] items-center justify-center gap-2.5 rounded-2xl bg-[#33374a] px-4 text-[16px] font-semibold leading-tight text-white rtl:leading-[1.8]", FOCUS)}>
              <CalendarPlus className="h-5 w-5 shrink-0" aria-hidden="true" />{F.scheduleObservation}
            </Link>
          </div>
        </div>
      </section>
    );
  }
  if (!body) return null;
  return <div data-testid="focus-card" className="mt-1">{body}</div>;
}
