import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClassPicker } from "./ClassPicker";

/**
 * ClassPicker `gradeColours` (opt-in; Digital Coaching's one screen, design v6): the picked class as the grade tile every
 * list uses ("G4" on the grade's colour over the short subject on its tint). The tray itself stays as it is everywhere
 * (the trial of grade colours in the tray was reverted by the operator, 16 Oct). Without it the picker is as before.
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

  it("the open tray stays as Lesson Plans and Assessment have it: no grade colours (trial reverted 16 Oct)", () => {
    inRouter(<ClassPicker label="Grade and subject" combos={MINE} subjectsByGrade={SUBJECTS} gradeColours />);
    fireEvent.click(screen.getByRole("button", { name: /Grade and subject/ }));
    const g5 = screen.getByRole("radio", { name: /^Grade 5/ });
    expect(g5.getAttribute("style")).toBeNull();
    fireEvent.click(g5);
    expect(g5.getAttribute("style")).toBeNull();
    const math = screen.getByRole("button", { name: /Grade 5 · Math/ });
    expect(within(math).queryByTestId("class-grade-tile")).toBeNull();
  });

  it("off by default: as before, no grade tile", () => {
    inRouter(<ClassPicker label="Grade and subject" combos={MINE} subjectsByGrade={SUBJECTS} value={{ grade: 4, subject: "General Science" }} />);
    expect(screen.queryByTestId("class-grade-tile")).toBeNull();
  });
});
