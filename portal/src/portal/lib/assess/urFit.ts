import { useEffect } from 'react';
import { childTestSa } from '../../services/api';
import './urFit.css';

/**
 * sa_ur_fit on the coach's Learning assessment pages: every Urdu word whole and inside its box (urFit.css). The page
 * marks <html> while it is open, so the fixed bars around it are covered too, and unmarks it when it closes.
 * Fail-CLOSED: off until the switch answers true; off when it cannot be read.
 */
export const UR_FIT_CLASS = 'sa-ur-fit';

export function useUrFit(): void {
  useEffect(() => {
    let live = true;
    const root = document.documentElement;
    Promise.resolve().then(() => childTestSa.getSwitches())
      .then((s) => { if (live && s && s.urFit === true) root.classList.add(UR_FIT_CLASS); })
      .catch(() => { /* off */ });
    return () => { live = false; root.classList.remove(UR_FIT_CLASS); };
  }, []);
}
