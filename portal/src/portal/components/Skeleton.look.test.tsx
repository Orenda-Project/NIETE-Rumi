/**
 * bd-1q4z4o — while the session and the flags are read on the teacher Home (WhatsApp's link lands there), the app's
 * placeholder frame continues index.html's outline: the Home look's navy band, nine tiles three per row climbing into it,
 * and the look's tab bar. Before this it drew the classic grey two-column outline, then jumped to the navy Home.
 */
import { render, screen } from "@testing-library/react";
import { FrameSkeleton } from "./Skeleton";
import { frameFor, writeShellHint, SHELL_HINT_KEY } from "../lib/shellHint";

describe("the teacher Home's placeholder frame", () => {
  afterEach(() => localStorage.clear());

  it("FrameSkeleton teacher-look: the band, then nine tile outlines three per row, climbing 28 px into it", () => {
    render(<FrameSkeleton variant="teacher-look" />);
    const frame = document.querySelector('[data-frame="teacher-look"]')!;
    expect(frame).not.toBeNull();
    expect(screen.getByTestId("frame-look-band")).toBeTruthy();
    const grid = screen.getByTestId("frame-look-tiles");
    expect(grid.className.split(" ")).toEqual(expect.arrayContaining(["grid-cols-3", "-mt-7"]));
    expect(grid.children).toHaveLength(9);
    expect(frame.getAttribute("aria-busy")).toBe("true");
  });

  it("frameFor: the Home path gets the look's frame unless this device last showed the classic portal", () => {
    expect(frameFor("/portal/teacher")).toBe("teacher-look");
    writeShellHint("teacher");
    expect(frameFor("/portal/teacher/")).toBe("teacher-look");
    expect(frameFor("/portal/teacher/lessons")).toBe("teacher");
    writeShellHint("classic");
    expect(frameFor("/portal/teacher")).toBe("classic");
    localStorage.removeItem(SHELL_HINT_KEY);
    expect(frameFor("/portal/dashboard")).toBe("classic");
  });
});
