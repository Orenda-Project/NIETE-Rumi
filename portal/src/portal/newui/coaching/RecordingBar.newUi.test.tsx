import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import RecordingBar, { NEW_BAR_STYLE } from "../../components/RecordingBar";
import type { RecordingSession } from "../../lib/recordingSession";
import { RecordingBarShownContext } from "../../lib/recordingBarShown";
import { BottomActions, BottomButton } from "../BottomButton";
import { scanStyle } from "../checks/source";
import { tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.26 (and bd-5rz1v.24) — the recording bar on the NEW menu, restyled with the kit.
 *
 * It reads like a kit row: a white card with the recording-red mic tile, "Recording", the clock
 * and ›; paused is the amber tile; a screen that went off turns the clock amber. Its look is all
 * in NEW_BAR_STYLE (tokens only). On the old menu it is exactly what it was (the flag-off pins).
 *
 * Where it sits, on a phone: an opaque strip from the top of the menu (80px + the safe area),
 * 8px of page colour, then the 56px bar — so it ends 144px up. A page's bottom button
 * (BottomActions) stands on that line while the bar shows: the two never overlap, and nothing
 * shows through a gap between them.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

const session = (over: Partial<RecordingSession> = {}): RecordingSession => ({
  active: true, paused: false, stream: null, screenWentOff: false, recordingId: "r", returnTo: "/portal/coaching/new",
  elapsedMs: () => 12 * 60_000 + 34_000,
  start: vi.fn(), pause: vi.fn(), resume: vi.fn(), finish: vi.fn(), askBeforeLogout: vi.fn(),
  ...over,
} as unknown as RecordingSession);

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderBar(over: Partial<RecordingSession> = {}, props: { aboveMenu?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={["/portal/curriculum"]}>
      <Routes>
        <Route path="/portal/curriculum" element={<RecordingBar session={session(over)} newMenu aboveMenu={props.aboveMenu ?? true} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** "bottom-[calc(80px+env(safe-area-inset-bottom))]" → 80 */
const bottomPx = (cls: string[]) => Number(cls.find((c) => /^bottom-\[calc\(\d+px/.test(c))!.match(/(\d+)px/)![1]);

describe("the recording bar on the new menu", () => {
  it("is a white kit card: the recording-red mic tile, Recording, the clock and ›", () => {
    renderBar();
    const bar = screen.getByTestId("recording-bar");
    expect(classes(bar)).toEqual(expect.arrayContaining(["h-14", "rounded-2xl", "border-[1.5px]", "border-nu-surface-line", "bg-nu-surface-card"]));
    const tile = screen.getByTestId("recording-bar-tile");
    expect(classes(tile)).toEqual(expect.arrayContaining(["bg-nu-record-bg", "text-nu-record"]));
    expect(tile.querySelector("svg.lucide-mic")).not.toBeNull();
    expect(bar).toHaveTextContent("Recording");
    expect(screen.getByTestId("recording-bar-clock")).toHaveTextContent("12:34");
    expect(classes(bar.querySelector("[data-chevron]")!)).toContain("rtl:rotate-180");
  });

  it("paused: the amber tile and Paused", () => {
    renderBar({ paused: true });
    expect(classes(screen.getByTestId("recording-bar-tile"))).toEqual(expect.arrayContaining(["bg-nu-chip-warning-bg", "text-nu-chip-warning"]));
    expect(screen.getByTestId("recording-bar")).toHaveTextContent("Paused");
  });

  it("the screen went off: the clock turns amber", () => {
    renderBar({ screenWentOff: true });
    expect(classes(screen.getByTestId("recording-bar-clock"))).toContain("text-nu-chip-warning");
  });

  it("one tap goes back to the recording", () => {
    renderBar();
    fireEvent.click(screen.getByTestId("recording-bar"));
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/coaching/new");
  });

  it("is a 56px target, and its style keeps the kit's rules (tokens, logical sides, motion-safe)", () => {
    renderBar();
    expect(tapProblems(document.body)).toEqual([]);
    const source = `const s = ${JSON.stringify(Object.values(NEW_BAR_STYLE).join(" "))};`;
    expect(scanStyle("RecordingBar.tsx", source)).toEqual([]);
  });

  it("with no menu it sits near the bottom edge", () => {
    renderBar({}, { aboveMenu: false });
    expect(classes(screen.getByTestId("recording-bar").parentElement!)).toContain("bottom-3");
  });
});

describe("the bar and a page's bottom button never overlap (bd-5rz1v.24)", () => {
  it("the bar's strip ends exactly where the bottom button starts", () => {
    renderBar();
    const dock = classes(screen.getByTestId("recording-bar").parentElement!);
    // The strip's 8px is UNDER the bar, between it and the menu (measured live: with the 8px on top
    // the bar sat on the menu, bd-5rz1v.26.3); nothing on top, where the button stands.
    expect(dock).toEqual(expect.arrayContaining(["bg-nu-surface", "pb-2"]));
    expect(dock.some((c) => /^(pt|py|p)-/.test(c))).toBe(false);
    const stripTop = bottomPx(dock) + 8 /* pb-2 */ + 56 /* h-14 */;

    render(
      <MemoryRouter>
        <RecordingBarShownContext.Provider value>
          <BottomActions><BottomButton>Open</BottomButton></BottomActions>
        </RecordingBarShownContext.Provider>
      </MemoryRouter>,
    );
    const actions = classes(screen.getByTestId("newui-bottom-actions"));
    expect(bottomPx(actions)).toBe(stripTop);
    expect(stripTop).toBe(144);
  });

  it("with no bar, the button sits just above the menu", () => {
    render(<MemoryRouter><BottomActions><BottomButton>Open</BottomButton></BottomActions></MemoryRouter>);
    expect(bottomPx(classes(screen.getByTestId("newui-bottom-actions")))).toBe(80);
  });
});
