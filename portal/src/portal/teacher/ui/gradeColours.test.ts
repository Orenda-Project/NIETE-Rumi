import { describe, it, expect } from "vitest";
import { GRADE_COLOURS, NEUTRAL_COLOURS, gradeColoursFor } from "./gradeColours";

/**
 * bd-fmf24g.19 — the class colours, by GRADE (operator, 9 Oct): Grades 1–5 bright, 6–12 deeper. The table is
 * final (workbench/blueprint/subject-colours/grade_palette_final.json); this is its one copy in code.
 */
const FINAL = {
  "1": {
    "dark": "#b45309",
    "light": "#faf3ee"
  },
  "2": {
    "dark": "#7c3aed",
    "light": "#efe7fd"
  },
  "3": {
    "dark": "#15803d",
    "light": "#eff6f1"
  },
  "4": {
    "dark": "#c62828",
    "light": "#f8e5e5"
  },
  "5": {
    "dark": "#1e40af",
    "light": "#e4e8f5"
  },
  "6": {
    "dark": "#946200",
    "light": "#f4efe6"
  },
  "7": {
    "dark": "#0e7490",
    "light": "#e2eef2"
  },
  "8": {
    "dark": "#5f6f00",
    "light": "#eceee0"
  },
  "9": {
    "dark": "#881337",
    "light": "#f1e3e7"
  },
  "10": {
    "dark": "#00796b",
    "light": "#e6f2f0"
  },
  "11": {
    "dark": "#6a1b9a",
    "light": "#ede4f3"
  },
  "12": {
    "dark": "#713f12",
    "light": "#eee8e3"
  }
} as const;

describe("gradeColours", () => {
  it("the table is the final palette, all twelve grades, nothing else", () => {
    expect(Object.keys(GRADE_COLOURS).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const [g, c] of Object.entries(FINAL)) expect(GRADE_COLOURS[Number(g)]).toEqual(c);
  });

  it("G4 and G10, exactly", () => {
    expect(gradeColoursFor(4)).toEqual({ dark: "#c62828", light: "#f8e5e5" });
    expect(gradeColoursFor(10)).toEqual({ dark: "#00796b", light: "#e6f2f0" });
  });

  it("a grade as a number, a digit string, \"G4\" or \"Grade 4\" is the same grade", () => {
    for (const g of [4, "4", " 4 ", "G4", "Grade 4"]) expect(gradeColoursFor(g)).toEqual(GRADE_COLOURS[4]);
  });

  it("no grade, a dash, or a grade off the 1–12 ladder is neutral (grey tint, dark ink)", () => {
    expect(NEUTRAL_COLOURS).toEqual({ dark: "#33374a", light: "#f3f4f6" });
    for (const g of [undefined, null, "", "  ", "-", "–", "—", 0, 13, "13", "abc", 4.5]) expect(gradeColoursFor(g as never)).toEqual(NEUTRAL_COLOURS);
  });
});
