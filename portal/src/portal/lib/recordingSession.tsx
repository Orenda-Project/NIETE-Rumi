import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import BottomSheet from '../components/coaching/BottomSheet';
import { LogoutWhileRecording } from '../newui/coaching/LogoutWhileRecording';
import { keepScreenOn } from './keepAwake';
import { newUiRemembered } from './newUiMemory';
import { LessonRecorder, type FinishedRecording } from './lessonRecorder';
import { pickRecordingType, type RecordingType } from './recordingSupport';
import { withDuration } from './webmDuration';
import { markFinished, type KeptRecording, type RecordingLink } from './recordingStore';
import { RecordingHeart, beatLink, cutOf, type BeatContext } from './recordingBeat';
import { lastSavedAt, wasCut } from './keptOffer';

/**
 * bd-5rz1v.10 — the lesson being recorded lives HERE, above the routes, not in
 * the record page.
 *
 * "The digital coach audio recording needs to be continued while the user uses
 * the rest of the application, because they might access lesson plans while
 * teaching" (operator, 2026-10-03). The record page used to own the recorder
 * and stop it on unmount, so opening anything else ended the lesson, and Back
 * had to be trapped on the page. Now:
 *
 *   the session (this file)   the recorder, the microphone, the screen-on hold,
 *                             the reload guard and the "screen went off" flag
 *   the record page           a view onto it: clock, sound bars, Pause, Finish
 *   every other page          RecordingBar ("Recording · 12:34", Return)
 *   Logout                    asks first (askBeforeLogout): it really would end it — in
 *                             the new UI's kit Sheet when portal_new_ui is on for her
 *                             (bd-5rz1v.26.4, newui/coaching/LogoutWhileRecording), the old
 *                             sheet otherwise, unchanged
 *
 * Chunks are still written to the phone as they arrive: that is LessonRecorder's
 * job, unchanged, and it no longer matters which page is on screen.
 *
 * Generic on purpose: `returnTo` says which screen the recording belongs to, so
 * the coach's recorder could move here later without this file knowing pages.
 * Nothing here touches Capacitor until a recording starts (keepScreenOn guards
 * its own plugin call), so an app build that cannot record never runs any of it.
 *
 * bd-ma9jiy (queue #262) — `restore`: a recording this phone kept (cut by a kill: WhatsApp swiped away, the phone off;
 * or stopped and never sent) comes back as THIS session, PAUSED: active, the clock at its saved length, no microphone.
 * `resume` then opens the microphone and continues the same recording (LessonRecorder `resume`: same id, the pieces
 * joined into one file); `finish` without a Resume hands back the kept file. "Simulate as if the observation got paused
 * in the middle" (the operator, 25 Nov). `beat` on start/restore: the heartbeat (recordingBeat) for every save.
 */

export type StartResult = 'recording' | 'micBlocked';

export type RecordingSession = {
  /** A recorder exists: recording or paused. */
  active: boolean;
  paused: boolean;
  /** The microphone stream, for the sound bars. */
  stream: MediaStream | null;
  /** The page was hidden while recording: part of the lesson may be silent. */
  screenWentOff: boolean;
  /** The recording's id in the phone's store (recordingStore). */
  recordingId: string | null;
  /** The screen this recording belongs to; the bar's Return goes there. */
  returnTo: string | null;
  /** Time actually recorded, now (pauses excluded). */
  elapsedMs: () => number;
  /** bd-ma9jiy (26 Nov ~15:10): `linkExtra` — the class (and name) kept with the recording on the phone, beside `beat`. */
  start: (opts: { returnTo: string; beat?: BeatContext; linkExtra?: Partial<Pick<RecordingLink, 'grade' | 'subject' | 'teacherName'>> }) => Promise<StartResult>;
  /** bd-ma9jiy: open a kept recording as this session, paused (nothing starts until Resume). */
  restore: (opts: { returnTo: string; kept: KeptRecording; beat?: BeatContext }) => void;
  pause: () => void;
  /** Carries on; on a restored recording it opens the microphone first (micBlocked when refused). */
  resume: () => void | Promise<StartResult>;
  /** Stop and keep: the recording, or null when there was none. */
  finish: () => Promise<FinishedRecording | null>;
  /** bd-v0toag.31: who hears each chunk as it is saved (the live screen), or null. Never affects the recording. */
  setChunkListener: (fn: ((blob: Blob, seq: number, elapsedMs: number) => void) | null) => void;
  /** Logout, or — while recording — a question first. */
  askBeforeLogout: (logout: () => unknown) => void;
};

