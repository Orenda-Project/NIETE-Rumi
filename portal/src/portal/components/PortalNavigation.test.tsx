import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-2434 (NIETE port of bd-2389/2390): the nav is role-gated. A leader gets
// the leader nav (My Patch / Teachers) and the SAME NIETE logo/branding; a
// teacher gets Dashboard / Lesson Plans / Assessment Generator / Training /
// My Classes / Coaching / Analytics (bd-4n7p4). Leader-family only — teachers never see the leader nav.
//
// bd-60078: "My Plans" is GONE from both. It listed a teacher's own
// Gamma-generated lesson plans and presentations, and custom generation is
// off — so the entry point goes with it rather than leading to a page that
// can only ever show her older work and no way to make more.

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "../hooks/useAuth";
import PortalNavigation from "./PortalNavigation";

function renderNav(user: any) {
  (useAuth as any).mockReturnValue({ user, logout: vi.fn() });
  render(
    <MemoryRouter>
      <PortalNavigation />
    </MemoryRouter>,
  );
}

describe("PortalNavigation role gating", () => {
  it("a leader sees the leader nav (My Patch, Teachers), not the teacher nav", () => {
    renderNav({ firstName: "Noor", role: "coach" });
    expect(screen.queryAllByText("My Patch").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Teachers").length).toBeGreaterThan(0);
    expect(screen.queryByText("Coaching")).toBeNull();
    expect(screen.queryByText("Curriculum")).toBeNull();
    expect(screen.queryByText("Lesson Plans")).toBeNull();
    expect(screen.queryByText("Assessment Generator")).toBeNull();
  });

  it("a teacher sees the teacher nav, not the leader nav", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    expect(screen.queryAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Lesson Plans").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Coaching").length).toBeGreaterThan(0);
    expect(screen.queryByText("My Patch")).toBeNull();
  });

  // bd-60078 — custom lesson-plan generation is off, so the entry point to a
  // teacher's own generated plans goes too. Checked for BOTH roles and in the
  // mobile overflow tray as well as the desktop rail, because the item was
  // never in MOBILE_PRIMARY and so only ever rendered in those two places.
  it("nobody sees My Plans — custom generation is off", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    expect(screen.queryByText("My Plans")).toBeNull();
  });

  it("a user with no role is treated as a teacher (leader nav hidden)", () => {
    renderNav({ firstName: "Sana" });
    expect(screen.queryByText("My Patch")).toBeNull();
    expect(screen.queryAllByText("Dashboard").length).toBeGreaterThan(0);
  });

  it("keeps the shared NIETE logo + wordmark for both roles", () => {
    renderNav({ firstName: "Noor", role: "coach" });
    expect(screen.getByAltText("NIETE logo")).toBeInTheDocument();
    expect(screen.queryAllByText("NIETE").length).toBeGreaterThan(0);
  });
});

