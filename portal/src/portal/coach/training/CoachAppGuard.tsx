import { useContext, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AuthContext } from "../../hooks/authContext";
import { FrameSkeleton } from "../../components/Skeleton";
import { readShellHint } from "../../lib/shellHint";
import { resolveRole } from "../../lib/leaderRole";
import { isCoachV2For, useCoachV2 } from "../useCoachV2";
import { coachPathReady, coachReadyHome } from "./appReady";

/**
 * bd-s42dye.2 — the ONE guard around the route table for a coach on the coach app v2: any page that is not one of the
 * ready features (appReady.ts) sends her to the Training Library, before that page mounts (none of its requests fire).
 * Teachers, principals and a coach with the flag off are never touched. While her flag is being read, a coach on a
 * page that is not ready sees the frame's outline, not the old page.
 *
 * Like AnalyticsOnlyGuard it reads the user the app already holds and never asks for it.
 */
const CoachAppGuard = ({ children }: { children: ReactNode }) => {
  const shared = useContext(AuthContext);
  const { pathname } = useLocation();
  const user = shared && !shared.loading ? shared.user : null;
  const isCoach = resolveRole(user) === "coach";
  const flag = useCoachV2(user?.phoneNumber || null, isCoach);
  if (!isCoach || coachPathReady(pathname)) return <>{children}</>;
  if (flag === null) return <FrameSkeleton variant={readShellHint() ?? "classic"} />;
  if (isCoachV2For(user, flag)) return <Navigate to={coachReadyHome()} replace />;
  return <>{children}</>;
};

export default CoachAppGuard;