// Labels, not sentences (operator, 2026-10-03). "Stop & log out" stops and
// KEEPS the recording: it stays on the phone, and Coaching offers Continue.
const COPY = {
  logoutTitle: 'Stop recording?',
  stopAndLogout: 'Stop & log out',
  keepRecording: 'Keep recording',
};

const RecordingSessionContext = createContext<RecordingSession | null>(null);

/** The session, or null outside the provider (a page rendered on its own in a test). */
export function useRecordingSession(): RecordingSession | null {
  return useContext(RecordingSessionContext);
}

/** The running clock, re-read twice a second while recording; only its reader re-renders. */
export function useRecordingClock(session: RecordingSession | null): number {
  const [ms, setMs] = useState(() => session?.elapsedMs() ?? 0);
  const active = !!session?.active;
  const paused = !!session?.paused;
  useEffect(() => {
    if (!session || !active) return undefined;
    setMs(session.elapsedMs());
    if (paused) return undefined;
    const tick = setInterval(() => setMs(session.elapsedMs()), 500);
    return () => clearInterval(tick);
  }, [session, active, paused]);
  return ms;
}

/**
 * Logout that asks first while a lesson is recording; plain logout otherwise. Any Logout button,
 * anywhere under the provider, goes through this (or newui/useGuardedLogout, which brings the
 * signed-in user's logout): the question then looks like the menu she is in.
 */
export function useLogoutGuard(logout: () => unknown): () => void {
  const session = useRecordingSession();
  return useCallback(() => {
    if (session) session.askBeforeLogout(logout);
    else void logout();
  }, [session, logout]);
}

type Live = {
  active: boolean;
  paused: boolean;
  stream: MediaStream | null;
  screenWentOff: boolean;
  recordingId: string | null;
  returnTo: string | null;
};

const IDLE: Live = { active: false, paused: false, stream: null, screenWentOff: false, recordingId: null, returnTo: null };

