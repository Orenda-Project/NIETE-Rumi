import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { DETAIL_M4, MODULES_C3, QUESTIONS_M4, httpError, trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — a part (deep-screens.html, Training 5): the light bar (crumb "Training · Group
 * Work", the part's title); chips "Part 4/7" and "9 min"; the video, the audio, a Handout row
 * (PDF); a Quick check row; the green "Start quick check" — or "Mark done" when the part has no
 * quiz, which completes it exactly as the old page did (POST /training/module/:id/complete).
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

const PART = "/portal/training/unit/m-4";
const routes = (over: Record<string, unknown> = {}) => trainingGet({
  "/training/module/m-4": { module: DETAIL_M4 },
  "/training/module/m-4/questions": { questions: QUESTIONS_M4 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "923001234567" }, loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(api.get).mockImplementation(routes() as never);
});

describe("Noise and rules", () => {
  it("the light bar: crumb 'Training · Group Work', the part's title", async () => {
    renderAt(PART);
    expect(await screen.findByRole("heading", { level: 1, name: "Noise and rules" })).toBeInTheDocument();
    expect(screen.getByTestId("newui-crumb")).toHaveTextContent("Training · Group Work");
    expect(screen.queryByTestId("training-v2-root")).not.toBeInTheDocument();
  });

  it("chips 'Part 4/7' and '9 min'", async () => {
    renderAt(PART);
    expect(await screen.findByText("Part 4/7")).toBeInTheDocument();
    expect(screen.getAllByText("9 min")[0]).toBeInTheDocument();
  });

  it("the video, the audio, and the part's own text", async () => {
    renderAt(PART);
    await screen.findByText("Part 4/7");
    expect(document.querySelector("video")).toHaveAttribute("src", DETAIL_M4.video_url);
    expect(document.querySelector("audio")).toHaveAttribute("src", DETAIL_M4.audio_url);
    expect(screen.getByText("Agree a quiet signal before groups start.")).toBeInTheDocument();
  });

  it("a Handout row with a PDF chip opens the file", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderAt(PART);
    const handout = await screen.findByTestId("training-handout");
    expect(within(handout).getByText("Handout")).toBeInTheDocument();
    expect(within(handout).getByText("PDF")).toBeInTheDocument();
    fireEvent.click(handout);
    expect(click).toHaveBeenCalled();
    const a = click.mock.contexts[0] as HTMLAnchorElement;
    expect(a.href).toBe(DETAIL_M4.pdf_url);
    expect(a.target).toBe("_blank");
    click.mockRestore();
  });

  it("a Quick check row: '5 Q' and the best score so far", async () => {
    vi.mocked(api.get).mockImplementation(routes({
      "/training/module/m-4/attempts": { attempts: [{ id: "q1", completed_at: "2026-10-02T00:00:00Z", score: 3, max_score: 5, quiz_kind: "training_module" }] },
    }) as never);
    renderAt(PART);
    const row = await screen.findByTestId("training-quick-check");
    await waitFor(() => expect(within(row).getByText("5 Q")).toBeInTheDocument());
    await waitFor(() => expect(within(row).getByText("3/5")).toBeInTheDocument());
    expect(row).toHaveAttribute("href", "/portal/training/unit/m-4/quiz");
  });

  it("no 'Practice' chip: since bd-2450 only a pass completes the part", async () => {
    renderAt(PART);
    const row = await screen.findByTestId("training-quick-check");
    await waitFor(() => expect(within(row).getByText("5 Q")).toBeInTheDocument());
    expect(screen.queryByText("Practice")).not.toBeInTheDocument();
  });

  it("the bottom button is Start quick check, to the quiz", async () => {
    renderAt(PART);
    const cta = await screen.findByRole("link", { name: "Start quick check" });
    expect(cta).toHaveAttribute("href", "/portal/training/unit/m-4/quiz");
  });
});

describe("a part with no quiz", () => {
  const noQuiz = { ...DETAIL_M4, has_questions: false };

  it("Mark done completes it on the server, then offers the next part", async () => {
    // A course with no unit locks (NIETE): the next part is open once this one is done.
    vi.mocked(api.get).mockImplementation(routes({
      "/training/module/m-4": { module: noQuiz },
      "/training/modules": { modules: MODULES_C3.map((m) => ({ ...m, lock: null })), exam: null, readings: null },
    }) as never);
    vi.mocked(api.post).mockResolvedValue({ data: { completed_at: "2026-10-03T10:00:00Z" } } as never);
    renderAt(PART);
    const done = await screen.findByRole("button", { name: "Mark done" });
    expect(screen.queryByTestId("training-quick-check")).not.toBeInTheDocument();
    fireEvent.click(done);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/training/module/m-4/complete"));
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Continue" })).toHaveAttribute("href", "/portal/training/unit/m-5");
  });

  it("a refusal stays on screen as a chip, and the button stays", async () => {
    vi.mocked(api.get).mockImplementation(routes({ "/training/module/m-4": { module: noQuiz } }) as never);
    vi.mocked(api.post).mockRejectedValue(httpError(500));
    renderAt(PART);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    expect(await screen.findByText("Not saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark done" })).toBeEnabled();
  });
});

describe("a locked part", () => {
  it("says Locked, in one word", async () => {
    vi.mocked(api.get).mockImplementation(routes({ "/training/module/m-4": httpError(403, { error: "Pass the session before this one" }) }) as never);
    renderAt(PART);
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.queryByText(/Pass the session/)).not.toBeInTheDocument();
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words are labels", async () => {
    renderAt(PART);
    await screen.findByRole("link", { name: "Start quick check" });
    expect(tapProblems(document.body)).toEqual([]);
    for (const el of Array.from(document.body.querySelectorAll("[data-chip], h2, [data-testid=newui-bottom-actions] a, [data-testid=newui-bottom-actions] button"))) {
      expect(copyProblem(el.textContent?.trim() || ""), el.textContent || "").toBeNull();
    }
  });
});
