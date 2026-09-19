import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60160 — the leader family can reach Training.
 *
 * Operator: "let coaches see and do the trainings too, which they can do from
 * the portal so this should be possible."
 *
 * It was not possible, and the reason was one missing array entry. The nav
 * splits into teacherNav and leaderNav, and leaderNav had no Training item at
 * all — so every coach, AEO, supervisor, principal and school leader had no
 * link to the training pages.
 *
 * The cost was measured, not hypothetical: of the 89 people assigned I-SAPS on
 * production, 88 are coaches. The training was assigned, the API served it
 * (the training routes check the session, never the role), and not one of
 * those 88 had a way to open it.
 *
 * A coach TAKES training; she does not only supervise it. Same entry, same
 * path, same page as a teacher's.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "../hooks/useAuth";
import PortalNavigation from "./PortalNavigation";

function renderNav(user: any) {
  (useAuth as any).mockReturnValue({ user, loading: false, logout: vi.fn() });
  render(<MemoryRouter><PortalNavigation /></MemoryRouter>);
}

const LEADER_ROLES = ["coach", "aeo", "supervisor", "principal", "school_leader"];

describe("bd-60160 — Training in the nav", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(LEADER_ROLES)("gives a %s a Training entry", (role) => {
    renderNav({ firstName: "Noor", role });
    expect(screen.queryAllByText("Training").length).toBeGreaterThan(0);
  });

  it("points a coach's Training at the same page a teacher gets", () => {
    renderNav({ firstName: "Noor", role: "coach" });
    const links = screen.getAllByRole("link", { name: /Training/ });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((l) => expect(l).toHaveAttribute("href", "/portal/training"));
  });

  it("still gives a teacher her Training entry, unchanged", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    const links = screen.getAllByRole("link", { name: /Training/ });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((l) => expect(l).toHaveAttribute("href", "/portal/training"));
  });

  it("leaves the leader family's own entries in place", () => {
    renderNav({ firstName: "Noor", role: "coach" });
    expect(screen.queryAllByText("My Patch").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Teachers").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Observations").length).toBeGreaterThan(0);
  });
});
