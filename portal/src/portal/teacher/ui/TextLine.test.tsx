import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { tapProblems } from "../../newui/checks/rules";
import { TextLine } from "./index";

/**
 * TextLine — the kit's one-line box for her own words: a visible label over a 56px input, tied to it; `dir="auto"`;
 * `maxLength`; `describedBy` for the page's message. Words are the screen's (props), never the kit's.
 */
describe("TextLine", () => {
  it("a labelled 56px box: the label names it, dir auto, the limit and the message id on the input", () => {
    const { container } = render(<TextLine label="What was wrong" value="" onChange={() => {}} maxLength={280} describedBy="msg-1" />);
    const box = screen.getByRole("textbox", { name: "What was wrong" }) as HTMLInputElement;
    expect(box.getAttribute("dir")).toBe("auto");
    expect(box.maxLength).toBe(280);
    expect(box.getAttribute("aria-describedby")).toBe("msg-1");
    expect(box.className).toMatch(/min-h-\[56px\]/);
    expect(tapProblems(container)).toEqual([]);
  });

  it("reports what she types", () => {
    const onChange = vi.fn();
    render(<TextLine label="What was wrong" value="" onChange={onChange} maxLength={280} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "سرگرمی لمبی تھی" } });
    expect(onChange).toHaveBeenCalledWith("سرگرمی لمبی تھی");
  });
});
