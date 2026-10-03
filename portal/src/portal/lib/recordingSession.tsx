import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import BottomSheet from '../components/coaching/BottomSheet';
import { keepScreenOn } from './keepAwake';
import { LessonRecorder, type FinishedRecording } from './lessonRecorder';
import { pickRecordingType } from './recordingSupport';

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
 *   Logout                    asks first (askBeforeLogout): it really would end it
 *
 * Chunks are still written to the phone as they arrive: that is LessonRecorder's
 * job, unchanged, and it no longer matters which page is on screen.
 *
 * Generic on purpose: `returnTo` says which screen the recording belongs to, so
 * the coach's recorder could move here later without this file knowing pages.
 * Nothing here touches Capacitor until a recording starts (keepScreenOn guards
 * its own plugin call), so an app build that cannot record never runs any of it.
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
  start: (opts: { returnTo: string }) => Promise<StartResult>;
  pause: () => void;
  resume: () => void;
  /** Stop and keep: the recording, or null when there was none. */
  finish: () => Promise<FinishedRecording | null>;
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

/** Logout that asks first while a lesson is recording; plain logout otherwise. */
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
  const [live, setLive] = useState<Live>(IDLE);
  const [logoutAsk, setLogoutAsk] = useState<(() => unknown) | null>(null);

  const elapsedMs = useCallback(() => recorderRef.current?.elapsedMs() ?? 0, []);

  const start = useCallback(async ({ returnTo }: { returnTo: string }): Promise<StartResult> => {
    // One lesson at a time: a second start shows the one already running.
    if (recorderRef.current) {
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
    const rec = new LessonRecorder({ stream: media, type });
    try {
      await rec.start();
    } catch {
      try { media.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
      return 'micBlocked';
    }
    recorderRef.current = rec;
    releaseScreen.current = await keepScreenOn();
    setLive({ active: true, paused: false, stream: media, screenWentOff: false, recordingId: rec.id ?? null, returnTo });
    return 'recording';
  }, []);

  const pause = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    rec.pause();
    setLive((l) => ({ ...l, paused: true }));
  }, []);

  const resume = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    rec.resume();
    setLive((l) => ({ ...l, paused: false }));
  }, []);

  const finish = useCallback(async (): Promise<FinishedRecording | null> => {
    // Two taps (Finish here, Logout there) finish it once.
    if (finishing.current) return finishing.current;
    const rec = recorderRef.current;
    if (!rec) return null;
    finishing.current = (async () => {
      try {
        return await rec.stop();
      } finally {
        recorderRef.current = null;
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
    if (!recorderRef.current) { void logout(); return; }
    setLogoutAsk(() => logout);
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
    ...live, elapsedMs, start, pause, resume, finish, askBeforeLogout,
  }), [live, elapsedMs, start, pause, resume, finish, askBeforeLogout]);

  const finishThenLogout = async () => {
    const logout = logoutAsk;
    setLogoutAsk(null);
    try { await finish(); } catch { /* its chunks are already on the phone */ }
    if (logout) await logout();
  };

  return (
    <RecordingSessionContext.Provider value={value}>
      {children}
      {logoutAsk && (
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
