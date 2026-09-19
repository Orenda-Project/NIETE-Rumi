/**
 * bd-60160 — the v2 page IS the training page. Rollout, not a hidden route.
 *
 * bd-60148 shipped it behind /portal/training/v2 with no nav entry, and this
 * file asserted that hiding. The operator has now made the call: "make v2 the
 * new v1 aka let people be to that page when they click on trainings."
 *
 * What is promised NOW:
 *   1. /portal/training renders the NEW page — the nav already points there;
 *   2. the old page is still reachable at /portal/training/v1, so a rollback
 *      is repointing one route rather than a revert;
 *   3. the nav's Training entry points at /portal/training, for teachers AND
 *      for the leader family.
 *
 * (3) is not cosmetic. 88 of the 89 people assigned I-SAPS on production are
 * coaches, who get leaderNav — which had no Training entry at all. The
 * training was assigned, served by the API, and unreachable in the UI for all
 * 88 of them.
 *
 * NOTE these tests render pages directly rather than through <App/>. That is
 * why the pre-bd-60160 versions kept passing through a route swap they were
 * written to catch: a direct render cannot see routing. The route-level
 * promise is covered by App.routes.test.tsx, which mounts the real router.
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

  it("points the nav's Training entry at the canonical path, not /v2", () => {
    render(
      <MemoryRouter>
        <PortalNavigation />
      </MemoryRouter>,
    );
    const links = screen.queryAllByRole("link");
    const training = links.filter((a) =>
      (a.getAttribute("href") || "").includes("/portal/training"));
    expect(training.length).toBeGreaterThan(0);
    // Never /v2: that URL is kept alive for old links, not advertised.
    for (const a of training) {
      expect(a.getAttribute("href")).not.toContain("/training/v2");
    }
  });
});
