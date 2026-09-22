import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * bd-60168 — one question, rendered the same way on every training.
 *
 * The operator's complaint was hierarchy: "its all same font same color,
 * distinguishing Question number from the question statement a bit difficult."
 * Both quiz surfaces rendered `{i + 1}. {question_text}` as one run of
 * `text-sm font-medium`, so the number read as the first word of the sentence.
 *
 * The four shapes tested here are the four the bank actually holds, audited
 * over 2,730 active questions on 2026-09-22: 4-option MCQ (2,613), open-ended
 * (70), 5-option (40), image options (1). There is no true/false, no
 * multi-select, no matching, and question_urdu is populated zero times — so
 * those paths are deliberately NOT built, and this file records why.
 */

import QuestionCard, { isSentenceCompletion } from "./QuestionCard";

const MCQ = {
  id: 1,
  question_text: "Miss Azra is giving feedback to a student. What is the most accurate analysis?",
  options: ["She is using the terms incorrectly.", "She is distinguishing output from understanding.",
            "She is separating objective from outcome.", "She is being impolite."],
  is_open_ended: false,
};

const FIVE = { ...MCQ, id: 2, options: [...MCQ.options, "None of the above."] };

const OPEN = {
  id: 3,
  question_text: "You are a head teacher working with a team of 8th-grade science teachers…",
  options: [],
  is_open_ended: true,
};

const IMAGES = {
  id: 4,
  question_text: "Following are snapshots of a lesson plan. Which draft is strongest?",
  options: [],
  option_images: ["https://r2.example/a.png", "https://r2.example/b.png",
                  "https://r2.example/c.png", "https://r2.example/d.png"],
  is_open_ended: false,
};

const COMPLETION = {
  id: 5,
  question_text: "Ignoring early warning signs in a classroom usually leads to",
  options: ["poor performance.", "possible problems.", "potential pitfalls.", "practical progress."],
  is_open_ended: false,
};

const MULTI = {
  id: 6,
  question_text: "Which of these are formative assessment strategies?",
  options: ["Exit tickets", "Final exam", "Think-pair-share", "Thumbs up/down"],
  multi: true,
  is_open_ended: false,
};

describe("bd-60168 — QuestionCard", () => {
  it("renders a MULTI-SELECT question as checkboxes, and says so", async () => {
    // Oxbridge has 26 of these. Showing radios makes them unanswerable.
    // My first audit missed them entirely: the signal is not in `options`,
    // it is `correct_option` holding several keys ("1,3,5").
    const onChange = vi.fn();
    render(<QuestionCard question={MULTI} index={0} total={1} value="" onChange={onChange} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText(/select all that apply/i)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("multi-select accumulates and un-picks, sorted, comma-joined", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <QuestionCard question={MULTI} index={0} total={1} value="3" onChange={onChange} />,
    );
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onChange).toHaveBeenCalledWith("1,3");          // sorted, not "3,1"
    rerender(<QuestionCard question={MULTI} index={0} total={1} value="1,3" onChange={onChange} />);
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onChange).toHaveBeenLastCalledWith("3");        // un-picking works
  });

  it("separates the POSITION from the STATEMENT", () => {
    render(<QuestionCard question={MCQ} index={0} total={3} value="" onChange={vi.fn()} />);
    const pos = screen.getByTestId("question-position");
    const stmt = screen.getByTestId("question-statement");
    expect(pos).toHaveTextContent("Question 1 of 3");
    // The number must NOT be inside the statement — that was the bug.
    expect(stmt.textContent).not.toMatch(/^1\./);
    expect(stmt).toHaveTextContent(/Miss Azra/);
    expect(pos).not.toBe(stmt);
  });

  it("renders a 4-option MCQ as real radios inside a fieldset", async () => {
    const onChange = vi.fn();
    render(<QuestionCard question={MCQ} index={0} total={1} value="" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    await userEvent.click(radios[2]);
    expect(onChange).toHaveBeenCalledWith("3");   // 1-based, matches the API
  });

  it("supports a 5-option MCQ — the letters run past D", () => {
    render(<QuestionCard question={FIVE} index={0} total={1} value="" onChange={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByText("E")).toBeInTheDocument();
  });

  it("renders an open-ended question as a textarea, not options", () => {
    render(<QuestionCard question={OPEN} index={2} total={3} value="" onChange={vi.fn()} />);
    expect(screen.getByTestId("answer-3")).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("renders IMAGE options as pictures with letters, still radios", async () => {
    const onChange = vi.fn();
    render(<QuestionCard question={IMAGES} index={0} total={1} value="" onChange={onChange} />);
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(4);
    expect(imgs[0]).toHaveAttribute("alt", "Option A");
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    await userEvent.click(screen.getAllByRole("radio")[1]);
    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("detects a sentence-completion stem, and does not on a normal question", () => {
    expect(isSentenceCompletion(COMPLETION)).toBe(true);
    expect(isSentenceCompletion(MCQ)).toBe(false);          // ends with "?"
    expect(isSentenceCompletion(OPEN)).toBe(false);         // no options
  });

  it("marks an answered question so the pager rail can show it", () => {
    render(<QuestionCard question={MCQ} index={0} total={2} value="2" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Answered")).toBeInTheDocument();
  });
});
