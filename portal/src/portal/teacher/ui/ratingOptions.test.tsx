import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RatingScale } from "./index";

/**
 * bd-4404s7.5 — RatingScale takes the scale the live review form gives (`options`): the framework's own rungs, not a
 * fixed 1–4. The live FICO scale is 0 Not observed / 1 Developing / 2 Proficient, plus N/A (bot: fico-framework
 * SCALE_MAX = 2), so a fixed 1–4 row would offer ratings the bot refuses and hide one it needs. With no `options` the
 * component is exactly what it was (1 2 3 4 N/A).
 */
const FICO = [
  { id: "0", label: "Not observed" },
  { id: "1", label: "Developing" },
  { id: "2", label: "Proficient" },
  { id: "na", label: "" },
];

describe("RatingScale options", () => {
  it("draws one 56px choice per option, the id as its face and N/A for na; the rung's name is spoken", () => {
    render(<RatingScale name="Quality Questioning" value="1" options={FICO} onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(radios.map((r) => r.textContent)).toEqual(["0", "1", "2", "N/A"]);
    expect(screen.getByRole("radio", { name: "1, Developing" })).toHaveAttribute("aria-checked", "true");
    expect(radios.every((r) => /min-h-\[56px\]/.test(r.className))).toBe(true);
  });

  it("reports the option's id, and marks the Digital Coach's pick", () => {
    const onChange = vi.fn();
    render(<RatingScale value={null} dcValue="2" options={FICO} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "2, Proficient, Digital Coach" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "0, Not observed" }));
    expect(onChange).toHaveBeenCalledWith("0");
  });

  it("arrow keys move through the given options", () => {
    const onChange = vi.fn();
    render(<RatingScale value="0" options={FICO} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "0, Not observed" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("without options it is the same 1 2 3 4 N/A", () => {
    render(<RatingScale value={3} onChange={() => {}} />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["1", "2", "3", "4", "N/A"]);
  });
});
