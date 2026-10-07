import { useEffect, useRef, useState } from 'react';
import { pickRecordingType } from './recordingSupport';
import { keepScreenOn } from './keepAwake';
import { LessonRecorder, type FinishedRecording } from './lessonRecorder';

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

export function useCoachRecording({ onStarted, onMicBlocked }: {
  /** The phone copy's id, the moment recording starts (so a page can remember whose it is). */
  onStarted?: (recordingId: string) => void;
  onMicBlocked?: () => void;
} = {}): CoachRecording {
  const recorderRef = useRef<LessonRecorder | null>(null);
  const releaseScreen = useRef<(() => Promise<void>) | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [micBlocked, setMicBlocked] = useState(false);
  const [screenWentOff, setScreenWentOff] = useState(false);
  const level = useMicLevel(stream, recording && !paused);

  // Start once, on mount; never leave the microphone or the screen hold on.
  useEffect(() => {
    let cancelled = false;
    const blocked = () => { if (cancelled) return; setMicBlocked(true); onMicBlocked?.(); };
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
      const rec = new LessonRecorder({ stream: media, type });
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

  // The clock, and a guard against leaving while recording.
  useEffect(() => {
    if (!recording) return undefined;
    const tick = setInterval(() => setElapsed(recorderRef.current?.elapsedMs() ?? 0), 500);
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

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (paused) { rec.resume(); setPaused(false); } else { rec.pause(); setPaused(true); }
    setElapsed(rec.elapsedMs());
  };

  const finish = async (): Promise<FinishedRecording | null> => {
    const rec = recorderRef.current;
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
    elapsedNow: () => recorderRef.current?.elapsedMs() ?? elapsed,
  };
}
