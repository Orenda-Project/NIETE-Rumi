import { useEffect, useRef, useState } from 'react';
import { pickRecordingType, type RecordingType } from './recordingSupport';
import { keepScreenOn } from './keepAwake';
import { LessonRecorder, type FinishedRecording } from './lessonRecorder';
import { withDuration } from './webmDuration';
import { markFinished, type KeptRecording } from './recordingStore';
import { RecordingHeart, beatLink, cutOf, type BeatContext } from './recordingBeat';

/**
 * bd-o15qnr.9 — the coach's recording engine, without a screen: the same
 * LessonRecorder (kept on the phone as it records), the screen held on, a live
 * microphone level, the clock, and a guard against leaving mid-lesson.
 *
 * Lifted out of CoachRecorder (bd-5rz1v.6) so the coach app v2's Record live
 * page draws the v18 design on the very same engine. CoachRecorder now uses
 * this hook and behaves exactly as before.
 *
 * It starts on mount. A refused microphone sets `micBlocked` and calls
 * onMicBlocked; `finish()` stops and hands back the recording.
 *
 * bd-ma9jiy (queue #262) — `kept`: a recording this phone kept (cut by a kill, or stopped and never sent) opens AS
 * PAUSED: no microphone, the clock at its saved length, Pause showing Resume. Resume opens the microphone and continues
 * the SAME recording (LessonRecorder `resume`: same id, joined into one file at Stop); Stop without Resume hands back
 * the kept file as it is. `beat`: the heartbeat's context (recordingBeat), so every save is sampled and sent.
 */

/** A live 0..1 microphone level, or null where Web Audio is unavailable. */
export function useMicLevel(stream: MediaStream | null, active: boolean): number | null {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!stream || !active) return undefined;
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return undefined;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    try {
      ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) { const v = (buf[i] - 128) / 128; sum += v * v; }
        setLevel(Math.sqrt(sum / buf.length));
      }, 120);
    } catch {
      setLevel(null);
    }
    return () => {
      if (timer) clearInterval(timer);
      try { void ctx?.close(); } catch { /* closed */ }
    };
  }, [stream, active]);
  return level;
}

export type CoachRecording = {
  recording: boolean;
  paused: boolean;
  elapsed: number;
  level: number | null;
  screenWentOff: boolean;
  micBlocked: boolean;
  togglePause: () => void;
  finish: () => Promise<FinishedRecording | null>;
  /** The recorder's own clock, read now (the state clock ticks every 500ms). */
  elapsedNow: () => number;
};

