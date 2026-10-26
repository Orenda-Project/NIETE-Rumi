import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, F, gets, httpError, renderRm, rmWorld, serve } from "./harness";
import { coachPathReady, coachReadyHome, COACH_APP_READY } from "../../coach/training/appReady";

/**
 * bd-sex15q.17 — the RM gate and the flag-off golden (B7, B8, SPEC v2 §2, REUSE B). /portal/rm opens only for a user
 * whose GET /coachip/me carries `rm`; anyone else gets the house "not available" words and NO RM read fires. A user who
 * is both a flagged coach and an RM lands on S1 (their coach home is unchanged) and reaches S8 from the RM menu, which
 * links back to "This week".
 */
describe("RM gate (flag off is invisible)", () => {
  beforeEach(async () => { await boot("en"); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  const OFF: Record<string, () => unknown> = {
    "every switch off": () => F.me_off,
    "a flagged coach with no RM entry": () => F.me_coach,
    "/me fails": () => { throw httpError(500, { error: "server_error" }); },
    "/me 401": () => { throw httpError(401, { success: false }); },
    "rm present but no sector string": () => ({ ...F.me_rm, rm: { sector: "", schoolCount: 0, coachCount: 0 } }),
  };
  for (const [name, me] of Object.entries(OFF)) {
    it(`${name}: "This page is not available." and no RM request`, async () => {
      serve(rmWorld({ "/coachip/me": me }));
      for (const sub of ["", "/coaches", "/circle", "/stats", "/coach/00000000-0000-4000-8000-070000000003"]) {
        const r = await renderRm(sub);
        expect(screen.getByTestId("rm-not-available").textContent).toBe("This page is not available.");
        expect(r.container.querySelector('[data-testid="rm-top-nav"],[data-testid="rm-home"]')).toBeNull();
        cleanup();
      }
      expect(gets().filter((p) => p.startsWith("/coachip/rm/") || p.startsWith("/coachip/m/"))).toEqual([]);
    });
  }

  it("the RM opens S8 with the RM menu (Sector · Coaches · Circle · Stats · EN | اردو)", async () => {
    serve(rmWorld());
    await renderRm("");
    expect(screen.getByTestId("rm-home")).toBeTruthy();
    const nav = screen.getByTestId("rm-top-nav");
    expect(Array.from(nav.querySelectorAll("[data-nav]")).map((a) => a.textContent)).toEqual(["Sector", "Coaches", "Circle", "Stats"]);
    expect(nav.querySelector('[data-testid="rm-lang-en"]')?.textContent).toBe("EN");
    expect(nav.querySelector('[data-testid="rm-lang-ur"]')?.textContent).toBe("اردو");
    expect(screen.getByTestId("rm-nav")).toBeTruthy();
    expect(gets()).toContain("/coachip/me");
  });

  it("a coach who is also the RM: the RM menu links back to This week; a plain RM has no such link", async () => {
    serve(rmWorld({ "/coachip/me": { ...F.me_rm, coach: { schoolCount: 6, teacherCount: 41 } } }));
    await renderRm("");
    const back = screen.getByTestId("rm-top-nav").querySelector('[data-nav="this_week"]') as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("/portal/coach/insights");
    cleanup();
    serve(rmWorld());
    await renderRm("");
    expect(screen.getByTestId("rm-top-nav").querySelector('[data-nav="this_week"]')).toBeNull();
  });

  it("an unknown RM path is not available, not S8", async () => {
    serve(rmWorld());
    await renderRm("/nothing-here");
    expect(screen.getByTestId("rm-not-available")).toBeTruthy();
  });
});

describe("the coach app guard lets /portal/rm through (an RM may be a v2 coach) and changes nothing else", () => {
  it("/portal/rm and its pages are always reachable for a v2 coach (the page gates itself)", () => {
    for (const p of ["/portal/rm", "/portal/rm/", "/portal/rm/coaches", "/portal/rm/coach/00000000-0000-4000-8000-070000000003", "/portal/rm/circle", "/portal/rm/stats"]) {
      expect(coachPathReady(p)).toBe(true);
    }
  });
  it("golden: nothing else opened, the home unchanged", () => {
    for (const p of ["/portal/rmx", "/portal/rm-old", "/portal/coach/insights", "/portal/coach", "/portal/leader", "/portal/coach/schedule"]) {
      expect(coachPathReady(p)).toBe(false);
    }
    expect(coachPathReady("/portal/coach/training")).toBe(true);
    expect(coachReadyHome()).toBe("/portal/coach/training");
    expect(COACH_APP_READY).toEqual(["training", "lessons"]);
  });
});
