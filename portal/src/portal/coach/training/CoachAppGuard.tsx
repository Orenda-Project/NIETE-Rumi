import { useContext, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AuthContext } from "../../hooks/authContext";
import { FrameSkeleton } from "../../components/Skeleton";
import { readShellHint } from "../../lib/shellHint";
import { resolveRole } from "../../lib/leaderRole";
import { useChildTestSa } from "../../lib/useChildTestSa";
import { isCoachV2For, useCoachV2 } from "../useCoachV2";
import { coachPathReady, coachReadyFor, coachReadyHome } from "./appReady";
import { useCoachip } from "../insights/useCoachip";

/**
 * bd-s42dye.2 — the ONE guard around the route table for a coach on the coach app v2: any page that is not one of the
 * ready features (appReady.ts) sends her to the Training Library, before that page mounts (none of its requests fire).
 * Teachers, principals and a coach with the flag off are never touched. While her flag is being read, a coach on a
 * page that is not ready sees the frame's outline, not the old page.
 *
 * The Learning assessment (/portal/leader/assess) also opens for a v2 coach while portal_child_test_sa is on.
 *
 * bd-sex15q.15 — with portal_coachip on, the insight pages ("This week", COACH_INSIGHTS_BASE) are ready too and come
 * first, so a v2 coach lands on "This week" instead of the Training Library. With it off (or unreadable) nothing here
 * changes.
 *
 * Like AnalyticsOnlyGuard it reads the user the app already holds and never asks for it.
 */
const ASSESS = "/portal/leader/assess";

const CoachAppGuard = ({ children }: { children: ReactNode }) => {
  const shared = useContext(AuthContext);
  const { pathname } = useLocation();
  const user = shared && !shared.loading ? shared.user : null;
  const isCoach = resolveRole(user) === "coach";
  const flag = useCoachV2(user?.phoneNumber || null, isCoach);
  const onAssess = pathname === ASSESS || pathname.startsWith(`${ASSESS}/`);
  const assess = useChildTestSa(isCoach && onAssess);
  const coachip = useCoachip(user?.phoneNumber || null, isCoach);
  if (!isCoach || coachPathReady(pathname)) return <>{children}</>;
  if (flag === null) return <FrameSkeleton variant={readShellHint() ?? "classic"} />;
  if (!isCoachV2For(user, flag)) return <>{children}</>;
  if (coachip === null) return <FrameSkeleton variant={readShellHint() ?? "classic"} />;
  const ready = coachReadyFor(coachip);
  if (coachPathReady(pathname, ready)) return <>{children}</>;
  if (onAssess && assess === null) return <FrameSkeleton variant={readShellHint() ?? "classic"} />;
  if (onAssess && assess) return <>{children}</>;
  return <Navigate to={coachReadyHome(ready)} replace />;
};

export default CoachAppGuard;
