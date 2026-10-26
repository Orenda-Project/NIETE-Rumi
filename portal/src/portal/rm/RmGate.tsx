import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import PortalLayout from "../components/PortalLayout";
import { useLang } from "../teacher/i18n";
import type { Me } from "../coach/insights/types";
import { rm } from "./api";
import { rt } from "./text";

/**
 * bd-sex15q.17 — the RM pages' own gate (DESIGN §7, SPEC v2 §2, REUSE B): one `GET /coachip/me` per mount; the pages
 * render only when `rm` is set (portal_coachip_rm names this user with a sector). Never CoachGate: an RM is a
 * leader-family user whose coach switches say nothing about the sector.
 *
 *   signed out          PortalLayout sends them to the sign-in page (the house frame)
 *   loading             the frame, nothing of the page, no RM request
 *   rm null / any error "This page is not available." and nothing else: the same words as any unknown page, so a
 *                       user without the switch learns nothing (B8)
 *
 * `bare`: the coach menu never draws here; RmFrame draws the RM menu.
 */
export type RmSession = { sector: string; isCoach: boolean };

const RmCtx = createContext<RmSession | null>(null);

export function useRmSession(): RmSession {
  const s = useContext(RmCtx);
  if (!s) throw new Error("useRmSession outside RmGate");
  return s;
}

export function RmNotAvailable() {
  const lang = useLang();
  return (
    <div role="status" data-testid="rm-not-available" className="mx-auto mt-8 max-w-xl rounded-2xl border border-[#e5e7eb] bg-white px-4 py-5 text-[15px] text-[#374151]">
      {rt("e.404", lang)}
    </div>
  );
}

function Inner({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ me: Me | null; done: boolean }>({ me: null, done: false });
  useEffect(() => {
    let live = true;
    rm.me().then(
      (me) => { if (live) setState({ me, done: true }); },
      () => { if (live) setState({ me: null, done: true }); },
    );
    return () => { live = false; };
  }, []);
  if (!state.done) return <div data-testid="rm-gate-loading" aria-busy="true" className="h-40" />;
  const r = state.me?.rm;
  if (!r || typeof r.sector !== "string" || !r.sector) return <RmNotAvailable />;
  return <RmCtx.Provider value={{ sector: r.sector, isCoach: !!state.me?.coach }}>{children}</RmCtx.Provider>;
}

export default function RmGate({ children }: { children: ReactNode }) {
  return (
    <PortalLayout bare>
      <Inner>{children}</Inner>
    </PortalLayout>
  );
}
