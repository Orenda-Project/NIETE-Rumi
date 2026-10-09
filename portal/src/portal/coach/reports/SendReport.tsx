import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Check } from "lucide-react";
import { leader } from "../../services/api";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { LoadState } from "../../teacher/lessons/LoadState";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { coach } from "../../services/api";
import { LESSONS } from "../../teacher/lessons/copy";
import { dayName, pkDayOf, pkToday } from "../../teacher/lessons/days";
import { ScoreRing } from "../../teacher/ui";
import { BottomButton, Initials, useLoad } from "../ui";
import ReportsFrame from "./ReportsFrame";
import { REPORTS } from "./copy";
import { observationPath } from "./paths";
import { firstNameOf, teacherNameOf, useObservationView } from "./useObservationView";
import { useBackTo } from "./useBackTo";

/**
 * bd-4404s7.5 — Send {name} the report, step 5 of 5 (Blueprint Coach_SendReport). The report exactly as the teacher
 * will get it — the image and caption the bot made — who it goes to, and one Send. Routes (all real, the old
 * /leader/observe/:id page used the same): report/preview makes the report, report/send sends it on the teacher's
 * WhatsApp. Nothing is sent until she taps Send.
 *
 *   feedback / preparing   "Making the report": opened straight from Your feedback, the page asks the bot to make
 *                          it (once), then re-reads until it is ready
 *   report                 the preview, To, and Send to {name}
 *   send_failed / refused  "Report not sent" in the app only, with Try again (the report is made again)
 *   sending / waiting      the bot is sending / waiting for the teacher to open the message
 *   sent                   Sent to {name}, and a way back to the observation
 *
 * The header (ScoreRing, name, Observation · day, the percentage) is the observation row's score (GET coach/observation/:id).
 * NOT drawn: "37/52 marks" and the Went well / To grow / Next step lines of the Blueprint. The view carries the report as
 * an image and caption only; marks and sections are not served to the coach (see the report's gap list).
 */
