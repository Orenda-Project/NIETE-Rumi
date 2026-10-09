import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ChevronRight, MapPin, Pause, Play } from "lucide-react";
import { coach, leader } from "../../services/api";
import type { CoachObservationView } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { LESSONS } from "../../teacher/lessons/copy";
import { dayName, pkDayOf, pkToday } from "../../teacher/lessons/days";
import { LoadState } from "../../teacher/lessons/LoadState";
import { PageChip } from "../../teacher/TeacherPage";
import { ListRow, ProgressSteps, TimeStamp, type ProgressStep } from "../../teacher/ui";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { cn } from "@/lib/utils";
import { trackerIndex } from "../../lib/coachObserve";
import { Card, useLoad } from "../ui";
import ReportsFrame from "../reports/ReportsFrame";
import { REPORTS } from "../reports/copy";
import { pkTime } from "../reports/data";
import { observationPath } from "../reports/paths";

/**
 * bd-o15qnr.19 / bd-4404s7.5 — the one v2 observation page (Blueprint Coach_Observation and _Sent), opened from
 * every Reports row and every HITL row of a teacher's History.
 *
 * Header: the teacher, her school, the day and its TimeStamp. The Digital Coach score and the lesson to play. The
 * kit's ProgressSteps — Observation analysed, Feedback Form, Debrief, Your feedback, Send {name} the report — done
 * green, current with "Your turn", later grey. The dock opens where she does the current step: the four v2 screens
 * of coach/reports (Feedback Form, Debrief, Your feedback, Send the report), never the old /leader/observe pages.
 *
 * Sent: the steps fold into one "Done" line; "What you made" opens her Feedback Form, Debrief and feedback to read;
 * and the report the teacher received is shown as she got it (the image and its caption).
 * An observation captured on WhatsApp is shown here too, but its steps happen there; someone else's is only read.
 *
 * INTERIM (kit PR 2): the score ring and the play button are the coach-local ones until ScoreRing and AudioCard land.
 */

const WORKER_STEPS = new Set(["analysing", "listening", "sending"]);

/** The step index from the session row alone (no portal view): draft 1, debrief 2, report 4, sent → all done. */
function indexFromRow(step: string | undefined): number {
  return { analysing: 0, draft: 1, talk: 2, report: 4, sent: 5 }[step || "analysing"] ?? 0;
}

/** The steps that wait on the coach who made the observation. */
const HER_STEPS = ["draft", "talk", "feedback", "report"];

function ScoreRing({ value, label, text }: { value: number | null; label: string; text: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full" aria-label={label} role="img"
      style={{ background: `conic-gradient(#33374a 0 ${pct}%, #e8e9f0 ${pct}% 100%)` }}>
      <span className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-white text-[15px] font-bold tabular-nums">{text}</span>
    </span>
  );
}

