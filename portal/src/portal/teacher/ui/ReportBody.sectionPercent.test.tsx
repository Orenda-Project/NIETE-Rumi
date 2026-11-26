import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReportBody, type ReportData } from "./ReportBody";

/**
 * bd-r2uzg1.23.11 (queue #274, call 23A; ICT sheet DC 128): each section in Your scores reads as a percentage, with its
 * points as a small grey fraction under it ("71%" over "10/14"). The operator, 26 Nov ~16:00: "Make these
 * percentages, but do show a small fraction too, greyed out." The headline is unchanged; Not assessed is unchanged.
 * The same design as #293's observer score card (the percentage big, its points small under it).
 */

const DATA: ReportData = {
  headline: "", marks: 33, max: 52, teacher: "Ayesha Bibi", topic: "Fractions", date: "28 Sep 2026",
  sections: [
    { code: "B", label: "Lesson Plan Fidelity", score: 10, max: 14 },
    { code: "C", label: "High-Leverage Practices", score: 7, max: 8 },
    { code: "E", label: "Classroom Environment", na: true },
  ],
};

describe("Your scores: each section as a percentage, its fraction small and grey", () => {
  it("the percentage is the row's number; the fraction sits under it, small and grey", () => {
    render(<ReportBody data={DATA} />);
    const scores = screen.getByRole("region", { name: "Your scores" });
    const pcts = within(scores).getAllByTestId("section-pct");
    expect(pcts.map((e) => e.textContent)).toEqual(["71%", "88%"]);
    expect(pcts[0]).toHaveClass("text-[15px]", "font-bold");
    const fracs = within(scores).getAllByTestId("section-fraction");
    expect(fracs.map((e) => e.textContent)).toEqual(["10/14", "7/8"]);
    expect(fracs[0]).toHaveClass("text-[12px]", "text-[#9ca3af]");
    expect(fracs[0]).toHaveAttribute("dir", "ltr");
  });

  it("Not assessed keeps its words and gets no percentage", () => {
    render(<ReportBody data={DATA} />);
    const scores = screen.getByRole("region", { name: "Your scores" });
    expect(within(scores).getByText("Not assessed")).toBeInTheDocument();
    expect(within(scores).getAllByTestId("section-pct")).toHaveLength(2);
  });

  it("the headline is unchanged: the overall % and the marks", () => {
    render(<ReportBody data={DATA} />);
    expect(screen.getByTestId("report-score")).toHaveTextContent(/^63% · 33\/52 marks$/);
  });
});

describe("a report with no overall score", () => {
  it("keeps the plain fraction and invents no percentage", () => {
    const { marks: _m, max: _x, ...rest } = DATA;
    render(<ReportBody data={rest as ReportData} />);
    const scores = screen.getByRole("region", { name: "Your scores" });
    expect(within(scores).queryAllByTestId("section-pct")).toHaveLength(0);
    expect(within(scores).getByText("10/14")).toBeInTheDocument();
    expect(scores).not.toHaveTextContent(/\d+%/);
  });
});
