import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useCoachV2, isCoachV2For } from "./useCoachV2";

/**
 * bd-o15qnr — the /portal/coach screens exist only for a coach with
 * portal_coach_v2. Anyone else who lands on one (a bookmark, a shared link)
 * goes to My Patch, exactly as before. While the flag is read nothing of v2
 * renders, so a non-pilot user never sees a v2 screen flash.
 */
const CoachGate = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const flag = useCoachV2(user?.phoneNumber || null, !loading && !!user);
  if (loading) return null;
  if (!user) return <Navigate to="/portal/login" replace />;
  if (flag === null) return null;
  if (!isCoachV2For(user, flag)) return <Navigate to="/portal/leader" replace />;
  return <>{children}</>;
};

export default CoachGate;
