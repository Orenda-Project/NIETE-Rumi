import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ScoreIndicator from "./ScoreIndicator";
import ScoreBreakdown from "./ScoreBreakdown";

/**
 * The shared score component renders a BAND. Every page that used to show a
 * percentage circle — the teacher's dashboard, her session list and report,
 * her principal's Analytics — switches with this one component.
 */

describe("ScoreIndicator shows the band, not the number", () => {
  it.each([
    [85, "Excellent"],
    [64.2, "Good"],
    [45, "Average"],
    [25, "Below average"],
    [5, "Needs support"],
  ])("%p → %s", (pct, label) => {
    const { container } = render(<ScoreIndicator percentage={pct} />);
    expect(screen.getByTestId("score-band")).toHaveTextContent(label);
    expect(container.textContent).not.toMatch(/\d|%/);
  });

  it("says which band it is, for anything that needs to read it", () => {
    render(<ScoreIndicator percentage={64.2} />);
    expect(screen.getByTestId("score-band")).toHaveAttribute("data-band", "good");
  });
});

describe("ScoreBreakdown — sections and indicators in bands", () => {
  const breakdown = {
    framework: "fico",
    language: "en",
    overall: 61,
    marks: 90,
    max: 148,
    scaleMax: 2,
    groups: [
      {
        key: "D", domainKey: "student_engagement", name: "Student Engagement",
        score: 9, max: 14, pct: 64,
        indicators: [
          { id: "D1", name: "Every student participates", score: 1, evidence: "e", evidence_summary: null, applicable: true },
          { id: "D2", name: "Students ask questions", score: 2, evidence: "e", evidence_summary: null, applicable: true },
        ],
      },
    ],
  };

  it("a section shows its band, not 'score/max · pct%'", () => {
    const { container } = render(<ScoreBreakdown breakdown={breakdown as any} />);
    expect(container.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(container.textContent).not.toMatch(/\d+\s*%/);
    expect(container.textContent).toMatch(/Good/);
  });

  it("an indicator's raw 0-2 is banded against the scale it came with", () => {
    render(<ScoreBreakdown breakdown={breakdown as any} />);
    expect(screen.getByTestId("indicator-D1")).toHaveTextContent("Average");   // 1 of 2
    expect(screen.getByTestId("indicator-D2")).toHaveTextContent("Excellent"); // 2 of 2
  });

  it("without a scale the raw score is hidden rather than printed", () => {
    const noScale = { ...breakdown, scaleMax: null };
    render(<ScoreBreakdown breakdown={noScale as any} />);
    expect(screen.getByTestId("indicator-D1").textContent).not.toMatch(/\b1\b/);
  });
});
