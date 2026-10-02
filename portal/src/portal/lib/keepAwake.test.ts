import { describe, it, expect, vi } from "vitest";
import { keepScreenOn } from "./keepAwake";

// bd-5rz1v — the screen stays on while she records (a locked phone gives the
// app silence from the microphone). In the NIETE app the native KeepScreen
// plugin does it (bd-q4g7s); in a browser, or an app build without the plugin,
// the Screen Wake Lock API. Neither being available is not an error — the page
// still tells her to keep the screen open.

describe("keepScreenOn", () => {
  it("uses the app's KeepScreen plugin when it is there", async () => {
    const plugin = { on: vi.fn().mockResolvedValue(undefined), off: vi.fn().mockResolvedValue(undefined) };
    const release = await keepScreenOn({ plugin: () => plugin, wakeLock: () => undefined, doc: document });
    expect(plugin.on).toHaveBeenCalled();
    await release();
    expect(plugin.off).toHaveBeenCalled();
  });

  it("falls back to the Screen Wake Lock API, and takes it back when she returns to the page", async () => {
    const sentinel = { release: vi.fn().mockResolvedValue(undefined) };
    const wakeLock = { request: vi.fn().mockResolvedValue(sentinel) };
    const release = await keepScreenOn({ plugin: () => null, wakeLock: () => wakeLock, doc: document });
    expect(wakeLock.request).toHaveBeenCalledWith("screen");

    // The browser drops a wake lock whenever the page is hidden.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(wakeLock.request).toHaveBeenCalledTimes(2);

    await release();
    expect(sentinel.release).toHaveBeenCalled();
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it("never throws when nothing can keep the screen on", async () => {
    const release = await keepScreenOn({
      plugin: () => ({ on: vi.fn().mockRejectedValue(new Error("x")), off: vi.fn() }),
      wakeLock: () => ({ request: vi.fn().mockRejectedValue(new Error("NotAllowedError")) }),
      doc: document,
    });
    await expect(release()).resolves.toBeUndefined();
  });
});
