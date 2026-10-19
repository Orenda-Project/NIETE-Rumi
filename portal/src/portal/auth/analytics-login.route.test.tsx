import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ANALYTICS_HOME, ANALYTICS_LOGIN, redirectFor } from "../lib/homeRoute";

/**
 * /portal/analytics/login is a SIGNED-OUT page: it must open for a visitor with no session, through the app's real
 * route table and both of its guards, and nothing may turn it into the analytics page or the teacher sign-in.
 *
 *   signed out          -> the page (no guard decision; the session read's 401 does not leave it)
 *   analytics-only      -> the guard lets it through like the other sign-in pages; the page sends her on itself
 *   anyone else         -> not under the analytics page, so the guard leaves it to the page (their own home)
 */
vi.mock("@/portal/services/api", async (orig) => {
  const real = await orig<typeof import("@/portal/services/api")>();
  const no = () => Promise.reject(Object.assign(new Error("401"), { response: { status: 401 } }));
  return {
    ...real,
    // Signed out: the session read answers 401 (useAuth.readSessionUser -> portal.getMe).
    portal: { ...real.portal, getMe: vi.fn(no), getDashboard: vi.fn(no), getConfig: vi.fn(() => new Promise(() => {})) },
  };
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const analyticsUser = { role: "unregistered", analyticsOnly: true };

describe("the guard's rule (lib/homeRoute)", () => {
  it("the page's address", () => {
    expect(ANALYTICS_LOGIN).toBe("/portal/analytics/login");
  });

  it("nobody signed in: no decision, the page opens", () => {
    expect(redirectFor(null, ANALYTICS_LOGIN)).toBeNull();
    expect(redirectFor(undefined, `${ANALYTICS_LOGIN}/`)).toBeNull();
  });

  it("an analytics-only account may open it, like the other sign-in pages (the page sends her on)", () => {
    expect(redirectFor(analyticsUser, ANALYTICS_LOGIN)).toBeNull();
    expect(redirectFor(analyticsUser, `${ANALYTICS_LOGIN}/`)).toBeNull();
    // Nothing else under /portal/analytics opens for her by this door.
    expect(redirectFor(analyticsUser, "/portal/analytics/loginx")).toBe(ANALYTICS_HOME);
    expect(redirectFor(analyticsUser, "/portal/analytics/login/more")).toBe(ANALYTICS_HOME);
  });

  it("it is not the analytics page: a teacher or a leader is not turned away from it by the guard", () => {
    expect(redirectFor({ role: "teacher" }, ANALYTICS_LOGIN)).toBeNull();
    expect(redirectFor({ role: "coach" }, ANALYTICS_LOGIN)).toBeNull();
  });
});

describe("the app's route table", () => {
  it("a cold open of /portal/analytics/login signed out shows the page and stays there", async () => {
    if (!window.matchMedia) {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
          matches: false, media: query, onchange: null,
          addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
        }),
      });
    }
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { "Content-Type": "application/json" } })));
    window.history.pushState({}, "", "/portal/analytics/login");
    const { default: App } = await import("@/App");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Schools analytics" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toBeInTheDocument();
    expect(screen.queryByText("Send code")).toBeNull();
    expect(window.location.pathname).toBe("/portal/analytics/login");
  }, 30_000);
});
