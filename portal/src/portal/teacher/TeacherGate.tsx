import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTeacherV2, isTeacherV2For } from "./useTeacherV2";
import { FrameSkeleton } from "../components/Skeleton";
import { readShellHint } from "../lib/shellHint";

/**
 * bd-fmf24g.1 — the /portal/teacher pages exist only for a teacher with
 * portal_teacher_v2. Anyone else who lands on one (a bookmark, a shared link)
 * goes to today's Home, exactly as before (it sends a leader on to My Patch).
 * While the flag is read nothing of v2 renders, so a non-pilot user never sees
 * a v2 screen flash. bd-fxk3t8: "nothing" was a white screen (3 s on sandbox) —
 * it is the app's frame with placeholder blocks now, never v2 content.
 *
 * App.tsx wraps EVERY registered teacher route in this gate, so a feature page
 * cannot forget it.
 */
const TeacherGate = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const flag = useTeacherV2(user?.phoneNumber || null, !loading && !!user);
  if (loading) return <FrameSkeleton variant={readShellHint() ?? "classic"} />;
  if (!user) return <Navigate to="/portal/login" replace />;
  if (flag === null) return <FrameSkeleton variant={readShellHint() ?? "classic"} />;
  if (!isTeacherV2For(user, flag)) return <Navigate to="/portal/dashboard" replace />;
  return <>{children}</>;
};

export default TeacherGate;
