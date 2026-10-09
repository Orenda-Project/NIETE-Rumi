import { useEffect, useState } from "react";
import { coach } from "../../services/api";
import type { CoachHomeData } from "../types";

/**
 * bd-4404s7.2 — her school and teacher counts, from GET /coach/home (`counts.schools`, `counts.teachers`): the one
 * real source for them. A failed read leaves it null and the page draws nothing in its place (never a made-up number).
 */
export function useCoachCounts(): CoachHomeData["counts"] | null {
  const [counts, setCounts] = useState<CoachHomeData["counts"] | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => coach.getHome())
      .then((r) => { if (live && r?.home?.counts) setCounts(r.home.counts); })
      .catch(() => { /* nothing shown */ });
    return () => { live = false; };
  }, []);
  return counts;
}
