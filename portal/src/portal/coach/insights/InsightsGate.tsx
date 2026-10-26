import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import CoachGate from "../CoachGate";
import { useAuth } from "../../hooks/useAuth";
import { useCoachip } from "./useCoachip";
import { COACH_TRAINING_BASE } from "../training/appReady";

/**
 * bd-sex15q.15 — every COACHIP coach page sits behind CoachGate (a v2 coach) AND portal_coachip. With the switch off,
 * loading or unreadable nothing of the page renders and none of its requests fire; off sends the coach to the Training
 * Library, exactly where CoachAppGuard sends a v2 coach without the switch (B7, B8).
 */
export default function InsightsGate({ children }: { children: ReactNode }) {
  return (
    <CoachGate>
      <CoachipOnly>{children}</CoachipOnly>
    </CoachGate>
  );
}

function CoachipOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const on = useCoachip(user?.phoneNumber || null, true);
  if (on === null) return null;
  if (!on) return <Navigate to={COACH_TRAINING_BASE} replace />;
  return <>{children}</>;
}
