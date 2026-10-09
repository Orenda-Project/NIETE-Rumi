import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeaveNote } from "./LeaveNote";

/**
 * bd-fmf24g.15 — LeaveNote (COMPONENTS.md §12): on a waiting page (a plan being prepared, a paper being written) a
 * white card with a bell and the sentence "You can leave. We'll tell you here." The words are the screen's (a
 * sentence is not a kit label); the kit draws the card.
 */
describe("LeaveNote", () => {
  it("a white card, a bell, the screen's words; announced politely", () => {
    const { container } = render(<LeaveNote text="You can leave. We'll tell you here." />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("You can leave. We'll tell you here.");
    expect(note.getAttribute("class")).toContain("bg-white");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
