import { lazy, type ComponentType } from "react";

/**
 * bd-fxk3t8 — a page in its own chunk (App.tsx), and the background fetch of all of them.
 *
 * A deploy replaces every chunk (their names are content hashes, and the old files are gone),
 * so a teacher who had the app open before it would ask for a chunk that no longer exists,
 * and React would have nothing to draw. When a page's chunk cannot be loaded, the app reloads
 * ONCE — index.html is never cached, so that is the new app — and a second failure in the
 * same tab is shown as the error it is, instead of reloading forever.
 */

const RELOADED_KEY = "niete:chunk-reload";
const loaders: Array<() => Promise<unknown>> = [];

type Loader<T> = () => Promise<{ default: T }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: Loader<T>) {
  loaders.push(load);
  return lazy(() =>
    load().then(
      (mod) => {
        try { window.sessionStorage.removeItem(RELOADED_KEY); } catch { /* storage blocked */ }
        return mod;
      },
      (err) => {
        let first = false;
        try {
          first = !window.sessionStorage.getItem(RELOADED_KEY);
          if (first) window.sessionStorage.setItem(RELOADED_KEY, "1");
        } catch { /* storage blocked: no reload, show the error */ }
        if (first) {
          window.location.reload();
          return new Promise<{ default: T }>(() => {}); // the reload takes over
        }
        throw err;
      },
    ),
  );
}

/**
 * Fetch every page's chunk once the app is idle, one after another, so a slow line stays
 * usable and a later tap is instant. A failed fetch here is ignored (the page retries,
 * with the reload above, when it is actually opened).
 */
export function prefetchPages(): void {
  if (import.meta.env.MODE === "test") return;
  const run = () => {
    loaders.reduce<Promise<unknown>>((prev, load) => prev.then(() => load().catch(() => undefined)), Promise.resolve());
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2500);
}
