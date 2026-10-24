import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LOOK_ICONS, type LookIconKey } from "./lookIcons";

/** Every key the look draws a glyph for resolves to a lucide component (guards a renamed glyph). */
const KEYS: LookIconKey[] = [
  "lessons", "coaching", "observations", "training", "assessment", "attendance", "classes", "analytics",
  "home", "more", "language", "lessonCard", "progress",
];
const NAMES: Record<LookIconKey, string> = {
  lessons: "book-open", coaching: "audio-lines", observations: "eye", training: "graduation-cap", assessment: "file-pen-line",
  attendance: "calendar-check", classes: "users", analytics: "chart-column", home: "house", more: "ellipsis",
  language: "languages", lessonCard: "list-checks", progress: "award",
};

describe("lookIcons", () => {
  it("has exactly the 13 keys", () => {
    expect(Object.keys(LOOK_ICONS).sort()).toEqual([...KEYS].sort());
  });

  it.each(KEYS)("%s maps to a component that draws its lucide glyph", (k) => {
    const Icon = LOOK_ICONS[k];
    expect(Icon).toBeTruthy();
    const { container } = render(<Icon size={22} />);
    const svg = container.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("class")).toContain(`lucide-${NAMES[k]}`);
  });
});
