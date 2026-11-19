import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { RatingScale } from "./index";

/**
 * RatingScale's two small extensions for the lesson-plan survey bar:
 *   RatingOption.icon  a lucide icon drawn before the option's words (hidden from a screen reader: the words say it);
 *   disabled           while an answer saves, the choices she did not pick cannot be tapped (the picked one stays shown).
 * Without either, the scale is exactly what it was (no svg, nothing disabled).
 */
const OPTIONS = [
  { id: "yes", text: "Useful", icon: ThumbsUp },
  { id: "no", text: "Not useful", icon: ThumbsDown },
];

describe("RatingScale icon", () => {
  it("draws the icon before the words in a row, hidden from a screen reader; the name is the words", () => {
    render(<RatingScale name="This plan" value={null} options={OPTIONS} onChange={() => {}} />);
    const yes = screen.getByRole("radio", { name: "Useful" });
    const svg = yes.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(yes.textContent).toBe("Useful");
    expect(yes.className).toMatch(/min-h-\[56px\]/);
  });

  it("draws it in a stacked scale too", () => {
    render(<RatingScale stacked value={null} options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Not useful" }).querySelector("svg")).not.toBeNull();
  });

  it("without icons, no svg is drawn (today's scale)", () => {
    render(<RatingScale value={3} onChange={() => {}} />);
    expect(screen.getAllByRole("radio").some((r) => r.querySelector("svg"))).toBe(false);
  });
});

describe("RatingScale disabled", () => {
  it("the choices not picked cannot be tapped; the picked one stays checked", () => {
    const onChange = vi.fn();
    render(<RatingScale disabled value="yes" options={OPTIONS} onChange={onChange} />);
    const no = screen.getByRole("radio", { name: "Not useful" }) as HTMLButtonElement;
    expect(no.disabled).toBe(true);
    fireEvent.click(no);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Useful" })).toHaveAttribute("aria-checked", "true");
  });

  it("not disabled by default", () => {
    render(<RatingScale value={null} options={OPTIONS} onChange={() => {}} />);
    expect(screen.getAllByRole("radio").every((r) => !(r as HTMLButtonElement).disabled)).toBe(true);
  });
});
