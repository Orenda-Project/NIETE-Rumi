import { useCallback, useEffect, useRef, useState } from "react";
import { leader } from "../../services/api";
import type { CoachObservationView } from "../../services/api";
import { isWaiting } from "../../lib/coachObserve";

/**
 * bd-4404s7.5 — one of her observations as the pipeline sees it (GET /leader/observe/:id): its step, the guide, her
 * feedback, the report. Re-read every 8 seconds while the next step is the worker's, not hers (analysing, listening,
 * making the report, sending) — the same rule the old observation page had. `status` is never "ok" on a failed read:
 * an empty page would read as "nothing here".
 */
const POLL_MS = 8_000;

export type ObservationViewState = {
  view: CoachObservationView | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

export function useObservationView(id: string): ObservationViewState {
  const [view, setView] = useState<CoachObservationView | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [tick, setTick] = useState(0);
  const live = useRef(true);

  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  useEffect(() => {
    if (!id) return undefined;
    let current = true;
    leader.getObservation(id)
      .then((v) => { if (current) { setView(v); setStatus("ok"); } })
      .catch(() => { if (current) setStatus((s) => (s === "ok" ? s : "error")); });
    return () => { current = false; };
  }, [id, tick]);

  useEffect(() => {
    if (!view || !isWaiting(view)) return undefined;
    const t = setTimeout(() => { if (live.current) setTick((n) => n + 1); }, POLL_MS);
    return () => clearTimeout(t);
  }, [view]);

  const reload = useCallback(() => { setStatus((s) => (s === "error" ? "loading" : s)); setTick((n) => n + 1); }, []);
  return { view, status, reload };
}

/** The teacher's name as the view carries it. */
export function teacherNameOf(view: CoachObservationView | null): string {
  return (view?.teacher?.name || view?.report.teacherName || "").trim();
}

/** "Ayesha" from "Ayesha Bibi". */
export function firstNameOf(name: string): string {
  return name.split(/\s+/)[0] || name;
}
