import "@testing-library/jest-dom/vitest";

// bd-omk735: Node 25 puts its own localStorage on globalThis (no methods without
// --localstorage-file) and it shadows jsdom's, so tests calling localStorage.clear()
// throw. Put jsdom's storage back; Node 20/22 (CI) never take this branch.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom && typeof globalThis.localStorage?.clear !== "function") {
  for (const k of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
  }
}

// bd-sex15q.34 — the teacher v2 pages (lib/lazyPage) and the notices tray (lazyOptional) are their own chunks now.
// The tests that draw those route lists and step through them synchronously (src/portal/teacher/*), and the frame's
// own tests (PortalLayout.*), load what their imports registered before they run, as when those were in the first
// chunk. Nothing else preloads: loading every page for every test file made the suite several times slower.
// (A test about the outline while a chunk arrives imports the app inside the test, after this has run.)
import { beforeAll, expect } from "vitest";
import { preloadAll } from "@/lib/lazyPage";
beforeAll(() => {
  const file = (expect.getState().testPath ?? "").replace(/\\/g, "/");
  const pages = file.includes("/src/portal/teacher/");
  const optional = file.includes("/src/portal/components/PortalLayout");
  if (!pages && !optional) return undefined;
  return preloadAll({ pages, optional });
}, 120_000);
