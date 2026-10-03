import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Mic, Trash2 } from "lucide-react";
import { Chip } from "./Chip";
import { List, Row } from "./List";
import { BottomButton } from "./BottomButton";
import { BUTTON, RECORDING, STATUS, tailwindColors } from "./tokens";
import { tapProblems } from "./checks/rules";

/**
 * bd-5rz1v.26 — the kit's pieces for Coaching.
 *
 * Red means errors and destructive actions (DESIGN.md, the colour rule) — and, in ONE place,
 * recording: the live "Recording" chip with its dot, and the Record live lecture icon. It is the
 * same red as an error, named for what it means here, so a screen says `recording` and never
 * borrows `error` for it.
 *
 * Delete next to a green primary is a red OUTLINE (the account sheet's Logout look): destructive,
 * but the second, quieter choice.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

describe("RECORDING — the error red, named for recording", () => {
  it("is the destructive red on the error tint", () => {
    expect(RECORDING.colour).toBe(BUTTON.destructive.background);
    expect(RECORDING.background).toBe(STATUS.error.background);
    expect(tailwindColors.record).toEqual({ DEFAULT: RECORDING.colour, bg: RECORDING.background });
  });
});

describe("Chip tone=recording", () => {
  it("is a flat red pill led by a dot that pulses only when motion is allowed", () => {
    render(<Chip tone="recording">Recording</Chip>);
    const chip = screen.getByText("Recording").closest("[data-chip]")!;
    expect(classes(chip)).toEqual(expect.arrayContaining(["bg-nu-record-bg", "text-nu-record", "rounded-full"]));
    expect(chip.getAttribute("role")).toBeNull();
    const dot = chip.querySelector("[data-dot]")!;
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(classes(dot)).toEqual(expect.arrayContaining(["bg-nu-record", "rounded-full", "motion-safe:animate-pulse"]));
    expect(classes(dot)).not.toContain("animate-pulse");
  });

  it("other tones have no dot", () => {
    render(<Chip tone="error">Failed</Chip>);
    expect(screen.getByText("Failed").closest("[data-chip]")!.querySelector("[data-dot]")).toBeNull();
  });
});

describe("Row tile=recording", () => {
  it("draws its icon red on the red tint; nothing else about the row changes", () => {
    render(<MemoryRouter><List><Row title="Record live lecture" icon={Mic} tile="recording" onClick={() => {}} /></List></MemoryRouter>);
    const tile = screen.getByTestId("newui-row-tile");
    expect(classes(tile)).toEqual(expect.arrayContaining(["bg-nu-record-bg", "text-nu-record", "h-[42px]", "w-[42px]"]));
    expect(screen.getByRole("button", { name: "Record live lecture" }).querySelector("[data-chevron]")).not.toBeNull();
  });
});

describe("BottomButton tone=dangerOutline", () => {
  it("is the outline button with red words: never a filled red, never green", () => {
    render(<BottomButton tone="dangerOutline" icon={Trash2}>Delete</BottomButton>);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(classes(btn)).toEqual(expect.arrayContaining([
      "h-14", "border-2", "border-nu-button-secondary-border", "bg-nu-button-secondary", "text-nu-button-destructive",
    ]));
    expect(classes(btn)).not.toContain("bg-nu-button-destructive");
    expect(classes(btn)).not.toContain("bg-nu-button");
  });

  it("every new piece is a 56px target", () => {
    render(
      <MemoryRouter>
        <List><Row title="Record live lecture" icon={Mic} tile="recording" onClick={() => {}} /></List>
        <BottomButton tone="dangerOutline">Delete</BottomButton>
        <Chip tone="recording">Recording</Chip>
      </MemoryRouter>,
    );
    expect(tapProblems(document.body)).toEqual([]);
  });
});

describe("the tap check skips what is not on screen", () => {
  it("a hidden file input (opened by a row's tap) is not a target", () => {
    render(<div><input type="file" hidden data-testid="picker" /><button type="button" className="h-10">Small</button></div>);
    expect(tapProblems(document.body)).toEqual([expect.stringMatching(/Small/)]);
  });
});
