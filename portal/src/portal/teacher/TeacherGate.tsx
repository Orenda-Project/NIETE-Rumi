import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTeacherV2, isTeacherV2For } from "./useTeacherV2";

/**
 * bd-fmf24g.1 — the /portal/teacher pages exist only for a teacher with
 * portal_teacher_v2. Anyone else who lands on one (a bookmark, a shared link)
 * goes to today's Home, exactly as before (it sends a leader on to My Patch).
 * While the flag is read nothing of v2 renders, so a non-pilot user never sees
 * a v2 screen flash.
 *
 * App.tsx wraps EVERY registered teacher route in this gate, so a feature page
 * cannot forget it.
 */
const TeacherGate = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const flag = useTeacherV2(user?.phoneNumber || null, !loading && !!user);
  if (loading) return null;
  if (!user) return <Navigate to="/portal/login" replace />;
  if (flag === null) return null;
  if (!isTeacherV2For(user, flag)) return <Navigate to="/portal/dashboard" replace />;
  return <>{children}</>;
};

export default TeacherGate;
