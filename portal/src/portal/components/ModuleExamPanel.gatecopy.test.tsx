import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * bd-60166 — the exam ROW must say what the gate says.
 *
 * The list row hardcoded a padlock and the word "Locked" for every closed
 * state. In one of them that is a straight lie: a teacher who has PASSED the
 * module exam was shown "🔒 Locked" while the server was returning
 * "🏆 Module exam — you passed this module" with cta "✓ Passed". She is told
 * she is blocked from something she has already finished — reported from
 * sandbox as "UX lying to me".
 *
 * The panel form below the row already renders `exam.body` verbatim, with a
 * comment saying "say what the gate says, in its own words". Only the row had
 * drifted. These tests hold both shapes to the same promise.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import ModuleExamPanel from "./ModuleExamPanel";

const PASSED = {
  available: false,
  body: "🏆 Module exam — you passed this module.",
  caption: "Your score counts towards the level certificate.",
  cta: "✓ Passed",
};
const LOCKED = {
  available: false,
  body: "🔒 Module exam — no exam for this module yet.",
  caption: " ",
  cta: "🔒 Locked",
};
const COOLDOWN = {
  available: false,
  body: "⏳ Module exam — locked after a recent attempt. Try again in about 3 hours.",
  caption: "Review the sessions while you wait.",
  cta: "⏳ Cooldown (3h)",
};

beforeEach(() => vi.clearAllMocks());

describe("bd-60166 — the row reflects the gate", () => {
  it("a PASSED exam does not say Locked", async () => {
    render(<ModuleExamPanel courseId="58" exam={PASSED as any} asListRow />);
    expect(await screen.findByTestId("module-exam-passed")).toBeInTheDocument();
    expect(screen.getByText(/Passed/)).toBeInTheDocument();
    expect(screen.queryByText("Locked")).not.toBeInTheDocument();
  });

  it("a genuinely locked exam still says Locked", async () => {
    render(<ModuleExamPanel courseId="58" exam={LOCKED as any} asListRow />);
    expect(await screen.findByTestId("module-exam-locked")).toBeInTheDocument();
    expect(screen.getByText(/Locked/)).toBeInTheDocument();
  });

  it("a cooldown says cooldown, not Locked — the gate's own word", async () => {
    render(<ModuleExamPanel courseId="58" exam={COOLDOWN as any} asListRow />);
    expect(await screen.findByTestId("module-exam-locked")).toBeInTheDocument();
    expect(screen.getByText(/Cooldown/i)).toBeInTheDocument();
  });

  it("the non-row panel keeps rendering the server's body verbatim", async () => {
    render(<ModuleExamPanel courseId="58" exam={PASSED as any} />);
    expect(await screen.findByText(/you passed this module/)).toBeInTheDocument();
  });
});
