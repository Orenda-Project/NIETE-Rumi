/**
 * bd-60148 — the rail is GATED on a vendor.
 *
 * v1 showed every level from every provider when no vendor was picked, and v2
 * inherited that. In a dropdown it was survivable; as a rail it puts all ten
 * levels from four providers in one flat grid — "Level 1 Aspiring Teacher"
 * next to "English" next to "Level 1: Novice" — with nothing saying which
 * belongs to whom, and two of them numbered "LEVEL 1".
 *
 * So: no vendor, no rail. Pick a provider first.
 *
 * bd-klecr — picking a provider now OPENS its own page (/provider/:key), and
 * there is no longer an exception for a teacher with one provider: every page
 * always shows (operator, 2026-10-02), so her single card is shown, not
 * skipped past.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import api from "../services/api";

vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { MemoryRouter, Routes, Route } from "react-router-dom";
import PortalTrainingV2 from "./PortalTrainingV2";
import { TRAINING_V2_PATHS } from "../lib/trainingRoutes";

function renderTraining() {
  return render(
    <MemoryRouter initialEntries={["/portal/training"]}>
      <Routes>
        {TRAINING_V2_PATHS.map(p => <Route key={p} path={p} element={<PortalTrainingV2 />} />)}
      </Routes>
    </MemoryRouter>,
  );
}

const VENDOR_NIETE = {
  vendor_key: "TALEEMABAD", vendor_name: "NIETE",
  level_count: 4, course_count: 36, module_count: 171,
  completed_module_count: 46, avg_score_pct: 86,
};
const VENDOR_BH = {
  vendor_key: "BEACONHOUSE", vendor_name: "Beacon House",
  level_count: 4, course_count: 20, module_count: 206,
  completed_module_count: 12, avg_score_pct: 71,
};

function level(id: number, name: string, vendor_key: string, order_index: number) {
  return {
    id, name, order_index, cpd_level: null, vendor_key,
    unlock_logic: "chain", state: "not_started" as const,
    module_count: 46, completed_count: 0,
    courses_total: 9, courses_completed: 0,
    passed_at: null, cooldown_until: null, previous_level_order: null,
  };
}

function mockApi(vendors: unknown[], levels: unknown[]) {
  (api.get as any).mockImplementation((url: string) => {
    if (url === "/training/vendors") return Promise.resolve({ data: { vendors } });
    if (url === "/training/levels") return Promise.resolve({ data: { levels } });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
    if (url === "/training/courses") return Promise.resolve({ data: { courses: [] } });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => vi.clearAllMocks());

describe("bd-60148 — the level rail is gated on a vendor", () => {
  it("shows NO levels until a provider is chosen", async () => {
    mockApi(
      [VENDOR_NIETE, VENDOR_BH],
      [level(1, "Aspiring Teacher", "TALEEMABAD", 0), level(9, "English", "BEACONHOUSE", 0)],
    );
    renderTraining();

    // The vendor cards are up...
    expect(await screen.findByTestId("vendor-card-TALEEMABAD")).toBeInTheDocument();
    // ...but nothing from either provider's ladder is on screen yet.
    expect(screen.queryByTestId("level-rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("level-card-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("level-card-9")).not.toBeInTheDocument();
  });

  it("shows only the chosen provider's levels once one is picked", async () => {
    // Two levels per provider: a lone level renders no rail at all (that is
    // the single-level collapse, covered separately), so a one-level fixture
    // would pass this test for the wrong reason.
    mockApi(
      [VENDOR_NIETE, VENDOR_BH],
      [
        level(1, "Aspiring Teacher", "TALEEMABAD", 0),
        level(2, "Emerging Practitioner", "TALEEMABAD", 1),
        level(9, "English", "BEACONHOUSE", 0),
        level(10, "Mathematics", "BEACONHOUSE", 1),
      ],
    );
    renderTraining();

    await userEvent.click(await screen.findByTestId("vendor-card-TALEEMABAD"));

    expect(await screen.findByTestId("level-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("level-card-2")).toBeInTheDocument();
    // The other provider's levels must NOT leak in.
    expect(screen.queryByTestId("level-card-9")).not.toBeInTheDocument();
    expect(screen.queryByTestId("level-card-10")).not.toBeInTheDocument();
  });

  it("shows a single provider's card rather than skipping to its levels", async () => {
    mockApi([VENDOR_NIETE], [level(1, "Aspiring Teacher", "TALEEMABAD", 0), level(2, "Emerging", "TALEEMABAD", 1)]);
    renderTraining();

    expect(await screen.findByTestId("vendor-card-TALEEMABAD")).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByTestId("level-rail")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("vendor-card-TALEEMABAD"));
    await waitFor(() => expect(screen.getByTestId("level-rail")).toBeInTheDocument());
    expect(screen.getByTestId("level-card-1")).toBeInTheDocument();
  });
});
