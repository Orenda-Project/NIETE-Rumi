import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Round 7b (the pilot's tester, 27 Oct). sa_end_test_restart: the corner End test is a TAP that opens a short question
// (End / Keep going), not a 3-second hold whose instruction the coach never sees. sa_end_section, RDF manual: End this
// section, the same way, asks the engine (sa:end_section) to skip to the next section. OFF: the hold as before, no section button.

vi.mock("../../lib/keepAwake", () => ({ keepScreenOn: vi.fn() }));
import { keepScreenOn } from "../../lib/keepAwake";
import AssessEngineSlot from "./AssessEngineSlot";

const SID = "0b8f6c1e-3d2a-4c5b-9e7f-112233445566";

function setup(extra: Partial<Parameters<typeof AssessEngineSlot>[0]> = {}) {
  const onFinished = vi.fn();
  (keepScreenOn as any).mockResolvedValue(vi.fn().mockResolvedValue(undefined));
  const r = render(<AssessEngineSlot sessionId={SID} firstName="Ayan" lang="en" grade={3} block="rdf_manual" onFinished={onFinished} {...extra} />);
  const frame = screen.getByTestId("assess-engine-frame") as HTMLIFrameElement;
  const post = vi.fn();
  Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => ({ postMessage: post, location: { search: "" } }) });
  return { ...r, frame, onFinished, post };
}

afterEach(() => { vi.useRealTimers(); });

describe("AssessEngineSlot round 7b", () => {
  it("endTestRestart ON: one tap asks; Keep going closes it; End test asks the engine to end", () => {
    vi.useFakeTimers();
    const { post, onFinished } = setup({ endTestRestart: true });
    fireEvent.click(screen.getByRole("button", { name: "End test (coach)" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("End Ayan's test? You can restart it from the list.");
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "End test (coach)" }));
    fireEvent.click(screen.getByRole("button", { name: "End test" }));
    expect(post).toHaveBeenCalledWith({ type: "sa:coach_end", s: SID }, window.location.origin);
    act(() => { vi.advanceTimersByTime(3100); });
    expect(onFinished).toHaveBeenCalledWith("coach_end");
  });

  it("endTestRestart OFF: a tap does nothing (the hold as before)", () => {
    const { post } = setup();
    fireEvent.click(screen.getByRole("button", { name: /End test \(coach\)/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("endSection ON, RDF manual: End this section asks, then tells the engine; the test stays open", () => {
    const { post, onFinished } = setup({ endSection: true });
    fireEvent.click(screen.getByRole("button", { name: "End this section" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("End this section? The test goes on with the next section.");
    fireEvent.click(screen.getByRole("button", { name: "End section" }));
    expect(post).toHaveBeenCalledWith({ type: "sa:end_section", s: SID }, window.location.origin);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("assess-engine-frame")).toBeInTheDocument();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("endSection: not in RDF auto, not when OFF; the Urdu words", () => {
    setup({ endSection: true, block: "rdf_auto" });
    expect(screen.queryByRole("button", { name: "End this section" })).toBeNull();
  });
  it("endSection OFF: no button", () => {
    setup();
    expect(screen.queryByRole("button", { name: "End this section" })).toBeNull();
  });
  it("Urdu: the section button and the question", () => {
    setup({ endSection: true, lang: "ur" });
    fireEvent.click(screen.getByRole("button", { name: "یہ حصہ ختم کریں" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("جائزہ اگلے حصے سے جاری رہے گا");
  });
});
