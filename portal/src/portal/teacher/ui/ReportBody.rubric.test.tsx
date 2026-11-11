import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportBody, type ReportData } from "./ReportBody";
import { toReportData } from "../coaching/report";

/**
 * bd-ra8xu.43 — every report shows the rubric it was scored with, in very small muted text, for debugging (operator,
 * 11 Nov ~18:15). The words come from the API (the stored session), never from a switch; no rubric, no line.
 */
const BASE: ReportData = {
  headline: "A clear lesson.", marks: 30, max: 44, teacher: "Ayesha Bibi", topic: "Fractions", date: "11 Nov 2026",
  sections: [{ code: "C", label: "What the teacher does", score: 15, max: 24 }],
};

describe("the rubric id under the report", () => {
  it("prints the stored rubric in tiny muted left-to-right text", () => {
    render(<ReportBody data={{ ...BASE, rubric: "FICO17 v6" }} />);
    const line = screen.getByTestId("report-rubric");
    expect(line).toHaveTextContent(/^FICO17 v6$/);
    expect(line).toHaveClass("text-[10px]", "text-[#9ca3af]");
    expect(line).toHaveAttribute("dir", "ltr");
  });

  it("no rubric → no line", () => {
    render(<ReportBody data={BASE} />);
    expect(screen.queryByTestId("report-rubric")).toBeNull();
  });

  it("the teacher's report page passes the session's rubric through", () => {
    const d = toReportData({ id: "s1", date: "2026-11-11", rubric: "FICO V3", reportNarrative: null } as never, { teacher: "Ayesha Bibi", journey: [] });
    expect(d.rubric).toBe("FICO V3");
    const none = toReportData({ id: "s1", date: "2026-11-11", reportNarrative: null } as never, { teacher: "Ayesha Bibi", journey: [] });
    expect(none.rubric ?? null).toBeNull();
  });
});
