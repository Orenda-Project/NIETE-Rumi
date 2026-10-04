import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { MODULES_C3, trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — a course's parts (deep-screens.html, Training 4). Teachers see "Part"; the
 * code's word is "module".
 *
 *   done   a green check tile, its duration and best score ("9/10", neutral)
 *   next   a play icon and a "Next" chip
 *   locked off, not tappable (the bot's lock)
 * Then the I-SAPS module-exam row and Recommended reading, and Continue at the bottom.
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {TRAINING_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<PortalTrainingPage view={r.view} />} />)}
      </Routes>
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

const GROUP_WORK = "/portal/training/provider/TALEEMABAD/level/2/course/c-3";
const parts = () => within(screen.getByRole("list", { name: "Parts" })).getAllByRole("listitem");

describe("Group Work", () => {
  it("the light bar: crumb 'Training · NIETE · Level 2', title the course; 'Parts 3/7'", async () => {
    renderAt(GROUP_WORK);
    expect(await screen.findByRole("heading", { level: 1, name: "Group Work" })).toBeInTheDocument();
    expect(screen.getByTestId("newui-crumb")).toHaveTextContent("Training · NIETE · Level 2");
    expect(screen.getByRole("heading", { level: 2, name: /Parts/ })).toHaveTextContent("3/7");
  });

  it("done: a green check, duration and best score (neutral); next: play and 'Next'; locked: off", async () => {
    renderAt(GROUP_WORK);
    await screen.findByText("Noise and rules");
    const [why, making, , noise, checking] = parts();

    expect(why.querySelector("[data-testid=newui-row-tile]")?.className).toContain("bg-nu-done-bg");
    expect(within(why).getByText("12 min")).toBeInTheDocument();
    await waitFor(() => expect(within(why).getByText("9/10")).toBeInTheDocument());
    // Best of two attempts.
    await waitFor(() => expect(within(making).getByText("7/10")).toBeInTheDocument());
    expect(within(why).getByText("9/10").closest("[data-chip]")?.className).toContain("bg-nu-chip-info-bg");

    expect(within(noise).getByText("Next")).toBeInTheDocument();
    expect(within(noise).getByText("9 min")).toBeInTheDocument();
    expect(noise.querySelector("[data-testid=newui-row-tile]")?.className).toContain("bg-nu-neutral-tile");
    expect(within(noise).getByRole("link")).toHaveAttribute("href", "/portal/training/unit/m-4");

    expect(within(checking).queryByRole("link")).not.toBeInTheDocument();
    expect(within(checking).getByRole("button")).toBeDisabled();
    expect(within(checking).getByText("11 min")).toBeInTheDocument();
  });

  it("a done part opens too", async () => {
    renderAt(GROUP_WORK);
    await screen.findByText("Why groups?");
    expect(within(parts()[0]).getByRole("link")).toHaveAttribute("href", "/portal/training/unit/m-1");
  });

  it("Continue at the bottom opens the next part", async () => {
    renderAt(GROUP_WORK);
    const cta = await screen.findByRole("link", { name: "Continue" });
    expect(cta).toHaveAttribute("href", "/portal/training/unit/m-4");
  });

  it("every part done: no Continue", async () => {
    vi.mocked(api.get).mockImplementation(trainingGet({
      "/training/modules": { modules: MODULES_C3.map((m) => ({ ...m, completed_at: "2026-10-02T00:00:00Z", lock: "passed" })), exam: null, readings: null },
    }) as never);
    renderAt(GROUP_WORK);
    await screen.findByText("Why groups?");
    expect(screen.queryByRole("link", { name: "Continue" })).not.toBeInTheDocument();
  });
});

describe("I-SAPS — the module exam row and Recommended reading", () => {
  const ISAPS_COURSE = "/portal/training/provider/ISAPS/level/9/course/c-9";
  const modules = (exam: unknown, readings: unknown = null) => trainingGet({
    "/training/courses": { courses: [{ id: "c-9", title: "Module 1", order_index: 0, module_count: 2, completed_count: 2 }] },
    "/training/modules": {
      modules: [
        { id: "u-1", title: "Unit 101", order_index: 0, duration_seconds: 600, has_video: true, has_audio: false, has_pdf: false, has_questions: true, completed_at: "2026-10-01T00:00:00Z", lock: "passed" },
        { id: "u-2", title: "Unit 102", order_index: 1, duration_seconds: 600, has_video: true, has_audio: false, has_pdf: false, has_questions: false, completed_at: "2026-10-02T00:00:00Z", lock: "passed" },
      ],
      exam,
      readings,
    },
  });

  it("an open exam is a row to the exam page", async () => {
    vi.mocked(api.get).mockImplementation(modules({ available: true, body: "Two questions.", caption: "", cta: "📝 Take the exam", module_no: 1 }) as never);
    renderAt(ISAPS_COURSE);
    const row = await screen.findByTestId("module-exam-row");
    expect(within(row).getByText("Module exam")).toBeInTheDocument();
    expect(within(row).getByText("Ready")).toBeInTheDocument();
    expect(row.closest("a")).toHaveAttribute("href", "/portal/training/exam/c-9");
  });

  it.each([
    ["passed", "✓ Passed", "Passed", true],
    ["being graded", "⏳ Being graded", "Being graded", true],
    ["locked", "🔒 Locked", "Locked", false],
  ])("%s: the gate's own word as a chip", async (_k, cta, chip, opens) => {
    vi.mocked(api.get).mockImplementation(modules({ available: false, body: "Gate words.", caption: "", cta, module_no: 1 }) as never);
    renderAt(ISAPS_COURSE);
    const row = await screen.findByTestId("module-exam-row");
    expect(within(row).getByText(chip)).toBeInTheDocument();
    expect(Boolean(row.closest("a"))).toBe(opens);
  });

  it("Recommended reading is a row; a tap lists what is online and what is coming", async () => {
    vi.mocked(api.get).mockImplementation(modules(null, {
      available: [{ title: "Teaching in groups", author: "A. Writer", type: "Book", description: "", url: "https://example.org/r1" }],
      unavailable: [{ title: "Classroom talk", author: "B. Writer", type: "Video", description: "", url: null }],
    }) as never);
    renderAt(ISAPS_COURSE);
    const row = await screen.findByTestId("readings-row");
    expect(within(row).getByText("Recommended reading")).toBeInTheDocument();
    expect(within(row).getByText("1 available")).toBeInTheDocument();
    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Teaching in groups")).toBeInTheDocument();
    expect(within(sheet).getByText("Classroom talk")).toBeInTheDocument();
    expect(within(sheet).getByText("Coming soon")).toBeInTheDocument();
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words (chips, labels, buttons) are labels — data is not copy", async () => {
    renderAt(GROUP_WORK);
    await screen.findByRole("link", { name: "Continue" });
    expect(tapProblems(document.body)).toEqual([]);
    for (const el of Array.from(document.body.querySelectorAll("[data-chip], h2, [data-testid=newui-bottom-actions] a, [data-testid=newui-bottom-actions] button"))) {
      expect(copyProblem(el.textContent?.trim() || ""), el.textContent || "").toBeNull();
    }
  });
});
