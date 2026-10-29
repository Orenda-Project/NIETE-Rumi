import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { language } from "../../services/api";
import { boot, renderAt, serve, settle, F, http } from "../../coach/insights/tests/harness";
import InsightsNav from "../../coach/insights/InsightsNav";
import { COPY } from "../../coach/insights/copy";

/**
 * bd-sex15q.42 (R6 ux-system) — the coach's chrome, red-first: every COACHIP coach page stands in the `.cp` Shell (the
 * tokens' scope) with the band (NIETE lockup) on a home tab and the slim app bar on an inner screen; the menu is the
 * one NavBar markup on a phone and the Rail on a laptop, and the Rail carries EN | اردو through the one writer.
 */
type Lang = "en" | "ur";

function laptop(on: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (q: string) => ({ matches: on && /min-width:\s*1024px/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
}

describe.each(["en", "ur"] as Lang[])("R6 coach chrome (%s)", (lang) => {
  beforeEach(async () => { await boot(lang); laptop(false); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("S1 stands in the .cp Shell; its band carries the NIETE lockup, the title and the date line; the trust line is the band's foot (FIX_R6 A6)", async () => {
    serve({ "/coachip/home": F.home });
    await renderAt("");
    const page = screen.getByTestId("insights-this-week");
    expect(page.classList.contains("cp")).toBe(true);
    expect(page.hasAttribute("data-cp-shell")).toBe(true);
    const band = screen.getByTestId("insights-band");
    expect(band.classList.contains("cp-band")).toBe(true);
    expect(band.querySelector(".cp-lattice")).not.toBeNull();
    expect(band.querySelector(".cp-band__lockup")?.textContent).toBe("NIETE");
    expect(within(band).getByRole("heading", { level: 1 }).textContent).toBe(COPY["band.title"][lang]);
    expect(within(band).getByTestId("s1-today")).toBeTruthy();
    expect(within(band).getByTestId("insights-band-foot").textContent).toBe(COPY["trust.coach"][lang]);
    expect(within(page).queryByTestId("trust-line")).toBeNull();
  });

  it("S2 is an inner screen: the slim app bar (back circle, title), no band", async () => {
    serve({ "/coachip/home": F.home, "/coachip/w/W-IP-TIME": F["w_W-IP-TIME"] });
    await renderAt("/w/W-IP-TIME");
    const page = screen.getByTestId("insights-w");
    expect(page.classList.contains("cp")).toBe(true);
    expect(within(page).queryByTestId("insights-band")).toBeNull();
    const bar = within(page).getByTestId("insights-appbar");
    expect(bar.querySelector('a[aria-label]')?.getAttribute("href")).toBe("/portal/coach/insights");
    expect(within(bar).getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("the phone menu is the NavBar (opaque, above scrolled content) and the laptop rail carries the brand wordmark", async () => {
    render(<MemoryRouter initialEntries={["/portal/coach/insights"]}><InsightsNav /></MemoryRouter>);
    await settle();
    const bar = screen.getByTestId("insights-nav");
    expect(bar.className).toContain("z-50");
    expect(bar.className).toContain("bg-white");
    expect(bar.className).toContain("lg:hidden");
    const rail = screen.getByTestId("insights-top-nav");
    expect(rail.className).toContain("lg:flex");
    expect(rail.querySelector("img")).not.toBeNull();
    expect(Array.from(rail.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
      "/portal/coach/insights", "/portal/coach/insights/schools", "/portal/coach/insights/listen",
      "/portal/coach/insights/stats", "/portal/coach/more",
    ]);
  });

  it("on a phone the rail mounts no language toggle (no /me/language read); on a laptop it does, and اردو/EN writes through language.set", async () => {
    render(<MemoryRouter initialEntries={["/portal/coach/insights"]}><InsightsNav /></MemoryRouter>);
    await settle();
    expect(screen.queryByTestId("cp-lang-ur")).toBeNull();
    expect(vi.mocked(language.get)).not.toHaveBeenCalled();
    cleanup();
    laptop(true);
    vi.mocked(language.set).mockResolvedValue({ success: true, language: lang === "en" ? "ur" : "en" } as never);
    render(<MemoryRouter initialEntries={["/portal/coach/insights"]}><InsightsNav /></MemoryRouter>);
    await settle();
    const rail = screen.getByTestId("insights-top-nav");
    const other = within(rail).getByTestId(lang === "en" ? "cp-lang-ur" : "cp-lang-en");
    expect(other.className).toContain("min-h-[44px]");
    await act(async () => { fireEvent.click(other); });
    await settle();
    expect(vi.mocked(language.set)).toHaveBeenCalledWith(lang === "en" ? "ur" : "en");
    expect(http.get.mock.calls.map((c: unknown[]) => String(c[0])).filter((p) => p.startsWith("/coachip/"))).toEqual([]);
  });
});
