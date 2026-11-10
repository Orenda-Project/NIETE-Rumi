import { useEffect, useState } from "react";
import { useObserveRoutes } from "../observe/observeRoutes";
import { Link, useParams } from "react-router-dom";
import { useBack } from "../../lib/useBack";
import { AlertTriangle, ChevronRight, MapPin } from "lucide-react";
import { coach, leader } from "../../services/api";
import type { CoachObservationView } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { LESSONS } from "../../teacher/lessons/copy";
import { COACHING } from "../../teacher/coaching/copy";
import { dayName, pkDayOf, pkToday } from "../../teacher/lessons/days";
import { LoadState } from "../../teacher/lessons/LoadState";
import { PageChip } from "../../teacher/TeacherPage";
import { AudioCard, ListRow, ProgressSteps, ScoreRing, TimeStamp, type ProgressStep } from "../../teacher/ui";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { useBidi } from "../../teacher/ui/bidi";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { cn } from "@/lib/utils";
import { trackerIndex } from "../../lib/coachObserve";
import { Card, useLoad } from "../ui";
import ReportsFrame from "../reports/ReportsFrame";
import { REPORTS } from "../reports/copy";
import { pkTime } from "../reports/data";
import { OBSERVATION_STEPS } from "../reports/paths";
import { LessonPlanRow } from "../observe/PlanState";

/**
 * bd-o15qnr.19 / bd-4404s7.5 — the one v2 observation page (Blueprint Coach_Observation and _Sent), opened from
 * every Reports row and every HITL row of a teacher's History.
 *
 * Header: the teacher, her school, the day and its TimeStamp. The Digital Coach score and the lesson to play. The
 * kit's ProgressSteps — Observation analysed, Feedback Form, Debrief, Send {name} the report — done green, current with
 * "Your turn", later grey, and "Step n of 4" in the same words as the Reports list card (bd-ewbzns.4.1). The dock opens
 * where she does the current step: the v2 screens of coach/reports (Feedback Form, Debrief, Send the report), never
 * the old /leader/observe pages. Her own feedback sits inside Debrief: once it is ready, Send is the current step.
 *
 * Once the debrief is coached, and when sent: "What you made" opens her Feedback Form, Debrief and feedback to read;
 * and the report the teacher received is shown as she got it (the image and its caption).
 * An observation captured on WhatsApp is shown here too, but its steps happen there; someone else's is only read.
 *
 */

const WORKER_STEPS = new Set(["analysing", "listening", "sending"]);

/**
 * bd-ewbzns.4.1 — where she is on the FOUR steps (Observation analysed 0, Feedback Form 1, Debrief 2, Send 3; 4 = all
 * done), the same four as the Reports list card. The portal view knows the finer steps: listening is still Debrief, and
 * once her feedback is ready (`feedback`) the Debrief is done and Send is hers. Waiting for the teacher's tap, sent and
 * done are all done for her.
 */
function stepAt(step: string | undefined): number {
  const t = trackerIndex(step as Parameters<typeof trackerIndex>[0]);
  if (t < 0) return t;
  return t <= 2 ? t : t <= 4 ? 3 : OBSERVATION_STEPS;
}

/** The same, from the session row alone (no portal view): the list's own steps — draft 1, talk 2, report 3, sent all done. */
function indexFromRow(step: string | undefined): number {
  return { analysing: 0, draft: 1, talk: 2, report: 3, sent: OBSERVATION_STEPS }[step || "analysing"] ?? 0;
}

/** bd-jjcofw.9 — how often the page asks again while the Digital Coach works (analysis takes 1-4 minutes). */
const REFRESH_MS = 10_000;

/** The steps that wait on the coach who made the observation. */
const HER_STEPS = ["draft", "talk", "feedback", "report"];

