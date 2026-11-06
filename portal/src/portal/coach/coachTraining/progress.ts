import { useCallback, useEffect, useRef, useState } from "react";
import { coach } from "../../services/api";

/**
 * bd-rlxkkt.9 — which Coach Training modules she has marked done, from the portal API (kept in
 * users.preferences.coach_training_done; see dashboard/routes/coach-training-progress.routes.js).
 *
 *   done      { module key: ISO time } once loaded; null while loading or when the read failed (show "—", never a 0)
 *   mark      mark(key, true | false): shows the change at once, then keeps the server's answer; if the save
 *             fails it puts the old state back and sets notSaved
 */
export function useCoachTrainingProgress() {
  const [done, setDone] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [notSaved, setNotSaved] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    coach.getCoachTrainingProgress()
      .then((r) => { if (live.current) setDone(r && r.done ? r.done : {}); })
      .catch(() => { if (live.current) setDone(null); });
    return () => { live.current = false; };
  }, []);

  const mark = useCallback(async (key: string, value: boolean) => {
    const before = done ?? {};
    const next = { ...before };
    if (value) next[key] = next[key] || new Date().toISOString();
    else delete next[key];
    setDone(next);
    setSaving(true);
    setNotSaved(false);
    try {
      const r = await coach.setCoachModuleDone(key, value);
      if (live.current) setDone(r && r.done ? r.done : next);
    } catch {
      if (live.current) { setDone(before); setNotSaved(true); }
    } finally {
      if (live.current) setSaving(false);
    }
  }, [done]);

  return { done, saving, notSaved, mark };
}
