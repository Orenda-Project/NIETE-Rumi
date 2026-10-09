import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * bd-fmf24g.18 — ONE shared timer for every feature icon that opts in (`<FeatureArt motion>`).
 *
 * Operator (2026-10-09): the icons move TOGETHER — "if they move separately from each other it might give the info
 * that it wants you to click it." So: they all play once when the screen opens, then all play again together after
 * one random gap of 30–60 s, re-drawn after every play. This is a single `setTimeout` for the whole screen, not one
 * per icon, and the only thing it changes is a counter; the movement itself is CSS (featureMotion.css).
 *
 *   - Reduced motion: nothing is scheduled and the icons get no motion class.
 *   - While the app or tab is hidden (`visibilitychange`) the timer is stopped; it starts counting again on return.
 *   - The bottom-menu glyphs (FeatureGlyph) do not read this and never move.
 */

export const MOTION_GAP_MS = { min: 30_000, max: 60_000 } as const;

/** A random gap between 30 s and 60 s. */
export const nextGapMs = (): number => MOTION_GAP_MS.min + Math.random() * (MOTION_GAP_MS.max - MOTION_GAP_MS.min);

export interface FeatureMotionState {
  /** Icons may move (false under reduced motion, and without a provider). */
  on: boolean;
  /** 0 = the arrival play; each shared replay adds one. A new number restarts every icon at the same moment. */
  cycle: number;
}

const IDLE: FeatureMotionState = { on: false, cycle: 0 };
const FeatureMotionContext = createContext<FeatureMotionState>(IDLE);

/** What a FeatureArt that opted in should do right now. */
export const useFeatureMotion = (): FeatureMotionState => useContext(FeatureMotionContext);

const REDUCE = '(prefers-reduced-motion: reduce)';
const reducedNow = (): boolean => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(REDUCE).matches;
const isHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function FeatureMotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(reducedNow);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(REDUCE) : null;
    if (!mq || !mq.addEventListener) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (reduced) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const schedule = () => {
      stop();
      timer = setTimeout(() => {
        timer = undefined;
        setCycle((c) => c + 1); // every icon restarts in this one render
        schedule();
      }, nextGapMs());
    };
    const onVisibility = () => { stop(); if (!isHidden()) schedule(); };
    if (!isHidden()) schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [reduced]);

  const value = useMemo<FeatureMotionState>(() => ({ on: !reduced, cycle }), [reduced, cycle]);
  return <FeatureMotionContext.Provider value={value}>{children}</FeatureMotionContext.Provider>;
}
