import { useCallback, useEffect, useRef, useState } from "react";
import { useObserveRoutes } from "../observe/observeRoutes";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Check, Compass, MessageCircle, Sparkles } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { leader } from "../../services/api";
import type { TalkGuide, TalkGuideSection } from "../../services/api";
import { cn } from "@/lib/utils";
import CoachRecorder from "../../components/coaching/coach/CoachRecorder";
import { AUDIO_ACCEPT, checkRecording } from "../../lib/coachingUpload";
import { holdFile, isFileRefused, tellUnreadablePick } from "../../lib/pickedRead";
import { SendError } from "../../lib/coachingSend";
import { sendTalk } from "../../lib/coachObserve";
import type { FinishedRecording } from "../../lib/lessonRecorder";
import { canRecordHere } from "../../lib/recordingSupport";
import { deleteRecording } from "../../lib/recordingStore";
import { useCopy } from "../../teacher/i18n";
import { NOTICES } from "../../teacher/notices/copy";
import { PageChip } from "../../teacher/TeacherPage";
import { LoadState } from "../../teacher/lessons/LoadState";
import { AudioCard, RecordUploadPair } from "../../teacher/ui";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import ReportsFrame from "./ReportsFrame";
import { InsightRow } from "./InsightRow";
import { RubricGuide } from "./RubricGuide";
import { REPORTS } from "./copy";
import { OBSERVATION_STEPS, SCREEN_STEP } from "./paths";
import { firstNameOf, teacherNameOf, useObservationView } from "./useObservationView";
import { useBack } from "../../lib/useBack";
import { useFlowV6 } from "../flow/useCoachFlowV2";
import { DebriefDock, DebriefListeningStage, ErrorAction, ErrorCard, FeedbackCard } from "../flow/VisitV7";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { coachReportPath } from "../report/api";
import { FLOW_V7_ERRORS } from "../flow/copyV7errors";

/**
 * bd-4404s7.5 — Debrief, step 3 of 5 (Blueprint Coach_Debrief): the guide for her talk with the teacher — the one the
 * bot writes from the form she just saved (what went well, one thing to grow, one action, the question to end on) — then
 * Start recording or Upload recording on the kit's RecordUploadPair. The talk goes to R2 and is attached to the observation
 * (presign → upload → talk), and she is back on the observation page, where her Digital Coach listens (about 3 minutes)
 * and writes her feedback.
 *
 * Real routes: POST talk/guide (the first open can take a minute; 409 = the form is not saved yet), observe-upload/presign,
 * POST talk, POST talk/retry. Read back later (the step is past the talk) it shows the guide the observation kept.
 *
 * bd-tymy1n (queue #179) — an uploaded talk is read when she picks it, and what goes up (and what Try again sends again)
 * is those bytes, never the picked file the Android app may no longer open. A file that will not open is refused here.
 *
 * bd-o15qnr.39 (queue #204; the operator 22 Nov ~00:40: "I got thrown back to the previous page ... I couldn't tell if my
 * audio got submitted and is being analyzed") — on the v6/v7 switch she stays here: Uploaded, then "The Digital Coach is
 * listening to your debrief" (about 3 minutes, she can leave, it shows on the visit) with her recording playing in place;
 * the page asks again by itself (useObservationView) and shows the debrief report's card once the feedback is written.
 * Off: back on the observation page, as before.
 *
 * bd-o15qnr.49 (queue #254; the operator 24 Nov ~11:00: "Maybe the record button should be a floating button at the bottom
 * of the page all the time, so they can read the notes and then they know that here is where they will start recording")
 * — on the v6/v7 switch Record debrief and Upload recording sit in the frame's dock, pinned to the bottom of the screen
 * the whole time she reads the notes (above the menu and the safe area, room kept under the last note); the pair at the
 * end of the page is gone. Same gate as the pair: the notes are there (or did not load) and the debrief is hers to
 * record. Off: the pair at the end, as before.
 *
 * The recorder is the existing CoachRecorder: its Finish sheet (the kit's ConfirmTray) takes its words from `C.recorder`, in
 * English and Urdu; its other on-screen words are still English only (see the gap list).
 */