const CoachObservation = () => {
  const C = useCopy(REPORTS);
  const { days } = useCopy(LESSONS);
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, failed, reload } = useLoad(() => coach.getObservation(id), [id]);
  const [view, setView] = useState<CoachObservationView | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const mine = !!data?.mine;

  // Her own observation: the pipeline's view knows the finer steps and their content, whichever side it was
  // captured on (bd-15y1pc).
  useEffect(() => {
    if (!mine) return undefined;
    let live = true;
    leader.getObservation(id).then((v) => { if (live) setView(v); }).catch(() => { /* the row's step is enough */ });
    return () => { live = false; };
  }, [mine, id]);

  useEffect(() => () => { player.current?.pause(); }, []);

  const back = () => (location.key && location.key !== "default" ? navigate(-1) : navigate("/portal/coach/reports"));
  const name = data?.teacher?.name || view?.teacher?.name || C.dash;
  const first = name.split(/\s+/)[0] || name;
  const stopped = view?.step === "stopped";
  const at = view ? trackerIndex(view.step) : indexFromRow(data?.step);
  const allDone = at >= 5;
  const viewStep = view?.step;
  // bd-gie5ep — hers from either side: the step waiting on her opens here.
  const herTurn = mine && !!view && HER_STEPS.includes(view.step) && !(view.step === "report" && view.preparing);
  const onWhatsApp = !mine && HER_STEPS.includes((view ? view.step : data?.step) || "");
  const working = (viewStep && WORKER_STEPS.has(viewStep)) || (viewStep === "report" && view?.preparing) || (!view && data?.step === "analysing");
  const dockStep = herTurn ? (["", "form", "debrief", "feedback", "send"][at] as "" | "form" | "debrief" | "feedback" | "send") : "";
  const score = data ? (data.score ?? data.dcScore ?? null) : null;
  const reportImage = data?.imageUrl || view?.report.imageUrl || null;
  const reportCaption = data?.caption || view?.report.caption || null;

  const today = pkToday();
  const dayOf = (iso: string | null | undefined) => { const d = pkDayOf(iso ?? null); return d ? dayName(d, today, days) : ""; };
  const shownDate = data ? dayOf(data.date) : "";
  const sentOn = dayOf(data?.sentAt || data?.date);

  const togglePlay = () => {
    if (!data?.audioUrl) return;
    try {
      if (!player.current) {
        player.current = new Audio(data.audioUrl);
        player.current.onended = () => setPlaying(false);
      }
      if (playing) { player.current.pause(); setPlaying(false); } else { void player.current.play(); setPlaying(true); }
    } catch { setPlaying(false); }
  };

  const labels = [C.stepAnalysed, C.stepForm, C.stepDebrief, C.stepFeedback, C.stepSend(first)];
  const nowText = onWhatsApp ? C.onWhatsApp : herTurn ? C.yourTurn : working ? C.working : undefined;
  const steps: ProgressStep[] = labels.map((label, i) => ({
    label,
    sub: i === 0 && shownDate ? shownDate : undefined,
    state: allDone || i < at ? "done" : i === at ? "current" : "later",
    nowText: i === at ? nowText : undefined,
  }));

  const time = data ? pkTime(data.date) : null;
  const dock = dockStep ? (
    <Link to={observationPath(id, dockStep)} data-testid="obs-dock"
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
          <Card className="flex items-center gap-3.5 px-4 py-3.5">
            <ScoreRing value={score} label={C.dcScoreOf(C.pct(score))} text={C.pct(score)} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[17px] font-semibold">{C.dcScore}</span>
              <span className="truncate text-[13px] text-[#6b7280]">{allDone && data.score != null ? C.finalScore(C.pct(data.score)) : C.draftBeforeCheck}</span>
            </span>
            {data.audioUrl && (
              <button type="button" onClick={togglePlay} aria-label={playing ? C.pauseRecording : C.playRecording}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[#48b078] bg-white text-[#48b078]">
                {playing ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5 fill-current" aria-hidden="true" />}
              </button>
            )}
          </Card>

          {stopped ? (
            <Card className="flex gap-2.5 bg-[#fef3c7] p-4 text-[15px] text-[#b45309]">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><span>{C.stopped}</span>
            </Card>
          ) : (
            <ProgressSteps heading={C.steps} steps={steps} done={allDone} doneLabel={C.reportSentOn(sentOn)} />
          )}
          {onWhatsApp && <p className="px-1 text-[13px] text-[#6b7280]">{C.continueOnWhatsApp}</p>}

          {allDone && mine && (
            <>
              <h2 className="mx-1 mt-2 text-[22px] font-semibold leading-[1.2]">{C.whatYouMade}</h2>
              <div className={LIST_CARD} data-testid="what-you-made">
                <ListRow icon="file" label={C.stepForm} subtitle={C.formRowSub} variant="row" first to={observationPath(id, "form")} />
                {view?.talk.guide && <ListRow icon="file" label={C.stepDebrief} subtitle={C.debriefRowSub} variant="row" first={false} to={observationPath(id, "debrief")} />}
                {view?.talk.feedback && <ListRow icon="file" label={C.stepFeedback} subtitle={C.feedbackRowSub} variant="row" first={false} to={observationPath(id, "feedback")} />}
              </div>
            </>
          )}

          {allDone && reportImage && (
            <>
              <h2 className="mx-1 mt-2 text-[22px] font-semibold leading-[1.2]">{C.reportReceived(first)}</h2>
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
