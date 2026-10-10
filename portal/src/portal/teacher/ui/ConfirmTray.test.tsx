import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Check } from "lucide-react";
import { tapProblems } from "../../newui/checks/rules";
import { ConfirmTray } from "./ConfirmTray";
import { ConfirmTray as FromIndex } from "./index";

/**
 * ConfirmTray: the kit's one "are you sure?" sheet (a recording's Finish / Stop asks first). It is the Tray, with a
 * title, an optional line, chips and an amber warning, then TWO kit buttons stacked: the primary (indigo) over the
 * secondary (white outline). Both are full width and 56px — never `flex-1`, which in a column lets the flex basis
 * squash a 56px button down to its text (the teacher's "Finish lesson" sheet drew 26px buttons that way).
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

function renderTray(over: Partial<React.ComponentProps<typeof ConfirmTray>> = {}) {
  const props = {
    open: true,
    title: "Finish lesson",
    onClose: vi.fn(),
    confirmLabel: "Yes, finish",
    onConfirm: vi.fn(),
    cancelLabel: "Keep recording",
    ...over,
  };
  render(<ConfirmTray {...props} />);
  return props;
}

describe("ConfirmTray", () => {
  it("is exported from the kit's index", () => {
    expect(FromIndex).toBe(ConfirmTray);
  });

  it("a Tray dialog named by its title", () => {
    renderTray();
    const dialog = screen.getByRole("dialog", { name: "Finish lesson" });
    expect(dialog).toHaveAttribute("data-state", "open");
    expect(classes(dialog)).toEqual(expect.arrayContaining(["bg-[#f3f4f6]", "rounded-t-[22px]"]));
  });

  it("the two actions are kit buttons, full width and 56px, stacked in one column with a gap — primary first", () => {
    renderTray({ confirmIcon: Check });
    const actions = screen.getByTestId("confirm-tray-actions");
    expect(classes(actions)).toEqual(expect.arrayContaining(["flex", "flex-col", "gap-3"]));
    const [yes, keep] = within(actions).getAllByRole("button");
    expect(yes).toHaveTextContent("Yes, finish");
    expect(keep).toHaveTextContent("Keep recording");
    for (const b of [yes, keep]) {
      expect(classes(b)).toEqual(expect.arrayContaining(["w-full", "min-h-[56px]", "rounded-2xl", "text-[16px]", "font-semibold"]));
      expect(classes(b)).not.toContain("flex-1");
    }
    expect(classes(yes)).toEqual(expect.arrayContaining(["bg-[#33374a]", "text-white"]));
    expect(classes(keep)).toEqual(expect.arrayContaining(["bg-white", "text-[#33374a]", "border"]));
    expect(yes.querySelector("svg")).not.toBeNull();
    expect(tapProblems(document.body)).toEqual([]);
  });

  it("Yes calls onConfirm; the secondary closes (onClose) unless it is given its own onCancel", () => {
    const p = renderTray();
    fireEvent.click(screen.getByRole("button", { name: "Yes, finish" }));
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep recording" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("onCancel, when given, is the secondary's", () => {
    const onCancel = vi.fn();
    const p = renderTray({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: "Keep recording" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it("the line, the chips (status tones) and the amber warning, when given", () => {
    renderTray({ line: "You recorded 6 minutes.", chips: [{ text: "6 min" }, { text: "Short lesson", tone: "waiting" }], warning: "That is short." });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("You recorded 6 minutes.")).toBeInTheDocument();
    const chips = [...dialog.querySelectorAll("[data-chip]")];
    expect(chips.map((c) => c.textContent)).toEqual(["6 min", "Short lesson"]);
    expect(classes(chips[1])).toEqual(expect.arrayContaining(["bg-[#fef3c7]", "text-[#b45309]"]));
    const note = within(dialog).getByRole("note");
    expect(note).toHaveTextContent("That is short.");
    expect(classes(note)).toEqual(expect.arrayContaining(["bg-[#fef3c7]", "text-[#b45309]"]));
  });

  it("nothing but the title and the buttons when there is no line, chip or warning", () => {
    renderTray();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("[data-chip]").length).toBe(0);
    expect(within(dialog).queryByRole("note")).toBeNull();
    expect(within(dialog).getAllByRole("button").map((b) => b.getAttribute("aria-label") || b.textContent)).toEqual(["Close", "Yes, finish", "Keep recording"]);
  });

  it("closed draws nothing", () => {
    renderTray({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
