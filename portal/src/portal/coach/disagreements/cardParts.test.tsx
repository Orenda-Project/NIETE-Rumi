import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClipProvider, ItemRow, ReasonBlock } from "./cardParts";

/** bd-tbprit.3 — a grader item and a reason block on their own: missing data reads —, one clip open at a time. */
const item = (id: string, at: number | null, score: number | null = 2) => ({ id, name: `Ind ${id}`, score, evidence: null, at, applicable: true });

describe("card parts", () => {
  it("an item without a score reads —, without a quote shows none", () => {
    render(<ClipProvider id="r"><ul><ItemRow item={item("X", null, null)} k="x" /></ul></ClipProvider>);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(document.querySelector("q")).toBeNull();
  });

  it("opening a second Listen closes the first", () => {
    render(<ClipProvider id="r"><ReasonBlock e={{ code: "score", items: [item("A", 65), item("B", 125)] }} /></ClipProvider>);
    const [a, b] = screen.getAllByRole("button", { name: /Listen/ });
    expect(a).toHaveTextContent("1:05");
    fireEvent.click(a);
    fireEvent.click(b);
    const clips = document.querySelectorAll('audio[src*="/clip"]');
    expect(clips).toHaveLength(1);
    expect(clips[0].getAttribute("src")).toMatch(/clip\?at=125$/);
  });

  it("won't work with no thing on record reads —", () => {
    render(<ClipProvider id="r"><ReasonBlock e={{ code: "wont_work", thing: null }} /></ClipProvider>);
    expect(screen.getByTestId("reason-wont_work")).toHaveTextContent("—");
  });
});
