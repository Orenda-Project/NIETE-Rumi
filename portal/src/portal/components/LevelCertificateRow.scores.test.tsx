import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * bd-vej4h — the teacher's I-SAPS score sheet, on the certificate card.
 *
 * I-SAPS: "The trainees' scores should be recorded and available at the end of
 * the training." Operator 2026-10-01: for the teacher, on the portal. The card
 * gets a collapsible "Your scores" list: per module, the exam split into its two
 * bars (multiple choice out of 20, written answer out of 10) and each unit's best
 * quick-check percentage.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from "../services/api";
import LevelCertificateRow from "./LevelCertificateRow";

const STATE = {
  state: "locked", certificate: null, units_total: 54, units_done: 3, exams_total: 9, exams_done: 1,
  scores: { modules: [
    { course_id: 71, title: "Module 1 - Philosophical Foundations",
      units: [{ id: 101, title: "Unit 101", best_pct: 100 }, { id: 102, title: "Unit 102", best_pct: 67 }],
      exam: { passed: true, mcq_correct: 3, mcq_served: 4, mcq_earned: 15, mcq_possible: 20, crq_earned: 6, crq_max: 10 } },
    { course_id: 72, title: "Module 2 - Affective Development",
      units: [{ id: 201, title: "Unit 201", best_pct: null }], exam: null },
  ] },
};

beforeEach(() => { vi.clearAllMocks(); });

describe("score sheet on the certificate card", () => {
  it("is collapsed at first and opens to show each module's exam marks", async () => {
    (api.get as any).mockResolvedValue({ data: STATE });
    render(<LevelCertificateRow levelId={27} />);
    const toggle = await screen.findByTestId("level-scores-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByText(/Multiple choice 15\/20/)).toBeInTheDocument();
    expect(screen.getByText(/Written answer 6\/10/)).toBeInTheDocument();
    expect(screen.getByText(/Not taken yet/)).toBeInTheDocument();
  });

  it("lists each unit's best quick-check score", async () => {
    (api.get as any).mockResolvedValue({ data: STATE });
    render(<LevelCertificateRow levelId={27} />);
    await userEvent.click(await screen.findByTestId("level-scores-toggle"));
    expect(screen.getByText("Unit 102").closest("li")).toHaveTextContent("67%");
    expect(screen.getByText("Unit 201").closest("li")).toHaveTextContent("—");
  });

  it("is still shown once the certificate is held", async () => {
    (api.get as any).mockResolvedValue({ data: { ...STATE, state: "issued", certificate: { certificate_code: "ISAPS-1" } } });
    render(<LevelCertificateRow levelId={27} />);
    expect(await screen.findByTestId("level-scores-toggle")).toBeInTheDocument();
  });

  it("renders no sheet for a level without one", async () => {
    (api.get as any).mockResolvedValue({ data: { ...STATE, scores: null } });
    render(<LevelCertificateRow levelId={27} />);
    await screen.findByTestId("level-certificate-claim");
    expect(screen.queryByTestId("level-scores-toggle")).not.toBeInTheDocument();
  });

  it("bd-hxm7a: a held written answer says it is being graded, never a mark", async () => {
    const held = { ...STATE, scores: { modules: [{ ...STATE.scores.modules[0],
      exam: { passed: false, pending: true, mcq_correct: 4, mcq_served: 4, mcq_earned: 20, mcq_possible: 20, crq_earned: null, crq_max: 10 } }] } };
    (api.get as any).mockResolvedValue({ data: held });
    render(<LevelCertificateRow levelId={27} />);
    await userEvent.click(await screen.findByTestId("level-scores-toggle"));
    expect(screen.getByText(/Module exam being graded/)).toBeInTheDocument();
    expect(screen.getByText(/Written answer being graded/)).toBeInTheDocument();
    expect(screen.queryByText(/\/10/)).not.toBeInTheDocument();
  });
});
