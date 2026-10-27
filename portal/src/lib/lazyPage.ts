import { createElement, lazy, useEffect, useState, type ComponentProps, type ComponentType } from "react";

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
const optionalLoaders: Array<() => Promise<unknown>> = [];

type Loader<T> = () => Promise<{ default: T }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: Loader<T>) {
  // bd-sex15q.34 — once the chunk is here (opened before, or fetched in the background), the page is drawn
  // straight away: no suspend, no outline for a tick. Until then, React.lazy as before.
  let ready: T | null = null;
  const remember: Loader<T> = () => load().then((mod) => { ready = mod.default; return mod; });
  loaders.push(remember);
  const Lazy = lazy(() =>
    remember().then(
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
  function Page(props: ComponentProps<T>) {
    return ready ? createElement(ready, props) : createElement(Lazy, props);
  }
  return Page;
}

/**
 * bd-sex15q.34 — load every page (and optional piece) registered so far. For tests that draw route elements and
 * step through them synchronously, as they did when those pages were in the first chunk (src/test/setup.ts).
 */
export function preloadAll(): Promise<unknown> {
  return Promise.all([...loaders, ...optionalLoaders].map((load) => load().catch(() => undefined)));
}

/**
 * Fetch every page's chunk once the app is idle, one after another, so a slow line stays
 * usable and a later tap is instant. A failed fetch here is ignored (the page retries,
 * with the reload above, when it is actually opened).
 */
export function prefetchPages(): void {
  if (import.meta.env.MODE === "test") return;
  // On data saver or a 3g-or-slower line, ~790 KB of page chunks starved an
  // FLN plan's audio, so skip the prefetch there. No navigator.connection (iOS, Firefox): as before.
  try {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData === true || ["slow-2g", "2g", "3g"].includes(conn?.effectiveType ?? "")) return;
  } catch { /* unreadable: prefetch as before */ }
  const run = () => {
    loaders.reduce<Promise<unknown>>((prev, load) => prev.then(() => load().catch(() => undefined)), Promise.resolve());
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2500);
}

/**
 * bd-sex15q.34 — a piece of a page (not a page) in its own chunk, whose absence must never take the page down: the
 * notices tray, the old dashboard's chart. If its chunk cannot be loaded it is asked for once more, and if that
 * fails too the piece is simply not drawn — never a reload (a lesson may be recording) and never a thrown error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyOptional<T extends ComponentType<any>>(load: Loader<T>, retryMs = 1500) {
  const nothing = { default: (() => null) as unknown as T };
  let ready: T | null = null;
  const remember: Loader<T> = () => load().then((mod) => { ready = mod.default; return mod; });
  optionalLoaders.push(remember);
  const Lazy = lazy(() =>
    remember().catch(
      () =>
        new Promise<{ default: T }>((resolve) => {
          setTimeout(() => remember().then(resolve, () => resolve(nothing)), retryMs);
        }),
    ),
  );
  function Piece(props: ComponentProps<T>) {
    return ready ? createElement(ready, props) : createElement(Lazy, props);
  }
  return Piece;
}

/**
 * bd-sex15q.34 — true once the page has drawn and the browser is idle (at most `maxMs` later): for a piece that
 * should not compete with the first screen for a slow line, like the notices tray. Straight away in tests.
 */
export function useAfterFirstIdle(maxMs = 4000): boolean {
  const [idle, setIdle] = useState(import.meta.env.MODE === "test");
  useEffect(() => {
    if (idle) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setIdle(true), { timeout: maxMs });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => setIdle(true), Math.min(maxMs, 1500));
    return () => clearTimeout(t);
  }, [idle, maxMs]);
  return idle;
}
