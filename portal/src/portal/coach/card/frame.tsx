import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { resolveRole } from "../../lib/leaderRole";
import { FrameSkeleton } from "../../components/Skeleton";
import { readShellHint } from "../../lib/shellHint";
import NotFound from "../../../pages/NotFound";
import { useSchoolCard } from "./useSchoolCard";

/**
 * The School card's page plumbing: whether the switch is on for the signed-in coach, a gate for the pages that exist only
 * with it on, and a loader that forgets the last answer when the period changes (so a new period never shows the old
 * period's numbers under its chip).
 */

/** Is the School card on for her? null while /config is read; false for anyone who is not a coach. */
export function useCardSwitch(): boolean | null {
  const { user, loading } = useAuth();
  const isCoach = !loading && !!user && resolveRole(user) === "coach";
  const on = useSchoolCard(user?.phoneNumber || null, isCoach);
  if (loading) return null;
  return isCoach ? on : false;
}

/**
 * The pages that exist only with the switch on (a feature by teacher, her lists, her coaching reports, a DC report). With
 * it off they are what any unknown address is today (the app's Not found page); while it is read, the frame's outline.
 */
export function CardOnly({ children }: { children: ReactNode }) {
  const on = useCardSwitch();
  if (on === null) return <FrameSkeleton variant={readShellHint() ?? "classic"} />;
  if (!on) return <NotFound />;
  return <>{children}</>;
}

/**
 * Where her page's Back goes: the School card list the coach opened it from (a by-teacher row passes `back` in the link
 * state), else `fallback`. Only a coach address is followed, so a stray state never sends Back off the coach app.
 */
export function useBackTo(fallback: string): string {
  const back = ((useLocation().state || {}) as { back?: unknown }).back;
  return typeof back === "string" && back.startsWith("/portal/coach/") ? back : fallback;
}

/** A read that starts over (data back to null) whenever its inputs change; `reload` asks again. */
export function useCardLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; failed: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; failed: boolean }>({ data: null, failed: false });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    setState({ data: null, failed: false });
    run().then((d) => { if (live) setState({ data: d, failed: false }); }).catch(() => { if (live) setState({ data: null, failed: true }); });
    return () => { live = false; };
  }, [run, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}
