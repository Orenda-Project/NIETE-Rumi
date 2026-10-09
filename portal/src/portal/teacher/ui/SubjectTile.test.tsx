import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SubjectTile } from "./SubjectTile";
import { subjectIcon, subjectShort, subjectFamily, SUBJECT_SHORT } from "./subjects";

/**
 * bd-fmf24g.2.1 — SubjectTile (COMPONENTS.md "SubjectTile"): a 48px rounded-12 square with the subject's icon,
 * neutral grey; first match wins, so "Computer Science" is a computer and "General Science" a flask.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("subjectIcon: subject → icon, first match wins", () => {
  it.each([
    ["English", "en"], ["Urdu", "ur"], ["اردو", "ur"], ["Math", "calc"], ["Mathematics", "calc"], ["Maths", "calc"],
    ["Computer Science", "monitor"], ["Physics", "atom"], ["Chemistry", "tube"], ["Biology", "sprout"],
    ["Agricultural Education (Zarai Taleem)", "wheat"], ["General Science", "flask"], ["Science", "flask"],
    ["General Knowledge", "bulb"], ["Geography", "globe"], ["Islamiat", "bookmark"], ["Islamiyat", "bookmark"],
    ["Religious Studies", "bookmark"], ["History", "scroll"], ["Pakistan Studies", "landmark"],
    ["Social Studies", "landmark"], ["Civics", "landmark"], ["Art", "book"], ["", "book"],
  ])("%j → %s", (subject, key) => {
    expect(subjectIcon(subject)).toBe(key);
  });
});

describe("subjectShort: the D6.5 lead's subject half (operator, 9 Oct: \"short form without a period, e.g. SST/Sci/Math\")", () => {
  it.each([
    ["English", "Eng"], ["Urdu", "Urdu"], ["اردو", "Urdu"], ["Math", "Math"], ["Maths", "Math"], ["Mathematics", "Math"],
    ["Computer Science", "Comp"], ["Computer", "Comp"], ["Physics", "Phy"], ["Chemistry", "Chem"], ["Biology", "Bio"],
    ["Agricultural Education (Zarai Taleem)", "Agri"], ["General Knowledge", "GK"], ["General Science", "Sci"],
    ["Science", "Sci"], ["Religious Studies", "Rel"], ["Pakistan Studies", "Pak St"], ["Social Studies", "SST"],
    ["Islamiat", "Isl"], ["Islamiyat", "Isl"], ["Geography", "Geo"], ["History", "Hist"],
    // Anything else: its first word, cut to 4 letters.
    ["Art", "Art"], ["Calligraphy", "Call"], ["Environmental Studies", "Envi"], ["  Drawing  ", "Draw"], ["", ""],
  ])("%j → %j", (subject, shown) => {
    expect(subjectShort(subject)).toBe(shown);
  });

  it("no short form ends in a period, and none is longer than \"Pak St\" (never wrapped or cut in 64px)", () => {
    for (const r of SUBJECT_SHORT) {
      expect(r.en).not.toMatch(/\.$/);
      expect([...r.en].length).toBeLessThanOrEqual(6);
      // Urdu: ONE word, 13px Nastaliq ≤ 50px wide (measured, Noto Nastaliq Urdu Bold — see subjects.ts).
      expect(r.ur).not.toMatch(/\s|\./);
      expect(r.ur).toMatch(/^[\u0600-\u06FF]+$/);
    }
  });

  it("Urdu: the short Urdu word; no Urdu form → the English 4 letters", () => {
    expect(subjectShort("General Science", "ur")).toBe("سائنس");
    expect(subjectShort("Maths", "ur")).toBe("ریاضی");
    expect(subjectShort("English", "ur")).toBe("انگریزی");
    expect(subjectShort("Calligraphy", "ur")).toBe("Call");
  });

  it("subjectFamily: languages, maths, sciences (incl. physics/chemistry/biology/agriculture), computer, humanities + everything else", () => {
    expect(["English", "Urdu"].map(subjectFamily)).toEqual(["languages", "languages"]);
    expect(subjectFamily("Mathematics")).toBe("maths");
    expect(["General Science", "Physics", "Chemistry", "Biology", "Agriculture"].map(subjectFamily)).toEqual(Array(5).fill("sciences"));
    expect(subjectFamily("Computer Science")).toBe("computer");
    expect(["Social Studies", "Pakistan Studies", "Islamiat", "History", "Geography", "General Knowledge", "Religious Studies", "Art", ""].map(subjectFamily))
      .toEqual(Array(9).fill("humanities"));
  });
});

describe("SubjectTile", () => {
  it("is a 48px rounded-12 neutral square, decorative", () => {
    const { container } = render(<SubjectTile subject="General Science" />);
    const tile = container.firstElementChild!;
    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(tile).toHaveAttribute("data-icon", "flask");
    expect(tile).toHaveStyle({ width: "48px", height: "48px" });
    expect(classes(tile)).toEqual(expect.arrayContaining(["rounded-xl", "bg-[#f3f4f6]", "text-[#33374a]", "shrink-0"]));
    // icon = 46% of the size
    expect(tile.querySelector("svg")).toHaveAttribute("width", "22");
  });

  it("English and Urdu are letters, 800 weight at 33% of the size", () => {
    const { container: en } = render(<SubjectTile subject="English" size={60} />);
    expect(en.firstElementChild).toHaveTextContent("Aa");
    expect(en.firstElementChild).toHaveStyle({ fontSize: "20px" });
    expect(classes(en.firstElementChild!)).toContain("font-extrabold");
    const { container: ur } = render(<SubjectTile subject="Urdu" />);
    expect(ur.firstElementChild).toHaveTextContent("اب");
  });

  it("selected tints the tile; dim greys the icon", () => {
    const { container: sel } = render(<SubjectTile subject="Math" tone="selected" />);
    expect(classes(sel.firstElementChild!)).toContain("bg-[#e8e9f0]");
    const { container: dim } = render(<SubjectTile subject="Math" tone="dim" />);
    expect(classes(dim.firstElementChild!)).toContain("text-[#9ca3af]");
  });

  it("every icon draws (no empty tile)", () => {
    for (const s of ["Math", "Computer Science", "Physics", "Chemistry", "Biology", "Agricultural Education", "General Science",
      "General Knowledge", "Geography", "Islamiat", "History", "Pakistan Studies", "Art"]) {
      const { container, unmount } = render(<SubjectTile subject={s} />);
      expect(container.querySelector("svg path, svg rect, svg circle, svg ellipse")).not.toBeNull();
      unmount();
    }
  });
});
