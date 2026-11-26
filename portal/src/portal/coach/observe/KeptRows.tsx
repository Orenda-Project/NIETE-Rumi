import { useCopy } from "../../teacher/i18n";
import { HistoryRow } from "../../teacher/ui";
import { OBSERVE } from "./copy";
import { lengthShort } from "./format";
import { pkTime } from "../reports/data";
import type { ObserveRoutes } from "./observeRoutes";
import type { KeptItem } from "./keptRecording";

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
export function keptHref(it: KeptItem, routes: ObserveRoutes): string {
  if (it.kind === "dbrf") return routes.observation(it.observationId || "", "debrief");
  if (!it.visitId) return routes.again(it.teacherExtId, it.schoolExtId);
  return it.state === "paused" ? routes.record(it.visitId) : routes.visit(it.visitId);
}

export function KeptRows({ items, routes, firstIndex = 0 }: { items: readonly KeptItem[]; routes: ObserveRoutes; firstIndex?: number }) {
  const O = useCopy(OBSERVE);
  return (
    <>
      {items.map((it, i) => {
        const extra = [it.kind === "dbrf" ? O.lastStep.talk : null, lengthShort(it.elapsedMs, O) || null, pkTime(it.startedAt)]
          .filter(Boolean).join(" · ");
        return (
          <HistoryRow key={it.id} lead="person" first={firstIndex + i === 0} title={it.teacherName || O.dash} extra={extra}
            chip={{ text: it.state === "paused" ? O.paused : O.notSentChip, tone: "waiting" }} to={keptHref(it, routes)} />
        );
      })}
    </>
  );
}
