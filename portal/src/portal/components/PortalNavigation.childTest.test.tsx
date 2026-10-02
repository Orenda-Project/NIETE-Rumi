import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-s1oo0.7 — the child-test page is reachable from the nav for the leader
// family when, and only when, the portal_child_test flag is on for them.

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ portal: { getConfig: vi.fn() } }));
import { useAuth } from "../hooks/useAuth";
import { portal } from "../services/api";
import PortalNavigation from "./PortalNavigation";

function renderNav(user: any, childTest: boolean) {
  (useAuth as any).mockReturnValue({ user, logout: vi.fn() });
  (portal.getConfig as any).mockResolvedValue({ features: { childTest } });
  render(<MemoryRouter><PortalNavigation /></MemoryRouter>);
}

describe("PortalNavigation — Child test", () => {
  it("a coach with the flag on gets a Child test link", async () => {
    renderNav({ firstName: "A", role: "coach" }, true);
    await waitFor(() => {
      const links = screen.getAllByRole("link", { name: /child test/i });
      expect(links.some((l) => l.getAttribute("href") === "/portal/leader/child-test")).toBe(true);
    });
  });

  it("no link with the flag off", async () => {
    renderNav({ firstName: "A", role: "coach" }, false);
    await waitFor(() => expect(portal.getConfig).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /child test/i })).toBeNull();
  });

  it("a teacher never gets it, flag or not", async () => {
    renderNav({ firstName: "T", role: "teacher" }, true);
    await waitFor(() => expect(portal.getConfig).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /child test/i })).toBeNull();
  });
});
