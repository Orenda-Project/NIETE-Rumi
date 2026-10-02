import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * bd-2exhl — the exam page says what happened to every submitted sitting, and
 * lets the teacher read back what she submitted (operator, 2026-10-01).
 *
 *   being graded → keep showing her answers, tell her about the wait, no retake
 *   not passed   → say so, "Try again"
 *   passed       → no retake; she can still read her answers
 *
 * Before this, coming back to the exam page after a failed sitting opened a
 * fresh paper on arrival (autoStart) with no word about the last one.
 */

const get = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({ default: { get: (...a: any[]) => get(...a), post: vi.fn(), put: vi.fn() } }));
import ModuleExamPanel from "./ModuleExamPanel";

const OPEN = { available: true, body: "Module exam", caption: "", cta: "Take the exam", module_no: 1 };
const BEING_GRADED = {
  available: false,
  body: "📝 Module exam — your written answer is being graded. This takes some time.",
  caption: "Multiple choice cleared. Once the written answer passes, we'll issue your certificate.",
  cta: "⏳ Being graded",
  module_no: 1,
};
const PASSED_GATE = { available: false, body: "🏆 Module exam — you passed this module.", caption: "", cta: "✓ Passed", module_no: 1 };

const answers = [
  { index: 0, question_text: "Which pair contrasts?", is_open_ended: false, options: ["Realism vs. Idealism", "Behaviourism vs. Cognitivism"], chosen_option: "2", answer_text: null },
  { index: 1, question_text: "Explain the Revised Taxonomy.", is_open_ended: true, options: [], chosen_option: null, answer_text: "My written answer about the taxonomy" },
];
const attempt = (status: string, extra: any = {}) => ({
  id: `a-${status}`, status, started_at: "2026-10-01T10:00:00Z", completed_at: "2026-10-01T10:05:00Z",
  mcq_correct: status === "failed" ? 2 : 3, mcq_served: 4, mcq_needed: 3,
  crq: { held: true, score: null, max: 10, feedback: null }, answers, ...extra,
});
function serve(attempts: any[]) {
  get.mockImplementation(async (url: string) => {
    if (url.endsWith("/exam/attempts")) return { data: { success: true, attempts } };
    if (url.endsWith("/exam/questions")) return { data: { success: true, attempt_id: "new", questions: [] } };
    return { data: {} };
  });
}
const openedPaper = () => get.mock.calls.some(c => String(c[0]).endsWith("/exam/questions"));

beforeEach(() => { get.mockReset(); });

describe("bd-2exhl — being graded", () => {
  it("says it is being graded, shows her submitted answers, and offers no way to sit it again", async () => {
    serve([attempt("pending_review")]);
    render(<ModuleExamPanel courseId="67" exam={BEING_GRADED as any} autoStart />);
    expect(await screen.findByTestId("exam-attempt-status")).toHaveTextContent(/being graded/i);
    fireEvent.click(screen.getByTestId("exam-attempt-review-toggle"));
    expect(screen.getByText("My written answer about the taxonomy")).toBeInTheDocument();
    expect(screen.getByText(/Behaviourism vs\. Cognitivism/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again|take the exam/i })).not.toBeInTheDocument();
    expect(openedPaper()).toBe(false);
  });

  it("never shows a written-answer mark while results are held", async () => {
    serve([attempt("pending_review")]);
    render(<ModuleExamPanel courseId="67" exam={BEING_GRADED as any} autoStart />);
    await screen.findByTestId("exam-attempt-status");
    expect(screen.queryByText(/\/\s*10/)).not.toBeInTheDocument();
  });
});

describe("bd-2exhl — not passed", () => {
  it("says not passed with the multiple-choice tally, offers Try again, and does not open a paper by itself", async () => {
    serve([attempt("failed")]);
    render(<ModuleExamPanel courseId="67" exam={OPEN as any} autoStart />);
    const status = await screen.findByTestId("exam-attempt-status");
    expect(status).toHaveTextContent(/not passed/i);
    expect(status).toHaveTextContent(/2 of 4/);
    expect(status).toHaveTextContent(/needed 3/);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // Give an autoStart a chance to fire if it were going to.
    await new Promise(r => setTimeout(r, 20));
    expect(openedPaper()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(openedPaper()).toBe(true));
  });
});

describe("bd-2exhl — passed", () => {
  it("says passed, offers no retake, and still lets her read her answers", async () => {
    serve([attempt("passed")]);
    render(<ModuleExamPanel courseId="67" exam={PASSED_GATE as any} autoStart />);
    expect(await screen.findByTestId("exam-attempt-status")).toHaveTextContent(/passed/i);
    expect(screen.queryByRole("button", { name: /try again|take the exam/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("exam-attempt-review-toggle"));
    expect(screen.getByText("My written answer about the taxonomy")).toBeInTheDocument();
  });
});

describe("bd-2exhl — first sitting and history", () => {
  it("with nothing submitted yet, the exam page still opens the paper on arrival", async () => {
    serve([]);
    render(<ModuleExamPanel courseId="67" exam={OPEN as any} autoStart />);
    await waitFor(() => expect(openedPaper()).toBe(true));
  });

  it("earlier sittings are listed under the latest one", async () => {
    serve([attempt("pending_review"), attempt("failed", { id: "older" })]);
    render(<ModuleExamPanel courseId="67" exam={BEING_GRADED as any} autoStart />);
    expect(await screen.findByTestId("exam-attempt-history")).toHaveTextContent(/not passed/i);
  });

  it("in the module list, a being-graded exam row opens the exam page so she can read her answers", async () => {
    serve([]);
    const onOpen = vi.fn();
    render(<ModuleExamPanel courseId="67" exam={BEING_GRADED as any} asListRow onOpen={onOpen} />);
    fireEvent.click(await screen.findByTestId("module-exam-review"));
    expect(onOpen).toHaveBeenCalled();
  });
});
