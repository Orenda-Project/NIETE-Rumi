import { useContext, useEffect, useState } from "react";
import { readConfigShared } from "./useNewUi";
import { AuthContext } from "../hooks/authContext";

/**
 * bd-8sr958 (queue #320) — app_settings.recording_repair: a damaged recording is checked at the pick (chips, Send stays
 * on; an empty file is refused) and a lesson the team is recovering reads "Recovering". Fail-closed: only a literal
 * `true` in `features.recordingRepair` turns it on; an unreadable config is off, and every screen is then as before.
 */
export function recordingRepairOn(cfg: unknown): boolean {
  const features = (cfg as { features?: unknown } | null | undefined)?.features;
  return !!features && typeof features === "object" && (features as { recordingRepair?: unknown }).recordingRepair === true;
}

/** The signed-in user's answer: null while /config is read (the shared read), then true or false. */
export function useRecordingRepair(): boolean | null {
  const userKey = useContext(AuthContext)?.user?.phoneNumber || null;
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared().then(recordingRepairOn).catch(() => false).then((value) => { if (live) setOn(value); });
    return () => { live = false; };
  }, [userKey]);
  return on;
}
