import { Navigate, useParams } from "react-router-dom";
import { FROM_COACH } from "../../lib/coachObserve";

/**
 * bd-4404s7.5 — Feedback Form, step 2 of 5.
 *
 * INTERIM: until kit PR 2 lands (StepBar, RatingScale) this opens the existing Feedback Form page (the old
 * /leader/observe/:id/draft, told it came from the coach app: it names the step "Feedback Form" and returns to the
 * v2 observation page). It is replaced by the kit-built screen in the next PR.
 */
export default function FeedbackForm() {
  const { id = "" } = useParams();
  return <Navigate to={`/portal/leader/observe/${encodeURIComponent(id)}/draft?${FROM_COACH}`} replace />;
}