type Stage = "guide" | "recording" | "micBlocked" | "sending" | "failed";
type GuideState = "loading" | "ready" | "failed" | "not_ready";
type Pending = { blob: Blob; filename: string; recordingId: string | null };

const GUIDE_ICON = { strengths: Check, growth: Compass, action: Sparkles } as const;

function GuideBlock({ guide }: { guide: TalkGuide }) {
  const C = useCopy(REPORTS);
  const labels = { strengths: C.wentWell, growth: C.toGrow, action: C.oneAction } as const;
  const tones = { strengths: "good", growth: "grow", action: "action" } as const;
  const quote = (sec: TalkGuideSection) => (sec.say_this ? <span className="mt-1 block italic text-[#4b5563]">“{sec.say_this}”</span> : null);
  return (
    <section data-testid="talk-guide" aria-label={C.debriefTitle} className={cn(LIST_CARD, "flex flex-col gap-3.5 p-3.5")}>
      {guide.intro && <p className="text-[15px] leading-relaxed" dir="auto">{guide.intro}</p>}
      {Array.isArray(guide.conversation) ? <RubricGuide guide={guide} />
        : guide.sections
        ? (["strengths", "growth", "action"] as const).map((k) => {
          const sec = guide.sections?.[k];
          if (!sec) return null;
          const Icon = GUIDE_ICON[k];
          return (
            <InsightRow key={k} tone={tones[k]} icon={<Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />} label={labels[k]}>
              {sec.body}{quote(sec)}
            </InsightRow>
          );
        })
        : (guide.steps || []).map((st, i) => (
          <InsightRow key={`${i}-${st.title}`} tone="action" icon={<b className="text-[15px]">{i + 1}</b>} label={st.title}>
            {st.body}{quote(st)}
          </InsightRow>
        ))}
      {guide.reflection_question && (
        <InsightRow tone="ask" icon={<MessageCircle className="h-[18px] w-[18px]" strokeWidth={2.2} />} label={C.askLast}>
          {guide.reflection_question}
        </InsightRow>
      )}
      {guide.outro && <p className="text-[14px] leading-relaxed text-[#6b7280]" dir="auto">{guide.outro}</p>}
    </section>
  );
}

const Note = ({ children, tone = "grey" }: { children: React.ReactNode; tone?: "grey" | "amber" }) => (
  <p role={tone === "amber" ? "alert" : undefined}
    className={cn("rounded-2xl px-4 py-4 text-[16px] font-semibold", tone === "amber" ? "bg-[#fef3c7] text-[#b45309]" : cn(LIST_CARD, "text-center text-[#6b7280]"))}>{children}</p>
);

/**
 * bd-ewbzns.4.5 — writing the guide can outrun the portal→bot request (sandbox, 7 Nov: the Urdu guide took 31.5 s and
 * the ask came back 502 at 30.7 s), yet the bot finishes and keeps it on the observation. So a 5xx is asked again after
 * these waits — the kept guide comes back at once — and only after the last does the page say it did not load.
 */
export const GUIDE_RETRY_MS = [15_000, 30_000] as const;

