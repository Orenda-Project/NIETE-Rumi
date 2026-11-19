import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOpenTarget, OPEN_HOLD_MS } from "./useOpenTarget";

/**
 * useOpenTarget — "Open in another app" as logic only (ShareActions draws it as a 64px button, ActionStrip as its
 * Download cell). Where she is decides what a press does: Chrome / the app opens the file; WhatsApp's browser on Android
 * hands it to the phone's browser through our page; on iPhone it copies the link. `flash` is the state word a small
 * surface shows, held at least OPEN_HOLD_MS (nothing disappears in under 10 s).
 */
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const FILE = "https://x.r2.cloudflarestorage.com/plan.pdf";

describe("useOpenTarget", () => {
  it("no target, or a page outside WhatsApp's browser → not shown", () => {
    expect(renderHook(() => useOpenTarget(undefined, { env: "chrome" })).result.current.show).toBe(false);
    expect(renderHook(() => useOpenTarget({ page: true }, { env: "chrome", pageHandoff: true })).result.current.show).toBe(false);
  });

  it("a file in Chrome: shown; a press opens it in a new tab and flashes Opening", async () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => useOpenTarget({ fileUrl: async () => FILE }, { env: "chrome" }));
    expect(result.current.show).toBe(true);
    expect(result.current.mode).toBe("default");
    await act(async () => { await result.current.press(); });
    expect(open).toHaveBeenCalledWith(FILE, "_blank", "noopener,noreferrer");
    expect(result.current.flash).toBe("opening");
    act(() => { vi.advanceTimersByTime(OPEN_HOLD_MS - 1); });
    expect(result.current.flash).toBe("opening");
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.flash).toBeNull();
  });

  it("the hold is at least 10 s", () => { expect(OPEN_HOLD_MS).toBeGreaterThanOrEqual(10_000); });

  it("iPhone, WhatsApp's browser: copy mode; a press copies the link and flashes copied", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const { result } = renderHook(() => useOpenTarget({ fileUrl: FILE }, { env: "ios-iab" }));
    expect(result.current.copyMode).toBe(true);
    expect(result.current.mode).toBe("copy");
    await act(async () => { await result.current.press(); });
    expect(writeText).toHaveBeenCalledWith(FILE);
    expect(result.current.mode).toBe("copied");
    expect(result.current.flash).toBe("copied");
  });

  it("Android, WhatsApp's browser: hands the file off through our page", async () => {
    const { result } = renderHook(() => useOpenTarget({ fileUrl: FILE }, { env: "android-iab" }));
    expect(result.current.handOff).toBe(true);
    const before = window.location.href;
    await act(async () => { await result.current.press(); });
    // jsdom does not navigate to intent://; the flash says it is on its way
    expect(result.current.flash).toBe("opening");
    expect(window.location.href).toBe(before);
  });

  it("no link → copy fallback, flashes failed; a second press while opening is ignored", async () => {
    const url = vi.fn(async () => null);
    const { result } = renderHook(() => useOpenTarget({ fileUrl: url }, { env: "chrome" }));
    await act(async () => { await Promise.all([result.current.press(), result.current.press()]); });
    expect(url).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBe("copy");
    expect(result.current.flash).toBe("failed");
  });
});
