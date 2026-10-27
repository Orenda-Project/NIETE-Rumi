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

