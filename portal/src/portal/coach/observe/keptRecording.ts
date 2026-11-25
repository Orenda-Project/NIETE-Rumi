import { useEffect, useState } from "react";
import { latestUnsent, type KeptRecording } from "../../lib/recordingStore";
import { recordingTeacher } from "../../lib/coachObserve";

/**
 * bd-ih6cej (queue #278) — a recording this phone keeps for THIS teacher: an in-app recording that was cut (the page or
 * WhatsApp closed, the phone off) or never sent, still in IndexedDB with whose it is in localStorage (rememberRecording).
 * Found even when a newer kept recording belongs to another teacher (latestUnsent's `accept`). Until #262 ships it is the
 * only way back to such a recording, so the visit page and the record step offer it before a new one starts.
 *
 * WhatsApp's in-app browser keeps both stores across closing the browser, swiping WhatsApp away and a phone restart
 * (#258, a WebView host on Android 15); they are per site address, so Chrome and the NIETE app each have their own.
 */
export function keptFor(teacherExtId: string): ReturnType<typeof latestUnsent> {
  // Inside a promise: a phone without IndexedDB (or a store that throws at once) answers "none", never breaks the page.
  // bd-ma9jiy: a debrief talk is never offered as the classroom recording.
  return Promise.resolve().then(() => latestUnsent((meta) => {
    const who = recordingTeacher(meta.id);
    return who?.teacherExtId === teacherExtId && who.kind !== "dbrf";
  }));
}

/** bd-ma9jiy — the debrief talk this phone keeps for THIS observation (cut, or stopped and never sent), or null. */
export function keptDebriefFor(observationId: string): ReturnType<typeof latestUnsent> {
  return Promise.resolve().then(() => latestUnsent((meta) => {
    const who = recordingTeacher(meta.id);
    return who?.kind === "dbrf" && who.observationId === observationId;
  }));
}

/**
 * bd-ma9jiy (queue #262) — the kept recording itself (to open it as paused), read once: undefined while the phone is
 * asked (or nothing to ask), then the recording or null. A failed read is null.
 */
export function useKept(ask: (() => Promise<KeptRecording | null>) | null, deps: unknown[]): KeptRecording | null | undefined {
  const [kept, setKept] = useState<KeptRecording | null | undefined>(undefined);
  useEffect(() => {
    if (!ask) { setKept(undefined); return undefined; }
    let live = true;
    setKept(undefined);
    ask().then((k) => { if (live) setKept(k); }).catch(() => { if (live) setKept(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return kept;
}

/** Whether one is kept: null while the phone is asked (or with no teacher yet), then true or false. A failed read is false. */
export function useKeptFor(teacherExtId: string | null | undefined, ask = true): boolean | null {
  const [kept, setKept] = useState<boolean | null>(null);
  useEffect(() => {
    if (!teacherExtId || !ask) return undefined;
    let live = true;
    keptFor(teacherExtId).then((u) => { if (live) setKept(!!u); }).catch(() => { if (live) setKept(false); });
    return () => { live = false; };
  }, [teacherExtId, ask]);
  return teacherExtId && ask ? kept : null;
}