const CoachObservation = () => {
  const C = useCopy(REPORTS);
  const { stepRecording } = useCopy(COACHING);
  const kit = useKitCopy();
  const bidi = useBidi();
  const { days } = useCopy(LESSONS);
  const { id = "" } = useParams();
  const routes = useObserveRoutes();
  // bd-jjcofw.9 — a fresh read of both answers on every tick: while the Digital Coach works, and when she comes back.
  const [tick, setTick] = useState(0);
  const { data, failed, reload } = useLoad(() => coach.getObservation(id), [id, tick]);
  const [view, setView] = useState<CoachObservationView | null>(null);
  const mine = !!data?.mine;

  // Her own observation: the pipeline's view knows the finer steps and their content, whichever side it was
  // captured on (bd-15y1pc).
  useEffect(() => {
    if (!mine) return undefined;
    let live = true;
    leader.getObservation(id).then((v) => { if (live) setView(v); }).catch(() => { /* the row's step is enough */ });
    return () => { live = false; };
  }, [mine, id, tick]);

  // bd-jjcofw.9 — Rifat, 5 Nov: the page opened on "Working" after her upload and never asked again; the draft was
  // ready 20 minutes later and the same tab still said Working an hour after that. Coming back to the tab (the phone
  // woke up, she switched back from WhatsApp) always asks again.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") setTick((n) => n + 1); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const back = useBack(routes.reports);
  const name = data?.teacher?.name || view?.teacher?.name || C.dash;
  const first = name.split(/\s+/)[0] || name;
  const stopped = view?.step === "stopped";
  const at = view ? stepAt(view.step) : indexFromRow(data?.step);
  const allDone = at >= OBSERVATION_STEPS;
  // bd-ewbzns.4.4 — Send was pressed with WhatsApp's window closed: she has the invite, not yet the report (bd-2675: the
  // coach is told it landed only when it did). Her part is done; the words say what the teacher has so far.
  const waitingTap = view?.step === "waiting_teacher";
  const viewStep = view?.step;
  // bd-gie5ep — hers from either side: the step waiting on her opens here.
  const herTurn = mine && !!view && HER_STEPS.includes(view.step) && !(view.step === "report" && view.preparing);
  const onWhatsApp = !mine && HER_STEPS.includes((view ? view.step : data?.step) || "");
  const working = (viewStep && WORKER_STEPS.has(viewStep)) || (viewStep === "report" && view?.preparing) || (!view && data?.step === "analysing");
  // bd-jjcofw.9 — while the Digital Coach works, ask again every REFRESH_MS; once it is her turn (or done) it stops.
  useEffect(() => {
    if (!working) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, [working]);
  const dockStep = herTurn ? (["", "form", "debrief", "send"][at] as "" | "form" | "debrief" | "send") : "";
  const score = data ? (data.score ?? data.dcScore ?? null) : null;
  const reportImage = data?.imageUrl || view?.report.imageUrl || null;
  const reportCaption = data?.caption || view?.report.caption || null;

  const today = pkToday();
  const dayOf = (iso: string | null | undefined) => { const d = pkDayOf(iso ?? null); return d ? dayName(d, today, days) : ""; };
  const shownDate = data ? dayOf(data.date) : "";
  const sentOn = dayOf(data?.sentAt || data?.date);

  const labels = [C.stepAnalysed, C.stepForm, C.stepDebrief, C.stepSend(first)];
  const nowText = onWhatsApp ? C.onWhatsApp : herTurn ? C.yourTurn : working ? C.working : undefined;
  const steps: ProgressStep[] = labels.map((label, i) => ({
    label,
    sub: i === 0 && shownDate ? shownDate : undefined,
    state: allDone || i < at ? "done" : i === at ? "current" : "later",
    nowText: i === at ? nowText : undefined,
  }));

  const time = data ? pkTime(data.date) : null;
  const dock = dockStep ? (
    <Link to={routes.observation(id, dockStep)} data-testid="obs-dock"
      className={cn("flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-base font-semibold text-white", FOCUS)}>
      {labels[at]}<ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
    </Link>
  ) : undefined;

  const chips = data ? (
    <>
      {data.teacher.schoolName && <PageChip><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{data.teacher.schoolName}</PageChip>}
      <PageChip>{shownDate}{time ? <> · <TimeStamp time={time} size={13} /></> : null}</PageChip>
    </>
  ) : undefined;

  return (
    <ReportsFrame title={name} crumb={C.title} onBack={back} chips={chips} dock={dock} testId="coach-observation">
      <LoadState status={failed ? "error" : data ? "ok" : "loading"} empty={false} onRetry={reload} />
      {data && (
        <>
          {(() => {
            // bd-33wxxi.6 — no scores (the principal app, #55 Q1): the lesson still plays, under its own word
            // ("Class recording", Digital Coaching's), with no ring and no score line; no recording, no card.
            if (!routes.showScores) return data.audioUrl ? <AudioCard title={stepRecording} src={data.audioUrl} /> : null;
            const ring = <ScoreRing value={score} label={C.dcScore} />;
            const sub = allDone && data.score != null ? C.finalScore(C.pct(data.score)) : C.draftBeforeCheck;
            return data.audioUrl
              ? <AudioCard title={C.dcScore} sub={sub} src={data.audioUrl} lead={ring} />
              : (
                <section data-testid="score-card" className={cn(LIST_CARD, "flex min-h-[84px] items-center gap-3 p-3")}>
                  {ring}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[16px] font-semibold leading-[1.3]">{C.dcScore}</span>
                    <span className="text-[13px] leading-[1.3] text-[#6b7280]">{sub}</span>
                  </span>
                </section>
              );
          })()}

          <LessonPlanRow lp={view?.lessonPlan} />

          {stopped ? (
            <Card className="flex gap-2.5 bg-[#fef3c7] p-4 text-[15px] text-[#b45309]">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><span>{C.stopped}</span>
            </Card>
          ) : (
            <ProgressSteps heading={C.steps} steps={steps} done={allDone} doneLabel={waitingTap ? C.waitingTeacher(first) : C.reportSentOn(sentOn)}
              copy={{ stepsCount: () => bidi(kit.stepOf(Math.min(at + 1, labels.length), labels.length)) }} />
          )}
          {onWhatsApp && <p className="px-1 text-[13px] text-[#6b7280]">{C.continueOnWhatsApp}</p>}

          {/* Once the debrief is coached, what she made opens here — her feedback included (it sits inside Debrief). */}
          {(allDone || at >= 3) && mine && (
            <>
              <h2 className="mx-1 mt-2 text-[22px] font-semibold leading-[1.2]">{C.whatYouMade}</h2>
              <div className={LIST_CARD} data-testid="what-you-made">
                <ListRow icon="file" label={C.stepForm} subtitle={C.formRowSub} variant="row" first to={routes.observation(id, "form")} />
                {view?.talk.guide && <ListRow icon="file" label={C.stepDebrief} subtitle={C.debriefRowSub} variant="row" first={false} to={routes.observation(id, "debrief")} />}
                {view?.talk.feedback && <ListRow icon="file" label={C.stepFeedback} subtitle={C.feedbackRowSub} variant="row" first={false} to={routes.observation(id, "feedback")} />}
              </div>
            </>
          )}

          {allDone && reportImage && (
            <>
              <h2 className="mx-1 mt-2 text-[22px] font-semibold leading-[1.2]">{waitingTap ? C.sentTitle(first) : C.reportReceived(first)}</h2>
              <section data-testid="observation-report" className={cn(LIST_CARD, "flex flex-col gap-2 p-2.5")}>
                <img src={reportImage} alt={C.reportImage(name)} className="w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb]" loading="lazy" />
                {reportCaption && <p className="whitespace-pre-line px-1 pb-1 text-[14px] leading-relaxed" dir="auto">{reportCaption}</p>}
              </section>
            </>
          )}
        </>
      )}
    </ReportsFrame>
  );
};

export default CoachObservation;
