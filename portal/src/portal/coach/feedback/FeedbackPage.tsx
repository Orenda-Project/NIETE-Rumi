import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calculator, CircleCheck, CircleHelp, ImagePlus, Lightbulb, Mic, Square, TriangleAlert, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy } from "../../teacher/i18n";
import { ChosenSoFar, ListRow, StepBar } from "../../teacher/ui";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { CARD, FOCUS } from "../../teacher/ui/styles";
import { AudioPlayer } from "../../newui/AudioPlayer";
import { useVoiceAnswer } from "../../lib/voiceAnswer";
import { BottomButton } from "../ui";
import { FEEDBACK, type FeedbackCopy } from "./copy";
import { checkScreenshot, failureText, MAX_SCREENSHOTS, SCREENSHOT_TYPES, sendFeedback, TOPICS, type Topic } from "./send";

/**
 * bd-x1tl95 — Send feedback, from the coach's More (/portal/coach/feedback). Coaches asked to give feedback by voice, so
 * a voice note is the big first button; she may write instead, or as well, and add up to three screenshots.
 *
 * One question per screen (the WhatsApp-flow form pattern): 1 Topic → 2 Your feedback → 3 Screenshots, one sticky
 * button each, the answers so far as ChosenSoFar with Change. Send uploads, then shows Thank you; Done goes back to More
 * replacing this page. The header's Back steps back through the form, then to More.
 *
 * In WhatsApp's browser (the in-app browser rules): the microphone and her playback stop on pagehide, on
 * visibilitychange to hidden and on freeze — the recording is kept, the sound does not keep playing after the browser
 * closes. The recorder is the reflection answer's (lib/voiceAnswer: a short clip in memory, 3 minutes at most).
 */
type Step = 1 | 2 | 3 | "sent";

const TOPIC_GLYPH: Record<Topic, typeof Lightbulb> = { broken: TriangleAlert, numbers: Calculator, idea: Lightbulb, other: CircleHelp };
const MORE = "/portal/coach/more";

