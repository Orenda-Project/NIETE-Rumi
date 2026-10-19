import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import type { LiveState } from "../../lib/live/liveMovesState";
import { LiveMovesList, LiveMovesPanel } from "./LiveMovesList";
import { MoveTapSheet } from "./MoveTapSheet";

// bd-v0toag.31 — the step list a group D teacher sees while she records (layout option A): the caveat,
// each section with its minutes, ✓ done / ▶ now (amber, with what to say) / ○ to come, and a tap on any
// move to agree or disagree. Ticks only ever say done: nothing here says "missed" or shows red.

const move = (idx: number, sec: string, ticked = false) => ({
  idx, sec, chip: "C", do: `Do ${idx}`, say: `Say ${idx}`, covers: [`m${idx}`],
  ticked, tickedAtMs: ticked ? 60_000 : null, lastTap: null,
});
const STATE: LiveState = {
  lessonId: "g4-eng-ch12-seg1", stamp: "s1",
  sections: [{ sec: "open", minutes: 5 }, { sec: "we", minutes: 12 }],
  moves: [move(0, "open", true), move(1, "we"), move(2, "we")],
  taps: [],
};

beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
afterEach(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

describe("LiveMovesList", () => {
  it("shows caveat in current language", async () => {
    const { rerender } = render(<LiveMovesList state={STATE} now={1} status="live" onTap={() => {}} />);
    expect(screen.getByText(/Ticks are the app's best guess from the recording and can be wrong in a busy class\. Tap any move to agree or disagree\./)).toBeTruthy();
    await act(async () => { await i18n.changeLanguage("ur"); });
    rerender(<LiveMovesList state={STATE} now={1} status="live" onTap={() => {}} />);
    expect(screen.getByText(/ٹِک ریکارڈنگ سے ایپ کا اندازہ ہیں/)).toBeTruthy();
  });

  it("renders ✓ ▶ ○ and the now say line", () => {
    render(<LiveMovesList state={STATE} now={1} status="live" onTap={() => {}} />);
    expect(screen.getByText("Open · 5 min")).toBeTruthy();
    expect(screen.getByText("We Do · 12 min")).toBeTruthy();
    expect(screen.getByTestId("live-move-0").getAttribute("data-mark")).toBe("done");
    expect(screen.getByTestId("live-move-1").getAttribute("data-mark")).toBe("now");
    expect(screen.getByTestId("live-move-2").getAttribute("data-mark")).toBe("later");
    expect(screen.getByTestId("live-move-0").textContent).toContain("✓");
    expect(screen.getByTestId("live-move-1").textContent).toContain("▶");
    expect(screen.getByTestId("live-move-2").textContent).toContain("○");
    expect(screen.getByTestId("live-move-1").className).toMatch(/#fff7d6/);
    expect(screen.getByText(/Say 1/)).toBeTruthy();
    expect(screen.queryByText(/Say 0/)).toBeNull();
    expect(screen.queryByText(/Say 2/)).toBeNull();
  });

  it("no element says missed or uses red for a move", () => {
    const { container } = render(<LiveMovesList state={STATE} now={2} status="paused" onTap={() => {}} />);
    expect(container.textContent).not.toMatch(/miss/i);
    expect(container.innerHTML).not.toMatch(/red|#ff4d4d|destructive/i);
  });

  it("paused line when status paused", () => {
    const { rerender } = render(<LiveMovesList state={STATE} now={1} status="live" onTap={() => {}} />);
    expect(screen.queryByText("Live ticks paused. Your recording is safe.")).toBeNull();
    rerender(<LiveMovesList state={STATE} now={1} status="paused" onTap={() => {}} />);
    expect(screen.getByText("Live ticks paused. Your recording is safe.")).toBeTruthy();
    rerender(<LiveMovesList state={STATE} now={1} status="off" onTap={() => {}} />);
    expect(screen.getByText("Live ticks paused. Your recording is safe.")).toBeTruthy();
  });

  it("a tap on a move gives its idx", () => {
    const onTap = vi.fn();
    render(<LiveMovesList state={STATE} now={1} status="live" onTap={onTap} />);
    fireEvent.click(screen.getByTestId("live-move-2"));
    expect(onTap).toHaveBeenCalledWith(2);
  });
});

describe("MoveTapSheet", () => {
  it("tap on ✓ offers two choices, on ○ one", () => {
    const onChoose = vi.fn();
    const { rerender } = render(<MoveTapSheet ticked onChoose={onChoose} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Yes, I did this" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "No, I didn't" }));
    expect(onChoose).toHaveBeenLastCalledWith("did_not");
    rerender(<MoveTapSheet ticked={false} onChoose={onChoose} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "No, I didn't" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I did this" }));
    expect(onChoose).toHaveBeenLastCalledWith("did");
  });
});

describe("LiveMovesPanel", () => {
  it("tap a move, choose, and the choice goes to the hook; the sheet closes", () => {
    const tap = vi.fn();
    render(<LiveMovesPanel live={{ state: STATE, now: 1, status: "live", tap }} />);
    fireEvent.click(screen.getByTestId("live-move-0"));
    fireEvent.click(screen.getByRole("button", { name: "Yes, I did this" }));
    expect(tap).toHaveBeenCalledWith(0, "did");
    expect(screen.queryByRole("button", { name: "Yes, I did this" })).toBeNull();
  });

  it("no state → nothing", () => {
    const { container } = render(<LiveMovesPanel live={{ state: null, now: null, status: "live", tap: vi.fn() }} />);
    expect(container.innerHTML).toBe("");
  });
});
