import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — a provider's levels (deep-screens.html, Training 2): the light bar with the
 * breadcrumb "Training", then one row per level.
 *
 *   NIETE is a ladder:  done → a "Certified" chip; current → a neutral number badge, "2/5"
 *                       and a bar; locked → a lock, "Pass 2", and the row is off.
 *   Beacon House levels are SUBJECTS, open in any order: no numbers, no locks.
 *   I-SAPS and Oxbridge have one level: the page goes straight to it.
 */

// The first render of a file loads the whole page module; give it longer than 1s under a busy run.
configure({ asyncUtilTimeout: 5000 });

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  portal: { getConfig: vi.fn() },
}));

import { useAuth } from "../../hooks/useAuth";
import api, { portal } from "../../services/api";
import PortalTrainingPage from "../../pages/PortalTrainingPage";
import { TRAINING_ROUTES } from "../../lib/trainingRoutes";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "923001234567" }, loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(api.get).mockImplementation(trainingGet() as never);
});

const levelRows = () => within(screen.getByRole("list", { name: "Levels" })).getAllByRole("listitem");

describe("NIETE — a ladder", () => {
  it("an inner page: the light bar, crumb 'Training', title 'NIETE'", async () => {
    renderAt("/portal/training/provider/TALEEMABAD");
    expect(await screen.findByRole("heading", { level: 1, name: "NIETE" })).toBeInTheDocument();
    expect(screen.getByTestId("newui-inner-bar")).toBeInTheDocument();
    expect(screen.getByTestId("newui-crumb")).toHaveTextContent("Training");
  });

  it("done: a Certified chip; current: number badge, 2/5, a bar; locked: a lock, 'Pass 2', off", async () => {
    renderAt("/portal/training/provider/TALEEMABAD");
    await screen.findByText("Emerging");
    const [aspiring, emerging, skilled, leader] = levelRows();

    expect(within(aspiring).getByText("Certified")).toBeInTheDocument();
    expect(aspiring.querySelector("[data-testid=newui-row-tile]")?.textContent).toBe("1");
    expect(within(aspiring).getByRole("link")).toHaveAttribute("href", "/portal/training/provider/TALEEMABAD/level/1");

    const tile = emerging.querySelector("[data-testid=newui-row-tile]");
    expect(tile?.textContent).toBe("2");
    expect(tile?.className).toContain("bg-nu-neutral-tile");
    expect(within(emerging).getByText("2/5")).toBeInTheDocument();
    expect(within(emerging).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(within(emerging).getByRole("link")).toHaveAttribute("href", "/portal/training/provider/TALEEMABAD/level/2");

    expect(within(skilled).getByText("Pass 2")).toBeInTheDocument();
    expect(within(skilled).queryByRole("link")).not.toBeInTheDocument();
    expect(within(skilled).getByRole("button")).toBeDisabled();
    expect(within(leader).getByText("Pass 3")).toBeInTheDocument();
  });

  it("the bottom button continues the current level", async () => {
    renderAt("/portal/training/provider/TALEEMABAD");
    expect(await screen.findByRole("link", { name: "Continue Level 2" })).toHaveAttribute("href", "/portal/training/provider/TALEEMABAD/level/2");
  });
});

describe("Beacon House — subjects, any order", () => {
  it("no numbers, no locks, no ladder words", async () => {
    renderAt("/portal/training/provider/BEACONHOUSE");
    expect(await screen.findByRole("heading", { level: 1, name: "Beacon House" })).toBeInTheDocument();
    const [english, maths] = levelRows();
    expect(english.querySelector("[data-testid=newui-row-tile]")?.textContent).toBe("");
    expect(within(english).getByText("0/4")).toBeInTheDocument();
    expect(within(maths).getByRole("link")).toHaveAttribute("href", "/portal/training/provider/BEACONHOUSE/level/19");
    expect(screen.queryByText(/Pass \d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Level \d/)).not.toBeInTheDocument();
  });
});

describe("one level", () => {
  it.each([["ISAPS", 9], ["OXBRIDGE", 17]])("%s goes straight to its level page", async (key, id) => {
    renderAt(`/portal/training/provider/${key}`);
    await waitFor(() => expect(where()).toBe(`/portal/training/provider/${key}/level/${id}`));
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words (chips, labels, buttons) are labels — data is not copy", async () => {
    renderAt("/portal/training/provider/TALEEMABAD");
    await screen.findByRole("link", { name: "Continue Level 2" });
    expect(tapProblems(document.body)).toEqual([]);
    for (const el of Array.from(document.body.querySelectorAll("[data-chip], h2, [data-testid=newui-bottom-actions] a, [data-testid=newui-bottom-actions] button"))) {
      expect(copyProblem(el.textContent?.trim() || ""), el.textContent || "").toBeNull();
    }
  });
});
