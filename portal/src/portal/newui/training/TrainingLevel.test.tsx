import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { GATE_INCOMPLETE, httpError, trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — a level (deep-screens.html, Training 3): the level exam on top as a row
 * ("3 more courses" with a lock, or Ready), then the courses, each with its progress chip.
 * The I-SAPS level certificate and Beacon House's written-quiz result stay, as rows.
 * No sentences.
 */

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

const NIETE_L2 = "/portal/training/provider/TALEEMABAD/level/2";

describe("NIETE · Level 2", () => {
  it("the light bar: crumb 'Training · NIETE', title 'Level 2 · Emerging'", async () => {
    renderAt(NIETE_L2);
    expect(await screen.findByRole("heading", { level: 1, name: "Level 2 · Emerging" })).toBeInTheDocument();
    expect(screen.getByTestId("newui-crumb")).toHaveTextContent("Training · NIETE");
  });

  it("the level exam on top: '3 more courses' with a lock, information only", async () => {
    renderAt(NIETE_L2);
    const exam = await screen.findByTestId("level-exam-row");
    expect(within(exam).getByText("Level exam")).toBeInTheDocument();
    expect(within(exam).getByText("3 more courses")).toBeInTheDocument();
    expect(within(exam).queryByRole("link")).not.toBeInTheDocument();
    // It comes before the courses.
    const courses = screen.getByRole("list", { name: "Courses" });
    expect(exam.compareDocumentPosition(courses) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a ready exam is a row that opens the exam page", async () => {
    vi.mocked(api.get).mockImplementation(trainingGet({ "/training/level/2/grand-quiz": { grand_quiz: { ...GATE_INCOMPLETE, state: "ready" } } }) as never);
    renderAt(NIETE_L2);
    const exam = await screen.findByTestId("level-exam-row");
    await waitFor(() => expect(within(exam).getByText("Ready")).toBeInTheDocument());
    expect(within(exam).getByRole("link")).toHaveAttribute("href", `${NIETE_L2}/exam`);
  });

  it.each([
    ["passed", { state: "passed", passed_at: "2026-10-01T00:00:00Z" }, "Passed"],
    ["cooldown", { state: "cooldown", cooldown_until: new Date(Date.now() + 18 * 3_600_000).toISOString() }, "Wait 18h"],
  ])("%s: the row says so in a chip", async (_k, over, chip) => {
    vi.mocked(api.get).mockImplementation(trainingGet({ "/training/level/2/grand-quiz": { grand_quiz: { ...GATE_INCOMPLETE, ...over } } }) as never);
    renderAt(NIETE_L2);
    const exam = await screen.findByTestId("level-exam-row");
    await waitFor(() => expect(within(exam).getByText(chip)).toBeInTheDocument());
  });

  it("no exam configured: no row", async () => {
    vi.mocked(api.get).mockImplementation(trainingGet({ "/training/level/2/grand-quiz": { grand_quiz: { ...GATE_INCOMPLETE, state: "no_quiz" } } }) as never);
    renderAt(NIETE_L2);
    await screen.findByText("Group Work");
    expect(screen.queryByTestId("level-exam-row")).not.toBeInTheDocument();
  });

  it("courses: 'Courses 2/5'; Done chips; 3/7 with a bar; 0/6 without; each opens its course", async () => {
    renderAt(NIETE_L2);
    await screen.findByText("Group Work");
    expect(screen.getByRole("heading", { level: 2, name: /Courses/ })).toHaveTextContent("2/5");
    const [routines, , group, feedback] = within(screen.getByRole("list", { name: "Courses" })).getAllByRole("listitem");
    expect(within(routines).getByText("Done")).toBeInTheDocument();
    expect(routines.querySelector("[data-testid=newui-row-tile]")?.className).toContain("bg-nu-done-bg");
    expect(within(group).getByText("3/7")).toBeInTheDocument();
    expect(within(group).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "43");
    expect(within(feedback).getByText("0/6")).toBeInTheDocument();
    expect(within(feedback).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(group).getByRole("link")).toHaveAttribute("href", `${NIETE_L2}/course/c-3`);
  });

  it("a level still locked on the server says Locked, with the level to pass", async () => {
    vi.mocked(api.get).mockImplementation(trainingGet({
      "/training/courses": () => httpError(403, { error: "You need to pass Level 1's exam before this level opens", previous_level_order: 0 }),
    }) as never);
    renderAt(NIETE_L2);
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("Pass Level 1")).toBeInTheDocument();
    expect(screen.queryByText(/before this level opens/)).not.toBeInTheDocument();
  });
});

describe("I-SAPS — assessed per module", () => {
  const ISAPS = "/portal/training/provider/ISAPS/level/9";
  const certificate = (over: Record<string, unknown> = {}) => ({
    state: "locked", certificate: null, units_total: 54, units_done: 6, exams_total: 9, exams_done: 1, scores: null, ...over,
  });

  it("has no level exam row; its certificate is a row with the exams passed", async () => {
    vi.mocked(api.get).mockImplementation(trainingGet({ "/training/level/9/certificate": certificate() }) as never);
    renderAt(ISAPS);
    const row = await screen.findByTestId("level-certificate-row");
    expect(within(row).getByText("Level certificate")).toBeInTheDocument();
    expect(within(row).getByText("1/9 exams")).toBeInTheDocument();
    expect(within(row).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "11");
    expect(screen.queryByTestId("level-exam-row")).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith("/training/level/9/grand-quiz", undefined);
  });

  it("every exam passed: Receive asks the server, which mints it", async () => {
    let issued = false;
    vi.mocked(api.get).mockImplementation(trainingGet({
      "/training/level/9/certificate": () => (issued
        ? certificate({ state: "issued", certificate: { certificate_code: "ISAPS-9", issued_at: "2026-10-03T00:00:00Z" } })
        : certificate({ exams_done: 9 })),
    }) as never);
    vi.mocked(api.post).mockImplementation((async () => { issued = true; return { data: { issued: true, certificate: { certificate_code: "ISAPS-9" } } }; }) as never);
    renderAt(ISAPS);
    const row = await screen.findByTestId("level-certificate-row");
    fireEvent.click(within(row).getByRole("button", { name: /Receive/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/training/level/9/certificate"));
    expect(await screen.findByTestId("level-certificate-download")).toBeInTheDocument();
  });
});

describe("Beacon House — the written quiz result", () => {
  it("is a row: score and Passed; a tap shows her answers and the feedback", async () => {
    vi.mocked(api.get).mockImplementation(trainingGet({
      "/training/level/18/grand-quiz": { grand_quiz: { ...GATE_INCOMPLETE, state: "no_quiz" } },
      "/training/level/18/capstone": {
        attempt: { id: "cap-1", status: "completed", is_passed: true, score: 18, total_score: 24, completed_at: "2026-09-30T00:00:00Z" },
        answers: [{ question_index: 0, question_text: "How do you open a lesson?", answer_text: "With a question.", answer_score: 4, feedback_text: "Good hook." }],
        pass_mark_pct: 70,
      },
    }) as never);
    renderAt("/portal/training/provider/BEACONHOUSE/level/18");
    const row = await screen.findByTestId("capstone-row");
    expect(within(row).getByText("Written quiz")).toBeInTheDocument();
    expect(within(row).getByText("18/24")).toBeInTheDocument();
    expect(within(row).getByText("Passed")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("How do you open a lesson?")).toBeInTheDocument();
    expect(within(sheet).getByText("With a question.")).toBeInTheDocument();
    expect(within(sheet).getByText("4/5")).toBeInTheDocument();
    expect(within(sheet).getByText("Good hook.")).toBeInTheDocument();
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words (chips, labels, buttons) are labels — data is not copy", async () => {
    renderAt(NIETE_L2);
    await screen.findByText("Group Work");
    expect(tapProblems(document.body)).toEqual([]);
    for (const el of Array.from(document.body.querySelectorAll("[data-chip], h2, [data-testid=newui-bottom-actions] a, [data-testid=newui-bottom-actions] button"))) {
      expect(copyProblem(el.textContent?.trim() || ""), el.textContent || "").toBeNull();
    }
  });
});
