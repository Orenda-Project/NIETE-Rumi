import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy } from "../../teacher/i18n";
import { CHEVRON, FOCUS, LIST_CARD, ROW_TITLE } from "../../teacher/ui/styles";
import { readDisagreementsOn } from "./api";
import { DISAGREE } from "./copy";

/**
 * bd-tbprit.3 — what the disagreement screens share: their own flag (coach_disagreement_card, fail-closed), the
 * coach gate and the kit's page frame, and the one entry row on Reports.
 */

/** null while /config is read, then true only for a real true. */
function useDisagreementsOn(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readDisagreementsOn().then((v) => { if (live) setOn(v); });
    return () => { live = false; };
  }, []);
  return on;
}

/** Renders nothing while the flag is read; off sends her to the coach home. Children mount (and load) only when on. */
export function Gated({ children }: { children: ReactNode }) {
  const on = useDisagreementsOn();
  if (on === null) return null;
  if (!on) return <Navigate to="/portal/coach" replace />;
  return <>{children}</>;
}

export function DisagreementsFrame({ title, crumb, backTo, testId, children }: {
  title: ReactNode; crumb: ReactNode; backTo: string; testId: string; children: ReactNode;
}) {
  return (
    <CoachGate>
      <TeacherPage feature="reports" title={title} crumb={crumb} backTo={backTo} testId={testId}>
        {children}
      </TeacherPage>
    </CoachGate>
  );
}

/** The row on Reports that opens the list; nothing at all unless the flag is on. */
export function DisagreementsEntry() {
  const C = useCopy(DISAGREE);
  const on = useDisagreementsOn();
  if (on !== true) return null;
  return (
    <Link
      to="/portal/coach/disagreements"
      data-testid="disagreements-entry"
      className={cn(LIST_CARD, FOCUS, "flex min-h-[56px] items-center gap-3 px-4 py-3")}
    >
      <span className={cn(ROW_TITLE, "min-w-0 flex-1")}>{C.entry}</span>
      <ChevronRight className={cn(CHEVRON, "h-5 w-5")} aria-hidden="true" />
    </Link>
  );
}
