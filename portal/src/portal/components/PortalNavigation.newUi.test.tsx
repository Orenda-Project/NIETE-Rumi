import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-5rz1v.12 — with `portal_new_ui` on, the menu is the new UI's INDIGO BAR
 * (Direction B, option 2), with the operator's menu decision of 2026-10-03:
 *
 *   teacher, phone   — indigo bottom bar: Home / Lessons / Assessment / Training /
 *                      Coaching. No More: what was under it (My Classes,
 *                      Analytics, My account, Logout) is in the PULL-UP MENU
 *                      (bd-5rz1v.18; newui/pullup.test.tsx), opened from the
 *                      bar's grab handle or her AVATAR (her initials) in a slim
 *                      indigo strip at the top. Labels 10.5px, pill 50px.
 *   teacher, desktop — indigo top bar: Home / Lesson Plans / Assessment /
 *                      Training / Coaching, then the avatar (the same panel).
 *   leaders          — their own items, bar + More sheet, recoloured only.
 *   Urdu             — RTL keeps working; labels are English literals, the way
 *                      the nav renders them today (the portal has no nav catalog).
 *
 * jsdom does not apply Tailwind, so colours are asserted through the classes
 * built from the tokens (tokens.test.ts proves class → hex), and sizes through
 * the min-size classes.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  // bd-5rz1v.18 — the pull-up menu reads her language when it opens.
  language: { get: vi.fn().mockResolvedValue({ language: "en", locked: false }), set: vi.fn() },
}));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import { resetNewUiMemory } from "../lib/useNewUi";
import PortalNavigation from "./PortalNavigation";

const TEACHER = { id: "t-1", firstName: "Ayesha Khan", role: "teacher" };
const COACH = { id: "c-1", firstName: "Noor", role: "coach" };
const PRINCIPAL = { id: "p-1", firstName: "Sana", role: "principal" };

let logout: ReturnType<typeof vi.fn>;

function renderNav(user: Record<string, unknown>, path: string, newUi: boolean) {
  logout = vi.fn();
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi } } as never);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PortalNavigation />
    </MemoryRouter>,
  );
}

const bottomBar = () => screen.findByTestId("newui-bottom-nav");
const topBar = () => screen.findByTestId("newui-top-nav");
const topStrip = () => screen.findByTestId("newui-top-strip");
const linksOf = (el: HTMLElement) =>
  within(el).getAllByRole("link").map((a) => [a.textContent?.trim(), a.getAttribute("href")]);
const PHYSICAL = /(^|\s)(-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|border-[lr](\s|-|$)|rounded-[lr]-)/;

async function openAccount(from: "phone" | "desktop" = "phone") {
  const holder = from === "phone" ? await topStrip() : await topBar();
  await userEvent.setup().click(within(holder).getByRole("button", { name: "Account" }));
  return screen.findByRole("dialog", { name: "Menu" });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
});
afterEach(() => {
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

describe("flag on — teacher, phone bottom bar", () => {
  it("is indigo, square, and follows the spacing spec (16/6/8px + safe area: the grab handle's 16px on top, still 80px)", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const cls = (await bottomBar()).className;
    expect(cls).toMatch(/\bbg-nu-ink\b/);
    // bd-5rz1v.18 — the mockup's .nav.handle: 16px above the items for the grab mark. The bottom
    // gives the 6px back, so the bar stays 80px and everything placed above it stays put.
    for (const c of ["pt-[16px]", "px-[6px]", "pb-[calc(8px+env(safe-area-inset-bottom))]"]) expect(cls).toContain(c);
    expect(cls).not.toMatch(/\brounded/);
  });

  it("reads Home / Lessons / Assessment / Training / Coaching — no More", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await bottomBar();
    expect(linksOf(bar)).toEqual([
      ["Home", "/portal/dashboard"],
      ["Lessons", "/portal/curriculum"],
      ["Assessment", "/portal/assessment"],
      ["Training", "/portal/training"],
      ["Coaching", "/portal/coaching"],
    ]);
    // bd-5rz1v.18 — the one button on the bar is the pull-up menu's handle.
    expect(within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Open menu"]);
    expect(screen.queryByTestId("mobile-nav-more")).toBeNull();
  });

  it("every item is a 56px target with a 10.5px label and a 50px-wide pill", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await bottomBar();
    const items = within(bar).getAllByRole("link");
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.className).toMatch(/\bmin-h-\[56px\]/);
      expect(item.className).toMatch(/\bmin-w-\[56px\]/);
      expect(item.className).toMatch(/\bflex-1\b/);
      expect(item.className).toMatch(/\bgap-1\b/);
      expect((item.querySelector("[data-label]") as HTMLElement).className).toMatch(/\btext-\[10\.5px\]/);
      const pill = (item.querySelector("[data-pill]") as HTMLElement).className.split(/\s+/);
      expect(pill).toEqual(expect.arrayContaining(["h-8", "w-[50px]", "rounded-2xl"]));
      expect(item.querySelector("svg")?.getAttribute("class")).toMatch(/\bh-\[23px\].*\bw-\[23px\]/);
    }
  });

  it.each([
    ["/portal/dashboard", "Home"],
    ["/portal/curriculum", "Lessons"],
    ["/portal/curriculum?tab=assessment", "Assessment"],
    // bd-5rz1v.13 — Assessment is its own page now, with pages inside it.
    ["/portal/assessment", "Assessment"],
    ["/portal/assessment/mine", "Assessment"],
    ["/portal/assessment/request/r-1", "Assessment"],
    ["/portal/training", "Training"],
    ["/portal/training/certificates", "Training"],
    ["/portal/coaching/new", "Coaching"],
  ])("on %s only %s is lit: white, green icon in a translucent pill", async (path, lit) => {
    renderNav(TEACHER, path, true);
    const bar = await bottomBar();
    for (const link of within(bar).getAllByRole("link")) {
      const name = link.textContent?.trim();
      const pill = link.querySelector("[data-pill]") as HTMLElement;
      if (name === lit) {
        expect(link).toHaveAttribute("aria-current", "page");
        expect(link.className).toMatch(/\btext-white\b/);
        expect(pill.className.split(/\s+/)).toContain("bg-nu-frame-translucent");
        expect(pill.querySelector("svg")?.getAttribute("class")).toMatch(/\btext-nu-leaf\b/);
      } else {
        expect(link, name).not.toHaveAttribute("aria-current");
        expect(link.className).toMatch(/\btext-nu-nav-label\b/);
        expect(pill.className).not.toMatch(/\bbg-/);
      }
    }
  });

  it("the old white bar is gone", async () => {
    const { container } = renderNav(TEACHER, "/portal/dashboard", true);
    await bottomBar();
    expect(container.querySelector("nav.bg-white")).toBeNull();
  });
});

