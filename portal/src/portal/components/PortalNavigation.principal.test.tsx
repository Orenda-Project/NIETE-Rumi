import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-60117 — a principal gets an Analytics tab; the rest of the leader family
 * does not.
 *
 * The leader nav has no Analytics entry at all today, so a principal had no
 * route to her school's numbers. It is added for principals ONLY: the other
 * four leader roles are multi-school, and a single school's numbers presented
 * to an AEO would be a confident wrong answer.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "../hooks/useAuth";
import PortalNavigation from "./PortalNavigation";

function renderNav(user: any) {
  (useAuth as any).mockReturnValue({ user, loading: false, logout: vi.fn() });
  render(<MemoryRouter><PortalNavigation /></MemoryRouter>);
}

describe("PortalNavigation — principal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives a principal the leader nav PLUS Analytics", () => {
    renderNav({ firstName: "Nosheen", role: "principal" });
    expect(screen.queryAllByText("My Patch").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Analytics").length).toBeGreaterThan(0);
  });

  it("points a principal's Analytics at the SCHOOL view, not the teacher one", () => {
    renderNav({ firstName: "Nosheen", role: "principal" });
    const links = screen.getAllByRole("link", { name: /Analytics/ });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((l) => expect(l).toHaveAttribute("href", "/portal/leader/school-analytics"));
  });

  it("does NOT give a coach an Analytics tab — her patch spans many schools", () => {
    renderNav({ firstName: "Noor", role: "coach" });
    expect(screen.queryAllByText("My Patch").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Analytics")).toHaveLength(0);
  });

  it("leaves the teacher nav untouched — still the teacher analytics route", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    const links = screen.getAllByRole("link", { name: /Analytics/ });
    links.forEach((l) => expect(l).toHaveAttribute("href", "/portal/coaching/analytics"));
  });
});
