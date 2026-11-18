import { Navigate } from "react-router-dom";
import { useCopy } from "../../teacher/i18n";
import CoachScheduling from "../pages/CoachScheduling";
import CoachSchedule from "../pages/CoachSchedule";
import CoachObserve from "../pages/CoachObserve";
import CoachObservePick from "../pages/CoachObservePick";
import CoachVisits from "../pages/CoachVisits";
import ObservePage from "../observe/ObservePage";
import { SCHEDULE } from "../schedule/copy";
import { Loading } from "../ui";
import { useFlowV2 } from "./useCoachFlowV2";

/**
 * bd-o15qnr.26 (queue #177, Option A) — the coach's Schedule and Observe addresses, with the visit flow v2 switch
 * (portal_coach_flow_v2, fail-closed) deciding what each one shows:
 *
 *   address                       switch on                          switch off (today, unchanged)
 *   /portal/coach/schedule        the one open list (CoachVisits)    My schedule (CoachSchedule, the week)
 *   /portal/coach/scheduling      → /portal/coach/schedule           the Schedule hub (three tiles)
 *   /portal/coach/observe/pick    → /portal/coach/schedule           Take observation's list (with Earlier folded)
 *   /portal/coach/observe         → /portal/coach/reports            the Observe hub (two tiles)
 *
 * The old addresses stay served, so a WhatsApp link or a bookmark still lands. While the switch is read (a moment, the
 * /config read is shared) the page frame shows with grey blocks: nothing redirects until the answer is in.
 */

function Waiting() {
  const S = useCopy(SCHEDULE);
  return <ObservePage title={S.title} crumb={S.home} backTo="/portal/coach"><Loading /></ObservePage>;
}

function pick(on: JSX.Element, off: JSX.Element) {
  return function FlowRoute() {
    const flow = useFlowV2();
    if (flow === null) return <Waiting />;
    return flow ? on : off;
  };
}

export const ScheduleRoute = pick(<CoachVisits />, <CoachSchedule />);
export const SchedulingRoute = pick(<Navigate to="/portal/coach/schedule" replace />, <CoachScheduling />);
export const ObservePickRoute = pick(<Navigate to="/portal/coach/schedule" replace />, <CoachObservePick />);
export const ObserveRoute = pick(<Navigate to="/portal/coach/reports" replace />, <CoachObserve />);
