import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClassPicker } from "./ClassPicker";

/**
 * ClassPicker `gradeColours` (opt-in; Digital Coaching's one screen, design v6): the picked class as the grade tile every
 * list uses ("G4" on the grade's colour over the short subject on its tint), and the tray's grades and subjects in the
 * grade colours. Without it the picker is exactly as before (Lesson Plans, Assessment).
 */

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const MINE = [{ grade: 4, subject: "General Science", subjectKey: "science", source: "class" }];
const SUBJECTS = { 4: ["General Science", "Math"], 5: ["Math"] };

describe("ClassPicker gradeColours", () => {
  it("the picked class is the G4 grade tile in Grade 4's colours", () => {
    inRouter(<ClassPicker label="Grade and subject" combos={MINE} subjectsByGrade={SUBJECTS} value={{ grade: 4, subject: "General Science" }} gradeColours />);
    const tile = screen.getByTestId("class-grade-tile");
    expect(tile.textContent).toContain("G4");
    expect(within(tile).getByText("G4")).toHaveStyle({ backgroundColor: "#c62828" });
  });

  it("in the tray, grades and subjects carry their grade colours", () => {
    inRouter(<ClassPicker label="Grade and subject" combos={MINE} subjectsByGrade={SUBJECTS} gradeColours />);
    fireEvent.click(screen.getByRole("button", { name: /Grade and subject/ }));
    // Her one grade (4) opens picked, so it is filled with Grade 4's colour; another grade sits on its own tint.
    expect(screen.getByRole("radio", { name: /^Grade 4/ })).toHaveStyle({ backgroundColor: "#c62828" });
    const g5 = screen.getByRole("radio", { name: /^Grade 5/ });
    expect(g5).toHaveStyle({ backgroundColor: "#e4e8f5" });
    const math4 = screen.getByRole("button", { name: /Grade 4 · Math/ });
    expect(within(math4).getByTestId("class-grade-tile").textContent).toContain("G4");
    fireEvent.click(g5);
    expect(g5).toHaveStyle({ backgroundColor: "#1e40af" });
  });

  it("off by default: as before, no grade tile", () => {
    inRouter(<ClassPicker label="Grade and subject" combos={MINE} subjectsByGrade={SUBJECTS} value={{ grade: 4, subject: "General Science" }} />);
    expect(screen.queryByTestId("class-grade-tile")).toBeNull();
  });
});
