import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/** A teacher's menu reaches her own Attendance page (operator, 2026-09-30). */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "../hooks/useAuth";
import PortalNavigation from "./PortalNavigation";

it("a teacher's menu has Attendance, pointing at her own page", () => {
  (useAuth as any).mockReturnValue({ user: { firstName: "Ayesha", role: "teacher" }, loading: false, logout: vi.fn() });
  render(<MemoryRouter><PortalNavigation /></MemoryRouter>);
  const links = screen.getAllByRole("link", { name: /Attendance/ });
  expect(links.length).toBeGreaterThan(0);
  for (const l of links) expect(l).toHaveAttribute("href", "/portal/attendance");
});
