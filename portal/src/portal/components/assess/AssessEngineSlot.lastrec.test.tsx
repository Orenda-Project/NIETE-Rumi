import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// The last recording: after sa:battery_end the engine sends the audio and says sa:audio_saved. Until then,
// for 10 s at most, Next child (hand-back v2) is disabled as "Saving the last recording…", and the coach's hold (any
// mode) waits for it, so the frame is not unmounted mid-upload. It never holds the coach longer than 10 s.

vi.mock("../../lib/keepAwake", () => ({ keepScreenOn: vi.fn() }));
import { keepScreenOn } from "../../lib/keepAwake";
import AssessEngineSlot from "./AssessEngineSlot";

const SID = "0b8f6c1e-3d2a-4c5b-9e7f-112233445566";

function setup(extra: Partial<Parameters<typeof AssessEngineSlot>[0]> = {}) {
  const onFinished = vi.fn();
  (keepScreenOn as any).mockResolvedValue(vi.fn().mockResolvedValue(undefined));
  render(<AssessEngineSlot sessionId={SID} firstName="Ayan" lang="en" grade={3} block="B2" onFinished={onFinished} {...extra} />);
  const frame = screen.getByTestId("assess-engine-frame") as HTMLIFrameElement;
  const post = vi.fn();
  Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => ({ postMessage: post, location: { search: "" } }) });
  return { onFinished, post };
}
const msg = (data: Record<string, unknown>) => act(() => {
  window.dispatchEvent(new MessageEvent("message", { data: { s: SID, ...data }, origin: window.location.origin }));
});
const next = () => screen.getByRole("button", { name: /Next child \(coach\)/ });

afterEach(() => { vi.useRealTimers(); });

describe("AssessEngineSlot: the last recording is saved before the next child", () => {
  it("v2: after sa:battery_end Next child is disabled as Saving… until sa:audio_saved, then the hold finishes complete", () => {
    vi.useFakeTimers();
    const { onFinished } = setup({ handbackV2: true });
    msg({ type: "sa:battery_ending" });
    msg({ type: "sa:battery_end" });
    expect(next()).toBeDisabled();
    expect(next()).toHaveTextContent("Saving the last recording…");
    fireEvent.pointerDown(next());
    act(() => { vi.advanceTimersByTime(3100); });
    expect(onFinished).not.toHaveBeenCalled();
    msg({ type: "sa:audio_saved", pending_audio: 0, state: "synced" });
    expect(next()).not.toBeDisabled();
    expect(next()).toHaveTextContent("Press and hold");
    fireEvent.pointerDown(next());
    act(() => { vi.advanceTimersByTime(3100); });
    expect(onFinished).toHaveBeenCalledWith("complete");
  });

  it("v2: no sa:audio_saved within 10 s (a weak link, an old engine): Next child enables anyway", () => {
    vi.useFakeTimers();
    const { onFinished } = setup({ handbackV2: true });
    msg({ type: "sa:battery_end" });
    act(() => { vi.advanceTimersByTime(9_900); });
    expect(next()).toBeDisabled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(next()).not.toBeDisabled();
    fireEvent.pointerDown(next());
    act(() => { vi.advanceTimersByTime(3100); });
    expect(onFinished).toHaveBeenCalledWith("complete");
  });

  it("v2 offline: sa:audio_saved with the audio still on the phone enables Next child at once", () => {
    setup({ handbackV2: true });
    msg({ type: "sa:battery_end" });
    msg({ type: "sa:audio_saved", pending_audio: 1, state: "offline" });
    expect(next()).not.toBeDisabled();
  });

  it("Urdu: Saving… in Nastaliq from the catalog", () => {
    setup({ handbackV2: true, lang: "ur" });
    msg({ type: "sa:battery_end" });
    expect(screen.getByRole("button", { name: /اگلا بچہ \(کوچ\)/ })).toHaveTextContent("آخری ریکارڈنگ محفوظ ہو رہی ہے…");
  });

  it("another session's audio_saved changes nothing", () => {
    setup({ handbackV2: true });
    msg({ type: "sa:battery_end" });
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:audio_saved", s: "other" }, origin: window.location.origin })); });
    expect(next()).toBeDisabled();
  });

  it("without v2: the corner hold after the end waits past 3 s for the engine's sa:done (sent after the audio)", () => {
    vi.useFakeTimers();
    const { onFinished, post } = setup();
    msg({ type: "sa:battery_end" });
    fireEvent.pointerDown(screen.getByRole("button", { name: /End test/ }));
    act(() => { vi.advanceTimersByTime(3100); });
    expect(post).toHaveBeenCalledWith({ type: "sa:coach_end", s: SID }, window.location.origin);
    act(() => { vi.advanceTimersByTime(3100); });
    expect(onFinished).not.toHaveBeenCalled();
    msg({ type: "sa:audio_saved", pending_audio: 0, state: "synced" });
    msg({ type: "sa:done", reason: "complete" });
    // the reason without v2 is today's (a corner hold reads coach_end); what changed is only when it comes
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("without v2: never more than 10 s after the end, whatever the engine says", () => {
    vi.useFakeTimers();
    const { onFinished } = setup();
    msg({ type: "sa:battery_end" });
    fireEvent.pointerDown(screen.getByRole("button", { name: /End test/ }));
    act(() => { vi.advanceTimersByTime(9_000); });
    expect(onFinished).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(4_100); });
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
