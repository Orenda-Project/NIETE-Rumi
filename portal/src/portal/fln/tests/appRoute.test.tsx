import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

/**
 * The App.tsx hook line `<Route path="/portal/fln/*" element={<FlnRoutes />} />`, executed through the
 * real App (BrowserRouter, CoachAppGuard, AnalyticsOnlyGuard, the lazy chunk): a cold open of a plan link mounts the
 * FLN route table, whose gate asks GET /api/portal/fln/me; signed out (401) it goes to sign-in with `next=` the plan.
 * Without the line the path falls to the catch-all NotFound and /me is never asked.
 */

vi.mock("@/portal/services/api", async (orig) => {
  const real = await orig<typeof import("@/portal/services/api")>();
  const no = () => Promise.reject(Object.assign(new Error("401"), { response: { status: 401 } }));
  return {
    ...real,
    // Signed out: the session read answers 401 (useAuth.readSessionUser → portal.getMe).
    portal: { ...real.portal, getMe: vi.fn(no), getDashboard: vi.fn(no), getConfig: vi.fn(() => new Promise(() => {})) },
  };
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("App route /portal/fln/*", () => {
  it("a cold open of /portal/fln/p/11156 mounts the FLN pages (gate → /me; 401 → login with next)", async () => {
    if (!window.matchMedia) {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
          matches: false, media: query, onchange: null,
          addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
        }),
      });
    }
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }));
    window.history.pushState({}, "", "/portal/fln/p/11156");
    const { default: App } = await import("@/App");
    render(<App />);
    await waitFor(() => expect(asked).toContain("/api/portal/fln/me"), { timeout: 10_000 });
    await waitFor(() => expect(window.location.pathname).toBe("/portal/login"));
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/portal/fln/p/11156");
  }, 30_000);
});
