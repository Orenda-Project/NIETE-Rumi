import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import i18n from "i18next";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
// The viewer itself is covered by LessonPlanViewer.*.test; here it is a stand-in that shows the recording state.
vi.mock("./LessonPlanViewer", () => ({
  default: ({ view, recording, onClose }: any) => (
    <div data-testid="lesson-plan-viewer">{view.title}{recording ? " · Recording continues" : ""}<button onClick={onClose}>‹</button></div>
  ),
}));

import { LessonPlanSheet } from "./LessonPlanSheet";
import { useRecordingBackGuard } from "../lib/useRecordingBackGuard";

/**
 * bd-kijmb8 (queue #318) — the plan opens OVER the page with its own history entry. Back closes it and lands on the same
 * page; a live recording's page is never left, and the coach's "Finish recording?" guard is asked only by the NEXT Back.
 */
const VIEW = { source: { lane: "session" as const, sessionId: "cs-1", fileKind: "image" as const }, title: "Plants" };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function Page({ guard }: { guard?: () => void }) {
  const [open, setOpen] = useState(false);
  useRecordingBackGuard(!!guard, guard ?? (() => {}));
  return (
    <div>
      <span data-testid="clock">00:07</span>
      <button onClick={() => setOpen(true)}>Lesson plan</button>
      {open ? <LessonPlanSheet view={VIEW} recording={!!guard} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  window.history.replaceState({}, "", "/");
});
afterEach(() => cleanup());

describe("LessonPlanSheet", () => {
  it("opens over the page and the phone's Back closes it, leaving the page as it was", async () => {
    render(<Page />);
    fireEvent.click(screen.getByText("Lesson plan"));
    expect(screen.getByTestId("lesson-plan-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("clock")).toHaveTextContent("00:07");
    act(() => { window.history.back(); });
    await waitFor(() => expect(screen.queryByTestId("lesson-plan-sheet")).toBeNull());
    expect(screen.getByTestId("clock")).toHaveTextContent("00:07");
  });

  it("the ‹ button closes it the same way and leaves no history entry behind", async () => {
    render(<Page />);
    fireEvent.click(screen.getByText("Lesson plan"));
    expect((window.history.state as any)?.overlayLayer).toBe(true);
    fireEvent.click(screen.getByText("‹"));
    await waitFor(() => expect(screen.queryByTestId("lesson-plan-sheet")).toBeNull());
    expect((window.history.state as any)?.overlayLayer).not.toBe(true);
  });

  it("while recording it says so", () => {
    render(<Page guard={() => {}} />);
    fireEvent.click(screen.getByText("Lesson plan"));
    expect(screen.getByTestId("lesson-plan-viewer")).toHaveTextContent("Recording continues");
  });

  it("coach recorder: the first Back closes the plan, the second asks 'Finish recording?'", async () => {
    const ask = vi.fn();
    render(<Page guard={ask} />);
    await settle();
    fireEvent.click(screen.getByText("Lesson plan"));
    act(() => { window.history.back(); });
    await waitFor(() => expect(screen.queryByTestId("lesson-plan-sheet")).toBeNull());
    await settle();
    expect(ask).not.toHaveBeenCalled();
    act(() => { window.history.back(); });
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  });
});