describe("flag on — teacher, the avatar and the pull-up menu", () => {
  it("the phone shows a slim indigo strip with the NIETE mark and her initials, a 56px target", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const strip = await topStrip();
    expect(strip.className).toMatch(/\bbg-nu-ink\b/);
    expect(strip.className).toMatch(/\bmd:hidden\b/);
    expect(within(strip).getByAltText("NIETE logo")).toBeInTheDocument();
    const avatar = within(strip).getByRole("button", { name: "Account" });
    expect(avatar).toHaveTextContent("AK");
    expect(avatar.className).toMatch(/\bmin-h-\[56px\]/);
    expect(avatar.className).toMatch(/\bmin-w-\[56px\]/);
  });

  it("a one-word name gives one initial; no name gives the person icon", async () => {
    renderNav({ ...TEACHER, firstName: "Ayesha" }, "/portal/dashboard", true);
    expect(within(await topStrip()).getByRole("button", { name: "Account" })).toHaveTextContent(/^A$/);
    cleanup();
    resetNewUiMemory();
    renderNav({ ...TEACHER, firstName: "" }, "/portal/dashboard", true);
    const avatar = within(await topStrip()).getByRole("button", { name: "Account" });
    expect(avatar.textContent?.trim()).toBe("");
    expect(avatar.querySelector("svg")).not.toBeNull();
  });

  it("opens the pull-up menu (bd-5rz1v.18), not a separate account sheet", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const panel = await openAccount("phone");
    expect(panel).toHaveAttribute("data-state", "open");
    expect(within(panel).getByTestId("newui-menu-who")).toHaveTextContent("Ayesha Khan");
    expect(linksOf(within(panel).getByTestId("newui-menu-grid"))).toEqual([
      ["My Classes", "/portal/classes"],
      ["Certificates", "/portal/training/certificates"],
      // bd-5rz1v.25 — the band picker left the Training page; it lives here now.
      ["My grades", "/portal/training/grades"],
      ["My account", "/portal/account"],
      ["Analytics", "/portal/coaching/analytics"],
    ]);
    expect(screen.queryByTestId("newui-sheet-rows")).toBeNull();
    expect(within(panel).getByTestId("mobile-nav-account")).toHaveAttribute("href", "/portal/account");
  });

  it("Logout is a light-red tile, 56px or more, and logs her out", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const panel = await openAccount("phone");
    const btn = within(panel).getByTestId("mobile-nav-logout");
    expect(btn).toHaveTextContent("Logout");
    expect(btn.className).toMatch(/\btext-nu-pullup-out\b/);
    expect(btn.className).toMatch(/\bmin-h-\[(56|84)px\]/);
    await userEvent.setup().click(btn);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("the panel's tiles carry no feature colour, and the current page's tile is lit", async () => {
    renderNav(TEACHER, "/portal/classes", true);
    const panel = await openAccount("phone");
    expect(panel.innerHTML).not.toMatch(/nu-f-/);
    const current = within(panel).getByRole("link", { name: /My Classes/ });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.className).toMatch(/\bbg-nu-frame-translucent\b/);
  });

  it("closes on Escape, the way Android Back closes it", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    await openAccount("phone");
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("flag on — teacher, desktop top bar", () => {
  it("is indigo with the NIETE mark: Home / Lesson Plans / Assessment / Training / Coaching", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await topBar();
    expect(bar.className).toMatch(/\bbg-nu-ink\b/);
    expect(within(bar).getByAltText("NIETE logo")).toBeInTheDocument();
    expect(linksOf(bar)).toEqual([
      ["Home", "/portal/dashboard"],
      ["Lesson Plans", "/portal/curriculum"],
      ["Assessment", "/portal/assessment"],
      ["Training", "/portal/training"],
      ["Coaching", "/portal/coaching"],
    ]);
  });

  it("highlights the active item", async () => {
    renderNav(TEACHER, "/portal/assessment", true);
    const bar = await topBar();
    const active = within(bar).getByRole("link", { name: "Assessment" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.className).toMatch(/\bbg-nu-frame-translucent\b/);
    expect(active.querySelector("svg")?.getAttribute("class")).toMatch(/\btext-nu-leaf\b/);
    expect(within(bar).getByRole("link", { name: "Lesson Plans" })).not.toHaveAttribute("aria-current");
  });

  it("ends with the avatar, which opens the same pull-up menu (Logout lives there)", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await topBar();
    expect(within(bar).queryByRole("button", { name: "Logout" })).toBeNull();
    const sheet = await openAccount("desktop");
    await userEvent.setup().click(within(sheet).getByTestId("mobile-nav-logout"));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("every desktop target is at least 56px", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await topBar();
    for (const t of [...within(bar).getAllByRole("link"), within(bar).getByRole("button", { name: "Account" })]) {
      expect(t.className, t.textContent ?? "").toMatch(/\bmin-h-\[56px\]/);
    }
  });
});

describe("flag on — leader roles: new colours, their own items", () => {
  async function itemsWith(user: Record<string, unknown>, path: string, on: boolean) {
    const { container } = renderNav(user, path, on);
    await waitFor(() => expect(portal.getConfig).toHaveBeenCalled());
    if (on) await topBar();
    const navs = container.querySelectorAll("nav");
    const desktop = linksOf(navs[0] as HTMLElement).filter(([, href]) => href !== "/portal/account");
    const phone = linksOf(navs[1] as HTMLElement);
    cleanup();
    return { desktop, phone };
  }

  it.each([
    ["coach", COACH, "/portal/leader"],
    ["principal", PRINCIPAL, "/portal/leader/school-analytics"],
  ])("a %s keeps exactly the items she had", async (_role, user, path) => {
    const before = await itemsWith(user, path, false);
    resetNewUiMemory();
    const after = await itemsWith(user, path, true);
    expect(after.desktop).toEqual(before.desktop);
    expect(after.phone).toEqual(before.phone);
    expect(before.desktop.length).toBeGreaterThan(0);
  });

  it("a coach's bars are indigo, she keeps More + the sheet, and has no avatar strip", async () => {
    renderNav(COACH, "/portal/leader", true);
    expect((await topBar()).className).toMatch(/\bbg-nu-ink\b/);
    const bar = await bottomBar();
    expect(bar.className).toMatch(/\bbg-nu-ink\b/);
    expect(screen.queryByTestId("newui-top-strip")).toBeNull();
    // Today a leader's phone bar holds only the titles named in MOBILE_PRIMARY
    // (just Training) and the rest sit behind the tray — unchanged here, so
    // My Patch is in the sheet and the More button is the lit one.
    const more = within(bar).getByRole("button", { name: "More" });
    expect(more.className).toMatch(/\btext-white\b/);
    await userEvent.setup().click(more);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("link", { name: /My Patch/ })).toHaveAttribute("href", "/portal/leader");
    expect(within(sheet).getByTestId("mobile-nav-account")).toHaveAttribute("href", "/portal/account");
    await userEvent.setup().click(within(sheet).getByTestId("mobile-nav-logout"));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("a coach's desktop keeps her name (My account) and Logout", async () => {
    renderNav(COACH, "/portal/leader", true);
    const bar = await topBar();
    expect(within(bar).getByTestId("portal-user-name")).toHaveAttribute("href", "/portal/account");
    expect(within(bar).getByRole("button", { name: "Logout" })).toBeInTheDocument();
  });
});

describe("flag on — Urdu (RTL)", () => {
  it("renders the same labels under dir=rtl, the way the nav renders them today", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    document.documentElement.setAttribute("lang", "ur");
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await bottomBar();
    expect(linksOf(bar).map(([label]) => label)).toEqual(["Home", "Lessons", "Assessment", "Training", "Coaching"]);
  });

  it("uses only logical (start/end) spacing, so the bars and the strip mirror themselves", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    renderNav(TEACHER, "/portal/dashboard", true);
    for (const el0 of [await bottomBar(), await topBar(), await topStrip()]) {
      for (const el of [el0, ...el0.querySelectorAll<HTMLElement>("*")]) {
        expect(el.getAttribute("class") || "", el.outerHTML.slice(0, 120)).not.toMatch(PHYSICAL);
      }
    }
  });

  it("the pull-up menu uses logical spacing, so it mirrors", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    renderNav(TEACHER, "/portal/dashboard", true);
    const panel = await openAccount("phone");
    for (const el of [panel, ...panel.querySelectorAll<HTMLElement>("*")]) {
      expect(el.getAttribute("class") || "").not.toMatch(PHYSICAL);
    }
  });
});
