import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";
import { CAPSTONE_PAPER, EXAM_QUESTIONS, gate, httpError, trainingGet } from "../../../test/trainingFixtures";

/**
 * bd-5rz1v.25 — the level exam (deep-screens.html, Training 8): a Hero (trophy, neutral) "Ready"
 * with the rules as chips — "20 Q", "80% to pass", amber "24h wait if failed" — and Start exam.
 * The exam is one question per screen, like the quick check, and posts LevelExamCard's exact
 * answer set. Pass and fail are Hero states; the certificate is a card with its code. Every
 * number comes from the gate (bd-2489): no pass mark from the gate, no chip.
 * A capstone level (Beacon House) gets the written exam the same way, one answer per screen.
 */

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

const EXAM = "/portal/training/provider/TALEEMABAD/level/2/exam";
const withGate = (g: unknown, over: Record<string, unknown> = {}) => trainingGet({
  "/training/level/2/grand-quiz": { grand_quiz: g },
  "/training/level/2/grand-quiz/questions": { questions: EXAM_QUESTIONS },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "923001234567" }, loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(api.get).mockImplementation(withGate(gate("ready")) as never);
});

/** The Hero whose title is `text` (not the loading Hero that comes before it). */
async function heroWith(text: string): Promise<HTMLElement> {
  const found = await screen.findAllByText(text);
  const hero = found.map((el) => el.closest("[data-testid=newui-hero]")).find(Boolean);
  if (!hero) throw new Error(`no Hero titled ${text}`);
  return hero as HTMLElement;
}

const choices = () => Array.from(document.querySelectorAll<HTMLElement>("[role=radio], [role=checkbox]"));
const pick = (i: number) => fireEvent.click(choices()[i]);

describe("Ready", () => {
  it("the light bar (crumb 'Training · NIETE', 'Level 2 exam'); a neutral trophy Hero 'Ready'; the rules as chips", async () => {
    renderAt(EXAM);
    expect(await screen.findByRole("heading", { level: 1, name: "Level 2 exam" })).toBeInTheDocument();
    expect(screen.getByTestId("newui-crumb")).toHaveTextContent("Training · NIETE");
    const hero = await heroWith("Ready");
    expect(within(hero).getByTestId("newui-hero-icon").className).toContain("bg-nu-neutral-tile");
    expect(within(hero).getByText("20 Q")).toBeInTheDocument();
    expect(within(hero).getByText("80% to pass")).toBeInTheDocument();
    const wait = within(hero).getByText("24h wait if failed").closest("[data-chip]");
    expect(wait?.className).toContain("bg-nu-chip-warning-bg");
    expect(screen.getByRole("button", { name: "Start exam" })).toBeInTheDocument();
  });

  it("numbers only from the gate: no pass mark, no chip; no cooldown, no wait chip", async () => {
    vi.mocked(api.get).mockImplementation(withGate(gate("ready", { pass_mark_pct: null, cooldown_hours: 0 })) as never);
    renderAt(EXAM);
    const hero = await heroWith("20 Q");
    expect(within(hero).queryByText(/to pass/)).not.toBeInTheDocument();
    expect(within(hero).queryByText(/wait if failed/)).not.toBeInTheDocument();
  });
});

