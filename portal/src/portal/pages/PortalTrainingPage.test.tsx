import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { resetNewUiMemory } from "../lib/useNewUi";
import { TRAINING_ROUTES, TRAINING_V2_PATHS } from "../lib/trainingRoutes";
import { trainingGet } from "../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — which Training a teacher gets, through the route table App.tsx mounts.
 *
 *   flag on, teacher        the new screens, where they are built; a page not built yet is
 *                           the old page at the same address, so nothing is unreachable
 *   flag off / a leader     the old page at every old address (PortalTrainingV2.flagOff pins
 *                           the markup); a NEW address goes to the old page it stands for
 *   every old address       still served (deep links and App Links: /portal/training…)
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  portal: { getConfig: vi.fn() },
}));

import { useAuth } from "../hooks/useAuth";
import api, { portal } from "../services/api";
import PortalTrainingPage from "./PortalTrainingPage";

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
const where = () => screen.getByTestId("where").textContent;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {TRAINING_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<PortalTrainingPage view={r.view} />} />)}
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

function setUp(newUi: boolean, role = "teacher") {
  resetNewUiMemory();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", role, phoneNumber: "923001234567" }, loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(trainingGet() as never);
});

describe("the route table", () => {
  it("serves every old training address, under both bases", () => {
    const served = TRAINING_ROUTES.map((r) => r.path);
    for (const p of TRAINING_V2_PATHS) expect(served).toContain(p);
  });

  it("adds My grades, the level exam page and the quick check, under both bases", () => {
    const served = TRAINING_ROUTES.map((r) => r.path);
    for (const base of ["/portal/training", "/portal/training/v2"]) {
      expect(served).toContain(`${base}/grades`);
      expect(served).toContain(`${base}/provider/:vendorKey/level/:levelId/exam`);
      expect(served).toContain(`${base}/unit/:moduleId/quiz`);
    }
  });
});

describe("flag on, a teacher", () => {
  beforeEach(() => setUp(true));

  it.each([
    ["/portal/training", "newui-main-heading"],
    ["/portal/training/v2", "newui-main-heading"],
    ["/portal/training/provider/TALEEMABAD", "newui-inner-bar"],
    ["/portal/training/provider/TALEEMABAD/level/2", "newui-inner-bar"],
    ["/portal/training/provider/TALEEMABAD/level/2/course/c-3", "newui-inner-bar"],
    ["/portal/training/unit/m-4", "newui-inner-bar"],
    ["/portal/training/unit/m-4/quiz", "newui-inner-bar"],
  ])("%s is a new screen", async (path, testId) => {
    renderAt(path);
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    expect(screen.queryByTestId("training-v2-root")).not.toBeInTheDocument();
  });

  it.each([
    "/portal/training/exam/c-9",
  ])("%s, not built yet, is the old page at the same address", async (path) => {
    renderAt(path);
    expect(await screen.findByTestId("training-v2-root")).toBeInTheDocument();
    expect(where()).toBe(path);
  });
});

describe("flag off", () => {
  beforeEach(() => setUp(false));

  it.each([
    "/portal/training",
    "/portal/training/provider/TALEEMABAD/level/2",
    "/portal/training/unit/m-4",
  ])("%s is the old page", async (path) => {
    renderAt(path);
    expect(await screen.findByTestId("training-v2-root")).toBeInTheDocument();
    expect(screen.queryByTestId("newui-main-heading")).not.toBeInTheDocument();
    expect(where()).toBe(path);
  });

  it.each([
    ["/portal/training/grades", "/portal/training"],
    ["/portal/training/v2/grades", "/portal/training/v2"],
    ["/portal/training/provider/TALEEMABAD/level/2/exam", "/portal/training/provider/TALEEMABAD/level/2"],
    ["/portal/training/unit/m-4/quiz", "/portal/training/unit/m-4"],
  ])("a new address, %s, goes to the old page it stands for (%s)", async (path, to) => {
    renderAt(path);
    await waitFor(() => expect(where()).toBe(to));
    expect(await screen.findByTestId("training-v2-root")).toBeInTheDocument();
  });
});

describe("a school leader, flag on", () => {
  it("keeps the old page", async () => {
    setUp(true, "principal");
    renderAt("/portal/training");
    expect(await screen.findByTestId("training-v2-root")).toBeInTheDocument();
    await waitFor(() => expect(portal.getConfig).toHaveBeenCalled());
    expect(screen.queryByTestId("newui-main-heading")).not.toBeInTheDocument();
  });
});
