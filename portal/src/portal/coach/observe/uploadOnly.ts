import { useContext, useEffect, useState } from "react";
import { readConfigShared } from "../../lib/useNewUi";
import { AuthContext } from "../../hooks/authContext";

/**
 * bd-oe6r47 (queue #278) — upload-only recording: the observe recording step (CoachRecord, the coach app and the
 * principal app) and the debrief recording step (Debrief) offer ONE button, Upload recording, and never start the in-app
 * recorder.
 *
 * bd-ih6cej — FAIL-CLOSED since 25 Nov ~17:20 (the operator: "give both the options again. But advise whoever is using to
 * use their own recorders if their internet is not very good"): app_settings `portal_observe_upload_only` names nobody,
 * so everyone has the in-app recorder again, with Upload recording and the weak-internet line beside it. Only a literal
 * `true` in `features.observeUploadOnly` (the switch naming her) is upload-only; an unreadable config is OFF.
 */
export function uploadOnlyOn(cfg: unknown): boolean {
  const features = (cfg as { features?: unknown } | null | undefined)?.features;
  return !!features && typeof features === "object" && (features as { observeUploadOnly?: unknown }).observeUploadOnly === true;
}

/** The signed-in user's answer: null while /config is read (the shared read, no extra request), then true or false. */
export function useUploadOnly(): boolean | null {
  const userKey = useContext(AuthContext)?.user?.phoneNumber || null;
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared().then(uploadOnlyOn).catch(() => false).then((value) => { if (live) setOn(value); });
    return () => { live = false; };
  }, [userKey]);
  return on;
}
