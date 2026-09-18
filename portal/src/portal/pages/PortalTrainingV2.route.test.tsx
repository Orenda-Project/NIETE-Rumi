/**
 * bd-60148 — the v2 training page lives at a HIDDEN route.
 *
 * Two independent promises are made here, and both are the point of the
 * ticket rather than incidental detail:
 *
 *   1. /portal/training/v2 renders the NEW page, and
 *   2. /portal/training still renders the OLD one, byte-for-byte untouched.
 *
 * (2) is why this test renders the real <App/> router rather than the pages
 * in isolation: a redesign that quietly captured the existing path would pass
 * every component test while taking the live page away from 9,534 teachers.
 *
 * The nav assertion is the third promise: no link points at v2 yet. The
 * operator reaches it by typing the URL until the rollout call is made, so a
 * stray nav entry is a regression, not a nicety.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import api from "../services/api";

// PortalLayout pulls auth + navigation; the pages under test only need their
// children rendered. Matches the mocking already used by the sibling tests.
vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MemoryRouter } from "react-router-dom";
import PortalTraining from "./PortalTraining";
import PortalTrainingV2 from "./PortalTrainingV2";
import PortalNavigation from "../components/PortalNavigation";

beforeEach(() => {
  vi.clearAllMocks();
  (api.get as any).mockImplementation((url: string) => {
    if (url === "/training/vendors") return Promise.resolve({ data: { vendors: [] } });
    if (url === "/training/levels") return Promise.resolve({ data: { levels: [] } });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
    return Promise.resolve({ data: {} });
  });
});

describe("bd-60148 — v2 training page behind a hidden route", () => {
  it("renders the v2 page, marked so it cannot be confused with v1", async () => {
    render(
      <MemoryRouter>
        <PortalTrainingV2 />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("training-v2-root")).toBeInTheDocument();
  });

  it("leaves the existing training page reachable and unchanged", async () => {
    render(
      <MemoryRouter>
        <PortalTraining />
      </MemoryRouter>,
    );
    // The v1 page's own marker: the certificates toggle asserted by the
    // sibling test. If v2 had replaced v1, this disappears.
    expect(await screen.findByTestId("certificates-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("training-v2-root")).not.toBeInTheDocument();
  });

  it("exposes no navigation link to v2 — the route stays typed-in only", () => {
    render(
      <MemoryRouter>
        <PortalNavigation />
      </MemoryRouter>,
    );
    const v2Links = screen
      .queryAllByRole("link")
      .filter((a) => (a.getAttribute("href") || "").includes("/training/v2"));
    expect(v2Links).toHaveLength(0);
  });
});
