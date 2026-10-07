import { Eye, FileCheck2 } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, HubTile, Chip, useLoad } from "../ui";
import { formatSlot, localDay } from "../time";
import type { CoachVisit } from "../types";

/**
 * bd-o15qnr — Observe: two tiles. Take observation (always against a scheduled
 * visit: pick the teacher, then Record live or Attach on her Visit page) and
 * Reports.
 *
 * bd-o15qnr.8 — the Take observation chip names her next visit whatever its day
 * (operator: "show whichever one the next is, even if it is not today"):
 * "Next: Ayesha · Thu 8 Oct 9:00 AM", or the time alone when it is today.
 */
function nextChip(v: CoachVisit, today: string): string {
  const first = (v.teacherName || "").split(" ")[0];
  const time = v.scheduledSlot ? formatSlot(v.scheduledSlot) : "";
  const day = v.scheduledFor && v.scheduledFor !== today
    ? new Date(`${v.scheduledFor}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : "";
  return `${C.next}: ${first} · ${[day, time].filter(Boolean).join(" ")}`.trim().replace(/ ·$/, "");
}

const CoachObserve = () => {
  const { data } = useLoad(() => coach.getHome(), []);
  const home = data?.home;
  const next = home?.next || null;
  return (
    <CoachPage title={C.observe} crumb={C.home} backTo="/portal/coach">
      <HubTile to="/portal/coach/observe/pick" hue="observe" icon={<Eye className="h-8 w-8" />} title={C.takeObservationTile}
        chips={next ? <Chip>{nextChip(next, localDay())}</Chip> : undefined} />
      <HubTile to="/portal/coach/reports" hue="observe" icon={<FileCheck2 className="h-8 w-8" />} title={C.reports}
        chips={home ? (
          <>
            <Chip tone={home.counts.waiting > 0 ? "warn" : "info"}>{C.waitingN(home.counts.waiting)}</Chip>
            {home.counts.inProgress > 0 && <Chip>{C.inProgressN(home.counts.inProgress)}</Chip>}
          </>
        ) : undefined} />
    </CoachPage>
  );
};

export default CoachObserve;
