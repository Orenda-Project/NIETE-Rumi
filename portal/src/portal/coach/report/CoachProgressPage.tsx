import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy, useLang, type Lang } from "../../teacher/i18n";
import { HistoryRow } from "../../teacher/ui";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { useBack } from "../../lib/useBack";
import { Chevron, SectionLabel } from "../ui";
import { useFlowV6 } from "../flow/useCoachFlowV2";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { FLOW_V7_WEEK, type FlowV7WeekCopy } from "../flow/copyV7week";
import { COACH_REPORT, type CoachReportCopy } from "./copy";
import { coachWeekPath, getCoachProgress, problemOf, type CoachProgress, type ReportProblem } from "./api";
import { weekSpan } from "./weekSpan";
import { Problem, ReportOutline, debriefPercent, pick } from "./CoachReportPage";
import { CountBar, DarkTop, FocusCount, KeyFocusCard, RespectLine, atGoal } from "./v7Parts";

/**
 * bd-o15qnr.28.1 (queue #204, v7; #188's c8-progress board, "My progress, closer to the reports") — the coach's own
 * progress, READ-ONLY, opened from the Home tile "My progress" (/portal/coach/progress), behind the v6/v7 switch
 * (useFlowV6; off: no page, back to Home). From GET /api/portal/coach/progress (her own; counts only):
 *
 *   1 the reports' dark top card: THIS WEEK, n/12 complete observations, the twelve segments
 *   2 the Key Focus Area (option B): its name, n of her last 10 debriefs, a bar with the goal mark at 6 of 10
 *   3 Respect held on its own line (the must-pass check, not one of the 8), above the 8
 *   4 her 8 behaviours over the last 10 debriefs: "9 of 10" and a bar, green from 60%, amber below
 *   5 Observations: the 3 most recent (the debrief's own score, behaviours seen as a % — the one % the operator kept —
 *     or where the visit stands, in the status line's words), each opening its visit; See all observations
 *   6 Weekly reports: each opening its week page (only when her week page opens for her)
 *
 * No buttons that act, no averages, no stars. A number that did not load is not drawn; nothing is invented.
 */
const STEP_WORD: Record<string, (W: FlowV7Copy) => string> = {
  analysing: (W) => W.steps[0].current,
  draft: (W) => W.steps[1].later,
  talk: (W) => W.steps[2].later,
  report: (W) => W.steps[3].later,
  sent: (W) => W.steps[3].done,
};

const dayOf = (iso: string | null, lang: Lang): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "ur" ? "ur-PK" : "en-GB", { weekday: "short", day: "numeric", timeZone: "Asia/Karachi" }).format(d);
};

export default function CoachProgressPage() {
  const F = useCopy(TEACHER_FRAME);
  const K = useCopy(FLOW_V7_WEEK) as FlowV7WeekCopy;
  const C = useCopy(COACH_REPORT) as CoachReportCopy;
  const lang = useLang();
  const back = useBack("/portal/coach");
  const v7 = useFlowV6();
  const [data, setData] = useState<CoachProgress | null>(null);
  const [problem, setProblem] = useState<ReportProblem | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (v7 !== true) return undefined;
    let live = true;
    setProblem(null);
    getCoachProgress().then((p) => { if (live) setData(p); }).catch((err) => { if (live) setProblem(problemOf(err)); });
    return () => { live = false; };
  }, [v7, tick]);

  if (v7 === false) return <Navigate to="/portal/coach" replace />;

  return (
    <CoachGate>
      <TeacherPage feature="reports" title={K.progressTitle} crumb={F.coachNav.home} onBack={back} testId="coach-progress">
        {data ? <ProgressBody p={data} K={K} C={C} lang={lang} />
          : problem ? <Problem problem={problem} C={C} onRetry={() => setTick((n) => n + 1)} />
            : <ReportOutline />}
      </TeacherPage>
    </CoachGate>
  );
}

