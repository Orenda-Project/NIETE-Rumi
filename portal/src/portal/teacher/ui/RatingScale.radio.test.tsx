import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { RatingScale } from "./index";

/**
 * bd-o15qnr.28 (v7; #188's canvas, m9-ff-v6) — RatingScale's `look="radio"`: the Feedback Form's levels as the v7 boards
 * draw them. One full-width 56px row per rung (a radio dot at the start, the rung's name, its words); the picked row
 * tinted with a filled dot; the Digital Coach's row edged purple with `dcTag` ("Rumi") at its end. Options marked
 * `aside` (N/A, Couldn't tell) follow as pills in 56px targets, in the SAME radiogroup. Without `look`, nothing changes.
 */
const OPTIONS = [
  { id: "1", label: "Not Observed", description: "No question at all" },
  { id: "2", label: "Developing" },
  { id: "3", label: "Proficient", description: "Two open questions" },
  { id: "4", label: "Highly Effective" },
  { id: "NA", text: "N/A", label: "No question asked", aside: true },
  { id: "IE", text: "Couldn't tell", aside: true },
];

const renderScale = (props: Partial<Parameters<typeof RatingScale>[0]> = {}) => {
  const onChange = vi.fn();
  render(<RatingScale look="radio" name="C1" value="3" dcValue="2" dcTag="Rumi" options={OPTIONS} onChange={onChange}
    copy={{ digitalCoach: "Rumi’s level" }} {...props} />);
  return onChange;
};

describe("RatingScale look=radio", () => {
  it("one 56px row per rung: the name and its words; the picked one checked, with a filled dot", () => {
    renderScale();
    const group = screen.getByRole("radiogroup", { name: "C1" });
    expect(group).toHaveAttribute("data-look", "radio");
    const picked = screen.getByRole("radio", { name: "Proficient" });
    expect(picked).toHaveAttribute("aria-checked", "true");
    expect(picked.className).toMatch(/min-h-\[56px\]/);
    expect(within(picked).getByText("Two open questions")).toBeInTheDocument();
    expect(picked.querySelector("[data-dot]")?.getAttribute("data-dot")).toBe("on");
    expect(screen.getByRole("radio", { name: "Highly Effective" }).querySelector("[data-dot]")?.getAttribute("data-dot")).toBe("off");
  });

  it("the Digital Coach's rung: edged purple, its tag at the end, spoken as the caller names it", () => {
    renderScale();
    const dc = screen.getByRole("radio", { name: "Developing, Rumi’s level" });
    expect(within(dc).getByText("Rumi")).toBeInTheDocument();
    expect(dc.className).toMatch(/border-\[#6e52e0\]/);
    expect(screen.getAllByText("Rumi")).toHaveLength(1);
  });

  it("asides are pills in the same group, in 56px targets; a tap picks them", () => {
    const onChange = renderScale();
    const pills = screen.getAllByTestId("level-aside");
    expect(pills.map((p) => p.textContent)).toEqual(["N/A · No question asked", "Couldn't tell"]);
    expect(pills.every((p) => /min-h-\[56px\]/.test(p.className))).toBe(true);
    expect(screen.getByRole("radiogroup", { name: "C1" })).toContainElement(pills[1]);
    fireEvent.click(pills[1]);
    expect(onChange).toHaveBeenCalledWith("IE");
  });

  it("arrow keys move from the rows into the asides", () => {
    const onChange = renderScale({ value: "4", dcValue: null });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Highly Effective" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith("NA");
  });

  it("without look, the scale is today's (no dots, no tag, no asides)", () => {
    render(<RatingScale stacked name="C1" value="3" dcValue="2" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "C1" })).not.toHaveAttribute("data-look");
    expect(document.querySelector("[data-dot]")).toBeNull();
    expect(screen.queryAllByTestId("level-aside")).toEqual([]);
  });
});
