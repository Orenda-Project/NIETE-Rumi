import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextButton } from "./FormV7";

/**
 * bd-o15qnr.48 (queue #244, the 390 px walk on sandbox) — a section's dock button names the next indicator to check
 * ("Next to check: C1 Quality of Questions Asked by the Teacher"). In the 56 px button with no side padding it wrapped
 * to two lines that ran edge to edge. Now it is one line inside the button's padding, cut with "…" (the full words stay
 * its name for a screen reader), in the 1-5 form and the 6-12 FICO-S form alike.
 */
const LONG = "Next to check: C1 Quality of Questions Asked by the Teacher";

describe("the dock's Next to check button", () => {
  it("one line: its words are cut, not wrapped, inside the button's padding; the full words are its name", () => {
    render(<div style={{ width: 358 }}><NextButton label={LONG} onClick={() => undefined} /></div>);
    const b = screen.getByRole("button", { name: LONG });
    expect(b.className).toMatch(/\bmin-w-0\b/);
    expect(b.className).toMatch(/\bpx-4\b/);
    const words = b.querySelector("span");
    expect(words?.className).toMatch(/\btruncate\b/);
    expect(words?.textContent).toBe(LONG);
  });

  it("both forms draw it with NextButton (1-5 FormV7List, 6-12 Obs612Form)", () => {
    for (const f of ["FormV7List.tsx", "Obs612Form.tsx"]) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      expect(src).toMatch(/<NextButton\b[^\n]*label=\{next\.label\} \/>/);
      expect(src).not.toMatch(/<BottomButton[^>]*>\{next\.label\}<\/BottomButton>/);
    }
  });
});
