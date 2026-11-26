import { useEffect, useMemo, useState } from "react";
import { latestUnsent, listKept, type KeptRecording } from "../../lib/recordingStore";
import { useRecordingSession } from "../../lib/recordingSession";
import { useSendingJobs } from "./sender";
import { lastSavedAt, RESUME_WINDOW_MS, wasCut, type KeptSummary } from "../../lib/keptOffer";
import { linkOf, sameObservation } from "../../lib/recordingLink";

/**
 * bd-ih6cej (queue #278) — a recording this phone keeps for THIS teacher: an in-app recording that was cut (the page or
 * WhatsApp closed, the phone off) or never sent, still in IndexedDB with whose it is in localStorage (rememberRecording).
 * Found even when a newer kept recording belongs to another teacher (latestUnsent's `accept`). Until #262 ships it is the
 * only way back to such a recording, so the visit page and the record step offer it before a new one starts.
 *
 * WhatsApp's in-app browser keeps both stores across closing the browser, swiping WhatsApp away and a phone restart
 * (#258, a WebView host on Android 15); they are per site address, so Chrome and the NIETE app each have their own.
 */
export function keptForVisit(visitId: string): ReturnType<typeof latestUnsent> {
  // Inside a promise: a phone without IndexedDB (or a store that throws at once) answers "none", never breaks the page.
  // bd-ma9jiy (26 Nov ~15:10, the operator: "note which observation is the one that's being recorded"): THIS visit's
  // lesson recording only — another visit of the same teacher, a debrief talk or an unlinked copy is never it.
  return Promise.resolve().then(() => latestUnsent((meta) => sameObservation(meta, { kind: "obs", visitId })));
}

/** bd-ma9jiy — the debrief talk this phone keeps for THIS observation (cut, or stopped and never sent), or null. */
export function keptDebriefFor(observationId: string): ReturnType<typeof latestUnsent> {
  return Promise.resolve().then(() => latestUnsent((meta) => sameObservation(meta, { kind: "dbrf", observationId })));
}

/**
 * bd-ma9jiy.3 (queue #262, UI round; #292's rule, 26 Nov) — what a kept recording IS to the coach:
 *   paused   cut by a kill (she never pressed Stop) and last saved within the hour, and a WebM (the code joins WebM parts):
 *            the lesson she was in. Continue recording only; it reopens paused and Resume carries on in it.
 *   unsent   anything else (she stopped it, or it is older): hers to send (Send saved recording), never resumed — Resume
 *            would join today's lesson onto an old one (26 Nov: 6 teachers' lessons were joined that way).
 * The window and the test are the teacher's own (lib/keptOffer, #292); the coach has no minimum length to send.
 */
export type KeptState = "paused" | "unsent" | "unlinked";

export function keptState(k: KeptSummary, now = Date.now()): KeptState {
  return k.meta.ext === ".webm" && wasCut(k) && now - lastSavedAt(k) <= RESUME_WINDOW_MS ? "paused" : "unsent";
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

/** Whether THIS visit has one kept: null while the phone is asked (or with no visit yet), then true or false. */
export function useKeptForVisit(visitId: string | null | undefined, ask = true): boolean | null {
  const [kept, setKept] = useState<boolean | null>(null);
  useEffect(() => {
    if (!visitId || !ask) return undefined;
    let live = true;
    keptForVisit(visitId).then((u) => { if (live) setKept(!!u); }).catch(() => { if (live) setKept(false); });
    return () => { live = false; };
  }, [visitId, ask]);
  return visitId && ask ? kept : null;
}

/** bd-ma9jiy.3 — one Needs you row: a recording the coach (or principal) made on this phone and has not sent. */
export type KeptItem = {
  id: string;
  kind: "obs" | "dbrf";
  state: KeptState;
  teacherName: string;
  teacherExtId: string;
  schoolExtId: string | null;
  visitId: string | null;
  observationId: string | null;
  startedAt: string;
  elapsedMs: number;
};

/**
 * Every recording this phone keeps that is the coach's (remembered with its teacher: an observation or a debrief talk),
 * newest first. A teacher's own Digital Coaching take on a shared phone has no such entry and is not listed here.
 */
export async function listKeptItems(now = Date.now()): Promise<KeptItem[]> {
  const all = await listKept();
  const out: KeptItem[] = [];
  for (const k of all) {
    const link = linkOf(k.meta);
    // The coach's (or principal's) own: a lesson or a debrief. A teacher's Digital Coaching take (an attempt) is not hers.
    // One with nothing on the phone to say whose it is (the old recorder, a cleared list) is still listed — unlinked,
    // with Save to phone — never lost (the operator, 26 Nov).
    if (link?.kind === "dc") continue;
    if (!link) {
      out.push({ id: k.meta.id, kind: "obs", state: "unlinked", teacherName: "", teacherExtId: "", schoolExtId: null, visitId: null,
        observationId: null, startedAt: k.meta.startedAt, elapsedMs: k.meta.elapsedMs || 0 });
      continue;
    }
    const kind = link.kind === "dbrf" ? "dbrf" : "obs";
    const linked = kind === "dbrf" ? !!link.observationId : !!link.visitId;
    out.push({
      id: k.meta.id, kind, state: linked ? keptState(k, now) : "unlinked", teacherName: link.teacherName || "",
      teacherExtId: link.teacherExtId || "", schoolExtId: null, visitId: link.visitId ?? null,
      observationId: link.observationId ?? null, startedAt: k.meta.startedAt, elapsedMs: k.meta.elapsedMs || 0,
    });
  }
  return out;
}

/**
 * The Needs you rows, read once on arrival: null while the phone is asked, then the list ([] with no phone storage). The
 * recording going on now (the session above the routes) and one being sent now (In progress shows it) are not rows.
 */
export function useKeptItems(): KeptItem[] | null {
  const [items, setItems] = useState<KeptItem[] | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => listKeptItems()).then((list) => { if (live) setItems(list); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);
  const session = useRecordingSession();
  const recordingNow = session?.active ? session.recordingId : null;
  const sending = useSendingJobs();
  return useMemo(() => {
    if (!items) return null;
    const busy = new Set(sending.map((j) => j.recordingId).filter(Boolean));
    return items.filter((it) => it.id !== recordingNow && !busy.has(it.id));
  }, [items, recordingNow, sending]);
}
