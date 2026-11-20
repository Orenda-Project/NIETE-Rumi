import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "../../hooks/useAuth";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy, useFollowPreferredLanguage } from "../../teacher/i18n";
import { noticeTracker } from "../../teacher/notices/tracker";
import { AttentionBanner } from "../../teacher/ui";
import type { AnyFeature } from "../../teacher/icons";
import CoachGate from "../CoachGate";
import { readPending, type Pending } from "../ui";
import { OBSERVE } from "./copy";
import { useObserveRoutes } from "./observeRoutes";
import ContinueOnWhatsApp from "./ContinueOnWhatsApp";
import { TroubleContext, type TroubleKind } from "./trouble";

/**
 * bd-4404s7.4 — the frame of every Observe screen: the coach gate, the kit's page frame (TeacherPage: the header card, the
 * crumb, the dock above the menu), and the kit's AttentionBanner ("2 reports waiting") under the header on the screens
 * that carry it. The page speaks her stored language (the teacher app's follow-the-preference rule, v2 screens only).
 *
 * The banner is hidden while the ready (or failed) banner of a sent observation shows above the menu, so the two never
 * stack (the notices host decides when that is; here it only looks).
 *
 * bd-9652yj (queue #166) — the coach app's way back to WhatsApp (ContinueOnWhatsApp) sits first, under the header, on
 * every coach-app Observe screen: a slim strip, or a full green button when the screen failed. A screen says it failed
 * with `trouble` (the microphone, a send), or its shared `Failed` card says so through TroubleContext (a load).
 */

function useAnnouncing(): boolean {
  return useSyncExternalStore(
    noticeTracker.subscribe,
    () => noticeTracker.getItems().some((i) => (i.state === "ready" || i.state === "failed") && !i.announced),
    () => false,
  );
}

export function CoachAttention() {
  const C = useCopy(OBSERVE);
  const [pending, setPending] = useState<Pending | null>(null);
  const announcing = useAnnouncing();
  useEffect(() => {
    let live = true;
    readPending().then((p) => { if (live) setPending(p); });
    return () => { live = false; };
  }, []);
  if (announcing || !pending || pending.waiting < 1) return null;
  const to = pending.waiting === 1 && pending.ids[0] ? `/portal/coach/observation/${pending.ids[0]}` : "/portal/coach/reports?show=waiting";
  return <AttentionBanner testId="pending-banner" text={C.reportsWaiting(pending.waiting)} to={to} />;
}

export default function ObservePage({
  title, crumb, backTo, onBack, feature, dock, bare = false, banner = true, whatsapp = true, trouble = null, children,
}: {
  title: ReactNode; crumb?: ReactNode; backTo?: string; onBack?: () => void; feature?: AnyFeature; dock?: ReactNode;
  /** No menu: a screen where one stray tap must not leave (recording). */
  bare?: boolean;
  /** The "reports waiting" line under the header (off while recording). */
  banner?: boolean;
  /**
   * bd-o15qnr.27 (v6) — the way back to WhatsApp (#166). Off on the v6 Observe screen only (the operator on v5: "remove
   * this button. No need once this is live."); every other Observe screen keeps it.
   */
  whatsapp?: boolean;
  /** bd-9652yj — this screen failed (the microphone, a send): the way back to WhatsApp becomes a full button. */
  trouble?: TroubleKind | null;
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  useFollowPreferredLanguage(!loading && !!user);
  const routes = useObserveRoutes();
  const [signalled, setSignalled] = useState<TroubleKind | null>(null);
  const signal = useCallback((kind: TroubleKind | null) => setSignalled(kind), []);
  // bd-33wxxi.4 — the principal app's screens: no coach gate (TeacherGate ran) and no coach "reports waiting" banner.
  // bd-9652yj — nor the way back to WhatsApp: it resumes a coach's booked visit.
  const page = (
    <TroubleContext.Provider value={signal}>
      <TeacherPage title={title} crumb={crumb} backTo={backTo} onBack={onBack} feature={feature} dock={dock} bare={bare}>
        {routes.coachGate && whatsapp && <ContinueOnWhatsApp trouble={trouble ?? signalled} bare={bare} />}
        {banner && !bare && routes.coachGate && <CoachAttention />}
        {children}
      </TeacherPage>
    </TroubleContext.Provider>
  );
  return routes.coachGate ? <CoachGate>{page}</CoachGate> : page;
}
