import { useContext, useEffect, useState } from "react";
import { readConfigShared } from "./useNewUi";
import { AuthContext } from "../hooks/authContext";

/**
 * bd-ma9jiy (queue #262) — portal_recording_resume, for the TEACHER's own Digital Coaching recording: a recording this
 * phone kept (cut by a kill, or never sent) reopens on the record screen as a PAUSED recording (Resume / Stop), instead of
 * the "Not sent" card. Fail-closed: only a literal `true` in `features.recordingResume` turns it on; an unreadable config
 * is off. Coaches' and principals' observation and debrief have it on by default and never read this.
 */
export function recordingResumeOn(cfg: unknown): boolean {
  const features = (cfg as { features?: unknown } | null | undefined)?.features;
  return !!features && typeof features === "object" && (features as { recordingResume?: unknown }).recordingResume === true;
}

/** The signed-in user's answer: null while /config is read (the shared read, no extra request), then true or false. */
export function useRecordingResume(): boolean | null {
  const userKey = useContext(AuthContext)?.user?.phoneNumber || null;
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared().then(recordingResumeOn).catch(() => false).then((value) => { if (live) setOn(value); });
    return () => { live = false; };
  }, [userKey]);
  return on;
}
