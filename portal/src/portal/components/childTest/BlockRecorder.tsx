import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Camera, Check, Loader2, Mic, RotateCcw, Send, Square, WifiOff } from "lucide-react";
import type { ChildTestCard, MathsCard, ReadingCard } from "../../types/childTest";
import type { ChildTestCopy } from "../../lib/childTest/copy";
import { appTiming, inTimedMinute, initialBlock, reduceBlock, secondsLeft, elapsedSeconds } from "../../lib/childTest/blockMachine";
import * as Recordings from "../../lib/childTest/recordings";
import { uploadItem, type UploadApi } from "../../lib/childTest/uploader";
import { LessonRecorder } from "../../lib/lessonRecorder";
import { pickRecordingType } from "../../lib/recordingSupport";
import { keepScreenOn as defaultKeepScreenOn } from "../../lib/keepAwake";
import { playTone as defaultPlayTone } from "../../lib/childTest/tone";
import { childTest } from "../../services/api";
import { MathsStimulus, ReadingStimulus } from "./StimulusCard";

/**
 * bd-s1oo0.7 — one block of the child test (Urdu, English or maths) on one
 * screen: the child's card large, a big Start, a visible 60-second countdown
 * with a tone at 60 s, Stop, Record again, Send. This is the thing WhatsApp
 * cannot do — show an open card while a voice note records.
 *
 * The recording is LessonRecorder (opus 32 kb/s, 5-s chunks) writing to the
 * child-test store on the phone, so nothing is lost if the app is killed or the
 * internet drops; Send moves it to R2 and the bot, and only then off the phone.
 */

type Deps = {
  api: UploadApi;
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder: typeof MediaRecorder;
  playTone: () => void;
  keepScreenOn: () => Promise<() => Promise<void>>;
};

function defaultDeps(): Deps {
  return {
    api: childTest,
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    MediaRecorder: typeof MediaRecorder === "undefined" ? (undefined as unknown as typeof MediaRecorder) : MediaRecorder,
    playTone: () => defaultPlayTone(),
    keepScreenOn: () => defaultKeepScreenOn(),
  };
}

type Props = {
  card: ChildTestCard;
  sessionId: string;
  copy: ChildTestCopy;
  onSent: () => void;
  deps?: Partial<Deps>;
};

