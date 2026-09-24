import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60174 (STEPS v1.1, principal-dashboard feedback items 4 and 5).
 *
 * Reported as "every section should be clickable" and "the current navigation
 * does not guide the user". The mechanism underneath both is narrow and
 * checkable: a principal has SIX leader routes but only FOUR nav entries.
 * Attendance and Lessons exist, are principal-gated, and are reachable only by
 * an in-page link from Analytics — so a principal who lands anywhere else has
 * no route to either.
 *
 * This repo has already paid for this exact bug once. From PortalNavigation
 * itself, on Training: "assigned, visible to the API, and with no link anywhere
 * in the UI. The gate was never a permission — it was a missing nav item." That
 * was 88 coaches. This is the same shape, on two more pages.
 *
 * The other four leader roles (coach, aeo, supervisor, school_leader) cover
 * many schools, so a single school's attendance is not their question and the
 * endpoint 403s them. These entries are principal-only, exactly like Analytics.
 */

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

/** Every leader route a principal can legitimately open, with its nav label. */
const PRINCIPAL_DESTINATIONS = [
  { label: /my patch/i, path: "/portal/leader" },
  { label: /teachers/i, path: "/portal/leader/teachers" },
  { label: /observations/i, path: "/portal/leader/observations" },
  { label: /analytics/i, path: "/portal/leader/school-analytics" },
  { label: /attendance/i, path: "/portal/leader/attendance" },
  { label: /lessons/i, path: "/portal/leader/lessons" },
];

describe("PortalNavigation — a principal can reach every page she owns (bd-60174)", () => {
  it("offers a nav entry for all six principal destinations", () => {
    renderNav({ firstName: "Atifa", role: "principal" });
    for (const dest of PRINCIPAL_DESTINATIONS) {
      const links = screen.getAllByRole("link", { name: dest.label });
      expect(
        links.some((el) => el.getAttribute("href") === dest.path),
        `no nav link to ${dest.path}`,
      ).toBe(true);
    }
  });

  it("keeps attendance and lessons away from the multi-school roles", () => {
    // A coach covers many schools, so one school's register is not her view —
    // the endpoint 403s her, and the nav should not offer the trip.
    renderNav({ firstName: "Noor", role: "coach" });
    expect(screen.queryByRole("link", { name: /attendance/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /lessons/i })).toBeNull();
  });
});
