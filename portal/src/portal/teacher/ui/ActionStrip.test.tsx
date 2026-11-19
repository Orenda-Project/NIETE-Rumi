import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AudioLines, Download, KeyRound } from "lucide-react";
import { tapProblems } from "../../newui/checks/rules";
import { ActionStrip } from "./ActionStrip";

/**
 * ActionStrip — one slim row of 1–3 equal action cells (the plan screen's Observe · Answer key · Download): an icon over
 * a 16px/600 word, each cell a 56px+ target, dividers on the start edge only, the row may grow in Urdu but never clips.
 * A cell is a link (`to`) or a button (`onPress`). `state` replaces the cell's word (Opening… / Paste in browser) and is
 * announced. No cells → nothing drawn.
 */
const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("ActionStrip", () => {
  it("three equal cells, icon over the word, 56px targets, a link and buttons", () => {
    const onKey = vi.fn();
    const { container } = inRouter(
      <ActionStrip items={[
        { key: "observe", icon: AudioLines, label: "Observe", spoken: "Start DC observation", to: "/dc" },
        { key: "key", icon: KeyRound, label: "Answer key", onPress: onKey },
        { key: "download", icon: Download, label: "Download", onPress: () => {} },
      ]} />,
    );
    const cells = screen.getAllByTestId(/^action-strip-/);
    expect(cells).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Start DC observation" })).toHaveAttribute("href", "/dc");
    fireEvent.click(screen.getByRole("button", { name: "Answer key" }));
    expect(onKey).toHaveBeenCalledTimes(1);
    for (const c of cells) {
      expect(classes(c)).toEqual(expect.arrayContaining(["min-h-[56px]", "flex-1", "basis-0", "flex-col"]));
      expect(c.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }
    // the word is 16px/600 and may wrap in Urdu (never truncated)
    const word = cells[1].querySelector("[data-word]") as Element;
    expect(classes(word)).toEqual(expect.arrayContaining(["text-[16px]", "font-semibold"]));
    expect(classes(word)).not.toContain("truncate");
    // dividers on the start edge, after the first cell only
    expect(classes(cells[0])).not.toContain("border-s");
    expect(classes(cells[1])).toContain("border-s");
    expect(tapProblems(container)).toEqual([]);
  });

  it("a state word replaces the cell's word and is announced", () => {
    inRouter(<ActionStrip items={[{ key: "download", icon: Download, label: "Download", state: "Opening…", onPress: () => {} }]} />);
    const cell = screen.getByTestId("action-strip-download");
    expect(cell).toHaveTextContent("Opening…");
    expect(cell).not.toHaveTextContent("Download");
    expect(cell.querySelector("[aria-live='polite']")).not.toBeNull();
  });

  it("one or two cells share the row evenly", () => {
    inRouter(<ActionStrip items={[{ key: "k", icon: KeyRound, label: "Answer key", onPress: () => {} }, { key: "d", icon: Download, label: "Download", onPress: () => {} }]} />);
    expect(screen.getAllByTestId(/^action-strip-/).every((c) => classes(c).includes("flex-1"))).toBe(true);
  });

  it("no cells → nothing drawn", () => {
    const { container } = inRouter(<ActionStrip items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
