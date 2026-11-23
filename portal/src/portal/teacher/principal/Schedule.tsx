import CoachSchedule, { type ScheduleLinks } from "../../coach/pages/CoachSchedule";
import { OBS_HOME } from "../observations/paths";
import { PRINCIPAL_PICK, principalVisitPath } from "./observe";

/**
 * bd-31ziu8 — a principal's My schedule: the coach's screen (GET /coach/schedule, her own bookings), each visit
 * opening the picked teacher's page (Start recording / Upload recording), New visit back to Pick the teacher.
 */
const LINKS: ScheduleLinks = {
  visitTo: (v) => principalVisitPath(v.teacherExtId || ""),
  newVisit: PRINCIPAL_PICK,
  back: OBS_HOME,
};

export function PrincipalSchedule() {
  return <CoachSchedule links={LINKS} />;
}
