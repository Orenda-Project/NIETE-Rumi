import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-5rz1v.12 — with `portal_new_ui` on, the first visible piece of the new UI
 * (Direction B, option 2) is the INDIGO MENU BAR:
 *
 *   phone   — indigo bottom bar; Home / Lessons / Training / Coaching / More;
 *             labels #b9bccb, the active item white with its icon in logo green;
 *             every target at least 56px; More opens the existing sheet.
 *   desktop — indigo top bar with the NIETE mark, the same destinations, the
 *             active item highlighted, My account and Logout kept.
 *   leaders — the same colours, their own items untouched.
 *   Urdu    — RTL keeps working; labels are rendered the way the nav renders
 *             them today (English literals — the portal has no nav catalog).
 *
 * jsdom does not apply Tailwind, so colours are asserted through the classes
 * built from the tokens (tokens.test.ts proves class → hex), and sizes through
 * the min-size classes.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import { resetNewUiMemory } from "../lib/useNewUi";
import PortalNavigation from "./PortalNavigation";

const TEACHER = { id: "t-1", firstName: "Ayesha", role: "teacher" };
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
const linksOf = (el: HTMLElement) =>
  within(el).getAllByRole("link").map((a) => [a.textContent?.trim(), a.getAttribute("href")]);

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
});
afterEach(() => {
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

describe("flag on — phone bottom bar (teacher)", () => {
  it("is indigo", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    expect((await bottomBar()).className).toMatch(/\bbg-nu-ink\b/);
  });

  it("reads Home / Lessons / Training / Coaching / More and goes where the old bar went", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await bottomBar();
    expect(linksOf(bar)).toEqual([
      ["Home", "/portal/dashboard"],
      ["Lessons", "/portal/curriculum"],
      ["Training", "/portal/training"],
      ["Coaching", "/portal/coaching"],
    ]);
    const more = within(bar).getByRole("button", { name: "More" });
    expect(more.textContent?.trim()).toBe("More");
  });

  it("every target is at least 56px", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await bottomBar();
    const targets = [...within(bar).getAllByRole("link"), within(bar).getByRole("button", { name: "More" })];
    expect(targets).toHaveLength(5);
    for (const t of targets) {
      expect(t.className, t.textContent ?? "").toMatch(/\bmin-h-\[56px\]/);
      expect(t.className, t.textContent ?? "").toMatch(/\bmin-w-\[56px\]/);
    }
  });

  it("follows the bar spacing spec: 10/6/14px padding plus the safe area, square corners", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const cls = (await bottomBar()).className;
    for (const c of ["pt-[10px]", "px-[6px]", "pb-[calc(14px+env(safe-area-inset-bottom))]"]) {
      expect(cls).toContain(c);
    }
    expect(cls).not.toMatch(/\brounded/);
  });

  it("each item: 4px between icon and label, a 23px icon, an 11.5px bold label, spread evenly", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await bottomBar();
    for (const item of [...within(bar).getAllByRole("link"), within(bar).getByRole("button", { name: "More" })]) {
      expect(item.className).toMatch(/\bflex-1\b/);
      expect(item.className).toMatch(/\bgap-1\b/);
      expect(item.querySelector("svg")?.getAttribute("class")).toMatch(/\bh-\[23px\].*\bw-\[23px\]/);
      const label = item.querySelector("[data-label]") as HTMLElement;
      expect(label.className).toMatch(/\btext-\[11\.5px\]/);
      expect(label.className).toMatch(/\bfont-bold\b/);
    }
  });

  it("the active item's icon sits in a 56x32 translucent pill (radius 16); the others have no pill fill", async () => {
    renderNav(TEACHER, "/portal/training", true);
    const bar = await bottomBar();
    const pill = within(bar).getByRole("link", { name: "Training" }).querySelector("[data-pill]") as HTMLElement;
    for (const c of ["h-8", "w-14", "rounded-2xl", "bg-nu-frame-translucent"]) expect(pill.className.split(/\s+/)).toContain(c);
    expect(pill.querySelector("svg")?.getAttribute("class")).toMatch(/\btext-nu-leaf\b/);
    const idle = within(bar).getByRole("link", { name: "Home" }).querySelector("[data-pill]") as HTMLElement;
    expect(idle.className).not.toMatch(/\bbg-/);
  });

  it("the active item is white with its icon in logo green; the rest are the muted label colour", async () => {
    renderNav(TEACHER, "/portal/curriculum", true);
    const bar = await bottomBar();
    const active = within(bar).getByRole("link", { name: "Lessons" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.className).toMatch(/\btext-white\b/);
    expect(active.querySelector("svg")?.getAttribute("class")).toMatch(/\btext-nu-leaf\b/);

    for (const name of ["Home", "Training", "Coaching"]) {
      const link = within(bar).getByRole("link", { name });
      expect(link).not.toHaveAttribute("aria-current");
      expect(link.className).toMatch(/\btext-nu-nav-label\b/);
      expect(link.className).not.toMatch(/\btext-white\b/);
    }
  });

  it("More opens the existing sheet: the other items, My account, Logout", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await bottomBar();
    await userEvent.setup().click(within(bar).getByRole("button", { name: "More" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("link", { name: /My Classes/ })).toHaveAttribute("href", "/portal/classes");
    expect(within(sheet).getByRole("link", { name: /Analytics/ })).toHaveAttribute("href", "/portal/coaching/analytics");
    expect(within(sheet).getByRole("link", { name: /My account/ })).toHaveAttribute("href", "/portal/account");
    for (const row of within(sheet).getAllByRole("link")) expect(row.className).toMatch(/\bmin-h-\[56px\]/);

    await userEvent.setup().click(within(sheet).getByTestId("mobile-nav-logout"));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("the sheet closes from a 56px button in its title row (the shared 16px × is hidden)", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    await userEvent.setup().click(within(await bottomBar()).getByRole("button", { name: "More" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet.className).toContain("[&>button:last-child]:hidden");
    const close = within(sheet).getByTestId("newui-sheet-close");
    expect(close.className).toMatch(/\bh-14\b/);
    expect(close.className).toMatch(/\bw-14\b/);
    await userEvent.setup().click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the sheet's icons are neutral grey — a feature colour is only ever a page-heading icon", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    await userEvent.setup().click(within(await bottomBar()).getByRole("button", { name: "More" }));
    const rows = within(await screen.findByRole("dialog")).getByTestId("newui-sheet-rows");
    expect(rows.innerHTML).not.toMatch(/nu-f-/);
    const tiles = rows.querySelectorAll("[data-tile]");
    expect(tiles.length).toBe(4); // My Classes, Analytics, My account, Logout
    for (const t of tiles) expect(t.getAttribute("class")).toMatch(/\bbg-nu-neutral-tile\b.*\btext-nu-neutral-icon\b|\btext-nu-neutral-icon\b.*\bbg-nu-neutral-tile\b/);
  });

  it("the current page's row in the sheet is selected the indigo way", async () => {
    renderNav(TEACHER, "/portal/classes", true);
    await userEvent.setup().click(within(await bottomBar()).getByRole("button", { name: "More" }));
    const row = within(await screen.findByRole("dialog")).getByRole("link", { name: /My Classes/ });
    expect(row).toHaveAttribute("aria-current", "page");
    expect(row.className).toMatch(/\bbg-nu-select-tint\b/);
  });

  it("More is the active item while she is on a page inside the sheet", async () => {
    renderNav(TEACHER, "/portal/classes", true);
    const bar = await bottomBar();
    const more = within(bar).getByRole("button", { name: "More" });
    expect(more.className).toMatch(/\btext-white\b/);
    expect(more.querySelector("svg")?.getAttribute("class")).toMatch(/\btext-nu-leaf\b/);
  });

  it("keeps the test ids the screenshot and recording-bar scripts use", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    await bottomBar();
    expect(screen.getByTestId("mobile-nav-more")).toBeInTheDocument();
  });

  it("the old white bar is gone", async () => {
    const { container } = renderNav(TEACHER, "/portal/dashboard", true);
    await bottomBar();
    expect(container.querySelector("nav.bg-white")).toBeNull();
  });
});

describe("flag on — desktop top bar (teacher)", () => {
  it("is indigo, carries the NIETE mark, and goes to the same places in the same order", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await topBar();
    expect(bar.className).toMatch(/\bbg-nu-ink\b/);
    expect(within(bar).getByAltText("NIETE logo")).toBeInTheDocument();
    const destinations = linksOf(bar).map(([, href]) => href);
    expect(destinations).toEqual([
      "/portal/dashboard", "/portal/curriculum", "/portal/training", "/portal/classes",
      "/portal/coaching", "/portal/coaching/analytics", "/portal/account",
    ]);
  });

  it("highlights the active item", async () => {
    renderNav(TEACHER, "/portal/training", true);
    const bar = await topBar();
    const active = within(bar).getByRole("link", { name: "Training" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.className).toMatch(/\btext-white\b/);
    expect(active.querySelector("svg")?.getAttribute("class")).toMatch(/\btext-nu-leaf\b/);
    expect(within(bar).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the My account link (her name) and Logout", async () => {
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await topBar();
    const account = within(bar).getByTestId("portal-user-name");
    expect(account).toHaveAttribute("href", "/portal/account");
    expect(account).toHaveTextContent("Ayesha");
    await userEvent.setup().click(within(bar).getByRole("button", { name: "Logout" }));
    expect(logout).toHaveBeenCalledTimes(1);
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

  it("a coach's bars are indigo, and her active place is lit the new way", async () => {
    renderNav(COACH, "/portal/leader", true);
    expect((await topBar()).className).toMatch(/\bbg-nu-ink\b/);
    expect((await bottomBar()).className).toMatch(/\bbg-nu-ink\b/);
    expect(within(await topBar()).getByRole("link", { name: "My Patch" })).toHaveAttribute("aria-current", "page");
    // Today a leader's phone bar holds only the titles named in MOBILE_PRIMARY
    // (just Training) and the rest sit behind the tray — unchanged here, so
    // My Patch is in the sheet and the More button is the lit one.
    const more = within(await bottomBar()).getByRole("button", { name: "More" });
    expect(more.className).toMatch(/\btext-white\b/);
  });
});

describe("flag on — Urdu (RTL)", () => {
  const PHYSICAL = /(^|\s)(-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|border-[lr](\s|-|$)|rounded-[lr]-)/;

  it("renders the same labels under dir=rtl, the way the nav renders them today", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    document.documentElement.setAttribute("lang", "ur");
    renderNav(TEACHER, "/portal/dashboard", true);
    const bar = await bottomBar();
    expect(linksOf(bar).map(([label]) => label)).toEqual(["Home", "Lessons", "Training", "Coaching"]);
    expect(within(bar).getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("uses only logical (start/end) spacing, so the bars mirror themselves in RTL", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    renderNav(TEACHER, "/portal/dashboard", true);
    for (const bar of [await bottomBar(), await topBar()]) {
      for (const el of [bar, ...bar.querySelectorAll<HTMLElement>("*")]) {
        const cls = el.getAttribute("class") || "";
        expect(cls, el.outerHTML.slice(0, 120)).not.toMatch(PHYSICAL);
      }
    }
  });

  it("the sheet's rows use logical spacing and the chevron turns round in RTL", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    renderNav(TEACHER, "/portal/dashboard", true);
    await userEvent.setup().click(within(await bottomBar()).getByRole("button", { name: "More" }));
    const sheet = await screen.findByRole("dialog");
    const rows = within(sheet).getByTestId("newui-sheet-rows");
    for (const el of [rows, ...rows.querySelectorAll<HTMLElement>("*")]) {
      expect(el.getAttribute("class") || "").not.toMatch(PHYSICAL);
    }
    const account = within(sheet).getByTestId("mobile-nav-account");
    const chevron = account.querySelectorAll("svg")[1];
    expect(chevron.getAttribute("class")).toMatch(/rtl:rotate-180/);
  });
});
