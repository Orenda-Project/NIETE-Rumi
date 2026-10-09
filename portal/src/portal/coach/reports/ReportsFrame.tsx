import { useEffect, useState, type ReactNode } from "react";
import CoachGate from "../CoachGate";
import { readPending, type Pending } from "../ui";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy } from "../../teacher/i18n";
import { AttentionBanner } from "../../teacher/ui";
import type { AnyFeature } from "../../teacher/icons";
import { REPORTS } from "./copy";

/**
 * bd-4404s7.5 — the page frame every Reports screen shares: the coach gate, the kit's TeacherPage (the reports
 * art on its white card, the back target, the crumb) and the kit's AttentionBanner for what waits on her.
 * Glue only: no look of its own.
 *
 * The banner is what the old pending banner was (one read, shared for 30 s; a failed read shows nothing):
 * one waiting report opens it, more open Reports filtered to the waiting ones.
 */
export function usePendingReports(): Pending | null {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    let live = true;
    readPending().then((p) => { if (live) setPending(p); });
    return () => { live = false; };
  }, []);
  return pending;
}

export function PendingReportsBanner() {
  const C = useCopy(REPORTS);
  const pending = usePendingReports();
  if (!pending || pending.waiting < 1) return null;
  const to = pending.waiting === 1 && pending.ids[0] ? `/portal/coach/observation/${pending.ids[0]}` : "/portal/coach/reports?show=waiting";
  return <AttentionBanner text={C.reportsWaiting(pending.waiting)} to={to} testId="pending-banner" />;
}

export default function ReportsFrame({
  title, crumb, backTo, onBack, feature = "reports", chips, dock, bare, banner = true, testId, children,
}: {
  title: ReactNode;
  crumb?: ReactNode;
  backTo?: string;
  onBack?: () => void;
  feature?: AnyFeature;
  chips?: ReactNode;
  dock?: ReactNode;
  bare?: boolean;
  /** The pending banner under the header; off on a screen with a job of its own (a recording). */
  banner?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <CoachGate>
      <TeacherPage feature={feature} title={title} crumb={crumb} backTo={backTo} onBack={onBack} chips={chips} dock={dock} bare={bare} testId={testId}>
        {banner && !bare ? <PendingReportsBanner /> : null}
        {children}
      </TeacherPage>
    </CoachGate>
  );
}