describe("the gate's other states", () => {
  it("courses incomplete: Locked, '3 more courses', no Start", async () => {
    vi.mocked(api.get).mockImplementation(withGate(gate("courses_incomplete")) as never);
    renderAt(EXAM);
    const hero = await heroWith("Locked");
    expect(within(hero).getByText("3 more courses")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start exam" })).not.toBeInTheDocument();
  });

  it("cooldown: an amber Wait with the hours left", async () => {
    vi.mocked(api.get).mockImplementation(withGate(gate("cooldown", { cooldown_until: new Date(Date.now() + 5 * 3_600_000).toISOString() })) as never);
    renderAt(EXAM);
    const hero = await heroWith("Wait");
    expect(within(hero).getByText("Wait 5h")).toBeInTheDocument();
    expect(within(hero).getByTestId("newui-hero-icon").className).toContain("bg-nu-chip-warning-bg");
  });

  it("passed: a green Hero and the certificate as a card with its code", async () => {
    vi.mocked(api.get).mockImplementation(withGate(gate("passed", {
      passed_at: "2026-10-01T00:00:00Z",
      certificate: { certificate_code: "NIETE-EM-7", teacher_name: "Ayesha", level_name: "Emerging", issued_at: "2026-10-01T00:00:00Z" },
    })) as never);
    renderAt(EXAM);
    const hero = await heroWith("Passed");
    const card = screen.getByTestId("training-certificate-card");
    expect(within(card).getByText("Emerging")).toBeInTheDocument();
    expect(within(card).getByText("NIETE-EM-7")).toBeInTheDocument();
  });
});

describe("the exam, one question per screen", () => {
  async function start() {
    renderAt(EXAM);
    fireEvent.click(await screen.findByRole("button", { name: "Start exam" }));
    await screen.findByText("What makes a group task work?");
  }

  it("Start opens the first question: dots, the question, answers, '1/4'", async () => {
    await start();
    expect(api.get).toHaveBeenCalledWith("/training/level/2/grand-quiz/questions");
    expect(screen.getByRole("progressbar", { name: /Question 1\/4/ })).toBeInTheDocument();
    expect(within(screen.getByTestId("newui-inner-bar")).getByText("1/4")).toBeInTheDocument();
    expect(choices()).toHaveLength(4);
  });

  it("object options show their text; Back keeps answers; Submit posts LevelExamCard's answer set", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { attempt: { id: "x", score: 4, max_score: 4, is_passed: true, status: "passed", cooldown_until: null, completed_at: "2026-10-03T00:00:00Z" }, certificate: null } } as never);
    await start();
    pick(0); fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Soon after the work")).toBeInTheDocument();
    pick(0); fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(choices()[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    pick(1); fireEvent.click(screen.getByRole("button", { name: "Next" }));
    pick(0); fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/training/level/2/grand-quiz/attempts", {
      answers: [
        { question_id: 201, chosen_option: "1" },
        { question_id: 202, chosen_option: "1" },
        { question_id: 203, chosen_option: "2" },
        { question_id: 204, chosen_option: "1" },
      ],
    }));
  });

  // bd-klecr.7 — the paper is the attempt's (NIETE: 20 of the bank, options shuffled).
  it("sends each picked option's canonical value, and the attempt id", async () => {
    const SHUFFLED = EXAM_QUESTIONS.map((q) => {
      const values = q.options.map((_, i) => String(q.options.length - i));
      return { ...q, options: [...q.options].reverse(), option_values: values };
    });
    vi.mocked(api.get).mockImplementation(withGate(gate("ready"), {
      "/training/level/2/grand-quiz/questions": { attempt_id: "att-7", questions: SHUFFLED },
    }) as never);
    vi.mocked(api.post).mockResolvedValue({ data: { attempt: { id: "att-7", score: 4, max_score: 4, is_passed: true, status: "passed", cooldown_until: null, completed_at: "2026-10-03T00:00:00Z" }, certificate: null } } as never);
    await start();
    expect(choices()[0]).toHaveTextContent("One leader only");
    for (let i = 0; i < 4; i += 1) {
      pick(0);
      fireEvent.click(screen.getByRole("button", { name: i < 3 ? "Next" : "Submit" }));
    }
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/training/level/2/grand-quiz/attempts", {
      attempt_id: "att-7",
      answers: [
        { question_id: 201, chosen_option: "4" },
        { question_id: 202, chosen_option: "3" },
        { question_id: 203, chosen_option: "3" },
        { question_id: 204, chosen_option: "3" },
      ],
    }));
  });

  async function finish() {
    await start();
    for (let i = 0; i < 4; i += 1) {
      pick(0);
      fireEvent.click(screen.getByRole("button", { name: i < 3 ? "Next" : "Submit" }));
    }
  }

  it("a pass: green Hero, the score, and the new certificate's card", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {
      attempt: { id: "x", score: 18, max_score: 20, is_passed: true, status: "passed", cooldown_until: null, completed_at: "2026-10-03T00:00:00Z" },
      certificate: { certificate_code: "NIETE-EM-9", teacher_name: "Ayesha", level_name: "Emerging", issued_at: "2026-10-03T00:00:00Z" },
    } } as never);
    await finish();
    const hero = await heroWith("Passed");
    expect(within(hero).getByText("18/20")).toBeInTheDocument();
    expect(within(screen.getByTestId("training-certificate-card")).getByText("NIETE-EM-9")).toBeInTheDocument();
  });

  it("a fail: Not passed, the score, and the wait as an amber chip", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {
      attempt: { id: "x", score: 9, max_score: 20, is_passed: false, status: "failed", cooldown_until: new Date(Date.now() + 24 * 3_600_000).toISOString(), completed_at: "2026-10-03T00:00:00Z" },
      certificate: null,
    } } as never);
    await finish();
    const hero = await heroWith("Not passed");
    expect(within(hero).getByText("9/20")).toBeInTheDocument();
    expect(within(hero).getByText("Wait 24h").closest("[data-chip]")?.className).toContain("bg-nu-chip-warning-bg");
  });

  it("a refused submit says so and re-reads the gate", async () => {
    vi.mocked(api.post).mockRejectedValue(httpError(409, { error: "Cooldown" }));
    await finish();
    expect(await screen.findByText("Not sent")).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([u]) => u === "/training/level/2/grand-quiz").length).toBeGreaterThan(1));
  });
});

