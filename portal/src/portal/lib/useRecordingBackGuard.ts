import { useEffect, useRef } from 'react';

/**
 * bd-5rz1v.8 — while a lesson (or a coach's talk) is being recorded, Back must
 * not leave the page: leaving stops the recorder mid-lesson. Back here is
 * Chrome's back button or gesture on the web, and in the app (build 1216+) the
 * Android key, which BackButtonHandler turns into navigate(-1). Both pop a
 * history entry.
 *
 * So, while `active`, one extra entry sits on top of the history. Back pops
 * that entry instead of the page; the hook puts it back and calls `onBack` —
 * the recorder asks "Finish recording?". When recording ends, the entry is
 * taken off again, so Back afterwards goes where it always did.
 *
 * The entry keeps the current state (React Router's own keys included) and
 * adds one flag; the URL does not change, so the router stays on this page.
 */

const GUARD = 'recordingGuard';

function onTop(): boolean {
  try {
    const state = window.history.state as Record<string, unknown> | null;
    return !!state && state[GUARD] === true;
  } catch {
    return false;
  }
}

function pushGuard(): void {
  try {
    const state = (window.history.state as Record<string, unknown> | null) || {};
    window.history.pushState({ ...state, [GUARD]: true }, '');
  } catch {
    // no history to guard (an embedded view): Back keeps its default
  }
}

export function useRecordingBackGuard(active: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return undefined;
    pushGuard();
    const onPop = () => {
      if (!onTop()) pushGuard();
      onBackRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (onTop()) {
        try { window.history.back(); } catch { /* nothing to take off */ }
      }
    };
  }, [active]);
}
