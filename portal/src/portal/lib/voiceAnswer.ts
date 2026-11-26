import { useCallback, useEffect, useRef, useState } from "react";
import { portal } from "../services/api";
import { canRecordHere, pickRecordingType } from "./recordingSupport";
import { LessonRecorder } from "./lessonRecorder";
import { deleteRecording, latestUnsent, type KeptRecording } from "./recordingStore";
import { RecordingHeart, beatLink, tellSent, type BeatContext } from "./recordingBeat";
import { sameObservation } from "./recordingLink";

/**
 * bd-eygg2f — ICT feedback (IAB Experience View, row 5): a teacher answers the reflection question by writing OR by
 * speaking, as she can on WhatsApp.
 *
 * bd-ma9jiy.5 (queue #262; the operator 26 Nov ~22:20: "It should work similar to the main coaching recorder. Yes, fix
 * pls.") — the spoken answer is recorded by the ONE shared recorder (LessonRecorder), no longer by a MediaRecorder of its
 * own. Why: that one started with no timeslice and uploaded whatever came out at Stop; 29 November uploads from 17
 * teachers were a WebM HEADER and nothing else (110 bytes, no audio frame), and Soniox v5, Soniox v4 and Whisper all
 * refused them as "invalid audio file / may be corrupt" (the "Portal coaching request threw" errors).
 *
 *   useVoiceAnswer   tap to record, tap to stop (3 minutes at most).
 *                    With `sessionId` (her reflection): saved on the phone every second, linked to the session it
 *                    answers (kind reflection), with the heartbeat. A stopped answer not yet sent comes back ready to
 *                    send (a failed upload is re-sent); one cut mid-way comes back PAUSED and Resume carries on in the
 *                    same recording. Without (the coach's feedback note): the same recorder, nothing kept on the phone.
 *                    Either way a take with no audio frame is never a clip: `empty` ("Nothing was recorded").
 *   sendVoiceAnswer  the lesson upload's own path — presign (kind reflection_audio) → PUT to R2 → the reflection endpoint
 *                    with the key; never a take with no audio frame (NoAudio). The bot transcribes it and runs the same
 *                    engine as a typed answer; a file with no audio frame is answered no_audio there too.
 */

export const VOICE_ANSWER_MAX_MS = 3 * 60 * 1000;
/** Under this, nothing a teacher said can be in it. */
export const VOICE_MIN_MS = 700;

export type VoiceClip = { blob: Blob; mimeType: string; ext: string; recordingId?: string | null; durationMs?: number | null };
export type VoiceState = "idle" | "recording" | "paused" | "recorded" | "blocked";

/** A take with no audio frame (a WebM header alone): never sent. */
export class NoAudioError extends Error {
  constructor() { super("no audio in the recording"); this.name = "NoAudio"; }
}

const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];

/** Does this file hold any audio? A WebM must have a Cluster; anything else, a kilobyte at least. */
export async function hasAudioFrames(blob: Blob | null | undefined, ext: string | null | undefined): Promise<boolean> {
  if (!blob || !blob.size) return false;
  const e = String(ext || "").toLowerCase();
  if (e !== ".webm" && e !== ".weba") return blob.size >= 1024;
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await blob.arrayBuffer()); } catch { return blob.size >= 1024; }
  for (let i = 0; i + 3 < bytes.length; i += 1) {
    if (bytes[i] === CLUSTER[0] && bytes[i + 1] === CLUSTER[1] && bytes[i + 2] === CLUSTER[2] && bytes[i + 3] === CLUSTER[3]) return true;
  }
  return false;
}

/** The coach's feedback note keeps nothing on the phone: the recorder's store does nothing. */
const MEMORY_STORE = {
  createRecording: async () => {},
  appendChunk: async () => {},
  markFinished: async () => {},
  deleteRecording: async () => {},
};

function newId(): string | undefined {
  try { return crypto.randomUUID(); } catch { return undefined; }
}

