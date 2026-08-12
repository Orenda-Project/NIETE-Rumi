import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-2434 (NIETE port of bd-2389/2390): the nav is role-gated. A leader gets
// the leader nav (My Patch / Teachers) and the SAME NIETE logo/branding; a
// teacher's nav is unchanged (Dashboard / Curriculum / My Plans / …).
// Leader-family only — teachers never see the leader nav.

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
    expect(screen.queryByText("My Plans")).toBeNull();
    expect(screen.queryByText("Coaching")).toBeNull();
    expect(screen.queryByText("Curriculum")).toBeNull();
  });

  it("a teacher sees today's nav unchanged (Dashboard, My Plans), not the leader nav", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    expect(screen.queryAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("My Plans").length).toBeGreaterThan(0);
    expect(screen.queryByText("My Patch")).toBeNull();
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
