import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, http, renderRm, rmWorld, serve, settle } from "./harness";
import RmRoutes from "../routes";
import { RM_HELD, RM_S9_TITLE_HELD } from "../held";
import { RM_COPY } from "../rm.copy";

/**
 * bd-sex15q.47 (R6 fix cycle 2, design/r6/FIX_R6.md §7.3, PR B2) — red-first for B8 and B9. jsdom has no layout, so the
 * held height is proven by the variable and the attribute the browser sizes from; the CLS itself is the cold probe's.
 *
 *   B8  the RM home holds its band from the first paint: the gate's loading draws the band skeleton at the RM's own
 *       height per language (440 / 509 px at 390, `rm/held.ts`), S8's band holds that height in every state with a
 *       hero skeleton and the trust foot while `/rm/home` is in flight, and the body is the overlapping skeleton
 *   B9  the RM app bars reserve their lines while loading: S9's title and sub, S10's date line, RM Stats' sub
 */
type Lang = "en" | "ur";
const C03 = "00000000-0000-4000-8000-070000000003";

/** Serve the RM world but leave `held` in flight for the whole test. */
function serveHolding(held: string) {
  serve(rmWorld());
  const answer = http.get.getMockImplementation()!;
  http.get.mockImplementation((url: string, cfg?: unknown) => (url === held ? new Promise(() => undefined) : answer(url, cfg)));
}

function renderAt(sub: string) {
  return render(
    <MemoryRouter initialEntries={[`/portal/rm${sub}`]}>
      <Routes><Route path="/portal/rm/*" element={<RmRoutes />} /></Routes>
    </MemoryRouter>,
  );
}

const heldVar = (el: Element | null) => (el as HTMLElement | null)?.style.getPropertyValue("--cp-band-min-h");

describe.each(["en", "ur"] as Lang[])("R6 fix cycle 2, RM deck (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("B8 the held heights are the live S8 band at 390 (design-qa r6b band.h)", () => {
    expect(RM_HELD).toEqual({ en: { band: 440 }, ur: { band: 509 } });
  });

  it("B8 RmGate loading on the sector draws the band skeleton at the RM's held height", async () => {
    serveHolding("/coachip/me");
    renderAt("");
    await settle();
    const gate = screen.getByTestId("rm-gate-loading");
    expect(gate.getAttribute("aria-busy")).toBe("true");
    const root = gate.querySelector(".cp");
    expect(root?.getAttribute("dir")).toBe(lang === "ur" ? "rtl" : "ltr");
    expect(heldVar(root)).toBe(`${RM_HELD[lang].band}px`);
    expect(gate.querySelector(".cp-band[data-cp-fixed]")).toBeTruthy();
    // no nav, no toggle, no RM read while the gate waits
    expect(gate.querySelector("nav, [data-testid^='rm-lang']")).toBeNull();
    expect(http.get.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual(["/coachip/me"]);
  });

  it("B8 RmGate loading off the sector draws no band (an inner page has an app bar)", async () => {
    serveHolding("/coachip/me");
    renderAt("/coaches");
    await settle();
    const gate = screen.getByTestId("rm-gate-loading");
    expect(gate.querySelector(".cp-band")).toBeNull();
  });

  it("B8 S8 loading: the band holds its height, the hero is a skeleton, the trust foot is there, the body overlaps", async () => {
    serveHolding("/coachip/rm/home");
    renderAt("");
    await waitFor(() => screen.getByTestId("rm-band"), { timeout: 5000 });
    await settle();
    const band = screen.getByTestId("rm-band");
    const held = band.parentElement!;
    expect(held.hasAttribute("data-rm-held")).toBe(true);
    expect(heldVar(held)).toBe(`${RM_HELD[lang].band}px`);
    expect(held.className).toContain("[&>.cp-band]:min-h-[var(--cp-band-min-h)]");
    expect(within(band).getByTestId("rm-hero-skeleton")).toBeTruthy();
    expect(within(band).queryByTestId("rm-opening")).toBeNull();
    expect(within(band).getByTestId("rm-band-foot").textContent).toBe(RM_COPY["s8.trust"][lang]);
    const body = screen.getByTestId("rm-state-loading");
    expect(body.querySelector(".cp-overlap")).toBeTruthy();
  });

  it("B8 S8 loaded: the same held band, no skeleton left", async () => {
    serve(rmWorld());
    await renderRm("");
    const band = screen.getByTestId("rm-band");
    expect(heldVar(band.parentElement)).toBe(`${RM_HELD[lang].band}px`);
    expect(screen.queryByTestId("rm-hero-skeleton")).toBeNull();
    expect(screen.queryByTestId("rm-state-loading")).toBeNull();
    expect(screen.getByTestId("rm-home").querySelector("[aria-busy='true']")).toBeNull();
    expect(within(band).getByTestId("rm-opening")).toBeTruthy();
  });

  it("B9 S9 loading: the app bar reserves the title and the sub line", async () => {
    serveHolding(`/coachip/rm/coach/${C03}`);
    renderAt(`/coach/${C03}`);
    await waitFor(() => screen.getByTestId("rm-band"), { timeout: 5000 });
    await settle();
    const bar = screen.getByTestId("rm-band");
    const title = bar.querySelector('[data-cp-ph="title"]') as HTMLElement | null;
    expect(title).toBeTruthy();
    // the live label wraps to two lines at 390: the placeholder holds that box (one line on a laptop)
    expect(title!.style.getPropertyValue("--rm-title-h")).toBe(`${RM_S9_TITLE_HELD[lang]}px`);
    expect(title!.getAttribute("aria-hidden")).toBe("true");
    expect(bar.querySelector('[data-cp-ph="sub"]')).toBeTruthy();
    expect(bar.querySelector("bdi[data-code]")).toBeNull();
  });

  it("B9 S10 loading: the app bar reserves the date line", async () => {
    serveHolding("/coachip/rm/circle");
    renderAt("/circle");
    await waitFor(() => screen.getByTestId("rm-band"), { timeout: 5000 });
    await settle();
    expect(screen.getByTestId("rm-band").querySelector('[data-cp-ph="sub"]')).toBeTruthy();
  });

  it("B9 RM Stats loading: the app bar reserves the sub line", async () => {
    serveHolding("/coachip/rm/home"); // RM Stats reads the sector home
    renderAt("/stats");
    await waitFor(() => screen.getByTestId("rm-band"), { timeout: 5000 });
    await settle();
    expect(screen.getByTestId("rm-band").querySelector('[data-cp-ph="sub"]')).toBeTruthy();
  });
});
