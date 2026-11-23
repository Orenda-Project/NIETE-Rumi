import { Navigate } from "react-router-dom";
import { useCopy } from "../../teacher/i18n";
import CoachScheduling from "../pages/CoachScheduling";
import CoachSchedule from "../pages/CoachSchedule";
import CoachObserve from "../pages/CoachObserve";
import CoachObservePick from "../pages/CoachObservePick";
import CoachObserveToday from "../pages/CoachObserveToday";
import ObservePage from "../observe/ObservePage";
import { SCHEDULE } from "../schedule/copy";
import { Loading } from "../ui";
import { useFlowV2 } from "./useCoachFlowV2";

/**
 * bd-o15qnr.26 (queue #177, Option A) — the coach's Schedule and Observe addresses, with the visit flow v2 switch
 * (portal_coach_flow_v2, fail-closed) deciding what each one shows:
 *
 *   address                       switch on (Concept 1, "Today and Needs you")   switch off (today, unchanged)
 *   /portal/coach/observe         the one Observe screen (CoachObserveToday)      the Observe hub (two tiles)
 *   /portal/coach/schedule        → Observe, All booked open (v6)                 My schedule (CoachSchedule, the week)
 *   /portal/coach/scheduling      → /portal/coach/observe                         the Schedule hub (three tiles)
 *   /portal/coach/observe/pick    → /portal/coach/observe                         Take observation's list (Earlier folded)
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

// bd-o15qnr.27 (v6): Booked visits opens in place on Observe ("All booked"); the old address opens it there.
export const ScheduleRoute = pick(<Navigate to="/portal/coach/observe?booked=open" replace />, <CoachSchedule />);
export const SchedulingRoute = pick(<Navigate to="/portal/coach/observe" replace />, <CoachScheduling />);
export const ObservePickRoute = pick(<Navigate to="/portal/coach/observe" replace />, <CoachObservePick />);
export const ObserveRoute = pick(<CoachObserveToday />, <CoachObserve />);