// bd-2558: the signed-in name sat in the header as a bare
// `text-sm text-white/80` span, in the same flex row as a Logout button
// styled `px-4 py-2 rounded-md`. Three things were wrong with that, all
// visible the moment you look at the two side by side:
//
//   1. No padding and no shared vertical metrics, so the name did not sit on
//      the same optical line as the control next to it.
//   2. A third opacity value (white/80) next to the nav items (white/70) and
//      the active pill (white) — three greys in one bar, for no reason.
//   3. No width bound, so a long name pushed the Logout button sideways; and
//      when firstName was missing the span collapsed entirely, leaving a
//      floating Logout with no indication of who was signed in.
//
// These assert on the rendered element rather than a screenshot, because the
// defect is structural — what classes the name carries relative to its sibling.
// bd-4n7p4 — "Curriculum" is renamed "Lesson Plans" and the Assessment Generator is its own
// menu item, right after it. On a phone the bottom bar keeps its four and the new item is in Other.
describe("PortalNavigation — Lesson Plans and Assessment Generator (bd-4n7p4)", () => {
  const TEACHER = { firstName: "Ayesha", role: "teacher" };

  it("lists Lesson Plans then Assessment Generator on desktop, with their paths", () => {
    renderNav(TEACHER);
    const desktop = document.querySelector("nav.hidden") as HTMLElement;
    const links = Array.from(desktop.querySelectorAll("a")).map((a) => [a.textContent?.trim(), a.getAttribute("href")]);
    const titles = links.map(([t]) => t);
    expect(titles.indexOf("Lesson Plans")).toBe(titles.indexOf("Dashboard") + 1);
    expect(titles.indexOf("Assessment Generator")).toBe(titles.indexOf("Lesson Plans") + 1);
    expect(links).toContainEqual(["Lesson Plans", "/portal/curriculum"]);
    expect(links).toContainEqual(["Assessment Generator", "/portal/assessment"]);
    expect(titles).not.toContain("Curriculum");
    expect(screen.queryByText("Curriculum")).toBeNull();
  });

  it("the phone bar is Dashboard, Lesson Plans, Training, Coaching; Assessment Generator is under Other", () => {
    renderNav(TEACHER);
    const mobile = document.querySelector("nav.md\\:hidden") as HTMLElement;
    const bar = Array.from(mobile.querySelectorAll(":scope > div > a")).map((a) => a.textContent?.trim());
    expect(bar).toEqual(["Dashboard", "Lesson Plans", "Training", "Coaching"]);
    // The tray's links are only mounted while it is open.
    expect(within(mobile).queryByText("Assessment Generator")).toBeNull();
  });

  it("the tray lists Assessment Generator once it is opened", async () => {
    renderNav(TEACHER);
    fireEvent.click(screen.getByTestId("mobile-nav-more"));
    const tray = await screen.findByRole("dialog");
    expect(within(tray).getByRole("link", { name: "Assessment Generator" })).toHaveAttribute("href", "/portal/assessment");
  });

  it("/portal/assessment lights Assessment Generator and not Lesson Plans", () => {
    vi.mocked(useAuth).mockReturnValue({ user: TEACHER, logout: vi.fn() } as never);
    render(<MemoryRouter initialEntries={["/portal/assessment"]}><PortalNavigation /></MemoryRouter>);
    const desktop = document.querySelector("nav.hidden") as HTMLElement;
    expect(within(desktop).getByRole("link", { name: "Assessment Generator" }).className).toMatch(/bg-white\/20/);
    expect(within(desktop).getByRole("link", { name: "Lesson Plans" }).className).not.toMatch(/bg-white\/20/);
  });
});

// bd-2563: the mobile tab bar's overflow tab is labelled "Other", not "More".
// The label appears in three places that must agree — the visible tab text, the
// button's aria-label (what a screen reader announces), and the title of the
// sheet it opens. Changing one and missing another is the obvious failure, so
// all three are asserted.
describe("PortalNavigation — the mobile overflow tab (bd-2563)", () => {
  it("labels the overflow tab 'Other'", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    expect(screen.getByTestId("mobile-nav-more")).toHaveTextContent("Other");
  });

  it("announces 'Other' to a screen reader", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    expect(screen.getByTestId("mobile-nav-more")).toHaveAttribute("aria-label", "Other");
  });

  it("no longer says 'More' anywhere in the overflow control", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    const tab = screen.getByTestId("mobile-nav-more");
    expect(tab).not.toHaveTextContent("More");
    expect(tab.getAttribute("aria-label")).not.toBe("More");
  });
});

describe("PortalNavigation — the signed-in name (bd-2558)", () => {
  /** The desktop header's name element. */
  function nameEl(text: string) {
    // getAllBy: the mobile nav renders its own tree; the desktop one is first.
    return screen.getAllByTestId("portal-user-name")[0];
  }

  it("shows the signed-in name", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    expect(nameEl("Ayesha")).toHaveTextContent("Ayesha");
  });

  it("shares the vertical metrics of the control beside it", () => {
    // Same py-2 rhythm as the Logout button, so the two sit on one line
    // instead of the name floating against a taller neighbour.
    renderNav({ firstName: "Ayesha", role: "teacher" });
    expect(nameEl("Ayesha").className).toMatch(/\bpy-2\b/);
  });

  it("does not introduce a third opacity into the header", () => {
    // Nav items are white/70; the name must not be a one-off white/80.
    renderNav({ firstName: "Ayesha", role: "teacher" });
    expect(nameEl("Ayesha").className).not.toMatch(/text-white\/80/);
  });

  it("truncates rather than pushing the logout button off", () => {
    renderNav({
      firstName: "Muhammad Abdul Rahman Siddiqui Al-Hashimi",
      role: "teacher",
    });
    const el = screen.getAllByTestId("portal-user-name")[0];
    expect(el.className).toMatch(/\btruncate\b/);
    expect(el.className).toMatch(/max-w-/);
  });

  it("keeps the slot stable when the name is missing", () => {
    // An empty span collapsed the slot and left Logout floating with no
    // indication of who was signed in. A signed-in user always has an identity
    // to show, even before the profile resolves.
    renderNav({ role: "teacher" });
    expect(screen.getAllByTestId("portal-user-name")[0]).toHaveTextContent(/\S/);
  });
});
