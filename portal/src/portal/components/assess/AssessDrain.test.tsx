import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import AssessDrain from "./AssessDrain";

// D1: the drain frame may need minutes to send an offline battery on a slow link. The coach page ends it on
// sa:drained, after 30 s with no progress (no sa:drain_progress: no server answer, no upload bytes), or at 10 minutes.
// A frame that never reports progress (an engine before sa-47) keeps the old 60 s cap.
// A fixed minute cut an upload that was still moving, and the next drain started that recording again from zero.

const post = (data: unknown) => act(() => {
  window.dispatchEvent(new MessageEvent("message", { data, origin: window.location.origin }));
});

describe("AssessDrain", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("K8: an upload that keeps moving is not cut at 60 s; it ends on sa:drained", () => {
    const onDone = vi.fn();
    render(<AssessDrain onDone={onDone} />);
    for (let s = 0; s < 300; s += 10) {
      act(() => { vi.advanceTimersByTime(10_000); });
      post({ type: "sa:drain_progress", acks: s / 10, bytes: s * 30_000 });
    }
    expect(onDone).not.toHaveBeenCalled();
    post({ type: "sa:drained", sessions: [{ s: "s1", pending_events: 0, pending_audio: 0 }] });
    expect(onDone).toHaveBeenCalledWith([{ s: "s1", pending: 0 }], true);
  });

  it("30 s with no progress ends it", () => {
    const onDone = vi.fn();
    render(<AssessDrain onDone={onDone} />);
    post({ type: "sa:drain_progress", acks: 1, bytes: 0 });
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(onDone).toHaveBeenCalledWith([], false);
  });

  it("a frame that never reports progress (an older engine) keeps today's 60 s cap", () => {
    const onDone = vi.fn();
    render(<AssessDrain onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(59_000); });
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(onDone).toHaveBeenCalledWith([], false);
  });

  it("10 minutes is the hard cap, however it moves", () => {
    const onDone = vi.fn();
    render(<AssessDrain onDone={onDone} />);
    for (let s = 0; s < 600; s += 10) {
      act(() => { vi.advanceTimersByTime(10_000); });
      if (s < 590) post({ type: "sa:drain_progress", acks: 1, bytes: s });
    }
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("progress from another origin does not keep it alive", () => {
    const onDone = vi.fn();
    render(<AssessDrain onDone={onDone} />);
    post({ type: "sa:drain_progress", acks: 1, bytes: 0 });
    act(() => { vi.advanceTimersByTime(20_000); });
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:drain_progress" }, origin: "https://evil.example" })); });
    act(() => { vi.advanceTimersByTime(11_000); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
