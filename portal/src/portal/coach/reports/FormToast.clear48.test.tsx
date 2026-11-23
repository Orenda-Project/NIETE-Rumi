import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormToast } from "./FormV7";
import { RecordingBarShownContext } from "../../lib/recordingBarShown";

/**
 * bd-o15qnr.48 (queue #244, the 390 px walk on sandbox) — the Feedback Form's toast ("1 item still needs an answer",
 * "3 sections to check") stood 104 px up, on top of the dock's button (the dock is 88 px up, 76 px tall: 88–164), so the
 * button she had just tapped — Agree and next, Save, Submit — was covered until the toast went. With a recording's bar
 * the dock moves 60 px up and the toast did not follow. Now the toast stands just above the dock, both ways.
 */
const TOAST = { id: 1, text: "1 item still needs an answer" };

describe("the form's toast stands clear of the dock", () => {
  it("no recording bar: above the dock (88 px + 76 px), with the notice and the safe area", () => {
    render(<FormToast toast={TOAST as never} onDone={() => undefined} />);
    const t = screen.getByTestId("ff-toast");
    expect(t.className).toContain("bottom-[calc(172px+var(--notice-h,0px)+env(safe-area-inset-bottom))]");
    expect(t.className).not.toContain("bottom-[104px]");
  });

  it("a recording's bar above the menu: the dock is 60 px higher, and so is the toast", () => {
    render(<RecordingBarShownContext.Provider value={true}><FormToast toast={TOAST as never} onDone={() => undefined} /></RecordingBarShownContext.Provider>);
    expect(screen.getByTestId("ff-toast").className).toContain("bottom-[calc(232px+var(--notice-h,0px)+env(safe-area-inset-bottom))]");
  });
});
