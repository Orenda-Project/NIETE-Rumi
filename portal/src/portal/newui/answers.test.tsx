import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AnswerChoices, QuestionDots } from "./Answers";
import { tapProblems } from "./checks/rules";

/**
 * bd-5rz1v.25 — answering one question per screen (deep-screens.html, Training 6 `.ans`, `.dots`).
 *
 *   AnswerChoices  big answer buttons, a letter tile then the answer: 58px or more, 16px corners,
 *                  2px edges. The picked one is SELECTED, so indigo (edge, tint and its letter).
 *                  One choice is a radio group; "pick all" questions are checkboxes.
 *                  Options that are pictures show the picture under the letter.
 *   QuestionDots   where she is: one bar per question, indigo up to the current one. Information,
 *                  never a button.
 */

const OPTS = ["Shout louder", "Use the quiet signal", "Stop the activity", "Ignore it"];

describe("AnswerChoices — one answer", () => {
  it("is a radio group of A–D, each with its letter and its answer", () => {
    render(<AnswerChoices label="Answers" options={OPTS} value={[]} onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Answers" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(radios.map((r) => r.querySelector("[data-letter]")?.textContent)).toEqual(["A", "B", "C", "D"]);
    expect(radios[1]).toHaveTextContent("Use the quiet signal");
  });

  it("the picked answer is indigo (edge, tint, its letter); the others are not", () => {
    render(<AnswerChoices label="Answers" options={OPTS} value={[1]} onChange={() => {}} />);
    const [a, b] = screen.getAllByRole("radio");
    expect(b).toHaveAttribute("aria-checked", "true");
    expect(b.className).toContain("border-nu-select");
    expect(b.className).toContain("bg-nu-select-tint");
    expect(b.querySelector("[data-letter]")?.className).toContain("bg-nu-select");
    expect(a).toHaveAttribute("aria-checked", "false");
    expect(a.className).not.toContain("border-nu-select ");
  });

  it("a tap picks that one, replacing the last", () => {
    const onChange = vi.fn();
    render(<AnswerChoices label="Answers" options={OPTS} value={[0]} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("radio")[2]);
    expect(onChange).toHaveBeenCalledWith([2]);
  });

  it("five options run to E", () => {
    render(<AnswerChoices label="Answers" options={[...OPTS, "Wait"]} value={[]} onChange={() => {}} />);
    expect(screen.getAllByRole("radio")[4].querySelector("[data-letter]")?.textContent).toBe("E");
  });
});

describe("AnswerChoices — pick all", () => {
  it("is a group of checkboxes; a tap adds or removes, kept in order", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AnswerChoices mode="multi" label="Answers" options={OPTS} value={[2]} onChange={onChange} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    fireEvent.click(boxes[0]);
    expect(onChange).toHaveBeenLastCalledWith([0, 2]);
    rerender(<AnswerChoices mode="multi" label="Answers" options={OPTS} value={[0, 2]} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("checkbox")[2]);
    expect(onChange).toHaveBeenLastCalledWith([0]);
  });
});

describe("AnswerChoices — pictures", () => {
  it("shows each picture with its letter", () => {
    render(<AnswerChoices label="Answers" options={[]} images={["/a.png", "/b.png"]} value={[]} onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[1].querySelector("img")).toHaveAttribute("src", "/b.png");
  });
});

describe("QuestionDots", () => {
  it("one bar per question, indigo up to and including the current one; not tappable", () => {
    const { container } = render(<QuestionDots label="Question 2/5" total={5} current={1} />);
    const bars = container.querySelectorAll("[data-dot]");
    expect(bars).toHaveLength(5);
    expect(Array.from(bars).map((b) => b.getAttribute("data-on"))).toEqual(["true", "true", "false", "false", "false"]);
    expect(container.querySelector("button")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "Question 2/5" })).toHaveAttribute("aria-valuenow", "2");
  });
});

describe("the tap rule", () => {
  it("every answer is a 56px target or more", () => {
    render(
      <>
        <AnswerChoices label="Answers" options={OPTS} value={[1]} onChange={() => {}} />
        <AnswerChoices mode="multi" label="Answers" options={OPTS} value={[]} onChange={() => {}} />
        <AnswerChoices label="Answers" options={[]} images={["/a.png"]} value={[]} onChange={() => {}} />
      </>,
    );
    expect(tapProblems(document.body)).toEqual([]);
  });
});
