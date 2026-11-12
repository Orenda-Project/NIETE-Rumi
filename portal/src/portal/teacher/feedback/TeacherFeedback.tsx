import { FeedbackForm } from "../../coach/feedback/FeedbackPage";
import { featurePath } from "../paths";

/**
 * bd-370733 — Send feedback from the teacher's More: the coach's own form (coach/feedback), one form for everyone.
 * TeacherGate (App.tsx) lets in teachers, and principals on the teacher app. What she sends goes to POST /feedback →
 * coach_feedback, the coaches' table; the bot records her role there.
 */
export default function TeacherFeedback() {
  return <FeedbackForm more={featurePath("more")} testId="teacher-feedback" />;
}
