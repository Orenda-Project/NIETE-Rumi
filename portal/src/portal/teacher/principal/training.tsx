import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { principalOf, resolveRole } from "../../lib/leaderRole";
import { useTeacherV2, isTeacherV2For } from "../useTeacherV2";
import { teacherPath } from "../routes";
import { COACH_TRAINING_PATH } from "../../coach/coachTraining/modules";
import { TrainingList } from "../../coach/coachTraining/CoachTrainingPage";
import { TrainingModule } from "../../coach/coachTraining/CoachTrainingModulePage";

/** My Patch: where a principal off the teacher app lands (pages/LeaderHome.tsx). */
const PATCH = "/portal/leader";

/**
 * bd-v04lsh (queue #257) — Principal Training. The operator, 24 Nov 2026: "Coach Trainings needs to go live for Principal
 * as well. Showing as Principal Training. Same feature, same trainings." The coach's own pages (coach/coachTraining),
 * drawn for a principal: the same ten modules, PDF / Video and Mark done (her own row), titled Principal Training.
 *
 * Every principal, by her role: the 487 on the principal app open it from their Home's tile, the 68 on My Patch from its
 * card (prod, 25 Nov). TeacherGate lets her in on these two routes whatever her teacher-app flag (`leaders`, routes.tsx);
 * here a coach is sent to her own Coach Training and anyone else Home. Back is the principal's own Home: the teacher
 * app's when she is on it, else My Patch (the teacher-app flag, read once, as TeacherGate reads it).
 */
export function PrincipalTrainingGate({ children }: { children: (home: string) => ReactNode }) {
  const { user, loading } = useAuth();
  const principal = principalOf(user);
  const flag = useTeacherV2(user?.phoneNumber || null, !loading && principal);
  if (loading) return null;
  if (!user) return <Navigate to="/portal/login" replace />;
  if (!principal) return <Navigate to={resolveRole(user) === "coach" ? COACH_TRAINING_PATH : teacherPath("home")} replace />;
  if (flag === null) return null;
  return <>{children(isTeacherV2For(user, flag) ? teacherPath("home") : PATCH)}</>;
}

/** /portal/teacher/principal-training — the ten modules, "Principal Training". */
export function PrincipalTrainingPage() {
  return <PrincipalTrainingGate>{(home) => <TrainingList audience="principal" backTo={home} />}</PrincipalTrainingGate>;
}

/** /portal/teacher/principal-training/<n> — one module: PDF or Video, Mark done. */
export function PrincipalTrainingModulePage() {
  return <PrincipalTrainingGate>{() => <TrainingModule audience="principal" />}</PrincipalTrainingGate>;
}
