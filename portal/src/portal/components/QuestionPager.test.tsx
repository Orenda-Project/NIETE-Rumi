import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * bd-60168 — pagination that does not punish the biggest vendor.
 *
 * The operator asked for "1 question per page with the next and previous
 * button", and then "make sure these designs also work with other trainings."
 * Those pull against each other, and the real question bank is why:
 *
 *   Taleemabad unit quiz    8-13 short MCQs     (largest vendor: 9,534 teachers)
 *   I-SAPS / Beacon House   1-3 questions
 *   I-SAPS module exam      2 MCQs + one ~1,800-char CRQ
 *
 * Paginating a 13-question quick check replaces one scroll with thirteen
 * page-turns. So the rule is: page when few, or when any question is
 * long-form; otherwise leave the list alone. These tests pin that rule to the
 * MEASURED shapes, so a later "let's just always paginate" has to argue with
 * Taleemabad's numbers rather than with a preference.
 *
 * The second promise: navigation never blocks. A teacher stuck on question 2
 * can answer 3 and come back. Only SUBMIT waits for a complete paper.
 */

import QuestionPager, { shouldPaginate } from "./QuestionPager";

const mcq = (id: number) => ({
  id, question_text: `Question text ${id}?`,
  options: ["One", "Two", "Three", "Four"], is_open_ended: false,
});
const open = (id: number) => ({
  id, question_text: "A long scenario…", options: [], is_open_ended: true,
});

describe("bd-60168 — shouldPaginate, against the real vendor shapes", () => {
  it("pages an I-SAPS module exam (2 MCQs + 1 CRQ)", () => {
    expect(shouldPaginate([mcq(1), mcq(2), open(3)])).toBe(true);
  });

  it("pages a short I-SAPS / Beacon House unit quiz (1-3 questions)", () => {
    expect(shouldPaginate([mcq(1), mcq(2)])).toBe(true);
    expect(shouldPaginate([mcq(1), mcq(2), mcq(3)])).toBe(true);
  });

  it("does NOT page a Taleemabad quick check — 8 to 13 short MCQs", () => {
    expect(shouldPaginate(Array.from({ length: 8 }, (_, i) => mcq(i)))).toBe(false);
    expect(shouldPaginate(Array.from({ length: 13 }, (_, i) => mcq(i)))).toBe(false);
  });

  it("pages a long quiz anyway IF it contains a written answer", () => {
    // Beacon House capstones are long-form; length must not override that.
    const many = [...Array.from({ length: 8 }, (_, i) => mcq(i)), open(99)];
    expect(shouldPaginate(many)).toBe(true);
  });

  it("does not page a single question — there is nothing to page between", () => {
    expect(shouldPaginate([mcq(1)])).toBe(false);
    expect(shouldPaginate([open(1)])).toBe(false);
  });
});

describe("bd-60168 — QuestionPager behaviour", () => {
  const three = [mcq(1), mcq(2), open(3)];

  it("shows one question at a time, with Previous disabled on page 1", async () => {
    render(<QuestionPager questions={three} answers={{}} onAnswer={vi.fn()} />);
    expect(screen.getByTestId("question-pager")).toBeInTheDocument();
    expect(screen.getByTestId("question-position")).toHaveTextContent("Question 1 of 3");
    expect(screen.getByTestId("pager-prev")).toBeDisabled();
  });

  it("Next advances even when the question is UNANSWERED", async () => {
    render(<QuestionPager questions={three} answers={{}} onAnswer={vi.fn()} />);
    await userEvent.click(screen.getByTestId("pager-next"));
    expect(screen.getByTestId("question-position")).toHaveTextContent("Question 2 of 3");
  });

  it("the rail jumps straight to a question", async () => {
    render(<QuestionPager questions={three} answers={{}} onAnswer={vi.fn()} />);
    await userEvent.click(screen.getByTestId("pager-step-3"));
    expect(screen.getByTestId("question-position")).toHaveTextContent("Question 3 of 3");
  });

  it("counts answers, and hands the caller the OUTSTANDING ones on the last page", async () => {
    const seen: number[][] = [];
    render(
      <QuestionPager
        questions={three}
        answers={{ 1: "2" }}
        onAnswer={vi.fn()}
        footer={({ unanswered }) => { seen.push(unanswered); return <span>footer</span>; }}
      />,
    );
    await userEvent.click(screen.getByTestId("pager-step-3"));
    expect(screen.getByTestId("pager-count")).toHaveTextContent("1 of 3 answered");
    expect(seen.at(-1)).toEqual([2, 3]);   // question 1 is done
  });

  it("renders a flat list — and the footer — when it should not page", () => {
    const many = Array.from({ length: 9 }, (_, i) => mcq(i + 1));
    render(
      <QuestionPager questions={many} answers={{}} onAnswer={vi.fn()}
        footer={() => <span data-testid="submit-here">submit</span>} />,
    );
    expect(screen.getByTestId("question-list")).toBeInTheDocument();
    expect(screen.queryByTestId("question-pager")).not.toBeInTheDocument();
    expect(screen.getByTestId("submit-here")).toBeInTheDocument();
  });
});
