import { Eye, FileCheck2 } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, HubTile, Chip, useLoad } from "../ui";
import { formatSlot } from "../time";

/**
 * bd-o15qnr — Observe: two tiles. Take observation (always against a scheduled
 * visit: pick the teacher, then Record live or Attach on her Visit page) and
 * Reports.
 */
const CoachObserve = () => {
  const { data } = useLoad(() => coach.getHome(), []);
  const home = data?.home;
  const next = home?.today.find((v) => v.current);
  return (
    <CoachPage title={C.observe} crumb={C.home} backTo="/portal/coach">
      <HubTile to="/portal/coach/observe/pick" hue="observe" icon={<Eye className="h-8 w-8" />} title={C.takeObservationTile}
        chips={next ? <Chip>{`${C.next}: ${(next.teacherName || "").split(" ")[0]} ${formatSlot(next.scheduledSlot)}`}</Chip> : undefined} />
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
