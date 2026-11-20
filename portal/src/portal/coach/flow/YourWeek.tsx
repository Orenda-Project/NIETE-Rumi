import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { readConfigShared } from "../../lib/useNewUi";
import { useCopy, useLang } from "../../teacher/i18n";
import { FOCUS } from "../../teacher/ui/styles";
import { Chevron } from "../ui";
import { karachiDay } from "../time";
import { COACH_REPORT, type CoachReportCopy } from "../report/copy";
import { coachWeekPath, getCoachWeek, getReadyReports, type CoachWeek, type ReadyWeek } from "../report/api";
import { weekSpan } from "../report/weekSpan";
import { FocusCount, KeyFocusIcon, Segments } from "../report/v7Parts";
import { FLOW_V7, type FlowV7Copy } from "./copyV7";
import { FLOW_V7_WEEK, type FlowV7WeekCopy } from "./copyV7week";
import { trackFlow } from "./track";

/**
 * bd-o15qnr.28.1 (queue #204, v7; #188's c8-home-monday board; the operator: "This should be accomodated inside the Focus
 * Area on the home page. Only on the first open on Monday.") — Home's Focus card on a Monday: "Your week".
 *
 * WHEN. It is Monday in Pakistan, her weekly report is on (coach_reports_app: the week page's own gate), and last week's
 * report is ready and not yet opened or closed (GET /coach/reports/ready carries the week row exactly then, until Monday
 * 16:00). Opening the week page stamps "opened", so the slot goes back to what needs her. Any other day, or no such week:
 * nothing (the Focus card's other states, as before).
 *
 * WHAT. The week's count against 12 with its segments, the Key Focus Area with its count and the goal at 6 of 10 (from
 * GET /coach/week/:monday, the page's own read; it writes nothing). Counts, never a % (the operator, 20 Nov 15:04). The
 * whole card is ONE link to the week page. If the week itself cannot be read, the ready row's debrief count stands in.
 */
export function isPkMonday(now: Date = new Date()): boolean {
  return new Date(`${karachiDay(now)}T00:00:00Z`).getUTCDay() === 1;
}

export type YourWeek =
  | { state: "off" }
  | { state: "loading" }
  | { state: "ready"; ready: ReadyWeek; week: CoachWeek | null };

/** Whether Home's Focus card shows "Your week" now; reads only on a Monday, only with her weekly report on. */
export function useYourWeek(monday: boolean): YourWeek {
  const [reportsApp, setReportsApp] = useState<boolean | null>(null);
  const [found, setFound] = useState<{ ready: ReadyWeek; week: CoachWeek | null } | null | undefined>(undefined);

  useEffect(() => {
    if (!monday) return undefined;
    let live = true;
    readConfigShared()
      .then((cfg) => cfg?.features?.coachReportsApp === true)
      .catch(() => false)
      .then((on) => { if (live) setReportsApp(on); });
    return () => { live = false; };
  }, [monday]);

  useEffect(() => {
    if (!monday || reportsApp !== true) return undefined;
    let live = true;
    getReadyReports()
      .then((list) => list.find((r): r is ReadyWeek => r.kind === "week") ?? null)
      .then((ready) => (ready ? getCoachWeek(ready.monday).then((week) => ({ ready, week }), () => ({ ready, week: null })) : null))
      .catch(() => null)
      .then((v) => { if (live) setFound(v); });
    return () => { live = false; };
  }, [monday, reportsApp]);

  if (!monday || reportsApp === false) return { state: "off" };
  if (reportsApp === null || found === undefined) return { state: "loading" };
  return found ? { state: "ready", ...found } : { state: "off" };
}

export function YourWeekCard({ ready, week }: { ready: ReadyWeek; week: CoachWeek | null }) {
  const C = useCopy(COACH_REPORT) as CoachReportCopy;
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const K = useCopy(FLOW_V7_WEEK) as FlowV7WeekCopy;
  const lang = useLang();
  const f = week?.focus ?? null;
  const name = f ? (lang === "ur" ? f.name.ur || f.name.en : f.name.en || f.name.ur) || "" : "";
  return (
    <Link to={coachWeekPath(ready.monday)} data-testid="focus-week" onClick={() => trackFlow("home.focus")}
      className={cn("flex flex-col gap-2.5 rounded-2xl border-2 border-[#33374a] bg-white px-3.5 pb-3.5 pt-3 text-[#1d2025]", FOCUS)}>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[20px] font-light leading-[1.3]"><bdi>{K.yourWeek(weekSpan(ready.monday, ready.friday, lang))}</bdi></span>
        <Chevron />
      </span>
      {week ? (
        <>
          <span className="flex items-baseline gap-2">
            <b dir="ltr" className="text-[40px] font-light leading-none">{`${week.complete}/${week.target}`}</b>
            <span className="text-[15px] text-[#4b5563]">{K.completeObs}</span>
          </span>
          <Segments done={week.complete} of={week.target} dark={false} label={`${week.complete}/${week.target}`} />
        </>
      ) : (
        <span className="text-[15px] font-semibold text-[#4b5563]">{C.weekDebriefs(ready.debriefs)}</span>
      )}
      {f ? (
        <>
          <span className="flex items-center gap-2 border-t border-[#f0f1f3] pt-1.5 text-[14px] font-bold text-[#6e52e0]">
            <KeyFocusIcon /><span>{W.keyFocus}: {name}</span>
          </span>
          <FocusCount count={C.ofTotal(f.last10.done, f.last10.of)} goalText={K.goal(f.doneAt, 10)}
            done={f.last10.done} of={f.last10.of} goal={f.doneAt} window={10} />
        </>
      ) : null}
    </Link>
  );
}