describe("Beacon House — the written exam (capstone)", () => {
  const BH = "/portal/training/provider/BEACONHOUSE/level/18/exam";
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(trainingGet({
      "/training/level/18/grand-quiz": { grand_quiz: gate("ready", { exam_kind: "capstone", question_count: 2, pass_mark_pct: 70, cooldown_hours: 0 }) },
      "/training/level/18/capstone/questions": CAPSTONE_PAPER,
    }) as never);
  });

  it("one answer per screen, with a character count that must reach the floor", async () => {
    renderAt(BH);
    expect(await screen.findByRole("heading", { level: 1, name: "English exam" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Start exam" }));
    const box = await screen.findByRole("textbox");
    expect(screen.getByText("How do you open a reading lesson?")).toBeInTheDocument();
    expect(screen.getByText("0/20")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "Too short" } });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "With a picture walk and a question." } });
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("posts the written answers to the capstone route and shows the score", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {
      attempt: { id: "c", score: 8, total_score: 10, pass_bar: 7, pass_mark_pct: 70, is_passed: true, completed_at: "2026-10-03T00:00:00Z" },
      answers: [{ question_index: 0, question_text: "How do you open a reading lesson?", answer_text: "With a picture walk and a question.", answer_score: 4, feedback_text: "Good." }],
      certificate: null,
    } } as never);
    renderAt(BH);
    fireEvent.click(await screen.findByRole("button", { name: "Start exam" }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "With a picture walk and a question." } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Exit tickets and two cold calls." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/training/level/18/capstone/attempts", {
      answers: [
        { question_id: 301, answer_text: "With a picture walk and a question." },
        { question_id: 302, answer_text: "Exit tickets and two cold calls." },
      ],
    }));
    const hero = await heroWith("Passed");
    expect(within(hero).getByText("8/10")).toBeInTheDocument();
  });
});

describe("the design rules", () => {
  it("every target is at least 56px, and our words are labels", async () => {
    renderAt(EXAM);
    await screen.findByRole("button", { name: "Start exam" });
    expect(tapProblems(document.body)).toEqual([]);
    for (const el of Array.from(document.body.querySelectorAll("[data-chip], h2, [data-testid=newui-bottom-actions] a, [data-testid=newui-bottom-actions] button"))) {
      expect(copyProblem(el.textContent?.trim() || ""), el.textContent || "").toBeNull();
    }
  });
});