export default function Debrief() {
  const C = useCopy(REPORTS);
  const N = useCopy(NOTICES);
  const { id = "" } = useParams();
  const routes = useObserveRoutes();
  const navigate = useNavigate();
  const { view, status, reload } = useObservationView(id);
  const home = routes.observation(id);
  const back = useBack(home);
  const [guide, setGuide] = useState<TalkGuide | null>(null);
  const [guideState, setGuideState] = useState<GuideState>("loading");
  const [canRecord, setCanRecord] = useState(true);
  const [stage, setStage] = useState<Stage>("guide");
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<SendError | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const asked = useRef(false);
  // bd-ewbzns.4.5 — the guide's ask outlives a re-render of the view; only leaving the page stops it.
  const mounted = useRef(true);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { mounted.current = false; if (retryTimer.current) clearTimeout(retryTimer.current); }, []);

  const name = teacherNameOf(view);
  const first = firstNameOf(name);
  const step = view?.step;
  // bd-o15qnr.39 — on the v6/v7 switch the page stays after the recording is in (justSent) and says what happens next.
  const v7 = useFlowV6() === true;
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const [justSent, setJustSent] = useState(false);
  const listeningNow = v7 && (step === "listening" || (justSent && step === "talk" && !view?.problem));
  const hers = (step === "talk" || step === "draft") && !listeningNow;
  const talkAudio = v7 ? view?.talk.audioUrl || null : null;
  const feedbackReady = v7 && !!view?.talk.feedback && step !== "listening";
  const feedbackTo = routes.coachGate ? coachReportPath(id) : routes.observation(id, "feedback");

  useEffect(() => { canRecordHere().then(setCanRecord).catch(() => { /* the recorder says if it cannot */ }); }, []);

  // The guide's ask, and its own asks again after a 5xx or no answer (GUIDE_RETRY_MS) before it says it did not load.
  const askGuide = useCallback((attempt: number) => {
    leader.getTalkGuide(id)
      .then((r) => { if (mounted.current) { setGuide(r.guide || null); setGuideState("ready"); } })
      .catch((err) => {
        if (!mounted.current) return;
        const code = (err as { response?: { status?: number } })?.response?.status;
        if (code === 409) { setGuideState("not_ready"); return; }
        // A 5xx or no answer: the guide may still be being written; ask again before saying it did not load.
        if ((code === undefined || code >= 500) && attempt < GUIDE_RETRY_MS.length) {
          retryTimer.current = setTimeout(() => askGuide(attempt + 1), GUIDE_RETRY_MS[attempt]);
          return;
        }
        setGuideState("failed");
      });
  }, [id]);

  // The guide: kept on the observation once written; otherwise asked for (the first ask can take a minute).
  useEffect(() => {
    if (!view || asked.current) return;
    if (view.talk.guide) { asked.current = true; setGuide(view.talk.guide); setGuideState("ready"); return; }
    if (!hers) { asked.current = true; setGuideState("ready"); return; }
    asked.current = true;
    askGuide(0);
  }, [view, hers, askGuide]);

  // bd-tfya0m (queue #205) — "Guide did not load" is never the end: Try again asks once more (with its own asks again).
  const guideAgain = () => { setGuideState("loading"); askGuide(0); };
  // bd-o15qnr.28 (v7, board m9-errors card 3): no guide is the red-edged card — record anyway, Try again, or record now.
  const E = useCopy(FLOW_V7_ERRORS);

  const send = async (audio: Pending) => {
    setPending(audio);
    setFailure(null);
    setProgress(0);
    setStage("sending");
    try {
      await sendTalk(id, { blob: audio.blob, filename: audio.filename }, undefined, undefined, setProgress);
      if (audio.recordingId) { try { await deleteRecording(audio.recordingId); } catch { /* already gone */ } }
      if (v7) { setJustSent(true); setStage("guide"); reload(); return; }
      navigate(home, { replace: true });
    } catch (err) {
      setFailure(err instanceof SendError ? err : new SendError("network"));
      setStage("failed");
    }
  };

  const onRecorded = (out: FinishedRecording) => { void send({ blob: out.blob, filename: `Talk${out.type.ext}`, recordingId: out.id }); };
  const onFile = async (picked: File | undefined) => {
    setFileError(null);
    if (!picked) return;
    // bd-hronni: a recording by its name, its type or its first bytes (an Opus file with no name ending is one)
    const checked = await checkRecording(picked);
    if (checked.problem || !checked.file) { setFileError(checked.problem === "too_large" ? C.tooLarge : C.notAudio); return; }
    const out = await holdFile(checked.file);
    if (isFileRefused(out)) { tellUnreadablePick("audio", checked.file, out.errName); setFileError(C.fileWontOpen); return; }
    void send({ blob: out.file, filename: checked.file.name, recordingId: null });
  };

  if (view && ["analysing"].includes(view.step)) return <Navigate to={home} replace />;

  const chips = <><PageChip>{C.aboutTenMinutes}</PageChip><PageChip>{C.afterClass}</PageChip></>;
  const recording = stage === "recording" || stage === "sending";
  const problem = view && hers && view.problem ? C.problems[view.problem as keyof typeof C.problems] : null;
  const canRetry = view?.problem === "failed" || view?.problem === "feedback_failed";
  // bd-w0zbbe: no recording until the guide is there (or did not load) — the talk follows the guide.
  const canStart = stage === "guide" && !!view && hers && (guideState === "ready" || guideState === "failed");
  const record = () => setStage(canRecord ? "recording" : "micBlocked");
  const pick = () => input.current?.click();
  // bd-o15qnr.49 — v7: Record debrief floats at the bottom (the frame's dock), not at the end of the notes.
  const dock = v7 && canStart ? <DebriefDock onRecord={record} onUpload={pick} /> : undefined;

  return (
    <ReportsFrame title={C.debriefTitle} crumb={name ? C.stepCrumb(name, SCREEN_STEP.debrief, OBSERVATION_STEPS) : C.observation} onBack={recording ? undefined : back}
      chips={recording ? undefined : chips} bare={recording} backTo={recording ? home : undefined} testId="coach-debrief"
      dock={dock} dockSpace={!!dock}>
      <LoadState status={status === "ok" ? "ok" : status} empty={false} onRetry={reload} />

      {stage === "guide" && view && (
        <>
          {/* bd-w0zbbe: a coach who saw only "Writing your guide" left after 4 s and thought the notes never came. How
              long it takes, and that she can leave (the guide is kept on the observation and shows when she is back). */}
          {guideState === "loading" && (
            <div data-testid="guide-writing" className={cn(LIST_CARD, "flex flex-col gap-1 px-4 py-4 text-center")}>
              <p className="text-[16px] font-semibold text-[#6b7280]">{C.writingGuide}</p>
              <p className="text-[15px] text-[#6b7280]">{C.guideWait}</p>
              <p className="text-[15px] text-[#6b7280]" dir="auto">{N.leave}</p>
            </div>
          )}
          {guideState === "failed" && v7 && (
            <ErrorCard testId="guide-failed" title={E.noGuide} line={E.noGuideLine}>
              <ErrorAction onClick={guideAgain}>{C.retry}</ErrorAction>
              {hers && <ErrorAction quiet onClick={() => setStage(canRecord ? "recording" : "micBlocked")}>{E.recordWithoutGuide}</ErrorAction>}
            </ErrorCard>
          )}
          {guideState === "failed" && !v7 && (
            <div data-testid="guide-failed" role="alert" className="flex items-center gap-3 rounded-2xl bg-[#fef3c7] p-4 text-[#b45309]">
              <span className="flex-1 text-[16px] font-semibold">{C.guideFailed}</span>
              <button type="button" onClick={guideAgain}
                className={cn("min-h-[48px] rounded-xl bg-white px-4 text-[15px] font-semibold text-[#33374a]", FOCUS)}>{C.retry}</button>
            </div>
          )}
          {guideState === "not_ready" && <Note tone="amber">{C.saveFormFirst}</Note>}
          {guideState === "ready" && guide && <GuideBlock guide={guide} />}
          {step === "listening" && !v7 && <Note>{C.listeningTalk}</Note>}
          {listeningNow && (
            <DebriefListeningStage>
              {justSent && <p data-testid="debrief-uploaded" className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-[#2f7a52]"><Check className="h-4 w-4" aria-hidden="true" />{W.uploaded}</p>}
              <Link to={home} className={cn("flex min-h-[56px] items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[16px] font-semibold text-[#33374a]", FOCUS)}>{W.backToVisit}</Link>
            </DebriefListeningStage>
          )}
          {feedbackReady && <FeedbackCard id={id} to={feedbackTo} />}
          {talkAudio && <AudioCard title={W.debriefRecording} src={talkAudio} controls testId="debrief-recording" />}

          {problem && (
            <div role="alert" className="flex items-center gap-3 rounded-2xl bg-[#fef3c7] p-4 text-[#b45309]">
              <span className="flex-1 text-[16px] font-semibold">{problem}</span>
              {canRetry && (
                <button type="button" onClick={() => { void leader.retryTalk(id).then(reload).catch(() => { /* the problem stays on screen */ }); }}
                  className={cn("min-h-[48px] rounded-xl bg-white px-4 text-[15px] font-semibold text-[#33374a]", FOCUS)}>{C.retry}</button>
              )}
            </div>
          )}

          {/* bd-w0zbbe: no recording until the guide is there (or did not load) — the talk follows the guide. v7: the two
              buttons are the dock's (bd-o15qnr.49); the file input and its error stay here. */}
          {canStart && (
            <>
              {!dock && <RecordUploadPair onRecord={record} onUpload={pick} />}
              <input ref={input} data-testid="talk-input" type="file" accept={AUDIO_ACCEPT} className="hidden"
                onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
              {fileError && <Note tone="amber">{fileError}</Note>}
            </>
          )}
        </>
      )}

      {stage === "recording" && (
        <CoachRecorder label={C.debriefWith(first)} copy={C.recorder} shortMs={3 * 60_000} onFinished={onRecorded} onMicBlocked={() => setStage("micBlocked")} />
      )}

      {stage === "micBlocked" && (
        <div className="flex flex-col gap-3">
          <Note tone="amber">{C.micBlocked}</Note>
          <p className={cn(LIST_CARD, "p-3.5 text-[15px] leading-relaxed text-[#4b5563]")}>{Capacitor.isNativePlatform() ? C.micHelpApp : C.micHelpWeb}</p>
          <button type="button" onClick={() => setStage("recording")} className={cn("min-h-[56px] rounded-2xl bg-[#33374a] text-base font-semibold text-white", FOCUS)}>{C.retry}</button>
          <button type="button" onClick={() => { setStage("guide"); setTimeout(() => input.current?.click(), 0); }}
            className={cn("min-h-[56px] rounded-2xl border border-[#d1d5db] bg-white text-base font-semibold text-[#33374a]", FOCUS)}>{C.uploadRecording}</button>
        </div>
      )}

      {stage === "sending" && (
        <div className="flex flex-col gap-3">
          <Note>{C.sendingTalk}</Note>
          <div className="relative h-4 w-full overflow-hidden rounded-full bg-[#e5e7eb]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full rounded-full bg-[#33374a] transition-[width]" style={{ width: `${Math.max(4, progress)}%` }} />
          </div>
          <p className={cn(LIST_CARD, "p-3.5 text-[15px] font-semibold text-[#4b5563]")}>{C.keepOpenSending}</p>
        </div>
      )}

      {stage === "failed" && failure && (
        <div className="flex flex-col gap-3">
          <Note tone="amber">{failure.kind === "network" ? C.netTitle : C.refused}</Note>
          {failure.kind === "network" && <p className={cn(LIST_CARD, "p-3.5 text-[15px] font-semibold text-[#4b5563]")}>{C.netSafe}</p>}
          <button type="button" onClick={() => (failure.kind === "network" && pending ? void send(pending) : navigate(home))}
            className={cn("min-h-[56px] rounded-2xl bg-[#33374a] text-base font-semibold text-white", FOCUS)}>{C.retry}</button>
        </div>
      )}
    </ReportsFrame>
  );
}