export function useVoiceAnswer({ sessionId = null }: { sessionId?: string | null } = {}) {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [clip, setClip] = useState<VoiceClip | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [empty, setEmpty] = useState(false);
  const recorder = useRef<LessonRecorder | null>(null);
  const heart = useRef<RecordingHeart | null>(null);
  const kept = useRef<KeptRecording | null>(null);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; cap?: ReturnType<typeof setTimeout> }>({});
  const ctx: BeatContext | null = sessionId ? { kind: "reflection", observationId: sessionId } : null;
  const ctxKey = sessionId || "";
  const persisted = !!sessionId;

  useEffect(() => {
    let live = true;
    canRecordHere().then((ok) => { if (live) setAvailable(ok); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // Her answer to THIS session, kept on the phone: ready to send again, or paused to carry on. One with no audio frame
  // is thrown away.
  useEffect(() => {
    if (!sessionId) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => latestUnsent((m) => sameObservation(m, { kind: "reflection", observationId: sessionId })))
      .then(async (k) => {
        if (!live || !k) return;
        if (!(await hasAudioFrames(k.blob, k.meta.ext))) {
          try { await deleteRecording(k.meta.id); } catch { /* gone */ }
          return;
        }
        if (!live || recorder.current) return;
        if (k.meta.finished) {
          setClip({ blob: k.blob, mimeType: k.meta.mimeType, ext: k.meta.ext, recordingId: k.meta.id, durationMs: k.meta.elapsedMs || null });
          setState("recorded");
        } else {
          kept.current = k;
          setElapsedMs(k.meta.elapsedMs || 0);
          setState("paused");
        }
      })
      .catch(() => { /* nothing kept */ });
    return () => { live = false; };
  }, [sessionId]);

  const clearTimers = useCallback(() => {
    clearInterval(timers.current.tick);
    clearTimeout(timers.current.cap);
    timers.current = {};
  }, []);

  useEffect(() => () => {
    clearTimers();
    const r = recorder.current;
    recorder.current = null;
    // Leaving mid-answer: the pieces stay on the phone (it comes back paused); the microphone is released.
    if (r) void r.stop().catch(() => {});
  }, [clearTimers]);

  const stop = useCallback(async () => {
    const r = recorder.current;
    if (!r) return;
    recorder.current = null;
    clearTimers();
    const out = await r.stop();
    const ok = out.durationMs >= VOICE_MIN_MS && await hasAudioFrames(out.blob, out.type.ext);
    if (!ok) {
      try { heart.current?.event("empty", { ms: Math.round(out.durationMs), bytes: out.blob.size }); } catch { /* instrumentation only */ }
      if (persisted) { try { await deleteRecording(out.id); } catch { /* nothing kept */ } }
      setClip(null);
      setElapsedMs(0);
      setEmpty(true);
      setState("idle");
      return;
    }
    // Only a kept answer has an id on the phone (to send again, to throw away, to say "sent" for).
    setClip({ blob: out.blob, mimeType: out.type.mimeType, ext: out.type.ext, recordingId: persisted ? out.id : null, durationMs: out.durationMs });
    setState("recorded");
  }, [clearTimers, persisted]);

  const start = useCallback(async () => {
    if (recorder.current) return;
    setEmpty(false);
    const type = pickRecordingType();
    if (!type) { setState("blocked"); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("blocked");
      return;
    }
    // A paused answer of this session carries on in the same recording (the same file type only: parts are joined).
    const from = kept.current && kept.current.meta.ext === type.ext ? kept.current : null;
    const id = from ? from.meta.id : newId();
    let h: RecordingHeart | undefined;
    if (ctx && id) { try { h = new RecordingHeart({ recordingId: id, ctx, ...(from ? { bytesSoFar: from.blob.size } : {}) }); } catch { h = undefined; } }
    heart.current = h || null;
    const rec = new LessonRecorder({
      stream, type,
      ...(id ? { id } : {}),
      ...(h ? { heart: h } : {}),
      ...(ctx ? { link: beatLink(ctx) } : { store: MEMORY_STORE }),
      ...(from ? { resume: { prior: from.blob, nextSeq: from.nextSeq, elapsedMs: from.meta.elapsedMs || 0 } } : {}),
    });
    try {
      await rec.start();
    } catch {
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
      setState("blocked");
      return;
    }
    kept.current = null;
    recorder.current = rec;
    setElapsedMs(rec.elapsedMs());
    timers.current.tick = setInterval(() => setElapsedMs(rec.elapsedMs()), 500);
    timers.current.cap = setTimeout(() => { void stop(); }, Math.max(1000, VOICE_ANSWER_MAX_MS - rec.elapsedMs()));
    setState("recording");
  }, [ctxKey, stop]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Thrown away (or sent): off the phone too. */
  const discard = useCallback(() => {
    const id = clip?.recordingId || kept.current?.meta.id || null;
    kept.current = null;
    if (id) void deleteRecording(id).catch(() => {});
    setClip(null);
    setElapsedMs(0);
    setEmpty(false);
    setState("idle");
  }, [clip]);

  /** The server heard no audio in it: as an empty take — thrown away, "Nothing was recorded". */
  const markEmpty = useCallback(() => {
    const id = clip?.recordingId || null;
    if (id) void deleteRecording(id).catch(() => {});
    setClip(null);
    setElapsedMs(0);
    setEmpty(true);
    setState("idle");
  }, [clip]);

  return { available, state, clip, elapsedMs, empty, start, stop, discard, markEmpty };
}

export async function sendVoiceAnswer(sessionId: string, clip: VoiceClip) {
  if (!(await hasAudioFrames(clip.blob, clip.ext))) throw new NoAudioError();
  const signed = await portal.presignCoachingUpload({
    filename: `answer${clip.ext}`, sizeBytes: clip.blob.size, kind: "reflection_audio",
  });
  await portal.uploadToR2(signed.uploadUrl, clip.blob, signed.contentType);
  const r = await portal.submitCoachingVoiceReflection(sessionId, signed.key);
  if (clip.recordingId) tellSent(clip.recordingId, { kind: "reflection", observationId: sessionId }, sessionId);
  return r;
}
