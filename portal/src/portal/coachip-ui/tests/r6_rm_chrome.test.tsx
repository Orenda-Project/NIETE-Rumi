import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderRm, rmWorld, serve } from "../../rm/tests/harness";

/**
 * bd-sex15q.42 (R6 ux-system) — the RM's chrome, red-first: every RM page is a `.cp` Shell; S8 (a home) wears the band
 * and the others the app bar, both under the same `rm-band` id; on a phone EN | اردو sits in that header (no separate
 * white strip above the page, DESIGN_SYSTEM / SCREENS "RM nav"); the menu is the shared NavBar and the laptop Rail.
 */
type Lang = "en" | "ur";
const COACH = "/coach/00000000-0000-4000-8000-070000000003";

describe.each(["en", "ur"] as Lang[])("R6 RM chrome (%s)", (lang) => {
  beforeEach(async () => { await boot(lang); serve(rmWorld()); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("S8 is a .cp Shell with the band; the phone's EN | اردو is in the band, and the old white strip is gone", async () => {
    await renderRm("");
    const page = screen.getByTestId("rm-home").closest("[data-cp-shell]") as HTMLElement;
    expect(page).not.toBeNull();
    expect(page.classList.contains("cp")).toBe(true);
    const band = screen.getByTestId("rm-band");
    expect(band.classList.contains("cp-band")).toBe(true);
    expect(within(band).getByTestId("rm-lang-ur")).toBeTruthy();
    expect(screen.queryByTestId("rm-phone-bar")).toBeNull();
  });

  it.each(["/coaches", "/circle", "/stats", COACH])("%s wears the app bar with the phone's EN | اردو in it", async (sub) => {
    await renderRm(sub);
    const bar = screen.getByTestId("rm-band");
    expect(bar.classList.contains("cp-band")).toBe(false);
    expect(within(bar).getByTestId("rm-lang-en")).toBeTruthy();
    expect(bar.closest("[data-cp-shell]")).not.toBeNull();
  });

  it("the menu: the shared NavBar on a phone (z-50, lg:hidden) and the Rail (lg:flex) with the wordmark", async () => {
    await renderRm("");
    const nav = screen.getByTestId("rm-nav");
    expect(nav.className).toContain("z-50");
    expect(nav.className).toContain("lg:hidden");
    const rail = screen.getByTestId("rm-top-nav");
    expect(rail.className).toContain("lg:flex");
    expect(rail.querySelector("img")).not.toBeNull();
  });
});
