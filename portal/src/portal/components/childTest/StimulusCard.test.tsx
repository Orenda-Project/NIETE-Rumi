import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReadingStimulus, MathsStimulus } from "./StimulusCard";
import { COPY } from "../../lib/childTest/copy";

// bd-s1oo0.7 — the portal's global CSS sets `[dir=rtl] .grid > * { direction: rtl }`
// and `[dir=rtl] { text-align: right }`. Inside the Urdu page that turned the
// child's "5 - 1" into "1 - 5" on screen and right-aligned the English story
// (seen in the 375×812 screenshots). Every child-facing element therefore
// carries its direction INLINE, which beats the stylesheet.

const english: any = {
  block: "english", grade: 3, form: "A", timedSeconds: 60, cue: { start: "s", stop: "t" },
  child: { story: { id: "e", title: null, text: "Imran woke up early." }, nonwords: [{ id: "n", text: "rup" }], fallback: null },
  coach: { questions: [{ id: "q", prompt: "What?" }], firstSounds: [] },
};
const maths: any = {
  block: "maths", grade: 3, form: "A", timedSeconds: 60, cue: { start: null, stop: null },
  child: { numbers: [47], quickSums: ["5 - 1"], written: [] },
  coach: { numbersStopRule: null, numberIds: [], writtenIds: [], wordProblem: null },
};

function inRtlPage(ui: JSX.Element) {
  return render(<div dir="rtl">{ui}</div>);
}

describe("stimulus direction inside the Urdu page", () => {
  it("the English story is left-to-right and left-aligned, inline", () => {
    inRtlPage(<ReadingStimulus card={english} view="story" copy={COPY.ur} />);
    const p = screen.getByTestId("story-text");
    expect(p.style.direction).toBe("ltr");
    expect(p.style.textAlign).toBe("left");
  });

  it("every maths cell is left-to-right inline, so 5 - 1 stays 5 - 1", () => {
    inRtlPage(<MathsStimulus card={maths} view="sums" copy={COPY.ur} />);
    const cell = screen.getByText("5 - 1");
    expect(cell.style.direction).toBe("ltr");
    expect(cell.style.unicodeBidi).toBe("isolate");
  });

  it("English made-up words are left-to-right too", () => {
    inRtlPage(<ReadingStimulus card={english} view="after" copy={COPY.ur} />);
    expect(screen.getByText("rup").style.direction).toBe("ltr");
  });
});
