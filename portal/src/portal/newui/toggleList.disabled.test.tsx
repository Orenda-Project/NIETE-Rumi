import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToggleList } from "./ToggleList";

/**
 * bd-5rz1v.25 — ToggleList `disabled` (My grades inside the server's 48-hour window): every option
 * is a disabled button, dimmed, and a tap changes nothing.
 */
describe("ToggleList disabled", () => {
  it("disables every option and ignores taps", () => {
    const onChange = vi.fn();
    render(<ToggleList mode="multi" disabled label="Grades" options={[{ key: "p", label: "Primary" }, { key: "m", label: "Middle" }]} value={["p"]} onChange={onChange} />);
    const boxes = screen.getAllByRole("checkbox");
    for (const b of boxes) {
      expect(b).toBeDisabled();
      expect(b.className).toContain("opacity-55");
    }
    fireEvent.click(boxes[1]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is off by default", () => {
    render(<ToggleList label="Grades" options={[{ key: "p", label: "Primary" }]} value={null} onChange={() => {}} />);
    expect(screen.getByRole("radio")).toBeEnabled();
  });
});
