import { useCallback, useEffect, useRef } from 'react';
import { registerOverlay } from './overlayBack';

/**
 * bd-kijmb8 (queue #318) — a layer over a page with its OWN history entry (the Lesson plan sheet, the Attach picker).
 * The phone's Back, the in-app browser's back and the layer's ‹ (`close`) all close it and land on the same page; the
 * coach recorder's Back guard ignores the Back that closes it (lib/overlayBack).
 */
const FLAG = 'overlayLayer';
const flagged = (): boolean => {
  try { return (window.history.state as Record<string, unknown> | null)?.[FLAG] === true; } catch { return false; }
};

export function useOverlayEntry(onClose: () => void): () => void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const done = useRef(false);

  useEffect(() => {
    done.current = false;
    const release = registerOverlay();
    let pushed = false;
    try {
      const state = (window.history.state as Record<string, unknown> | null) || {};
      window.history.pushState({ ...state, [FLAG]: true }, '');
      pushed = true;
    } catch { /* no history here (an embedded view): ‹ still closes it */ }
    const onPop = () => {
      if (done.current) return;
      done.current = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      release();
      // Closed by code (not by Back): take its entry off, so Back afterwards goes where it always did.
      if (pushed && !done.current && flagged()) {
        done.current = true;
        try { window.history.back(); } catch { /* nothing to take off */ }
      }
    };
  }, []);

  return useCallback(() => {
    if (flagged()) { try { window.history.back(); return; } catch { /* fall through */ } }
    if (!done.current) { done.current = true; closeRef.current(); }
  }, []);
}
