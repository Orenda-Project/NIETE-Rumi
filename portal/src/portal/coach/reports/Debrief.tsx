import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Check, Compass, MessageCircle, Sparkles } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { leader } from "../../services/api";
import type { TalkGuide, TalkGuideSection } from "../../services/api";
import { cn } from "@/lib/utils";
import CoachRecorder from "../../components/coaching/coach/CoachRecorder";
import { acceptFor, checkFile } from "../../lib/coachingUpload";
import { SendError } from "../../lib/coachingSend";
import { sendTalk } from "../../lib/coachObserve";
import type { FinishedRecording } from "../../lib/lessonRecorder";
import { canRecordHere } from "../../lib/recordingSupport";
import { deleteRecording } from "../../lib/recordingStore";
import { useCopy } from "../../teacher/i18n";
import { PageChip } from "../../teacher/TeacherPage";
import { LoadState } from "../../teacher/lessons/LoadState";
import { RecordUploadPair } from "../../teacher/ui";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import ReportsFrame from "./ReportsFrame";
import { InsightRow } from "./InsightRow";
import { REPORTS } from "./copy";
import { observationPath } from "./paths";
import { firstNameOf, teacherNameOf, useObservationView } from "./useObservationView";
import { useBackTo } from "./useBackTo";

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
 * The recorder is the existing CoachRecorder (its own on-screen words are English only: see the gap list).
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
      {guide.sections
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

export default function Debrief() {
  const C = useCopy(REPORTS);
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { view, status, reload } = useObservationView(id);
  const home = observationPath(id);
  const back = useBackTo(home);
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

  const name = teacherNameOf(view);
  const first = firstNameOf(name);
  const step = view?.step;
  const hers = step === "talk" || step === "draft";

  useEffect(() => { canRecordHere().then(setCanRecord).catch(() => { /* the recorder says if it cannot */ }); }, []);

  // The guide: kept on the observation once written; otherwise asked for (the first ask can take a minute).
  useEffect(() => {
    if (!view || asked.current) return;
    if (view.talk.guide) { asked.current = true; setGuide(view.talk.guide); setGuideState("ready"); return; }
    if (!hers) { asked.current = true; setGuideState("ready"); return; }
    asked.current = true;
    leader.getTalkGuide(id)
      .then((r) => { setGuide(r.guide || null); setGuideState("ready"); })
      .catch((err) => setGuideState((err as { response?: { status?: number } })?.response?.status === 409 ? "not_ready" : "failed"));
  }, [view, hers, id]);

  const send = async (audio: Pending) => {
    setPending(audio);
    setFailure(null);
    setProgress(0);
    setStage("sending");
    try {
      await sendTalk(id, { blob: audio.blob, filename: audio.filename }, undefined, undefined, setProgress);
      if (audio.recordingId) { try { await deleteRecording(audio.recordingId); } catch { /* already gone */ } }
      navigate(home);
    } catch (err) {
      setFailure(err instanceof SendError ? err : new SendError("network"));
      setStage("failed");
    }
  };

  const onRecorded = (out: FinishedRecording) => { void send({ blob: out.blob, filename: `Talk${out.type.ext}`, recordingId: out.id }); };
  const onFile = (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    const problem = checkFile(file, "audio");
    if (problem) { setFileError(problem === "too_large" ? C.tooLarge : C.notAudio); return; }
    void send({ blob: file, filename: file.name, recordingId: null });
  };

  if (view && ["analysing"].includes(view.step)) return <Navigate to={home} replace />;

  const chips = <><PageChip>{C.aboutTenMinutes}</PageChip><PageChip>{C.afterClass}</PageChip></>;
  const recording = stage === "recording" || stage === "sending";
  const problem = view && hers && view.problem ? C.problems[view.problem as keyof typeof C.problems] : null;
  const canRetry = view?.problem === "failed" || view?.problem === "feedback_failed";

  return (
    <ReportsFrame title={C.debriefTitle} crumb={name ? C.stepCrumb(name, 3, 5) : C.observation} onBack={recording ? undefined : back}
      chips={recording ? undefined : chips} bare={recording} backTo={recording ? home : undefined} testId="coach-debrief">
      <LoadState status={status === "ok" ? "ok" : status} empty={false} onRetry={reload} />

      {stage === "guide" && view && (
        <>
          {guideState === "loading" && <Note>{C.writingGuide}</Note>}
          {guideState === "failed" && <Note tone="amber">{C.guideFailed}</Note>}
          {guideState === "not_ready" && <Note tone="amber">{C.saveFormFirst}</Note>}
          {guideState === "ready" && guide && <GuideBlock guide={guide} />}
          {step === "listening" && <Note>{C.listeningTalk}</Note>}

          {problem && (
            <div role="alert" className="flex items-center gap-3 rounded-2xl bg-[#fef3c7] p-4 text-[#b45309]">
              <span className="flex-1 text-[16px] font-semibold">{problem}</span>
              {canRetry && (
                <button type="button" onClick={() => { void leader.retryTalk(id).then(reload).catch(() => { /* the problem stays on screen */ }); }}
                  className={cn("min-h-[48px] rounded-xl bg-white px-4 text-[15px] font-semibold text-[#33374a]", FOCUS)}>{C.retry}</button>
              )}
            </div>
          )}

          {hers && guideState !== "not_ready" && (
            <>
              <RecordUploadPair onRecord={() => setStage(canRecord ? "recording" : "micBlocked")} onUpload={() => input.current?.click()} />
              <input ref={input} data-testid="talk-input" type="file" accept={`${acceptFor("audio")},audio/*`} className="hidden"
                onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
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
