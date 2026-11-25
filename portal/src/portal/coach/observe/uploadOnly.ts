import { useContext, useEffect, useState } from "react";
import { readConfigShared } from "../../lib/useNewUi";
import { AuthContext } from "../../hooks/authContext";

/**
 * bd-oe6r47 (queue #278) — upload-only recording: the observe recording step (CoachRecord, the coach app and the
 * principal app) and the debrief recording step (Debrief) never start the in-app web recorder. The main button asks for
 * the phone's own recorder (PhonePick: <input type=file accept="audio/*" capture>), the second is Upload recording.
 * The operator, 25 Nov: "until we are completely sure ... the recordings don't go away if you have bad internet ...
 * we only give the upload recording button".
 *
 * app_settings `portal_observe_upload_only`, served as `features.observeUploadOnly` in /config (dashboard/lib/
 * feature-flags.js). DEFAULT ON, unlike the fail-closed switches: upload-only is the safe side (the audio stays in the
 * phone's recorder app whatever the internet does), so an unreadable config, a missing key or any value but a literal
 * `false` is ON. Only `false` brings the web recorder back.
 */
export function uploadOnlyOn(cfg: unknown): boolean {
  const features = (cfg as { features?: unknown } | null | undefined)?.features;
  if (!features || typeof features !== "object") return true;
  return (features as { observeUploadOnly?: unknown }).observeUploadOnly !== false;
}

/** The signed-in user's answer: null while /config is read (the shared read, no extra request), then true or false. */
export function useUploadOnly(): boolean | null {
  const userKey = useContext(AuthContext)?.user?.phoneNumber || null;
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared().then(uploadOnlyOn).catch(() => true).then((value) => { if (live) setOn(value); });
    return () => { live = false; };
  }, [userKey]);
  return on;
}
