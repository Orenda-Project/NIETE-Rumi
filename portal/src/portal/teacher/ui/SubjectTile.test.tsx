import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SubjectTile } from "./SubjectTile";
import { subjectIcon, blockSubject } from "./subjects";

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

describe("blockSubject: the block lead's subject line (about as long as \"Grade 10\")", () => {
  it.each([
    ["English", "English"], ["Urdu", "Urdu"], ["Math", "Maths"], ["Mathematics", "Maths"], ["General Science", "Science"],
    ["Physics", "Physics"], ["Chemistry", "Chemistry"], ["Biology", "Biology"], ["Computer Science", "Computer"],
    ["Islamiyat", "Islamiat"], ["Islamiat", "Islamiat"], ["History", "History"], ["Geography", "Geogr."],
    ["Agricultural Education (Zarai Taleem)", "Agricul."], ["Social Studies", "Soc. St."], ["Pakistan Studies", "Pak. St."],
    ["General Knowledge", "Gen. Kn."], ["Religious Studies", "Religion"], ["Art", "Art"], ["Calligraphy", "Callig."],
  ])("%j → %j", (subject, shown) => {
    expect(blockSubject(subject)).toBe(shown);
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
