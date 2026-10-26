import { useCallback, useEffect, useState } from "react";
import { errorKind, type LoadError } from "./api";

/** bd-sex15q.15 — one read per screen: data, the error kind (COPY §E) and a retry. Never cached (no-store). */
export function useLoad<T>(read: () => Promise<T>, deps: readonly unknown[]): { data: T | null; error: LoadError | null; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: LoadError | null }>({ data: null, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    setState({ data: null, error: null });
    read().then(
      (data) => { if (live) setState({ data, error: null }); },
      (e) => { if (live) setState({ data: null, error: errorKind(e) }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload };
}