export default function SendReport() {
  const C = useCopy(REPORTS);
  const { days } = useCopy(LESSONS);
  const { id = "" } = useParams();
  const { view, status, reload } = useObservationView(id);
  const back = useBackTo(observationPath(id));
  // The observation row: the score and the day, for the preview's header (a failed read just leaves the header out).
  const { data: row } = useLoad(() => coach.getObservation(id), [id]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);

  const name = teacherNameOf(view);
  const first = firstNameOf(name);
  const step = view?.step;

  // Straight from Your feedback the report is not made yet: ask once, then the view takes over.
  useEffect(() => {
    if (step !== "feedback" || asked.current) return;
    asked.current = true;
    leader.previewReport(id).then(reload).catch(() => setFailed(true));
  }, [step, id, reload]);

  const send = async () => {
    setBusy(true);
    setFailed(false);
    try { await leader.sendReport(id); reload(); } catch { setFailed(true); }
    setBusy(false);
  };
  const again = async () => {
    setBusy(true);
    setFailed(false);
    try { await leader.previewReport(id); reload(); } catch { setFailed(true); }
    setBusy(false);
  };

  // Not at this step yet (or it is not hers): the observation page says where it is.
  if (view && ["analysing", "draft", "talk", "listening"].includes(view.step)) return <Navigate to={observationPath(id)} replace />;

  const making = step === "feedback" || (step === "report" && view?.preparing) || step === "sending";
  const ready = step === "report" && !view?.preparing && view?.problem !== "send_failed";
  const notSent = failed || (step === "report" && view?.problem === "send_failed");
  const phone = view?.report.teacherPhone || view?.teacher?.phone || null;

  const dock = ready ? (
    <BottomButton onClick={send} disabled={busy}>{C.sendTo(first)}</BottomButton>
  ) : undefined;

  return (
    <ReportsFrame title={name ? C.sendTitle(first) : C.observation} crumb={name ? C.stepCrumb(name, 5, 5) : undefined} onBack={back} dock={dock} testId="coach-send-report">
      <LoadState status={status === "ok" ? "ok" : status} empty={false} onRetry={reload} />

      {notSent && (
        <div role="alert" data-testid="send-failed" className="flex items-center gap-3 rounded-2xl bg-[#fee4e2] p-4 text-[#c8331f]">
          <span className="flex-1 text-[16px] font-semibold">{C.sendFailed}</span>
          {step === "report" && view?.problem === "send_failed" && (
            <button type="button" onClick={again} disabled={busy} className={cn("min-h-[48px] rounded-xl bg-white px-4 text-[15px] font-semibold text-[#33374a]", FOCUS)}>{C.retry}</button>
          )}
        </div>
      )}

      {making && !notSent && (
        <p data-testid="send-making" className={cn(LIST_CARD, "px-4 py-5 text-center text-[16px] font-semibold text-[#6b7280]")}>{step === "sending" ? C.sending : C.making}</p>
      )}

      {ready && view && (
        <>
          <h2 className="mx-1 mt-1 text-[22px] font-semibold leading-[1.2]">{C.preview}</h2>
          {row && (row.score ?? row.dcScore) != null && (
            <section data-testid="send-score" className={cn(LIST_CARD, "flex items-center gap-3.5 p-3.5")}>
              <ScoreRing value={row.score ?? row.dcScore ?? null} label={C.dcScore} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[17px] font-semibold" dir="auto">{name}</span>
                <span className="truncate text-[13px] text-[#6b7280]">{[C.observation, (() => { const d = pkDayOf(row.date); return d ? dayName(d, pkToday(), days) : ""; })()].filter(Boolean).join(" · ")}</span>
                <span className="text-[13px] font-semibold text-[#4b5563]">{C.pct(row.score ?? row.dcScore ?? null)}</span>
              </span>
            </section>
          )}
          <section data-testid="report-preview" className={cn(LIST_CARD, "flex flex-col gap-2 p-2.5")}>
            {view.report.imageUrl && <img src={view.report.imageUrl} alt={C.reportImage(name)} className="w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb]" />}
            {view.report.caption && <p className="whitespace-pre-line px-1 text-[14px] leading-relaxed" dir="auto">{view.report.caption}</p>}
            {view.report.companionText && <p className="whitespace-pre-line px-1 pb-1 text-[14px] leading-relaxed" dir="auto">{view.report.companionText}</p>}
          </section>
          <h2 className="mx-1 mt-2 text-[22px] font-semibold leading-[1.2]">{C.to}</h2>
          <section data-testid="send-to" className={cn(LIST_CARD, "flex min-h-[76px] items-center gap-3 px-3.5 py-2.5")}>
            <Initials name={name} size={48} />
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="line-clamp-2 text-[16px] font-semibold leading-[1.3]" dir="auto">{name}</span>
              {phone && <span className="text-[13px] leading-[1.3] text-[#6b7280]" dir="ltr">{`+${phone}`}</span>}
            </span>
          </section>
        </>
      )}

      {step === "waiting_teacher" && (
        <p data-testid="send-waiting" className={cn(LIST_CARD, "px-4 py-5 text-center text-[16px] font-semibold text-[#6b7280]")}>{C.waitingTeacher(first)}</p>
      )}

      {(step === "sent" || step === "done") && (
        <div data-testid="send-sent" className={cn(LIST_CARD, "flex flex-col items-center gap-3 p-5 text-center")}>
          <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#2f7a52] text-white"><Check className="h-10 w-10" strokeWidth={2.6} aria-hidden="true" /></span>
          <span className="text-[22px] font-semibold" dir="auto">{C.sentTitle(first)}</span>
          <Link to={observationPath(id)} className={cn("flex min-h-[56px] items-center justify-center rounded-2xl bg-[#33374a] px-6 text-[16px] font-semibold text-white", FOCUS)}>{C.openReport}</Link>
        </div>
      )}
    </ReportsFrame>
  );
}
