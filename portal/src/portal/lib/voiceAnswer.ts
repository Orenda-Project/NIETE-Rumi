import { useCallback, useEffect, useRef, useState } from "react";
import { portal } from "../services/api";
import { canRecordHere, pickRecordingType } from "./recordingSupport";

/**
 * bd-eygg2f — ICT feedback (IAB Experience View, row 5): a teacher answers the reflection question by
 * writing OR by speaking, as she can on WhatsApp.
 *
 *   useVoiceAnswer   tap to record, tap to stop. A short clip held in memory — not the lesson recorder
 *                    (useCoachRecording / LessonRecorder): no IndexedDB, no wake-lock, no leave guard,
 *                    the phone's normal call-style mic processing. Stops itself at VOICE_ANSWER_MAX_MS.
 *   sendVoiceAnswer  the lesson upload's own path: presign (kind reflection_audio) → PUT to R2 → the
 *                    reflection endpoint with the key. The bot transcribes it and runs the same engine
 *                    as a typed answer (portal-coaching.service submitReflection).
 */

export const VOICE_ANSWER_MAX_MS = 3 * 60 * 1000;

export type VoiceClip = { blob: Blob; mimeType: string; ext: string };
export type VoiceState = "idle" | "recording" | "recorded" | "blocked";

export function useVoiceAnswer() {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [clip, setClip] = useState<VoiceClip | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; cap?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    let live = true;
    canRecordHere().then((ok) => { if (live) setAvailable(ok); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const release = useCallback(() => {
    clearInterval(timers.current.tick);
    clearTimeout(timers.current.cap);
    timers.current = {};
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => () => {
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    release();
  }, [release]);

  const stop = useCallback(() => {
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  const start = useCallback(async () => {
    const type = pickRecordingType();
    if (!type) { setState("blocked"); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("blocked");
      return;
    }
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream.current, { mimeType: type.mimeType });
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      release();
      recorder.current = null;
      const base = type.mimeType.split(";")[0];
      setClip({ blob: new Blob(chunks, { type: base }), mimeType: type.mimeType, ext: type.ext });
      setState("recorded");
    };
    recorder.current = r;
    r.start();
    const startedAt = Date.now();
    setElapsedMs(0);
    timers.current.tick = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    timers.current.cap = setTimeout(stop, VOICE_ANSWER_MAX_MS);
    setState("recording");
  }, [release, stop]);

  const discard = useCallback(() => {
    setClip(null);
    setElapsedMs(0);
    setState("idle");
  }, []);

  return { available, state, clip, elapsedMs, start, stop, discard };
}

export async function sendVoiceAnswer(sessionId: string, clip: VoiceClip) {
  const signed = await portal.presignCoachingUpload({
    filename: `answer${clip.ext}`, sizeBytes: clip.blob.size, kind: "reflection_audio",
  });
  await portal.uploadToR2(signed.uploadUrl, clip.blob, signed.contentType);
  return portal.submitCoachingVoiceReflection(sessionId, signed.key);
}