function ProgressBody({ p, K, C, lang }: { p: CoachProgress; K: FlowV7WeekCopy; C: CoachReportCopy; lang: Lang }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const slim = "flex min-h-[64px] items-center px-4 text-[15px] font-semibold text-[#6b7280]";
  return (
    <div className="flex flex-col gap-3" data-testid="progress-body">
      <DarkTop testId="progress-week" ariaLabel={K.thisWeek} eyebrow={K.thisWeek} done={p.week.complete} of={p.week.target} words={K.completeObs} />

      {p.focus ? (
        <KeyFocusCard testId="progress-focus" label={W.keyFocus} name={pick(p.focus.name, lang)}>
          <FocusCount count={C.ofTotal(p.focus.last10.done, p.focus.last10.of)} goalText={K.goal(p.focus.doneAt, p.focus.window)}
            done={p.focus.last10.done} of={p.focus.last10.of} goal={p.focus.doneAt} window={p.focus.window} />
        </KeyFocusCard>
      ) : null}

      {p.respectAll ? <RespectLine testId="progress-respect" label={W.respectHeld} note={W.respectNote} /> : null}

      <section data-testid="progress-behaviours" aria-label={K.behavioursLast(p.window)} className="flex flex-col gap-2">
        <SectionLabel>{p.window > 0 ? K.behavioursLast(p.window) : W.yourBehaviours(8)}</SectionLabel>
        <div className={LIST_CARD}>
          {p.behaviours.length ? p.behaviours.map((b, i) => (
            <div key={b.key} data-testid="progress-behaviour" data-tone={atGoal(b.done, b.of) ? "good" : "low"}
              className={cn("flex min-h-[52px] items-center gap-3 px-3.5", i > 0 && "border-t border-[#f0f1f3]")}>
              <span className="min-w-0 flex-1 text-[15px] font-semibold leading-[1.3]">{pick(b.name, lang)}</span>
              <CountBar done={b.done} of={b.of} />
              <span className="w-16 shrink-0 text-end text-[14px] font-bold tabular-nums"><bdi>{C.ofTotal(b.done, b.of)}</bdi></span>
            </div>
          )) : <p className={cn(slim, "m-0")}>{K.noDebriefs}</p>}
        </div>
      </section>

      <section data-testid="progress-observations" aria-label={W.observations} className="flex flex-col gap-2">
        <SectionLabel>{W.observations}</SectionLabel>
        <div className={LIST_CARD}>
          {p.observations.length ? (
            <>
              {p.observations.map((o, i) => {
                const state = o.debrief && o.debrief.total > 0 ? `${debriefPercent(o.debrief.done, o.debrief.total)}%` : (STEP_WORD[o.step] ?? STEP_WORD.analysing)(W);
                return (
                  <HistoryRow key={o.id} lead="person" first={i === 0} title={o.teacher || "—"} action="chevron"
                    to={`/portal/coach/observation/${encodeURIComponent(o.id)}`} extra={[dayOf(o.at, lang), state].filter(Boolean).join(" · ")} />
                );
              })}
              <Link to="/portal/coach/reports/all"
                className={cn("flex min-h-[56px] items-center justify-center gap-1.5 border-t border-[#e5e7eb] text-[15px] font-semibold text-[#33374a]", FOCUS)}>
                {K.seeAll}<Chevron />
              </Link>
            </>
          ) : <p className={cn(slim, "m-0")}>{K.noObservations}</p>}
        </div>
      </section>

      {p.weeks ? (
        <section data-testid="progress-weeks" aria-label={K.weeklyReports} className="flex flex-col gap-2">
          <SectionLabel>{K.weeklyReports}</SectionLabel>
          <div className={LIST_CARD}>
            {p.weeks.length ? p.weeks.map((w, i) => (
              <Link key={w.monday} to={coachWeekPath(w.monday)}
                className={cn("flex min-h-[60px] items-center gap-3 px-4", i > 0 && "border-t border-[#f0f1f3]", FOCUS)}>
                <span className="flex-1 text-[16px] font-semibold"><bdi>{weekSpan(w.monday, w.friday, lang)}</bdi></span>
                <span className="text-[13px] font-bold text-[#6b7280]"><bdi>{C.ofTotal(w.complete, w.target)}</bdi></span>
                <Chevron />
              </Link>
            )) : <p className={cn(slim, "m-0")}>{K.noWeeks}</p>}
          </div>
        </section>
      ) : null}
    </div>
  );
}
