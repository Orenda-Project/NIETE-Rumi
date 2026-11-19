import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Obs612Block } from "./Obs612Block";

/**
 * Queue #184 (operator 19 Nov ~11:40): the FICO 6-12 report shows the reasoning. Each indicator row shows the
 * observer's evidence as submitted, on the page (a phone has no hover), in its own direction.
 */
const base = {
  label: "FICO 6-12", rubric: "fico_s_v1_1", tool: "ficos" as const, toolName: "FICO 6-12", toolTitle: "FICO 6-12",
  grade: 7, subject: "Maths", result: "75% · Proficient", noTotal: false, headline: "66 / 88 · 75% · Proficient",
  footer: "Scored by your observer.", feedback: [],
};

describe("Obs612Block: the observer's evidence under each indicator", () => {
  it("shows a row's note as text, first-strong", () => {
    render(<Obs612Block o={{ ...base, rows: [
      { name: "A · Lesson planning & structure", value: "3.0 / 4", pct: 75 },
      { name: "A1 · Lesson objective (SLO)", value: "3 · Proficient", pct: null, full: "Level text", note: "She wrote the SLO on the board and read it out." },
      { name: "B2 · Explaining why", value: "2 · Developing", pct: null, note: "استاد نے وجہ بتائی۔" },
    ] }} />);
    const notes = screen.getAllByTestId("obs612-note");
    expect(notes).toHaveLength(2);
    expect(notes[0]).toHaveTextContent("She wrote the SLO on the board and read it out.");
    expect(notes[0]).toHaveAttribute("dir", "auto");
    expect(notes[1]).toHaveTextContent("استاد نے وجہ بتائی۔");
  });

  it("draws no note line for a row without one", () => {
    render(<Obs612Block o={{ ...base, rows: [{ name: "A · Lesson planning & structure", value: "3.0 / 4", pct: 75 }] }} />);
    expect(screen.queryByTestId("obs612-note")).toBeNull();
  });
});