export const RecordingSessionProvider = ({ children }: { children: ReactNode }) => {
  const recorderRef = useRef<LessonRecorder | null>(null);
  const releaseScreen = useRef<(() => Promise<void>) | null>(null);
  const finishing = useRef<Promise<FinishedRecording | null> | null>(null);
  const chunkListener = useRef<((blob: Blob, seq: number, elapsedMs: number) => void) | null>(null);
  const setChunkListener = useCallback((fn: ((blob: Blob, seq: number, elapsedMs: number) => void) | null) => {
    chunkListener.current = fn;
  }, []);
  const [live, setLive] = useState<Live>(IDLE);
  /** bd-ma9jiy: a kept recording restored as paused, until Resume makes it live (or finish hands it back). */
  const keptRef = useRef<KeptRecording | null>(null);
  const heartRef = useRef<RecordingHeart | null>(null);
  const resuming = useRef<Promise<StartResult> | null>(null);
  // The pending Logout, and which look asks about it: the new UI's (portal_new_ui on for her)
  // or the old one. Decided when she taps, from the flag the layout last read for her.
  const [logoutAsk, setLogoutAsk] = useState<{ logout: () => unknown; newUi: boolean } | null>(null);

  const elapsedMs = useCallback(() => recorderRef.current?.elapsedMs() ?? keptRef.current?.meta.elapsedMs ?? 0, []);

  const start = useCallback(async ({ returnTo, beat, linkExtra }: { returnTo: string; beat?: BeatContext; linkExtra?: Partial<Pick<RecordingLink, 'grade' | 'subject' | 'teacherName'>> }): Promise<StartResult> => {
    // One lesson at a time: a second start shows the one already running.
    if (recorderRef.current || keptRef.current) {
      setLive((l) => ({ ...l, returnTo }));
      return 'recording';
    }
    const type = pickRecordingType();
    if (!type) return 'micBlocked';
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        // A classroom, not a call: call-style echo and noise suppression would
        // also suppress children answering from across the room.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    } catch {
      return 'micBlocked';
    }
    const id = (() => { try { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined; } catch { return undefined; } })();
    let heart: RecordingHeart | undefined;
    if (beat && id) { try { heart = new RecordingHeart({ recordingId: id, ctx: beat }); } catch { heart = undefined; } }
    const rec = new LessonRecorder({
      stream: media, type, onChunk: (b, seq, ms) => chunkListener.current?.(b, seq, ms), ...(id ? { id } : {}), ...(heart ? { heart } : {}),
      // bd-ma9jiy (26 Nov ~15:10): what this recording belongs to, written into its row on the phone.
      ...(beat ? { link: beatLink(beat, linkExtra) } : {}),
    });
    try {
      await rec.start();
    } catch {
      try { media.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
      return 'micBlocked';
    }
    recorderRef.current = rec;
    heartRef.current = heart || null;
    releaseScreen.current = await keepScreenOn();
    setLive({ active: true, paused: false, stream: media, screenWentOff: false, recordingId: rec.id ?? null, returnTo });
    return 'recording';
  }, []);

  const restore = useCallback(({ returnTo, kept, beat }: { returnTo: string; kept: KeptRecording; beat?: BeatContext }) => {
    if (recorderRef.current || keptRef.current) { setLive((l) => ({ ...l, returnTo })); return; }
    keptRef.current = kept;
    if (beat) {
      try {
        const heart = new RecordingHeart({ recordingId: kept.meta.id, ctx: beat, bytesSoFar: kept.blob.size });
        heartRef.current = heart;
        // bd-91htd2 (queue #292): `cut` only for one cut by a kill; one she had stopped is a `reopen` (every reopen of a
        // stopped recording logged a cut: 207 of 235 on 26 Nov). ageS: from its last save (also with no heartbeats).
        const now = Date.now();
        heart.event(wasCut(kept) ? 'cut' : 'reopen', { ...(cutOf(kept.beats, now) || {}), ageS: Math.max(0, Math.round((now - lastSavedAt(kept)) / 1000)), ms: kept.meta.elapsedMs, finished: kept.meta.finished, parts: kept.parts });
      } catch { /* instrumentation only */ }
    }
    setLive({ active: true, paused: true, stream: null, screenWentOff: false, recordingId: kept.meta.id, returnTo });
  }, []);

  /** bd-ma9jiy: Resume on a restored recording — the microphone, then the SAME recording carries on. */
  const resumeKept = useCallback((kept: KeptRecording): Promise<StartResult> => {
    if (resuming.current) return resuming.current;
    resuming.current = (async (): Promise<StartResult> => {
      const supported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(kept.meta.mimeType);
      const type: RecordingType | null = supported ? { mimeType: kept.meta.mimeType, ext: kept.meta.ext as RecordingType['ext'] } : pickRecordingType();
      if (!type) return 'micBlocked';
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
      } catch {
        heartRef.current?.event('mic_blocked', { ms: kept.meta.elapsedMs });
        return 'micBlocked';
      }
      const rec = new LessonRecorder({
        stream: media, type, id: kept.meta.id, onChunk: (b, seq, ms) => chunkListener.current?.(b, seq, ms),
        resume: { prior: kept.blob, nextSeq: kept.nextSeq, elapsedMs: kept.meta.elapsedMs },
        ...(heartRef.current ? { heart: heartRef.current } : {}),
      });
      try {
        await rec.start();
      } catch {
        try { media.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
        return 'micBlocked';
      }
      recorderRef.current = rec;
      keptRef.current = null;
      releaseScreen.current = await keepScreenOn();
      setLive((l) => ({ ...l, active: true, paused: false, stream: media }));
      return 'recording';
    })().finally(() => { resuming.current = null; });
    return resuming.current;
  }, []);

  const pause = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    rec.pause();
    setLive((l) => ({ ...l, paused: true }));
  }, []);

  const resume = useCallback((): void | Promise<StartResult> => {
    const rec = recorderRef.current;
    if (!rec) {
      if (keptRef.current) return resumeKept(keptRef.current);
      return undefined;
    }
    rec.resume();
    setLive((l) => ({ ...l, paused: false }));
    return undefined;
  }, [resumeKept]);

  const finish = useCallback(async (): Promise<FinishedRecording | null> => {
    // Two taps (Finish here, Logout there) finish it once.
    if (finishing.current) return finishing.current;
    const rec = recorderRef.current;
    const kept = keptRef.current;
    if (!rec && kept) {
      // bd-ma9jiy: Stop on a restored recording never resumed: the kept file as it is (its length written in).
      keptRef.current = null;
      const blob = await withDuration(kept.blob, kept.meta.ext, kept.meta.elapsedMs);
      try { await markFinished(kept.meta.id, kept.meta.elapsedMs); } catch { /* the kept copy stays */ }
      heartRef.current?.event('stop', { ms: kept.meta.elapsedMs, kept: true });
      void heartRef.current?.dispose(true);
      heartRef.current = null;
      setLive(IDLE);
      return { blob, durationMs: kept.meta.elapsedMs, type: { mimeType: kept.meta.mimeType, ext: kept.meta.ext as RecordingType['ext'] }, id: kept.meta.id };
    }
    if (!rec) return null;
    finishing.current = (async () => {
      try {
        return await rec.stop();
      } finally {
        recorderRef.current = null;
        heartRef.current = null;
        const release = releaseScreen.current;
        releaseScreen.current = null;
        void release?.();
        setLive(IDLE);
        finishing.current = null;
      }
    })();
    return finishing.current;
  }, []);

  const askBeforeLogout = useCallback((logout: () => unknown) => {
    // A restored, never-resumed recording is already safe on the phone: nothing to ask.
    if (!recorderRef.current) { keptRef.current = null; setLive(IDLE); void logout(); return; }
    setLogoutAsk({ logout, newUi: newUiRemembered() });
  }, []);

  // While recording: a reload or closing the tab asks first, and a hidden page
  // (screen off, another app) is remembered — Android gives a background app
  // silence from the microphone, so part of the lesson may be missing.
  useEffect(() => {
    if (!live.active) return undefined;
    const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const onHide = () => {
      if (document.visibilityState === 'hidden') setLive((l) => (l.active && !l.screenWentOff ? { ...l, screenWentOff: true } : l));
    };
    window.addEventListener('beforeunload', leave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', leave);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [live.active]);

  // The app itself going away (never, outside tests): leave no microphone on.
  useEffect(() => () => {
    void releaseScreen.current?.();
    const rec = recorderRef.current;
    if (rec) void Promise.resolve().then(() => rec.stop()).catch(() => {});
  }, []);

  const value = useMemo<RecordingSession>(() => ({
    ...live, elapsedMs, start, restore, pause, resume, finish, askBeforeLogout, setChunkListener,
  }), [live, elapsedMs, start, restore, pause, resume, finish, askBeforeLogout, setChunkListener]);

  const finishThenLogout = async () => {
    const logout = logoutAsk?.logout;
    setLogoutAsk(null);
    try { await finish(); } catch { /* its chunks are already on the phone */ }
    if (logout) await logout();
  };

  return (
    <RecordingSessionContext.Provider value={value}>
      {children}
      {logoutAsk?.newUi ? (
        <LogoutWhileRecording
          open
          paused={live.paused}
          elapsedMs={elapsedMs}
          onKeep={() => setLogoutAsk(null)}
          onStop={() => { void finishThenLogout(); }}
        />
      ) : null}
      {logoutAsk && !logoutAsk.newUi && (
        <BottomSheet label={COPY.logoutTitle} onClose={() => setLogoutAsk(null)}>
          <div className="text-[23px] font-bold">{COPY.logoutTitle}</div>
          <button type="button" onClick={() => setLogoutAsk(null)}
            className="h-[60px] rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.keepRecording}</button>
          <button type="button" onClick={finishThenLogout}
            className="h-14 rounded-[14px] border-2 border-primary bg-white text-lg font-bold text-primary">{COPY.stopAndLogout}</button>
        </BottomSheet>
      )}
    </RecordingSessionContext.Provider>
  );
};
