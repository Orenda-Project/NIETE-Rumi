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
    expect(frame.getAttribute("allow")).toBe("microphone; screen-wake-lock; autoplay");
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

  it("the coach's 3 s hold asks the engine to end the run (sa:coach_end), and ends on its sa:done", () => {
    const { frame, onFinished } = setup({ lang: "en" });
    const post = vi.fn();
    Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => ({ postMessage: post, location: { search: "" } }) });
    const hold = screen.getByRole("button", { name: /End test/ });
    vi.useFakeTimers();
    fireEvent.pointerDown(hold);
    act(() => { vi.advanceTimersByTime(3100); });
    expect(post).toHaveBeenCalledWith({ type: "sa:coach_end", s: SID }, window.location.origin);
    expect(onFinished).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s: SID, reason: "coach_end" }, origin: window.location.origin })); });
    expect(onFinished).toHaveBeenCalledWith("coach_end");
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("an engine that does not answer the hold within 3 s is left anyway", () => {
    const { onFinished } = setup({ lang: "en" });
    const hold = screen.getByRole("button", { name: /End test/ });
    vi.useFakeTimers();
    fireEvent.pointerDown(hold);
    act(() => { vi.advanceTimersByTime(3100); });
    expect(onFinished).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onFinished).toHaveBeenCalledWith("coach_end");
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  describe("hand-back v2 (sa_handback_v2): the battery's end turns the hold into Next child", () => {
    const batteryEnd = (s = SID) => act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:battery_end", s }, origin: window.location.origin }));
    });

    it("at sa:battery_end the hold reads Next child (coach) / Press and hold, and completing it finishes complete", () => {
      const { frame, onFinished } = setup({ lang: "en", handbackV2: true });
      const post = vi.fn();
      Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => ({ postMessage: post, location: { search: "" } }) });
      expect(screen.getByRole("button", { name: /End test/ })).toBeInTheDocument();
      batteryEnd();
      const hold = screen.getByRole("button", { name: /Next child \(coach\)/ });
      expect(hold).toHaveTextContent("Press and hold");
      expect(screen.queryByRole("button", { name: /End test/ })).toBeNull();
      vi.useFakeTimers();
      fireEvent.pointerDown(hold);
      act(() => { vi.advanceTimersByTime(3100); });
      expect(onFinished).toHaveBeenCalledWith("complete");
      expect(onFinished).toHaveBeenCalledTimes(1);
      expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "sa:coach_end" }), expect.anything());
    });

    it("the Urdu labels", () => {
      setup({ lang: "ur", handbackV2: true });
      batteryEnd();
      const hold = screen.getByRole("button", { name: /اگلا بچہ \(کوچ\)/ });
      expect(hold).toHaveTextContent("دبا کر رکھیں");
    });

    it("a hold begun before the end can never yield coach_end once the battery has ended", () => {
      const { onFinished } = setup({ lang: "en", handbackV2: true });
      vi.useFakeTimers();
      fireEvent.pointerDown(screen.getByRole("button", { name: /End test/ }));
      act(() => { vi.advanceTimersByTime(3100); });
      batteryEnd();
      act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s: SID, reason: "coach_end" }, origin: window.location.origin })); });
      expect(onFinished).toHaveBeenCalledWith("complete");
      act(() => { vi.advanceTimersByTime(3100); });
      expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it("another session's battery_end changes nothing", () => {
      setup({ lang: "en", handbackV2: true });
      batteryEnd("other");
      expect(screen.getByRole("button", { name: /End test/ })).toBeInTheDocument();
    });

    const batteryEnding = (s = SID) => act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:battery_ending", s }, origin: window.location.origin }));
    });

    it("sa:battery_ending: the corner hold goes, Next child shows disabled as Sending… until sa:battery_end", () => {
      const { frame, onFinished } = setup({ lang: "en", handbackV2: true });
      const post = vi.fn();
      Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => ({ postMessage: post, location: { search: "" } }) });
      batteryEnding();
      expect(screen.queryByRole("button", { name: /End test/ })).toBeNull();
      const hold = screen.getByRole("button", { name: /Next child \(coach\)/ });
      expect(hold).toBeDisabled();
      expect(hold).toHaveTextContent("Sending…");
      vi.useFakeTimers();
      fireEvent.pointerDown(hold);
      act(() => { vi.advanceTimersByTime(3100); });
      expect(onFinished).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      batteryEnd();
      const ready = screen.getByRole("button", { name: /Next child \(coach\)/ });
      expect(ready).not.toBeDisabled();
      expect(ready).toHaveTextContent("Press and hold");
      fireEvent.pointerDown(ready);
      act(() => { vi.advanceTimersByTime(3100); });
      expect(onFinished).toHaveBeenCalledWith("complete");
    });

    it("Sending… in Urdu", () => {
      setup({ lang: "ur", handbackV2: true });
      batteryEnding();
      expect(screen.getByRole("button", { name: /اگلا بچہ \(کوچ\)/ })).toHaveTextContent("بھیج رہے ہیں…");
    });

    it("no sa:battery_end within 20 s of the ending (offline, a lost message): the hold enables anyway, as complete", () => {
      vi.useFakeTimers();
      const { onFinished } = setup({ lang: "en", handbackV2: true });
      batteryEnding();
      act(() => { vi.advanceTimersByTime(20_100); });
      const hold = screen.getByRole("button", { name: /Next child \(coach\)/ });
      expect(hold).not.toBeDisabled();
      fireEvent.pointerDown(hold);
      act(() => { vi.advanceTimersByTime(3100); });
      expect(onFinished).toHaveBeenCalledWith("complete");
    });

    it("an engine sa:done coach_end after the ending still counts the child complete", () => {
      const { onFinished } = setup({ lang: "en", handbackV2: true });
      batteryEnding();
      act(() => { window.dispatchEvent(new MessageEvent("message", { data: { type: "sa:done", s: SID, reason: "coach_end" }, origin: window.location.origin })); });
      expect(onFinished).toHaveBeenCalledWith("complete");
    });

    it("switch off: battery_ending changes nothing", () => {
      setup({ lang: "en" });
      batteryEnding();
      expect(screen.getByRole("button", { name: /End test/ })).toBeInTheDocument();
    });

    it("switch off: battery_end changes nothing (today's hold)", () => {
      setup({ lang: "en" });
      batteryEnd();
      expect(screen.getByRole("button", { name: /End test/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Next child/ })).toBeNull();
    });
  });

  it("full screen belongs to the page, not the frame, so the coach's hold stays on top of the engine", () => {
    const req = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    const proto = HTMLElement.prototype as any;
    const had = proto.requestFullscreen;
    proto.requestFullscreen = req;
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    let fs: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fs });
    try {
      const { frame, unmount } = setup({ lang: "en" });
      // a frame allowed full screen goes to the top layer, above the hold
      expect(frame.getAttribute("allow") || "").not.toMatch(/fullscreen/);
      const slot = screen.getByTestId("assess-engine-slot");
      expect(req).toHaveBeenCalledTimes(1);
      expect(req.mock.contexts[0]).toBe(slot);
      expect(slot).toContainElement(screen.getByRole("button", { name: /End test/ }));
      fs = slot;
      unmount();
      expect(exit).toHaveBeenCalledTimes(1);
    } finally {
      proto.requestFullscreen = had;
      delete (document as any).exitFullscreen;
      delete (document as any).fullscreenElement;
    }
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
