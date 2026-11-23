import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * bd-o15qnr.48 (queue #244; the operator 23 Nov: "weird minute errors in the UI like the feedback form navigation") —
 * the phone's Back key inside the Feedback Form. The form's views (every section → one section → one indicator) are
 * one page address, so Android's Back (the browser's step back) left the whole form from an indicator, while the app's
 * own arrow went up one level. Now each level deeper than the first view has its own history entry (same address, its
 * depth in the entry's state), so the phone's Back and the arrow do the same thing: up one level, then out.
 *
 *   moved(from, to)  the form changed level: deeper pushes one entry per level, shallower pops them (a move sideways —
 *                    Next, Previous, a section chip — changes no history)
 *   up()             the app's arrow at a level deeper than 0: up one level now, and its entry popped
 *   toDepth(d)       the form's own step up to level d, called when the history moved back (the phone's Back)
 *
 * Entries are ours alone: `state.ffDepth` on this form's address. A reload mid-form shows the first view, so a depth
 * left in the entry is walked back to the form's own entry first.
 */
const KEY = "ffDepth";

export function depthIn(state: unknown): number {
  const d = state && typeof state === "object" ? (state as Record<string, unknown>)[KEY] : undefined;
  return typeof d === "number" && d > 0 ? d : 0;
}

export function useFormLevels(depth: number, toDepth: (d: number) => void) {
  const navigate = useNavigate();
  const location = useLocation();
  const at = useRef(depth);
  at.current = depth;
  const step = useRef(toDepth);
  step.current = toDepth;
  const here = `${location.pathname}${location.search}`;
  const histDepth = depthIn(location.state);

  // A reload (or a return) onto an entry this form pushed: back to the form's own entry, where the first view lives.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (histDepth > 0 && at.current === 0) navigate(-histDepth);
  }, [histDepth, navigate]);

  // The history went back past the level on screen (the phone's Back): step the form up to that level.
  useEffect(() => {
    if (histDepth < at.current) step.current(histDepth);
  }, [location.key, histDepth]);

  const moved = useCallback((from: number, to: number) => {
    if (to > from) for (let d = from + 1; d <= to; d += 1) navigate(here, { state: { [KEY]: d } });
    else if (to < from) navigate(to - from);
  }, [navigate, here]);

  const up = useCallback(() => {
    if (at.current <= 0) return;
    step.current(at.current - 1);
    navigate(-1);
  }, [navigate]);

  return { moved, up };
}
