import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { AudioCard, HistoryRow, Tray } from "../../teacher/ui";
import { readKept, setLink } from "../../lib/recordingStore";
import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { leader } from "../../services/api";
import { karachiDay } from "../time";
import { recordingFilename } from "../../lib/saveRecording";
import { OBSERVE } from "./copy";
import { lengthShort } from "./format";
import { pkTime } from "../reports/data";
import type { ObserveRoutes } from "./observeRoutes";
import { useKeptItems, type KeptItem } from "./keptRecording";
import { SectionLabel } from "../ui";
import { SCHEDULE } from "../schedule/copy";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";

/**
 * bd-ma9jiy.3 (queue #262; the operator 26 Nov ~11:10: "incomplete recordings aka recordings that were done but not yet
 * submitted should also be on the Needs You section") — one row per recording this phone keeps and has not sent, in the
 * Needs you card of Observe and Home (coach and principal), before the server's rows:
 *
 *   the teacher · "Debrief" for a talk · its length · the time it started; the chip Paused (cut mid-way, within the hour)
 *   or Not sent (stopped, or older), amber either way (it waits on her)
 *
 *   paused observation   → its record step, which opens it PAUSED (Resume / Stop)
 *   not sent observation → its visit page (Send saved recording there); with no visit (kept before 25 Nov) → schedule
 *                          that teacher for now, whose visit page offers it
 *   debrief talk         → its Debrief (Continue recording, or Send saved recording)
 */
export function keptHref(it: KeptItem, routes: ObserveRoutes): string | null {
  if (it.state === "unlinked") return null; // bd-ma9jiy: no visit to open — its own tray (Save to phone)
  if (it.kind === "dbrf") return routes.observation(it.observationId || "", "debrief");
  if (!it.visitId) return null;
  return it.state === "paused" ? routes.record(it.visitId) : routes.visit(it.visitId);
}

/**
 * bd-ma9jiy (26 Nov ~15:10) — a copy kept before recordings said which visit they belong to: never reopened, never sent
 * as a visit's (the operator: "never auto-append"). Its tray: what it is, its player, Save to phone.
 */
function UnlinkedTray({ item, routes, onClose }: { item: KeptItem; routes: ObserveRoutes; onClose: () => void }) {
  const O = useCopy(OBSERVE);
  const navigate = useNavigate();
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The operator, 26 Nov: an old-recorder copy is sent too — as its OWN observation of its teacher (a visit booked for now;
  // the principal's teacher page), its row tied to that visit, then Check and send as for any recording. No teacher on the
  // phone: no visit to send it with (Save to phone only).
  const send = async () => {
    if (!item.teacherExtId || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      let visitId = item.teacherExtId;
      if (routes.coachGate) {
        const r = await leader.createSchedule({ teacherExtId: item.teacherExtId, date: karachiDay(), now: true });
        if (!r?.id) throw new Error("no visit");
        visitId = r.id;
      }
      await setLink(item.id, { kind: "obs", visitId, teacherExtId: item.teacherExtId, teacherName: item.teacherName || null });
      navigate(routes.check(visitId));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    readKept(item.id).then((k) => {
      if (!live || !k) return;
      url = URL.createObjectURL(k.blob);
      setSrc(url);
    }).catch(() => { /* nothing to play */ });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [item.id]);
  const time = pkTime(item.startedAt) || "";
  return (
    <Tray open title={O.unlinkedFrom(time)} onClose={onClose} testId="unlinked-tray">
      <p className="m-0 text-[15px] leading-snug text-[#4b5563]">{O.unlinkedLine}</p>
      {src && (
        <AudioCard title={item.teacherName || O.dash} sub={lengthShort(item.elapsedMs, O) || undefined} src={src} controls testId="unlinked-player"
          save={{ kind: item.kind === "dbrf" ? "dbrf" : "obs", recordingId: item.id, filename: recordingFilename({ kind: item.kind === "dbrf" ? "dbrf" : "obs", at: item.startedAt, ext: ".webm" }) }} />
      )}
      {item.teacherExtId && item.kind === "obs" ? (
        <button type="button" onClick={() => { void send(); }} disabled={busy}
          className={cn("flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-[#33374a] px-4 text-base font-semibold text-white disabled:opacity-60", FOCUS)}>
          <Send className="h-5 w-5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />{O.sendAsObservation(item.teacherName || O.dash)}
        </button>
      ) : null}
      {failed ? <p role="alert" className="m-0 text-center text-[14px] font-semibold text-[#b45309]">{O.sendFailedShort}</p> : null}
    </Tray>
  );
}

export function KeptRows({ items, routes, firstIndex = 0 }: { items: readonly KeptItem[]; routes: ObserveRoutes; firstIndex?: number }) {
  const O = useCopy(OBSERVE);
  const [open, setOpen] = useState<KeptItem | null>(null);
  return (
    <>
      {items.map((it, i) => {
        const extra = [it.kind === "dbrf" ? O.lastStep.talk : null, lengthShort(it.elapsedMs, O) || null, pkTime(it.startedAt)]
          .filter(Boolean).join(" · ");
        const chip = { text: it.state === "paused" ? O.paused : it.state === "unlinked" ? O.unlinkedChip : O.notSentChip, tone: "waiting" as const };
        const to = keptHref(it, routes);
        const row = (
          <HistoryRow key={it.id} lead="person" first={firstIndex + i === 0} title={it.teacherName || O.dash} extra={extra}
            chip={chip} to={to ?? undefined} action={to ? undefined : "none"} />
        );
        return to ? row : (
          <button key={it.id} type="button" onClick={() => setOpen(it)} className={cn("block w-full text-start", FOCUS)}>{row}</button>
        );
      })}
      {open && <UnlinkedTray item={open} routes={routes} onClose={() => setOpen(null)} />}
    </>
  );
}

/**
 * bd-ma9jiy.3 — Home's Needs you card (the full coach Home, the slim one every production coach has, and the principal's):
 * one row per recording kept on this phone and not sent; nothing at all when there is none.
 */
export function KeptHomeCard({ routes }: { routes: ObserveRoutes }) {
  const S = useCopy(SCHEDULE);
  const items = useKeptItems() ?? [];
  if (items.length === 0) return null;
  return (
    <section data-testid="home-kept" className="flex flex-col gap-2">
      <SectionLabel count={items.length} countTone="warn">{S.needsYou}</SectionLabel>
      <div className={LIST_CARD}><KeptRows items={items} routes={routes} /></div>
    </section>
  );
}
