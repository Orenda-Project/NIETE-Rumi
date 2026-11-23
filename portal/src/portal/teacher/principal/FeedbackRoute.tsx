import type { ReactNode } from "react";
import { useFlowV6 } from "../../coach/flow/useCoachFlowV2";
import { PrincipalFeedbackPage } from "../../coach/flow/FeedbackPage";

/**
 * bd-o15qnr.28 (queue #204, v7) — a principal's "Your feedback": with the v6/v7 switch on for her (principalFlowV2), the
 * one feedback page (the debrief report, her own ending); off, or while the switch is read, today's page (`off`).
 */
export function PrincipalFeedbackRoute({ off }: { off: ReactNode }) {
  const v7 = useFlowV6();
  if (v7 === null) return null;
  return v7 ? <PrincipalFeedbackPage /> : <>{off}</>;
}
