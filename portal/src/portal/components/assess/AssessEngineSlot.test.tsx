import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// The engine runs in a same-origin iframe. The child is done when the engine
// posts sa:done, when the frame lands on the handback URL, or when the frame
// can no longer be read after it has loaded once (offline error page). The
// coach can end early with a 3 s hold. The first name is only in the fragment.

vi.mock("../../lib/keepAwake", () => ({ keepScreenOn: vi.fn() }));
import { keepScreenOn } from "../../lib/keepAwake";
import AssessEngineSlot from "./AssessEngineSlot";

const SID = "0b8f6c1e-3d2a-4c5b-9e7f-112233445566";

function setup(extra: Partial<Parameters<typeof AssessEngineSlot>[0]> = {}) {
  const onFinished = vi.fn();
  const release = vi.fn().mockResolvedValue(undefined);
  (keepScreenOn as any).mockResolvedValue(release);
  const r = render(<AssessEngineSlot sessionId={SID} firstName="Ayan" lang="ur" grade={3} block="B2" onFinished={onFinished} {...extra} />);
  const frame = screen.getByTestId("assess-engine-frame") as HTMLIFrameElement;
  return { ...r, frame, onFinished, release };
}

function fakeWindow(frame: HTMLIFrameElement, location: () => unknown) {
  Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => ({ get location() { return location(); } }) });
}

afterEach(() => { vi.useRealTimers(); });

describe("AssessEngineSlot", () => {
  it("a full-screen same-origin frame on the play page, the name only after #n=", () => {
    const { frame } = setup();
    expect(frame.getAttribute("allow")).toBe("microphone; fullscreen; screen-wake-lock; autoplay");
    expect(frame.getAttribute("title")).toBeTruthy();
    const src = frame.getAttribute("src") as string;
    const [path, frag] = src.split("#");
    const u = new URL(path, "http://x");
    expect(u.pathname).toBe("/sa/play.html");
    expect(u.searchParams.get("s")).toBe(SID);
    expect(u.searchParams.get("form")).toBe("sa.coach.G3.A.ur");
    expect(u.searchParams.get("mode")).toBe("proctored");
    expect(u.searchParams.get("lang")).toBe("ur");
    expect(u.searchParams.get("block")).toBe("B2");
    expect(u.searchParams.get("embed")).toBe("1");
    expect(u.searchParams.get("back")).toBe(`/sa/play.html?handback=${SID}`);
    expect(path).not.toContain("Ayan");
    expect(frag).toBe("n=Ayan");
  });

  it("finishes on a same-origin sa:done for this session only", () => {
    const { onFinished } = setup();
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s: "other" }, origin: window.location.origin })); });
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s: SID }, origin: "https://elsewhere.example" })); });
    expect(onFinished).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s: SID }, origin: window.location.origin })); });
    expect(onFinished).toHaveBeenCalledWith("done");
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s: SID }, origin: window.location.origin })); });
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("passes the engine's reason on", () => {
    const { onFinished } = setup();
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s: SID, reason: "coach_end" }, origin: window.location.origin })); });
    expect(onFinished).toHaveBeenCalledWith("coach_end");
  });

  it("finishes when the frame lands on the handback URL", () => {
    const { frame, onFinished } = setup();
    fakeWindow(frame, () => ({ search: "?s=x&embed=1" }));
    fireEvent.load(frame);
    expect(onFinished).not.toHaveBeenCalled();
    fakeWindow(frame, () => ({ search: `?handback=${SID}` }));
    fireEvent.load(frame);
    expect(onFinished).toHaveBeenCalledWith("handback");
  });

  it("an unreadable frame after a first load counts as done (offline error page)", () => {
    const { frame, onFinished } = setup();
    fakeWindow(frame, () => { throw new Error("cross-origin"); });
    fireEvent.load(frame);
    expect(onFinished).not.toHaveBeenCalled();
    fireEvent.load(frame);
    expect(onFinished).toHaveBeenCalledWith("offline");
  });

  it("the coach can end early with a 3 s hold", () => {
    const { onFinished } = setup({ lang: "en" });
    const hold = screen.getByRole("button", { name: /End test/ });
    vi.useFakeTimers();
    fireEvent.pointerDown(hold);
    act(() => { vi.advanceTimersByTime(3100); });
    expect(onFinished).toHaveBeenCalledWith("coach_end");
  });

  it("keeps the screen on while mounted and lets go on unmount", async () => {
    const { unmount, release } = setup();
    expect(keepScreenOn).toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); });
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(release).toHaveBeenCalled();
  });
});