export function useCoachRecording({ onStarted, onMicBlocked, kept = null, beat }: {
  /** The phone copy's id, the moment recording starts (so a page can remember whose it is). */
  onStarted?: (recordingId: string) => void;
  onMicBlocked?: () => void;
  /** bd-ma9jiy: open this kept recording as paused instead of starting a new one. */
  kept?: KeptRecording | null;
  /** bd-ma9jiy: the heartbeat's context (none: no telemetry). */
  beat?: BeatContext;
} = {}): CoachRecording {
  const recorderRef = useRef<LessonRecorder | null>(null);
  const releaseScreen = useRef<(() => Promise<void>) | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(!!kept);
  const [paused, setPaused] = useState(!!kept);
  const [elapsed, setElapsed] = useState(kept ? kept.meta.elapsedMs : 0);
  /** bd-ma9jiy: the kept recording, until Resume turns it into a live one (or Stop hands it back). */
  const keptRef = useRef<KeptRecording | null>(kept);
  const heartRef = useRef<RecordingHeart | null>(null);
  const resuming = useRef(false);
  const [micBlocked, setMicBlocked] = useState(false);
  const [screenWentOff, setScreenWentOff] = useState(false);
  const level = useMicLevel(stream, recording && !paused);

  // Start once, on mount; never leave the microphone or the screen hold on. bd-ma9jiy: a kept recording does not start:
  // it waits, paused, for Resume (the cut is told once, from its last saved sample).
  useEffect(() => {
    let cancelled = false;
    const blocked = () => { if (cancelled) return; setMicBlocked(true); onMicBlocked?.(); };
    const k = keptRef.current;
    if (k) {
      if (beat) {
        try {
          const heart = new RecordingHeart({ recordingId: k.meta.id, ctx: beat, bytesSoFar: k.blob.size });
          heartRef.current = heart;
          heart.event('cut', { ...(cutOf(k.beats, Date.now()) || {}), ms: k.meta.elapsedMs, finished: k.meta.finished, parts: k.parts });
        } catch { /* instrumentation only */ }
      }
      return () => {
        cancelled = true;
        void releaseScreen.current?.();
        if (recorderRef.current) void recorderRef.current.stop().catch(() => {});
      };
    }
    const start = async () => {
      const type = pickRecordingType();
      if (!type) { blocked(); return; }
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          // A classroom, not a call: call-style processing would also suppress
          // children answering from across the room.
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
        });
      } catch {
        blocked();
        return;
      }
      if (cancelled) { media.getTracks().forEach((t) => t.stop()); return; }
      let heart: RecordingHeart | undefined;
      const id = (() => { try { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined; } catch { return undefined; } })();
      if (beat && id) { try { heart = new RecordingHeart({ recordingId: id, ctx: beat }); } catch { heart = undefined; } }
      // bd-ma9jiy (26 Nov ~15:10): the recording's row says which visit or observation it belongs to.
      const rec = new LessonRecorder({ stream: media, type, ...(id ? { id } : {}), ...(heart ? { heart } : {}), ...(beat ? { link: beatLink(beat) } : {}) });
      recorderRef.current = rec;
      setStream(media);
      try {
        await rec.start();
      } catch {
        blocked();
        return;
      }
      releaseScreen.current = await keepScreenOn();
      if (cancelled) return;
      onStarted?.(rec.id);
      setRecording(true);
    };
    void start();
    return () => {
      cancelled = true;
      void releaseScreen.current?.();
      if (recorderRef.current) void recorderRef.current.stop().catch(() => {});
    };
    // Mount-only: the callbacks belong to the page that mounted it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clockNow = () => recorderRef.current?.elapsedMs() ?? keptRef.current?.meta.elapsedMs ?? 0;

  // The clock, and a guard against leaving while recording.
  useEffect(() => {
    if (!recording) return undefined;
    const tick = setInterval(() => setElapsed(clockNow()), 500);
    const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const onHide = () => { if (document.visibilityState === 'hidden') setScreenWentOff(true); };
    window.addEventListener('beforeunload', leave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(tick);
      window.removeEventListener('beforeunload', leave);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [recording]);

  /** bd-ma9jiy: Resume on a kept recording — the microphone, then the same recording carries on. */
  const resumeKept = async (k: KeptRecording) => {
    if (resuming.current) return;
    resuming.current = true;
    try {
      const picked = pickRecordingType();
      const sameType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(k.meta.mimeType)
        ? { mimeType: k.meta.mimeType, ext: k.meta.ext as RecordingType['ext'] }
        : picked;
      if (!sameType) { setMicBlocked(true); onMicBlocked?.(); return; }
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
      } catch {
        heartRef.current?.event('mic_blocked', { ms: k.meta.elapsedMs });
        setMicBlocked(true);
        onMicBlocked?.();
        return;
      }
      const rec = new LessonRecorder({
        stream: media, type: sameType, id: k.meta.id,
        resume: { prior: k.blob, nextSeq: k.nextSeq, elapsedMs: k.meta.elapsedMs },
        ...(heartRef.current ? { heart: heartRef.current } : {}),
      });
      try { await rec.start(); } catch { media.getTracks().forEach((t) => t.stop()); setMicBlocked(true); onMicBlocked?.(); return; }
      recorderRef.current = rec;
      keptRef.current = null;
      setStream(media);
      releaseScreen.current = await keepScreenOn();
      setPaused(false);
      setElapsed(rec.elapsedMs());
    } finally {
      resuming.current = false;
    }
  };

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) {
      if (keptRef.current && paused) void resumeKept(keptRef.current);
      return;
    }
    if (paused) { rec.resume(); setPaused(false); } else { rec.pause(); setPaused(true); }
    setElapsed(rec.elapsedMs());
  };

  const finish = async (): Promise<FinishedRecording | null> => {
    const rec = recorderRef.current;
    const k = keptRef.current;
    if (!rec && k) {
      // bd-ma9jiy: Stop on a kept recording never resumed: the kept file as it is (its length written in).
      const blob = await withDuration(k.blob, k.meta.ext, k.meta.elapsedMs);
      try { await markFinished(k.meta.id, k.meta.elapsedMs); } catch { /* the kept copy stays */ }
      heartRef.current?.event('stop', { ms: k.meta.elapsedMs, kept: true });
      void heartRef.current?.dispose(true);
      keptRef.current = null;
      setRecording(false);
      return { blob, durationMs: k.meta.elapsedMs, type: { mimeType: k.meta.mimeType, ext: k.meta.ext as RecordingType['ext'] }, id: k.meta.id };
    }
    if (!rec) return null;
    const out = await rec.stop();
    recorderRef.current = null;
    setStream(null);
    setRecording(false);
    void releaseScreen.current?.();
    releaseScreen.current = null;
    return out;
  };

  return {
    recording, paused, elapsed, level, screenWentOff, micBlocked, togglePause, finish,
    elapsedNow: () => recorderRef.current?.elapsedMs() ?? keptRef.current?.meta.elapsedMs ?? elapsed,
  };
}
