import { useEffect, useState, type ReactNode } from "react";
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
import { extOf, recordingFilename } from "../../lib/saveRecording";
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
import { Obs612Block } from "../../components/coaching/Obs612Block";
import { useFlowV6 } from "../flow/useCoachFlowV2";
import { bandOfRubric } from "../../teacher/help/observe/guides";
import { StatusLine } from "../flow/StatusLine";
import { AnalysingStage, AnalysisStoppedCard, DebriefDue, DebriefListeningStage, DebriefStage, DoneRow, FeedbackCard, FormStage, SendStage, StoppedStage, ViewLink, ViewToggle } from "../flow/VisitV7";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { coachReportPath } from "../report/api";
import { ReportImage } from "../reports/ReportImage";

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
  const W = useCopy(FLOW_V7) as FlowV7Copy;
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
  // bd-o15qnr.47 — what the visit's folded rows have open in place (the 6-12 / FDE form, the report sent).
  const [formOpen, setFormOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
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
  // bd-o15qnr.28 (queue #204, v7; the v6/v7 switch): the status line (option A), the debrief's due day, and the current
  // step's card ON the visit (#188: "Actions live on the visit only"); the feedback is the report's own top card opening
  // the ONE feedback page (the coach's debrief report; the principal's "Your feedback"). Off: this page as on production.
  const v7 = useFlowV6() === true;
  const name = data?.teacher?.name || view?.teacher?.name || C.dash;
  const first = name.split(/\s+/)[0] || name;
  // bd-f5a245 — on the switch the row's own step says stopped too (both endpoints agree now), so the card shows before the
  // pipeline's view arrives, and on a visit that is not hers.
  const stopped = view?.step === "stopped" || (v7 && !view && data?.step === "stopped");
  const dupStop = stopped && view?.problem === "duplicate";
  // bd-f5a245 (queue #245) — the analysis stopped (failed, or the system gave up), not a visit she cancelled: say so and
  // offer Upload recording for that teacher.
  const cancelledStop = data?.cancelled === true || view?.sessionStatus === "cancelled";
  const analysisStopped = v7 && stopped && !dupStop && !cancelledStop;
  const againTo = data?.teacher?.teacherExtId ? routes.again(data.teacher.teacherExtId, data.teacher.schoolExtId) : null;
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
  // v7: the one feedback page — the coach's debrief report, or (the principal app's routes) its "Your feedback".
  const feedbackTo = routes.coachGate ? coachReportPath(id) : routes.observation(id, "feedback");
  const hasFeedback = !!view?.talk.feedback;
  // bd-o15qnr.39 — her debrief is in and being listened to; its recording plays in place when the portal kept it.
  const listening = viewStep === "listening";
  const talkAudio = view?.talk.audioUrl || null;
  // bd-ma9jiy (queue #262) — Save to phone on the full player: NIETE_OBS_25Nov_1040.webm / NIETE_DBRF_25Nov_1130.webm.
  const classSave = data?.audioUrl ? { kind: "obs" as const, filename: recordingFilename({ kind: "obs", at: data.date, ext: extOf(data.audioUrl) }) } : undefined;
  const talkSave = talkAudio ? { kind: "dbrf" as const, filename: recordingFilename({ kind: "dbrf", at: view?.talk.recordedAt || data?.date, ext: extOf(talkAudio) }) } : undefined;
  const dock = dockStep && !v7 ? (
    <Link to={routes.observation(id, dockStep)} data-testid="obs-dock"
      className={cn("flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-base font-semibold text-white", FOCUS)}>
      {labels[at]}<ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
    </Link>
  ) : undefined;

  // bd-o15qnr.47 — the switch's visit (see the comment over its body below).
  const fdeVisit = /^(obs612-|fico_s_v)/.test(String(view?.rubric?.id || ""));
  const scoreSub = allDone && data?.score != null ? C.finalScore(C.pct(data.score)) : C.draftBeforeCheck;
  const rubricLabel = !data?.obs612 && view?.rubric?.label ? (
    <span data-testid="rubric-label" dir="ltr" className="self-end px-1 text-[10px] leading-none text-[#9ca3af]">{view.rubric.label}</span>
  ) : null;
  // The form is filled once FDE's result is in, or the visit is past the form (Debrief, Send, done).
  const formFilled = !!data?.obs612 || at >= 2;
  // A 6-12 / FDE form opens in place, read-only (the coach app: the principal's app shows no result, #55).
  const formObs612 = routes.showScores && data?.obs612 ? data.obs612 : null;
  const formLine = formObs612
    ? formObs612.headline
    : routes.showScores && !fdeVisit && data
      ? (data.score != null ? C.finalScore(C.pct(data.score)) : data.dcScore != null ? C.dcScoreOf(C.pct(data.dcScore)) : null)
      : null;
  // The class recording, one compact row; before a 1-5 form is filled it still carries the AI score's ring.
  // bd-f5a245 — never an empty AI score under a stopped analysis: there is no score, and none is coming.
  const preFormScore = routes.showScores && !fdeVisit && !data?.obs612 && !formFilled && !analysisStopped;
  const classRecording = !data ? null : data.audioUrl ? (
    <div data-item="class-recording">
      {preFormScore
        ? <AudioCard title={C.dcScore} sub={scoreSub} src={data.audioUrl} lead={<ScoreRing value={score} label={C.dcScore} />} controls compact testId="class-recording" save={classSave} />
        : <AudioCard title={W.classRecording} src={data.audioUrl} controls compact testId="class-recording" save={classSave} />}
    </div>
  ) : preFormScore ? (
    <section data-item="score" data-testid="score-card" className={cn(LIST_CARD, "flex min-h-[72px] items-center gap-3 p-3")}>
      <ScoreRing value={score} label={C.dcScore} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[16px] font-semibold leading-[1.3]">{C.dcScore}</span>
        <span className="text-[13px] leading-[1.3] text-[#6b7280]">{scoreSub}</span>
      </span>
    </section>
  ) : null;
  // The card on top: the step she does next ("Next: …"), or what the Digital Coach is doing, or why it stopped.
  let active: ReactNode = null;
  let nextShown = false;
  if (stopped) {
    active = dupStop
      // bd-k8uh1r (queue #238) — a recording this coach already had analysed (bd-erpvf) says so, and what to do.
      ? <StoppedStage text={C.problems.duplicate} line={C.stoppedDuplicateLine} />
      : analysisStopped
        ? <AnalysisStoppedCard to={againTo} />
        : <StoppedStage text={C.stopped} />;
  } else if (at === 0 && working) {
    active = <AnalysingStage />;
  } else if (listening && mine) {
    active = <DebriefListeningStage />;
  } else if (herTurn && dockStep === "form") {
    active = <FormStage to={routes.observation(id, "form")} />;
    nextShown = true;
  } else if (herTurn && dockStep === "debrief") {
    active = <DebriefStage to={routes.observation(id, "debrief")} due={<DebriefDue visitDay={pkDayOf(data?.date ?? null)} />} />;
    nextShown = true;
  } else if (herTurn && dockStep === "send") {
    active = <SendStage name={first} to={routes.observation(id, "send")} />;
    nextShown = true;
  }

  const chips = data ? (
    <>
      {data.teacher.schoolName && <PageChip><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{data.teacher.schoolName}</PageChip>}
      <PageChip>{shownDate}{time ? <> · <TimeStamp time={time} size={13} /></> : null}</PageChip>
    </>
  ) : undefined;

  return (
    <ReportsFrame title={name} crumb={C.title} onBack={back} chips={chips} dock={dock} testId="coach-observation" helpBand={bandOfRubric(view?.rubric?.id)}>
      <LoadState status={failed ? "error" : data ? "ok" : "loading"} empty={false} onRetry={reload} />
      {/* bd-o15qnr.47 (queue #243; the operator 23 Nov ~23:23: "On the observation page when the form has been filled, it
          is just there on this page as a whole. Pushes the next stuff all the way down.") — the switch's visit, coach and
          principal: the step she does next (or the one the Digital Coach is on) FIRST, under the header; the status line;
          then every step done, folded to one row each, the newest on top: the report sent, the debrief report, the
          debrief, the Feedback Form (one row: Form filled, its result, View form), and the class recording as one
          compact row; the lesson plan and the rubric's small label last. */}
      {data && v7 && (
        <>
          {active}
          {!stopped && <StatusLine at={at} current={listening ? W.debriefAnalysing : undefined} hideNow={nextShown} />}
          {onWhatsApp && <p className="px-1 text-[13px] text-[#6b7280]">{C.continueOnWhatsApp}</p>}

          <div data-testid="visit-items" className="flex flex-col gap-3">
            {mine && allDone && reportImage && (
              <DoneRow testId="observation-report" item="teacher-report" title={waitingTap ? C.sentTitle(first) : W.reportSentTo(first)} line={sentOn || null}
                action={<ViewToggle open={reportOpen} onToggle={() => setReportOpen((o) => !o)} view={W.viewReport} hide={W.hideReport} />}>
                {reportOpen && (
                  <div className="flex flex-col gap-2 border-t border-[#f0f1f3] p-2.5">
                    {/* bd-o15qnr.39.2: opens full screen in the app, the same viewer as on Send */}
                    <ReportImage src={reportImage} alt={C.reportImage(name)} loading="lazy" />
                    {reportCaption && <p className="whitespace-pre-line px-1 pb-1 text-[14px] leading-relaxed" dir="auto">{reportCaption}</p>}
                  </div>
                )}
              </DoneRow>
            )}
            {mine && hasFeedback && (at >= 3 || allDone) && (
              <div data-item="debrief-report"><FeedbackCard id={id} to={feedbackTo} /></div>
            )}
            {mine && (at >= 3 || allDone) && (
              <DoneRow testId="visit-debrief" item="debrief" title={W.steps[2].done} line={view?.talk.recordedAt ? dayOf(view.talk.recordedAt) : null}
                action={view?.talk.guide ? <ViewLink to={routes.observation(id, "debrief")} label={W.viewDebrief} /> : undefined} />
            )}
            {mine && talkAudio && (
              <div data-item="debrief-recording">
                <AudioCard title={W.debriefRecording} src={talkAudio} controls compact testId="debrief-recording" save={talkSave} />
              </div>
            )}
            {formFilled && (
              <DoneRow testId="visit-form" item="form" title={W.steps[1].done} line={formLine} ltr={!!formObs612}
                action={formObs612
                  ? <ViewToggle open={formOpen} onToggle={() => setFormOpen((o) => !o)} view={W.viewForm} hide={W.hideForm} />
                  : mine ? <ViewLink to={routes.observation(id, "form")} label={W.viewForm} /> : undefined}>
                {formObs612 && formOpen && (
                  <div className="border-t border-[#f0f1f3] px-4 pb-4 pt-3">
                    <Obs612Block o={formObs612} className="rounded-none border-0 p-0 shadow-none" />
                  </div>
                )}
              </DoneRow>
            )}
            {classRecording}
          </div>

          <LessonPlanRow lp={view?.lessonPlan} />
          {rubricLabel}
        </>
      )}
      {data && !v7 && (
        <>
          {(() => {
            // bd-33wxxi.6 — no scores (the principal app, #55 Q1): the lesson still plays, under its own word
            // ("Class recording", Digital Coaching's), with no ring and no score line; no recording, no card.
            if (!routes.showScores) return data.audioUrl ? <AudioCard title={stepRecording} src={data.audioUrl} testId="class-recording" /> : null;
            // bd-pni007 — an FDE visit has no FICO score: the lesson (if recorded), then FDE's own result.
            // bd-ra8xu.40 — before Submit there is no result yet (the visit is FDE by its rubric): the lesson alone.
            // bd-31ziu8: a FICO-S v1.1 visit (fico_s_v1_1) is filled and shown the same way.
            if (data.obs612 || fdeVisit) {
              return (
                <>
                  {data.audioUrl ? <AudioCard title={stepRecording} src={data.audioUrl} testId="class-recording" /> : null}
                  {data.obs612 ? <Obs612Block o={data.obs612} /> : null}
                </>
              );
            }
            const ring = <ScoreRing value={score} label={C.dcScore} />;
            return data.audioUrl
              ? <AudioCard title={C.dcScore} sub={scoreSub} src={data.audioUrl} lead={ring} testId="class-recording" />
              : (
                <section data-testid="score-card" className={cn(LIST_CARD, "flex min-h-[84px] items-center gap-3 p-3")}>
                  {ring}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[16px] font-semibold leading-[1.3]">{C.dcScore}</span>
                    <span className="text-[13px] leading-[1.3] text-[#6b7280]">{scoreSub}</span>
                  </span>
                </section>
              );
          })()}

          {/* bd-ra8xu.40 — the rubric this visit was scored with, very small (an FDE block prints its own). */}
          {rubricLabel}

          <LessonPlanRow lp={view?.lessonPlan} />

          {stopped ? (
            <Card className="flex gap-2.5 bg-[#fef3c7] p-4 text-[15px] text-[#b45309]">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><span>{dupStop ? C.stoppedDuplicateLine : C.stopped}</span>
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
