import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import PortalLayout from "../components/PortalLayout";
import { useLang } from "../teacher/i18n";
import type { Me } from "../coach/insights/types";
import { rm } from "./api";
import { heldStyle } from "./held";
import { HeroSkeleton } from "./components/OpeningCard";
import { currentRmItem } from "./paths";
import { rt } from "./text";

/**
 * bd-sex15q.17 — the RM pages' own gate (DESIGN §7, SPEC v2 §2, REUSE B): one `GET /coachip/me` per mount; the pages
 * render only when `rm` is set (portal_coachip_rm names this user with a sector). Never CoachGate: an RM is a
 * leader-family user whose coach switches say nothing about the sector.
 *
 *   signed out          PortalLayout sends them to the sign-in page (the house frame)
 *   loading             the frame, nothing of the page, no RM request; on the sector the band's skeleton at the RM's
 *                       held height (FIX_R6 B8: the first paint is the band S8 will draw, so nothing drops)
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

/**
 * bd-sex15q.47 (R6 fix cycle 2, FIX_R6 §7.3 B8) — the wait before an RM page (the gate's read, then the page's chunk).
 * On the sector at a phone width: the navy band with the empty ring at S8's held height (`rm/held.ts`) and the
 * overlapping card, bled to the edges as the Shell is; no menu, no toggle (both are fixed or in the band's top row and
 * move nothing below). Elsewhere, and on a laptop, an empty block as before (an inner page has an app bar, not a band).
 * Drawn here, not with coachip-ui's `Skeleton`: importing that from the RM chunk split it out of the coach's StateBlock
 * chunk and cost S1's first open +230 B gz (chunk diff, FIX_R6 §7.1).
 */
export function RmLoading() {
  const lang = useLang();
  const { pathname } = useLocation();
  const band = currentRmItem(pathname) === "sector";
  return (
    <div data-testid="rm-gate-loading" aria-busy="true" className={band ? "lg:h-40" : "h-40"}>
      {band && (
        <div className="cp min-h-screen bg-cp-ground -mx-4 -mt-4 md:-mx-6 lg:hidden" dir={lang === "ur" ? "rtl" : "ltr"} style={heldStyle(lang)}>
          <div className="cp-band" data-cp-fixed="">
            <div className="cp-lattice" />
            {/* the top row, the title and the date line's boxes (Band.tsx), then the body */}
            <div className="mb-2.5 min-h-[28px]" />
            <div className="h-[29px]" />
            <div className="mt-1 h-[19px]" />
            <div className="mt-3"><HeroSkeleton /></div>
          </div>
          <div className="cp-overlap mx-5 h-[189px] rounded-[20px] bg-cp-surface shadow-[0_2px_8px_rgba(51,55,72,0.08)]" />
        </div>
      )}
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
  if (!state.done) return <RmLoading />;
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