function mmss(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const BIG = "w-full rounded-2xl py-5 text-2xl font-semibold flex items-center justify-center gap-3 disabled:opacity-40";

export default function BlockRecorder({ card, sessionId, copy, onSent, deps: given }: Props) {
  const deps = { ...defaultDeps(), ...given } as Deps;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [state, dispatch] = useReducer(reduceBlock, initialBlock(card.block, card.timedSeconds || 60));
  const stateRef = useRef(state);
  stateRef.current = state;
  const recorderRef = useRef<LessonRecorder | null>(null);
  const releaseScreenRef = useRef<null | (() => Promise<void>)>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const isMaths = card.block === "maths";

  // the clock
  useEffect(() => {
    if (state.phase !== "recording") return undefined;
    const t = window.setInterval(() => dispatch({ type: "TICK", now: Date.now() }), 250);
    return () => window.clearInterval(t);
  }, [state.phase]);

  // the tone, once
  useEffect(() => {
    if (!state.toneDue) return;
    try { depsRef.current.playTone(); } catch { /* the screen still says time is up */ }
    dispatch({ type: "TONE_PLAYED" });
  }, [state.toneDue]);

  // leaving mid-recording: microphone and screen hold released; the chunks so far stay on the phone
  useEffect(() => () => {
    const rec = recorderRef.current;
    if (rec) void rec.stop().catch(() => {});
    void releaseScreenRef.current?.();
  }, []);

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const start = useCallback(async () => {
    const d = depsRef.current;
    const type = pickRecordingType(d.MediaRecorder);
    let stream: MediaStream;
    try {
      stream = await d.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      dispatch({ type: "MIC_DENIED" });
      return;
    }
    if (!type) {
      for (const tr of stream.getTracks()) tr.stop();
      dispatch({ type: "MIC_DENIED" });
      return;
    }
    const rec = new LessonRecorder({ stream, type, store: Recordings, MediaRecorder: d.MediaRecorder });
    recorderRef.current = rec;
    await rec.start();
    dispatch({ type: "START", now: Date.now() });
    try { releaseScreenRef.current = await d.keepScreenOn(); } catch { /* the page also says keep it open */ }
  }, []);

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    const finished = await rec.stop();
    void releaseScreenRef.current?.();
    releaseScreenRef.current = null;
    const event = { type: "STOPPED" as const, recordingId: finished.id, durationMs: finished.durationMs };
    // Tagged NOW, not at Send: a take stopped and then lost to a killed app is
    // still on the phone, tagged, and the list page sends it ("waiting to send").
    const after = reduceBlock(stateRef.current, event);
    const timing = { ...appTiming(after), startedAt: after.startedAt != null ? new Date(after.startedAt).toISOString() : null };
    try {
      await Recordings.tagRecording(finished.id, { sessionId, block: card.block, kind: "audio", timing });
    } catch { /* no phone storage: the take is in memory until Send */ }
    setAudioUrl(URL.createObjectURL(finished.blob));
    dispatch(event);
  }, [sessionId, card.block]);

  const recordAgain = useCallback(async () => {
    if (state.recordingId) {
      try { await Recordings.deleteRecording(state.recordingId); } catch { /* nothing stored */ }
    }
    setAudioUrl(null);
    setSendNote(null);
    dispatch({ type: "RERECORD" });
  }, [state.recordingId]);

  const onPhoto = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const id = `photo-${sessionId}-${Date.now()}`;
    try {
      await Recordings.savePhoto({ id, sessionId, blob: file });
    } catch { /* kept in memory below; Send will say if it cannot go */ }
    setPhoto({ id, url: URL.createObjectURL(file) });
  }, [sessionId]);

  const send = useCallback(async (opts: { photoDeclined?: boolean } = {}) => {
    if (!state.recordingId) return;
    dispatch({ type: "SEND" });
    setSendNote(null);
    const pending = (await Recordings.listPending(sessionId).catch(() => []))
      .filter((p) => p.meta.block === card.block)
      .filter((p) => !(opts.photoDeclined && p.meta.kind === "photo"));
    if (isMaths && !opts.photoDeclined && !pending.some((p) => p.meta.kind === "photo")) {
      dispatch({ type: "SEND_FAILED", reason: "no_photo" });
      return;
    }
    // photo first: maths is marked once both are in, and the audio's arrival is what starts it
    pending.sort((a, b) => (a.meta.kind === "photo" ? -1 : 0) - (b.meta.kind === "photo" ? -1 : 0));
    for (const item of pending) {
      // eslint-disable-next-line no-await-in-loop
      // a declined photo travels with the audio: the bot then scores maths with force
      const r = await uploadItem(item, depsRef.current.api, item.meta.kind === "audio" && opts.photoDeclined ? { photoDeclined: true } : {});
      if (r.ok === false) {
        const failed = r as { error: string; reason?: string };
        setSendNote(failed.error === "refused" ? copy.refusedBy(failed.reason || "") : copy.savedOnPhone);
        dispatch({ type: "SEND_FAILED", reason: failed.error });
        return;
      }
    }
    dispatch({ type: "SENT" });
    onSent();
  }, [state, sessionId, card.block, isMaths, copy, onSent]);

  const timed = inTimedMinute(state);
  const left = secondsLeft(state);
  const timeUp = state.phase === "recording" && state.timedEndAt != null;

  // what the child sees
  let stimulus: JSX.Element;
  if (isMaths) {
    const view = state.timedStartAt == null ? "numbers" : (state.timedEndAt == null ? "sums" : "strip");
    stimulus = <MathsStimulus card={card as MathsCard} view={state.phase === "recording" ? view : "numbers"} copy={copy} />;
  } else {
    const view = state.fallback ? "fallback" : (timeUp ? "after" : "story");
    stimulus = <ReadingStimulus card={card as ReadingCard} view={state.phase === "recording" ? view : "story"} copy={copy} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {state.phase === "ready" && (
        <p className="text-base text-slate-700">
          {copy.turnPhone}{" "}
          {isMaths ? copy.sayCueMaths : copy.sayCue(card.cue.start || "")}
        </p>
      )}

      {state.phase === "recording" && (
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-2xl bg-slate-900 text-white px-4 py-3 shadow">
          <span className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
            {copy.recordingOn} {mmss(elapsedSeconds(state))}
          </span>
          {state.timedStartAt != null && (
            timeUp
              ? <span className="text-xl font-bold text-amber-300">{state.fallback ? copy.fallbackTitle : copy.timeUp}</span>
              : (
                <span className="flex items-baseline gap-1">
                  <span data-testid="countdown" className={`text-4xl font-bold tabular-nums ${left <= 10 ? "text-amber-300" : ""}`}>{left}</span>
                  <span className="text-sm opacity-80">{copy.secondsLeft}</span>
                </span>
              )
          )}
        </div>
      )}

      {(state.phase === "ready" || state.phase === "recording" || state.phase === "micBlocked") && stimulus}

      {state.phase === "micBlocked" && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-900">
          <p className="font-semibold">{copy.micBlocked}</p>
          <p className="text-sm">{copy.micAllow}</p>
        </div>
      )}

      {/* controls */}
      {(state.phase === "ready" || state.phase === "micBlocked") && (
        <button type="button" onClick={start} className={`${BIG} bg-emerald-600 text-white`}>
          <Mic className="h-7 w-7" aria-hidden /> {copy.start}
        </button>
      )}

      {state.phase === "recording" && (
        // pinned to the bottom: a long story must never push Stop off the screen
        <div className="sticky bottom-0 z-10 -mx-4 px-4 pt-3 pb-4 bg-slate-50/95 backdrop-blur flex flex-col gap-3 border-t border-slate-200">
          {isMaths && state.timedStartAt == null && (
            <button type="button" onClick={() => dispatch({ type: "START_TIMED", now: Date.now() })} className={`${BIG} bg-emerald-600 text-white`}>
              {copy.startSums}
            </button>
          )}
          {timed && (
            <button type="button" onClick={() => dispatch({ type: "FINISH_EARLY", now: Date.now() })} className="w-full rounded-xl py-3 text-lg border border-slate-300 bg-white">
              {isMaths ? copy.childFinishedMaths : copy.childFinished}
            </button>
          )}
          {!isMaths && timed && !state.fallback && card.child && (card as ReadingCard).child.fallback && (
            <button type="button" onClick={() => dispatch({ type: "FALLBACK", now: Date.now() })} className="w-full rounded-xl py-3 text-lg border border-slate-300 bg-white">
              {copy.cantRead}
            </button>
          )}
          <button type="button" onClick={stop} className={`${BIG} bg-red-600 text-white`}>
            <Square className="h-6 w-6" aria-hidden /> {copy.stop}
          </button>
        </div>
      )}

      {(state.phase === "review" || state.phase === "sending" || state.phase === "failed") && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <p className="font-semibold text-slate-800">{copy.recorded(mmss(Math.round((state.durationMs || 0) / 1000)))}</p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            {audioUrl && <audio controls src={audioUrl} className="w-full" />}
          </div>

          {isMaths && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <p className="font-semibold text-slate-800">{copy.photoTitle}</p>
              <p className="text-sm text-slate-600">{copy.photoSub}</p>
              {photo && <img src={photo.url} alt="" className="w-full rounded-lg border" />}
              <label className="w-full rounded-xl py-3 text-lg border border-slate-300 bg-white flex items-center justify-center gap-2 cursor-pointer">
                <Camera className="h-5 w-5" aria-hidden /> {photo ? copy.retakePhoto : copy.takePhoto}
                <input
                  data-testid="strip-photo-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
            </div>
          )}

          {state.phase === "failed" && sendNote && (
            <p className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900">
              <WifiOff className="h-5 w-5 shrink-0" aria-hidden /> {copy.notSent} {sendNote}
            </p>
          )}

          {isMaths && !photo && (
            <button type="button" onClick={() => send({ photoDeclined: true })} disabled={state.phase === "sending"}
              className="w-full rounded-xl py-3 text-lg border border-slate-300 bg-white">
              {copy.noPhoto}
            </button>
          )}
          <button
            type="button"
            onClick={() => send()}
            disabled={state.phase === "sending" || (isMaths && !photo)}
            className={`${BIG} bg-emerald-600 text-white`}
          >
            {state.phase === "sending" ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Send className="h-6 w-6" aria-hidden />}
            {state.phase === "sending" ? copy.sending : copy.send}
          </button>
          <button type="button" onClick={recordAgain} disabled={state.phase === "sending"} className="w-full rounded-xl py-3 text-lg border border-slate-300 bg-white flex items-center justify-center gap-2">
            <RotateCcw className="h-5 w-5" aria-hidden /> {copy.recordAgain}
          </button>
        </div>
      )}

      {/* the camera input exists for maths from the start, so a re-render never drops a picked file */}
      {isMaths && state.phase !== "review" && state.phase !== "sending" && state.phase !== "failed" && (
        <input data-testid="strip-photo-input" type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onPhoto(e.target.files?.[0]); }} />
      )}

      {state.phase === "sent" && (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-emerald-900 text-lg">
          <Check className="h-6 w-6" aria-hidden /> {copy.sent}
        </p>
      )}
    </div>
  );
}
