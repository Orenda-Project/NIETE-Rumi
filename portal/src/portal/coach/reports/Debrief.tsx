import { Navigate, useParams } from "react-router-dom";
import { FROM_COACH } from "../../lib/coachObserve";

/**
 * bd-4404s7.5 — Debrief, step 3 of 5.
 *
 * INTERIM: until kit PR 2 lands (RecordUploadPair, AudioCard) this opens the existing Debrief page (the old
 * /leader/observe/:id/talk, told it came from the coach app: it names the step "Debrief" and returns to the v2
 * observation page). It is replaced by the kit-built screen in the next PR.
 */
export default function Debrief() {
  const { id = "" } = useParams();
  return <Navigate to={`/portal/leader/observe/${encodeURIComponent(id)}/talk?${FROM_COACH}`} replace />;
}
