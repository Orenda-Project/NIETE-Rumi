import { ReportIssue } from "../../coach/profile/CoachReport";
import { portal } from "../../services/api";
import { featurePath } from "../paths";

/**
 * bd-370733 — Report an issue from the teacher's More: the coach's own form (coach/profile/CoachReport), one form for
 * everyone. TeacherGate (App.tsx) lets in teachers, and principals on the teacher app. Her report goes to
 * POST /report-issue → coach_feedback, the coaches' table; the server records her role there.
 */
export default function TeacherReport() {
  const more = featurePath("more");
  return <ReportIssue more={more} send={(b) => portal.reportIssue({ ...b, page: more })} testId="teacher-report" />;
}