export default function FeedbackPage() {
  const C = useCopy(FEEDBACK) as FeedbackCopy;
  const kit = useKitCopy();
  const navigate = useNavigate();
  const voice = useVoiceAnswer();
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [text, setText] = useState("");
  const [shots, setShots] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The in-app browser rule: nothing records or plays once she leaves the page or WhatsApp closes it.
  const { stop } = voice;
  useEffect(() => {
    const hush = () => {
      stop();
      root.current?.querySelectorAll("audio").forEach((a) => a.pause());
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") hush(); };
    window.addEventListener("pagehide", hush);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("freeze", hush);
    return () => {
      window.removeEventListener("pagehide", hush);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("freeze", hush);
    };
  }, [stop]);

  const recording = voice.state === "recording";
  const hasClip = voice.state === "recorded" && !!voice.clip;
  const said = hasClip || !!text.trim();

  const send = async () => {
    if (!topic || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendFeedback({ topic, text, clip: hasClip ? voice.clip : null, shots });
      setStep("sent");
    } catch (e) {
      setError(failureText(e, C));
    } finally {
      setSending(false);
    }
  };

  const back = step === 2 ? () => setStep(1) : step === 3 ? () => setStep(2) : undefined;
  const dock = step === 1 ? <BottomButton onClick={() => setStep(2)} disabled={!topic}>{C.next}</BottomButton>
    : step === 2 ? <BottomButton onClick={() => setStep(3)} disabled={!said || recording}>{C.next}</BottomButton>
      : step === 3 ? <BottomButton onClick={() => { void send(); }} disabled={sending}>{sending ? `${C.sending}…` : C.send}</BottomButton>
        : <BottomButton onClick={() => navigate(MORE, { replace: true })}>{C.done}</BottomButton>;

  return (
    <CoachGate>
      <TeacherPage title={C.title} backTo={back ? undefined : MORE} onBack={back} dock={dock} testId="coach-feedback">
        <div ref={root} className="flex flex-col gap-4">
          {step !== "sent" && <StepBar total={3} current={step} label={kit.stepOf(step, 3)} />}

          {step === 1 && (
            <section aria-label={C.topic} className="flex flex-col gap-2.5">
              <h2 className="mx-1 text-sm font-semibold text-[#4b5563]">{C.topic}</h2>
              {TOPICS.map((t) => {
                const Glyph = TOPIC_GLYPH[t];
                return (
                  <ListRow key={t} label={C[t]} glyph={<Glyph className="h-6 w-6" strokeWidth={2} aria-hidden="true" />}
                    state={topic === t ? "selected" : "default"} onPress={() => setTopic(t)} testId={`feedback-topic-${t}`} />
                );
              })}
            </section>
          )}

          {(step === 2 || step === 3) && topic && (
            <ChosenSoFar items={[
              { label: C.topic, value: C[topic], onChange: () => setStep(1) },
              ...(step === 3 ? [{ label: C.yourFeedback, value: text.trim() || C.voiceNote, onChange: () => setStep(2) }] : []),
            ]} />
          )}

          {step === 2 && <TellUs C={C} voice={voice} text={text} setText={setText} />}

          {step === 3 && <Screenshots C={C} shots={shots} setShots={setShots} />}

          {step === "sent" && (
            <section aria-live="polite" className={cn(CARD, "flex flex-col items-center gap-2 px-5 py-8 text-center")}>
              <CircleCheck className="h-12 w-12 text-[#2f7a52]" strokeWidth={2} aria-hidden="true" />
              <h2 className="text-[20px] font-bold text-[#1d2025]">{C.thanks}</h2>
              <p className="text-[16px] text-[#4b5563]">{C.gotIt}</p>
            </section>
          )}

          {error && <p role="alert" className="mx-1 text-[15px] font-semibold text-[#c8331f]">{error}</p>}
        </div>
      </TeacherPage>
    </CoachGate>
  );
}

/** Step 2: the voice note first (the coaches' ask), then the box to write in. */
function TellUs({ C, voice, text, setText }: {
  C: FeedbackCopy; voice: ReturnType<typeof useVoiceAnswer>; text: string; setText: (v: string) => void;
}) {
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!voice.clip) { setClipUrl(null); return undefined; }
    const url = URL.createObjectURL(voice.clip.blob);
    setClipUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [voice.clip]);

  return (
    <section aria-label={C.yourFeedback} className="flex flex-col gap-3">
      <h2 className="mx-1 text-sm font-semibold text-[#4b5563]">{C.yourFeedback}</h2>
      {voice.state === "recording" ? (
        <div className={cn(CARD, "flex items-center gap-3 p-3")}>
          <span className="h-3 w-3 shrink-0 rounded-full bg-[#c8331f] motion-safe:animate-pulse" aria-hidden="true" />
          <span className="flex-1 text-[17px] font-semibold">{C.recording}</span>
          <span className="text-[16px] tabular-nums text-[#6b7280]" dir="ltr">{clock(voice.elapsedMs)}</span>
          <button type="button" aria-label={C.stop} onClick={voice.stop}
            className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#c8331f] text-white", FOCUS)}>
            <Square className="h-5 w-5 fill-current" aria-hidden="true" />
          </button>
        </div>
      ) : voice.state === "recorded" && voice.clip ? (
        <div data-testid="feedback-voice" className={cn(CARD, "flex items-center gap-2 p-2.5")}>
          <div className="min-w-0 flex-1">{clipUrl && <AudioPlayer src={clipUrl} label={C.voiceNote} copy={C.audio} bare />}</div>
          <button type="button" aria-label={C.removeVoice} onClick={voice.discard}
            className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#33374a]", FOCUS)}>
            <Trash2 className="h-[22px] w-[22px]" aria-hidden="true" />
          </button>
        </div>
      ) : voice.available ? (
        <button type="button" onClick={() => { void voice.start(); }}
          className={cn("flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl bg-[#33374a] px-4 text-[17px] font-semibold text-white", FOCUS)}>
          <Mic className="h-6 w-6" aria-hidden="true" />{C.record}
        </button>
      ) : null}
      {voice.state === "blocked" && (
        <div role="alert" className="mx-1 flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-[#c8331f]">{C.micBlocked}</span>
          <span className="text-[14px] text-[#4b5563]">{C.micHint}</span>
        </div>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="mx-1 text-sm font-semibold text-[#4b5563]">{C.orWrite}</span>
        {/* dir=auto: Urdu she types runs right to left, English left to right (bd-phk3v4). */}
        <textarea dir="auto" aria-label={C.orWrite} value={text} maxLength={2000} rows={4} onChange={(e) => setText(e.target.value)}
          className={cn("w-full resize-none rounded-2xl border-[1.5px] border-[#d1d5db] bg-white px-4 py-3 text-[16px] leading-snug", FOCUS)} />
      </label>
    </section>
  );
}

/** Step 3: up to three screenshots, each with Remove; optional. */
function Screenshots({ C, shots, setShots }: { C: FeedbackCopy; shots: File[]; setShots: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const made = shots.map((f) => URL.createObjectURL(f));
    setUrls(made);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [shots]);

  const add = (files: FileList | null) => {
    setProblem(null);
    const picked = Array.from(files || []);
    const bad = picked.map(checkScreenshot).find(Boolean);
    if (bad) setProblem(bad === "too_large" ? C.tooLarge : C.notPicture);
    const good = picked.filter((f) => !checkScreenshot(f));
    if (good.length) setShots([...shots, ...good].slice(0, MAX_SCREENSHOTS));
  };

  return (
    <section aria-label={C.screenshots} className="flex flex-col gap-3">
      <div className="mx-1 flex flex-col">
        <h2 className="text-sm font-semibold text-[#4b5563]">{C.screenshots}</h2>
        <span className="text-[13px] text-[#6b7280]">{C.optional}</span>
      </div>
      {shots.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
          {shots.map((f, i) => (
            <li key={`${f.name}-${i}`} data-testid="feedback-shot" className="relative h-[120px] w-[96px] overflow-hidden rounded-xl border border-[#e5e7eb] bg-[#f3f4f6]">
              {urls[i] && <img src={urls[i]} alt="" className="h-full w-full object-cover" />}
              <button type="button" aria-label={C.removeScreenshot} onClick={() => setShots(shots.filter((_, j) => j !== i))}
                className={cn("absolute end-0 top-0 flex h-11 w-11 items-center justify-center", FOCUS)}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1d2025]/75 text-white"><X className="h-4 w-4" aria-hidden="true" /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shots.length < MAX_SCREENSHOTS && (
        <button type="button" onClick={() => input.current?.click()}
          className={cn(CARD, "flex min-h-[64px] w-full items-center gap-3.5 px-3.5 text-start text-[17px] font-semibold", FOCUS)}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-[#33374a]" aria-hidden="true">
            <ImagePlus className="h-[22px] w-[22px]" />
          </span>
          {C.addScreenshot}
        </button>
      )}
      <input ref={input} data-testid="feedback-shot-input" type="file" multiple accept={SCREENSHOT_TYPES.join(",")} className="hidden"
        onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      {problem && <p role="alert" className="mx-1 text-[15px] font-semibold text-[#c8331f]">{problem}</p>}
    </section>
  );
}

/** m:ss for the recording's running clock, left to right in both languages. */
function clock(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
