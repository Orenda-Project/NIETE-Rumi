import { CalendarDays, CalendarPlus, Users } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, HubTile, Chip, useLoad } from "../ui";

/** bd-o15qnr — Scheduling: three big tiles (New visit, My schedule, Team schedule). */
const CoachScheduling = () => {
  const { data } = useLoad(() => coach.getHome(), []);
  const counts = data?.home?.counts;
  return (
    <CoachPage title={C.scheduling} crumb={C.home} backTo="/portal/coach">
      <HubTile to="/portal/coach/new-visit" hue="scheduling" icon={<CalendarPlus className="h-8 w-8" />} title={C.newVisit}
        chips={<Chip>{C.newVisitChip}</Chip>} />
      <HubTile to="/portal/coach/schedule" hue="scheduling" icon={<CalendarDays className="h-8 w-8" />} title={C.mySchedule}
        chips={counts ? <><Chip>{C.thisWeekN(counts.week)}</Chip>{counts.overdue > 0 && <Chip tone="warn">{C.overdueN(counts.overdue)}</Chip>}</> : undefined} />
      <HubTile to="/portal/coach/team" hue="scheduling" icon={<Users className="h-8 w-8" />} title={C.teamSchedule} />
    </CoachPage>
  );
};

export default CoachScheduling;
