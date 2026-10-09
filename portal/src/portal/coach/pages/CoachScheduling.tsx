import { CalendarDays, CalendarPlus, Users } from "lucide-react";
import { coach } from "../../services/api";
import { CoachPage, useLoad } from "../ui";
import { StatusChip } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { SCHEDULE } from "../schedule/copy";
import { ScheduleTile } from "../schedule/ScheduleTile";

/**
 * bd-o15qnr — Schedule (was "Scheduling", bd-o15qnr.8): three big tiles (New visit, My schedule, Team schedule).
 * bd-4404s7.3: in the Schedule feature's rose, status chips in the kit's tones, words in en + ur (../schedule/copy.ts).
 */
const CoachScheduling = () => {
  const c = useCopy(SCHEDULE);
  const { data } = useLoad(() => coach.getHome(), []);
  const counts = data?.home?.counts;
  return (
    <CoachPage title={c.title} crumb={c.home} backTo="/portal/coach">
      <nav aria-label={c.title} className="[display:grid] grid-cols-2 gap-3">
        <ScheduleTile to="/portal/coach/new-visit" label={c.newVisit} icon={<CalendarPlus className="h-9 w-9" strokeWidth={1.8} />}
          chips={<StatusChip text={c.newVisitChip} tone="info" />} />
        <ScheduleTile to="/portal/coach/schedule" label={c.mySchedule} icon={<CalendarDays className="h-9 w-9" strokeWidth={1.8} />}
          chips={counts ? <><StatusChip text={c.thisWeekN(counts.week)} tone="info" />{counts.overdue > 0 && <StatusChip text={c.overdueN(counts.overdue)} tone="waiting" />}</> : undefined} />
        <ScheduleTile wide to="/portal/coach/team" label={c.teamSchedule} icon={<Users className="h-9 w-9" strokeWidth={1.8} />} />
      </nav>
    </CoachPage>
  );
};

export default CoachScheduling;
