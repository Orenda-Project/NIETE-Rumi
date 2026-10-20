import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { COACHING, COACHING_V2_COPY as C } from "./copy";
import { PlanPicker } from "./parts";

/**
 * bd-hsgah5 (operator, 20 Oct): a PDF uploaded as the lesson plan was labelled "Plan photo" / «پلان کی تصویر». An
 * uploaded plan can be a PDF, a Word file or a picture, so the row says "Lesson plan" / «لیسن پلان» for all of them,
 * with the file's name under it. A library pick keeps its own title.
 */
describe("the uploaded lesson plan's label (bd-hsgah5)", () => {
  it.each([
    ["a PDF", new File(["%PDF"], "Grade 4 English — Ch2 Day 6.pdf", { type: "application/pdf" }), false],
    ["a Word file", new File(["x"], "plan.docx"), false],
    ["a photo of the plan", new File(["x"], "IMG_0042.jpg", { type: "image/jpeg" }), true],
  ])("%s says Lesson plan, not Plan photo, with its file name under it", (_what, file, asPhoto) => {
    render(<PlanPicker plan={{ kind: "file", file, asPhoto }} onOpen={() => {}} />);
    expect(screen.getByText(C.lessonPlan)).toBeTruthy();
    expect(screen.getByText(file.name)).toBeTruthy();
    expect(screen.queryByText("Plan photo")).toBeNull();
  });

  it("a library pick keeps its own title", () => {
    render(<PlanPicker plan={{ kind: "library", pick: { lessonId: "g4-eng-ch2-d6" }, title: "Grammar Noun Town", chips: ["Ch 2", "Day 6"] }} onOpen={() => {}} />);
    expect(screen.getByText("Grammar Noun Town")).toBeTruthy();
  });

  it("Urdu: «لیسن پلان», never «پلان کی تصویر» for a file", () => {
    const b = COACHING as unknown as { ur: Record<string, unknown> };
    expect(b.ur.lessonPlan).toBe("لیسن پلان");
    expect(Object.values(b.ur)).not.toContain("پلان کی تصویر");
  });
});
