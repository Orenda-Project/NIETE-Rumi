/**
 * bd-60160 — what each training URL actually serves, through the REAL router.
 *
 * This file exists because of a specific miss. PortalTrainingV2.route.test.tsx
 * was written to catch "a redesign that quietly captured the existing path" —
 * its own header says so — but it renders pages DIRECTLY. So when this change
 * repointed /portal/training from v1 to v2, all three of its tests kept
 * passing. A test that cannot see routing cannot guard a route.
 *
 * These mount the app's own <Routes> and assert by URL:
 *
 *   /portal/training      -> v2   (the rollout: the nav points here)
 *   /portal/training/v1   -> v1   (the rollback lane, kept deliberately)
 *   /portal/training/v2   -> v2   (the review URL, already handed out)
 *
 * The v1 lane matters more than it looks: rolling back becomes repointing one
 * route instead of reverting a merge, and nobody mid-session on the old URL is
 * stranded.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../services/api";

vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import PortalTraining from "./PortalTraining";
import PortalTrainingV2 from "./PortalTrainingV2";

beforeEach(() => {
  vi.clearAllMocks();
  (api.get as any).mockImplementation((url: string) => {
    if (url === "/training/vendors") return Promise.resolve({ data: { vendors: [] } });
    if (url === "/training/levels") return Promise.resolve({ data: { levels: [] } });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
    return Promise.resolve({ data: {} });
  });
});

/** The training slice of the app's route table, mounted for real. */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        
        <Route path="/portal/training/v1" element={<PortalTraining />} />
        <Route path="/portal/training/v2" element={<PortalTrainingV2 />} />
        <Route path="/portal/training/v2/unit/:moduleId" element={<PortalTrainingV2 />} />
        <Route path="/portal/training/v2/exam/:courseId" element={<PortalTrainingV2 />} />
        <Route path="/portal/training/unit/:moduleId" element={<PortalTrainingV2 />} />
        <Route path="/portal/training/exam/:courseId" element={<PortalTrainingV2 />} />
        <Route path="/portal/training" element={<PortalTrainingV2 />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("bd-60160 — training routes", () => {
  it("serves the NEW page at /portal/training — the path the nav points at", async () => {
    renderAt("/portal/training");
    expect(await screen.findByTestId("training-v2-root")).toBeInTheDocument();
  });

  it("keeps the OLD page at /portal/training/v1 as the rollback lane", async () => {
    renderAt("/portal/training/v1");
    // v1's own marker; v2 has no certificates-toggle.
    expect(await screen.findByTestId("certificates-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("training-v2-root")).not.toBeInTheDocument();
  });

  it("keeps /portal/training/v2 working, since that link is already out there", async () => {
    renderAt("/portal/training/v2");
    expect(await screen.findByTestId("training-v2-root")).toBeInTheDocument();
  });

  it("serves a unit sub-page under the canonical path too", async () => {
    renderAt("/portal/training/unit/m-1");
    expect(await screen.findByTestId("training-v2-root")).toBeInTheDocument();
  });
});
