import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { useAuth } from "../../hooks/useAuth";
import { boot, renderRm, rmWorld, serve, settle, F } from "./harness";

/**
 * fix-r5 s6 (a), GO_PACKAGE v5 §0.4 a (qa-rm 102038, COS-deputy 102124): a pure RM had no way to log out. The coach's
 * More is closed to them, and no RM screen carried a log-out control, so on a shared office laptop the next person
 * found a sector's data open. Every RM tab needs one on a laptop (the rail's foot, beside EN | اردو) and one on a phone
 * (the bar's overflow), and tapping it ends the session through the app's one logout (useAuth → POST /api/portal/logout).
 *
 * jsdom has no layout, so "on a laptop" and "on a phone" are read the way the browser decides `display`: an ancestor
 * with `hidden lg:flex` is laptop-only, one with `lg:hidden` is phone-only.
 */
const classes = (n: Element) => (n.getAttribute("class") || "").split(/\s+/);
function laptopOnly(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) if (classes(n).includes("hidden") && classes(n).some((c) => /^lg:(block|flex|grid|inline)/.test(c))) return true;
  return false;
}
function phoneOnly(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) if (classes(n).includes("lg:hidden")) return true;
  return false;
}
const TABS = ["", "/coaches", "/circle", "/stats", "/coach/00000000-0000-4000-8000-070000000003"];

describe("fix-r5 s6 (a): pure RM: a log-out control exists on every RM tab and ends the session", () => {
  let logout: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await boot("en");
    logout = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({ user: { id: "rm-1" }, loading: false, logout } as never);
    expect(F.me_rm.coach).toBeNull(); // the fixture's RM coaches no school: a pure RM, the More of the coach is not theirs
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it.each(TABS)("%s: the rail's foot has Log out beside EN | اردو, and it ends the session", async (sub) => {
    await renderRm(sub);
    const rail = screen.getByTestId("rm-top-nav");
    const out = rail.querySelectorAll('[data-testid="rm-logout"]');
    expect(out).toHaveLength(1);
    expect(laptopOnly(out[0])).toBe(true);
    expect(out[0].textContent).toBe("Log out");
    // beside the language toggle: the same foot block
    expect(out[0].parentElement?.querySelector('[data-testid="rm-lang-ur"]')).not.toBeNull();
    await act(async () => { fireEvent.click(out[0]); });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it.each(TABS)("%s: the phone bar's overflow opens a menu with Log out, and it ends the session", async (sub) => {
    await renderRm(sub);
    const more = screen.getAllByTestId("rm-more").filter((b) => phoneOnly(b));
    expect(more).toHaveLength(1);
    expect(more[0].getAttribute("aria-haspopup")).toBe("menu");
    expect(more[0].getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("rm-more-menu")).toBeNull();
    await act(async () => { fireEvent.click(more[0]); });
    expect(more[0].getAttribute("aria-expanded")).toBe("true");
    const item = screen.getByTestId("rm-more-menu").querySelector('[data-testid="rm-logout"]') as HTMLElement;
    expect(item.getAttribute("role")).toBe("menuitem");
    expect(item.textContent).toBe("Log out");
    await act(async () => { fireEvent.click(item); });
    await settle();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("rm-more-menu")).toBeNull();
  });

  it("the overflow closes on Escape and on a tap outside, without logging out", async () => {
    await renderRm("");
    const more = screen.getAllByTestId("rm-more").filter((b) => phoneOnly(b))[0];
    await act(async () => { fireEvent.click(more); });
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(screen.queryByTestId("rm-more-menu")).toBeNull();
    await act(async () => { fireEvent.click(more); });
    await act(async () => { fireEvent.pointerDown(document.body); });
    expect(screen.queryByTestId("rm-more-menu")).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });

  it("in Urdu the control reads لاگ آؤٹ on both widths", async () => {
    await boot("ur");
    vi.mocked(useAuth).mockReturnValue({ user: { id: "rm-1" }, loading: false, logout } as never);
    await renderRm("/circle");
    expect(screen.getByTestId("rm-top-nav").querySelector('[data-testid="rm-logout"]')?.textContent).toBe("لاگ آؤٹ");
    const more = screen.getAllByTestId("rm-more").filter((b) => phoneOnly(b))[0];
    expect(more.getAttribute("aria-label")).toBe("مزید");
    await act(async () => { fireEvent.click(more); });
    expect(screen.getByTestId("rm-more-menu").textContent).toBe("لاگ آؤٹ");
  });
});
