import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { tapProblems } from "./checks/rules";

/**
 * bd-5rz1v.18 — the pull-up menu (deep-screens.html, "Menu bar · pull up"): the operator's one
 * "everything else" place.
 *
 *   the handle   a 38×4 grab mark on top of the teacher's indigo bottom bar (`.nav.handle`); a tap
 *                on the bar's top edge or a swipe up on the bar opens the panel.
 *   the panel    a dimmed page, then an indigo panel rising from the bar (`.pullup`): a grab mark,
 *                "who" (initials, her name, school · Teacher), and a 3-column grid of big tiles
 *                (`.pgrid`, `.ptile`): My Classes, Certificates, My grades, Language, My account,
 *                Analytics, then Logout in light red. The menu row stays at the bottom.
 *   closing      Android Back (role=dialog + data-state=open, lib/back-button.cjs), Escape, a tap on
 *                the dimmed page, a swipe down, or going to a tile.
 *   the avatar   every avatar opens this same panel; the old account sheet is gone.
 *   Language     the portal's one language setting (GET/PUT /api/portal/me/language → the bot's
 *                setUserLanguage). A tap writes, then turns the page (lang + dir). A locked choice
 *                is hers: the page follows it. Nothing is written without her tap.
 *   leaders      unchanged.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  language: { get: vi.fn(), set: vi.fn() },
}));
const guardedLogout = vi.fn();
vi.mock("../lib/recordingSession", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/recordingSession")>();
  // The "Stop recording?" confirm lives in this guard (bd-5rz1v.10); the panel must call it.
  return { ...real, useLogoutGuard: () => guardedLogout };
});
import { useAuth } from "../hooks/useAuth";
import { language, portal } from "../services/api";
import { resetNewUiMemory } from "../lib/useNewUi";
import i18n from "@/i18n/config";
import { OVERLAY_SELECTOR } from "@/lib/back-button.cjs";
import PortalNavigation from "../components/PortalNavigation";
import { AccountAvatar } from "./NewUiNavigation";
import { closeAccountSheet } from "./accountSheet";

// jsdom has no PointerEvent, so a fired pointerdown would carry no clientY: give it the real shape.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventShim;
}

const TEACHER = { id: "t-1", firstName: "Ayesha Khan", role: "teacher", schoolName: "IMSG I-8/1" };
const COACH = { id: "c-1", firstName: "Noor", role: "coach" };

function Where() {
  const { pathname } = useLocation();
  return <output data-testid="where">{pathname}</output>;
}

function renderNav(user: Record<string, unknown> = TEACHER, path = "/portal/curriculum") {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: true } } as never);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<><PortalNavigation /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const bar = () => screen.findByTestId("newui-bottom-nav");
const panel = () => screen.findByRole("dialog", { name: "Menu" });

async function openByHandle() {
  const handle = within(await bar()).getByTestId("newui-menu-handle");
  fireEvent.click(handle);
  return panel();
}

/** A finger on the bar: down at one height, up at another (screen y grows downwards). */
function swipe(el: Element, fromY: number, toY: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientY: fromY, isPrimary: true });
  fireEvent.pointerUp(el, { pointerId: 1, clientY: toY, isPrimary: true });
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetNewUiMemory();
  act(() => closeAccountSheet());
  vi.mocked(language.get).mockResolvedValue({ language: "en", locked: false });
  vi.mocked(language.set).mockResolvedValue(undefined);
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(async () => {
  cleanup();
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("the handle on the bar", () => {
  it("a 38×4 grab mark sits on top of the bar; the bar keeps its 80px (16px over the items, 8px under)", async () => {
    renderNav();
    const b = await bar();
    const mark = within(b).getByTestId("newui-menu-grab");
    expect(mark.className.split(/\s+/)).toEqual(expect.arrayContaining(["h-1", "w-[38px]", "bg-nu-pullup-grab"]));
    expect(mark).toHaveAttribute("aria-hidden", "true");
    for (const c of ["pt-[16px]", "px-[6px]", "pb-[calc(8px+env(safe-area-inset-bottom))]"]) expect(b.className).toContain(c);
  });

  it("the handle is a button named Open menu, closed to start, a 56px target behind the five items", async () => {
    renderNav();
    const handle = within(await bar()).getByTestId("newui-menu-handle");
    expect(handle.tagName).toBe("BUTTON");
    expect(handle).toHaveAccessibleName("Open menu");
    expect(handle).toHaveAttribute("aria-expanded", "false");
    expect(tapProblems(await bar())).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a tap opens the panel", async () => {
    renderNav();
    const p = await openByHandle();
    expect(p).toHaveAttribute("data-state", "open");
    expect(within(await bar()).getByTestId("newui-menu-handle")).toHaveAttribute("aria-expanded", "true");
  });

  it("a swipe up on the bar opens it — from an item too, without going there", async () => {
    renderNav();
    const lessons = within(await bar()).getByRole("link", { name: "Lessons" });
    swipe(lessons, 800, 730);
    fireEvent.click(lessons);
    expect(await panel()).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/curriculum");
  });

  it("a small wobble is a tap, not a swipe", async () => {
    renderNav();
    swipe(await bar(), 800, 790);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the panel", () => {
  it("rises from the bar: indigo, 24px top corners, over a dimmed page", async () => {
    renderNav();
    const p = await openByHandle();
    expect(p.className).toMatch(/\bbg-nu-ink\b/);
    expect(p.className).toContain("rounded-t-[24px]");
    expect(p.className).toContain("bottom-[calc(80px+env(safe-area-inset-bottom))]");
    const scrim = screen.getByTestId("newui-menu-scrim");
    expect(scrim.className).toMatch(/\bbg-nu-surface-scrim\b/);
    expect(within(p).getByTestId("newui-menu-grab-panel")).toHaveAttribute("aria-hidden", "true");
  });

  it("the menu row stays at the bottom, above the dimmed page", async () => {
    renderNav();
    await openByHandle();
    const b = await bar();
    const z = (el: Element) => Number((el.className.match(/\bz-\[?(\d+)\]?/) || [])[1]);
    expect(z(b)).toBeGreaterThan(z(screen.getByTestId("newui-menu-scrim")));
    expect(within(b).getAllByRole("link")).toHaveLength(5);
  });

  it("who: her initials, her name, her school · Teacher", async () => {
    renderNav();
    const who = within(await openByHandle()).getByTestId("newui-menu-who");
    expect(who).toHaveTextContent("AK");
    expect(within(who).getByText("Ayesha Khan")).toBeInTheDocument();
    expect(within(who).getByText("IMSG I-8/1 · Teacher")).toBeInTheDocument();
  });

  it("no school on file: just Teacher", async () => {
    renderNav({ ...TEACHER, schoolName: null });
    const who = within(await openByHandle()).getByTestId("newui-menu-who");
    expect(within(who).getByText("Teacher")).toBeInTheDocument();
  });

  it("a 3-column grid of big tiles, in order, each going where it says", async () => {
    renderNav();
    const p = await openByHandle();
    const grid = within(p).getByTestId("newui-menu-grid");
    expect(grid.className).toContain("[display:grid]");
    expect(grid.className).toMatch(/\bgrid-cols-3\b/);
    const tiles = Array.from(grid.children) as HTMLElement[];
    expect(tiles.map((t) => [t.textContent?.trim(), t.getAttribute("href")])).toEqual([
      ["My Classes", "/portal/classes"],
      ["Certificates", "/portal/training/certificates"],
      // bd-5rz1v.25 — the band picker lives behind the avatar; it stays reachable here.
      ["My grades", "/portal/training/grades"],
      ["اردو", null],
      ["My account", "/portal/account"],
      ["Analytics", "/portal/coaching/analytics"],
      ["Logout", null],
    ]);
    for (const t of tiles) expect(t.className).toMatch(/\bmin-h-\[(84|56)px\]/);
    expect(tapProblems(p)).toEqual([]);
  });

  it("tiles are neutral on indigo; the page she is on is lit like the menu's current item", async () => {
    renderNav(TEACHER, "/portal/classes");
    const p = await openByHandle();
    expect(p.innerHTML).not.toMatch(/nu-f-/);
    const current = within(p).getByRole("link", { name: "My Classes" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.className).toMatch(/\bbg-nu-frame-translucent\b/);
    const other = within(p).getByRole("link", { name: "Certificates" });
    expect(other.className).toMatch(/\bbg-nu-pullup-tile\b/);
  });

  it("Logout is light red and calls the guarded logout (Stop recording? asks first)", async () => {
    renderNav();
    const p = await openByHandle();
    const out = within(p).getByRole("button", { name: "Logout" });
    expect(out.className).toMatch(/\btext-nu-pullup-out\b/);
    fireEvent.click(out);
    expect(guardedLogout).toHaveBeenCalledTimes(1);
  });

  it("going to a tile closes the panel", async () => {
    renderNav();
    const p = await openByHandle();
    fireEvent.click(within(p).getByRole("link", { name: "Analytics" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/coaching/analytics");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("uses only logical spacing, so it mirrors in Urdu", async () => {
    renderNav();
    const p = await openByHandle();
    const PHYSICAL = /(^|\s)(-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|border-[lr](\s|-|$)|rounded-[lr]-)/;
    for (const el of [p, ...p.querySelectorAll<HTMLElement>("*")]) expect(el.getAttribute("class") || "").not.toMatch(PHYSICAL);
  });
});

describe("closing the panel", () => {
  it("is what Android Back looks for, and Back (Escape) closes it", async () => {
    renderNav();
    const p = await openByHandle();
    expect(document.querySelector(OVERLAY_SELECTOR)).toBe(p);
    // BackButtonHandler sends Escape from whatever has focus.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a tap on the dimmed page closes it", async () => {
    renderNav();
    await openByHandle();
    fireEvent.click(screen.getByTestId("newui-menu-scrim"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a swipe down closes it; a tap on the handle again closes it", async () => {
    renderNav();
    const p = await openByHandle();
    swipe(p, 400, 480);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openByHandle();
    fireEvent.click(within(await bar()).getByTestId("newui-menu-handle"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("the avatar opens the same panel; the account sheet is gone", () => {
  it.each([["the phone strip", "newui-avatar"], ["the desktop bar", "newui-avatar-desktop"]])("%s", async (_where, id) => {
    renderNav();
    fireEvent.click(await screen.findByTestId(id));
    const p = await panel();
    expect(within(p).getByTestId("newui-menu-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("newui-sheet-rows")).toBeNull();
  });

  it("bd-5rz1v.32 — on a desktop the card stays under the avatar: its end is the menu's column end, not the window's 24px", async () => {
    renderNav();
    fireEvent.click(await screen.findByTestId("newui-avatar-desktop"));
    const cls = (await panel()).className.split(/\s+/);
    // The menu's column (DESK_COLUMN): 40px each side, or the 1040px-wide middle once the window passes 1120px.
    expect(cls).toContain("md:end-[max(2.5rem,calc(50%_-_520px))]");
    expect(cls).not.toContain("md:end-6");
  });

  it("an avatar on a page's own heading (Home's band) opens it too", async () => {
    renderNav(TEACHER, "/portal/dashboard");
    await bar();
    render(<AccountAvatar name="Ayesha Khan" testId="band-avatar" />);
    fireEvent.click(screen.getByTestId("band-avatar"));
    expect(await panel()).toBeInTheDocument();
  });
});

describe("Language — the portal's one language setting", () => {
  it("in English the tile offers اردو; a tap writes it through PUT /me/language, then the page turns right-to-left", async () => {
    renderNav();
    const p = await openByHandle();
    const tile = within(p).getByRole("button", { name: "اردو" });
    fireEvent.click(tile);
    await waitFor(() => expect(language.set).toHaveBeenCalledWith("ur"));
    await waitFor(() => expect(document.documentElement.getAttribute("dir")).toBe("rtl"));
    expect(document.documentElement.getAttribute("lang")).toBe("ur");
    expect(await within(p).findByRole("button", { name: "English" })).toBeInTheDocument();
  });

  it("and back: English writes en and the page turns left-to-right", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    vi.mocked(language.get).mockResolvedValue({ language: "ur", locked: true });
    renderNav();
    const p = await openByHandle();
    fireEvent.click(await within(p).findByRole("button", { name: "English" }));
    await waitFor(() => expect(language.set).toHaveBeenCalledWith("en"));
    await waitFor(() => expect(document.documentElement.getAttribute("dir")).toBe("ltr"));
  });

  it("a write that fails leaves the page as it was and says Not saved", async () => {
    vi.mocked(language.set).mockRejectedValue(Object.assign(new Error("400"), { response: { status: 400 } }));
    renderNav();
    const p = await openByHandle();
    fireEvent.click(within(p).getByRole("button", { name: "اردو" }));
    expect(await within(p).findByText("Not saved")).toBeInTheDocument();
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(i18n.language).toBe("en");
  });

  it("opening the panel reads her setting and writes nothing", async () => {
    renderNav();
    await openByHandle();
    await waitFor(() => expect(language.get).toHaveBeenCalled());
    expect(language.set).not.toHaveBeenCalled();
  });

  it("a LOCKED choice is hers: the page follows it, without a write", async () => {
    vi.mocked(language.get).mockResolvedValue({ language: "ur", locked: true });
    renderNav();
    const p = await openByHandle();
    await waitFor(() => expect(document.documentElement.getAttribute("dir")).toBe("rtl"));
    expect(language.set).not.toHaveBeenCalled();
    expect(await within(p).findByRole("button", { name: "English" })).toBeInTheDocument();
  });

  it("an unlocked stored value is not her decision: the page stays as it is", async () => {
    vi.mocked(language.get).mockResolvedValue({ language: "ur", locked: false });
    renderNav();
    await openByHandle();
    await waitFor(() => expect(language.get).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(language.set).not.toHaveBeenCalled();
  });
});

describe("leaders keep their menu", () => {
  it("a coach has no handle and no panel; her More sheet is unchanged", async () => {
    renderNav(COACH, "/portal/leader");
    const b = await bar();
    expect(within(b).queryByTestId("newui-menu-handle")).toBeNull();
    expect(within(b).queryByTestId("newui-menu-grab")).toBeNull();
    fireEvent.click(within(b).getByRole("button", { name: "More" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByTestId("newui-sheet-rows")).toBeInTheDocument();
  });
});
