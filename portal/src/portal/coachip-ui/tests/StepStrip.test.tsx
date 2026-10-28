import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepStrip } from "../StepStrip";

describe("StepStrip", () => {
  it("one segment per step: done green, current outlined, not done grey, never red; LTR by default", () => {
    render(<StepStrip steps={[{ label: "Hook", state: "done" }, { label: "I do", state: "current" }, { label: "We do", state: "todo" }]} />);
    const strip = screen.getByTestId("cp-step-strip");
    expect(strip.getAttribute("dir")).toBe("ltr");
    const segs = Array.from(strip.querySelectorAll("li > span[aria-hidden]"));
    expect(segs.map((s) => s.className.includes("bg-cp-green") ? "g" : s.className.includes("border-cp-green") ? "o" : "t")).toEqual(["g", "o", "t"]);
    expect(strip.innerHTML).not.toMatch(/red|#e/i);
  });
});
