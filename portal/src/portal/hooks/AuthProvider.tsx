import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { AuthContext } from './authContext';
import { useOwnAuth } from './useAuth';

/**
 * bd-fxk3t8 — the signed-in user, read once per visit and kept above every route.
 *
 * Every page used to read GET /dashboard for itself (often twice) and show a full-screen
 * spinner until it answered — 0.9–1.9 s on every tap of the menu on sandbox. Here it is
 * read when the first page asks for it (useAuth), and every later page has it on its first
 * render. Pages that never ask — sign-in, privacy, account deletion — read nothing, as before.
 *
 * Kept fresh without a spinner: once the answer is older than STALE_MS, the next page that
 * asks starts a background re-read; the same user again changes nothing.
 */
const AUTH_STALE_MS = 30_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [wanted, setWanted] = useState(false);
  // "loading" from the start: until the first read, nobody knows who she is.
  const own = useOwnAuth(wanted, true);
  const { checkAuth, fetchedAt, loading } = own;

  const refreshing = useRef(false);
  const latest = useRef({ fetchedAt, loading });
  latest.current = { fetchedAt, loading };

  const request = useCallback(() => {
    setWanted(true);
    const { fetchedAt: at, loading: busy } = latest.current;
    if (busy || !at || refreshing.current || Date.now() - at < AUTH_STALE_MS) return;
    refreshing.current = true;
    checkAuth(true).finally(() => { refreshing.current = false; });
  }, [checkAuth]);

  const value = useMemo(
    () => ({ ...own, request }),
    // own's functions only use setters and the router; its data is what changes
    // (a background re-read that finds the same user changes nothing below)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own.user, own.loading, request],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
