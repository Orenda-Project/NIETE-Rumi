import { useContext, useEffect, useState, type ReactNode } from "react";
import CoachGate from "../CoachGate";
import { useObserveRoutes } from "../observe/observeRoutes";
import { readPending, type Pending } from "../ui";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy } from "../../teacher/i18n";
import { AttentionBanner } from "../../teacher/ui";
import type { AnyFeature } from "../../teacher/icons";
import { REPORTS } from "./copy";
import { useFlowV6 } from "../flow/useCoachFlowV2";
import { RecordingBarShownContext } from "../../lib/recordingBarShown";
import { ObserveHelp, ObserveHelpButton } from "../../teacher/help/observe/ObserveHelp";
import type { Band } from "../../teacher/help/observe/guides";

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
  // bd-o15qnr.45 (the operator 23 Nov ~20:20: "The X observations need you are on too many pages. They should be maximum
  // at the home and main Observation page.") — on the visit flow switch this bar is Home's only (the main Observe page
  // opens with Needs you). Off: as before; while the switch is read, nothing (no flash).
  const flow = useFlowV6();
  const pending = usePendingReports();
  if (flow !== false || !pending || pending.waiting < 1) return null;
  const to = pending.waiting === 1 && pending.ids[0] ? `/portal/coach/observation/${pending.ids[0]}` : "/portal/coach/reports?show=waiting";
  return <AttentionBanner text={C.reportsWaiting(pending.waiting)} to={to} testId="pending-banner" />;
}

export default function ReportsFrame({
  title, crumb, backTo, onBack, feature = "observations", chips, dock, bare, banner = true, testId, dockSpace = false, helpBand, children,
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
  /** bd-o15qnr.40.8 — keep room under the content for the bar, the menu and the safe area (the v7 form views). */
  dockSpace?: boolean;
  /** bd-3xf7vb.1 (queue #217) — the visit's grades (its rubric): that band's indicator guide opens first in the "?". */
  helpBand?: Band;
  children: ReactNode;
}) {
  const routes = useObserveRoutes();
  const barShown = useContext(RecordingBarShownContext);
  // bd-o15qnr.40.8 (queue #229, the operator 23 Nov 20:17: "Page not scrolling all the way on the form") — with a bar
  // (Agree and next, Save, Submit…) the content keeps room under it for the bar (~80px), the menu (88px, or 148px with a
  // running recording's bar above it), a notice, and the phone's safe area, so the last field scrolls clear of them on
  // every form view (1-5 and 6-12). No menu (bare): the bar and the safe area. Wide screens: no menu, no room needed.
  const space = !dock || !dockSpace ? null : bare
    ? "h-[calc(88px+env(safe-area-inset-bottom))]"
    : barShown
      ? "h-[calc(228px+var(--notice-h,0px)+env(safe-area-inset-bottom))]"
      : "h-[calc(168px+var(--notice-h,0px)+env(safe-area-inset-bottom))]";
  // bd-33wxxi.4 — the principal app's observation screens: no coach gate (TeacherGate ran), no coach pending banner.
  // bd-3xf7vb.1 (queue #217): the "?" (film + indicator guides) at the end of the header, never on a bare screen; ObserveHelp
  // around the screen holds its tray and gives the Feedback Form the guide (its "Examples" under an indicator).
  const page = (
    <TeacherPage feature={feature} title={title} crumb={crumb} backTo={backTo} onBack={onBack} chips={chips} dock={dock} bare={bare} testId={testId}
      action={!bare ? <ObserveHelpButton /> : undefined}>
      {banner && !bare && routes.coachGate ? <PendingReportsBanner /> : null}
      {children}
      {space ? <div aria-hidden="true" data-testid="dock-space" className={`${space} shrink-0 md:h-0`} /> : null}
    </TeacherPage>
  );
  return <ObserveHelp band={helpBand}>{routes.coachGate ? <CoachGate>{page}</CoachGate> : page}</ObserveHelp>;
}
