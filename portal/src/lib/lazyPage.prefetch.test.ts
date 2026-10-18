/**
 * prefetchPages() on a slow line (qa-audio 202011).
 *
 * The background fetch of every page chunk (~790 KB) competed with an FLN plan warming its
 * audio on a 400 kbps line. When the browser says data saver is on, or the line is 3g or
 * slower, the app skips that prefetch; a page still loads when it is opened. Where the
 * browser has no navigator.connection (iOS Safari, Firefox) nothing changes.
 *
 * These tests run the real non-test branch of prefetchPages(): MODE is stubbed to
 * "production", and a fresh module is imported per test so its loader list starts empty.
 */
import { vi, beforeEach, afterEach, it, expect } from "vitest";

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
const w = window as IdleWindow;
const hadIdle = "requestIdleCallback" in w;
const realIdle = w.requestIdleCallback;
const hadConnection = "connection" in navigator;
const realConnection = (navigator as Navigator & { connection?: unknown }).connection;

let idle: ReturnType<typeof vi.fn>;

function setConnection(value: unknown) {
  Object.defineProperty(navigator, "connection", { configurable: true, value });
}

async function freshModuleWithOnePage() {
  vi.resetModules();
  const mod = await import("./lazyPage");
  const load = vi.fn(() => Promise.resolve({ default: () => null }));
  mod.lazyPage(load);
  return { prefetchPages: mod.prefetchPages, load };
}

beforeEach(() => {
  vi.stubEnv("MODE", "production");
  idle = vi.fn((cb: () => void) => { cb(); return 1; });
  w.requestIdleCallback = idle as unknown as IdleWindow["requestIdleCallback"];
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (hadIdle) w.requestIdleCallback = realIdle;
  else delete w.requestIdleCallback;
  if (hadConnection) setConnection(realConnection);
  else delete (navigator as Navigator & { connection?: unknown }).connection;
});

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

it("data saver on: nothing is scheduled and no chunk is fetched", async () => {
  setConnection({ saveData: true, effectiveType: "4g" });
  const { prefetchPages, load } = await freshModuleWithOnePage();
  prefetchPages();
  await flush();
  expect(idle).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
});

for (const effectiveType of ["slow-2g", "2g", "3g"]) {
  it(`a ${effectiveType} line: nothing is scheduled and no chunk is fetched`, async () => {
    setConnection({ saveData: false, effectiveType });
    const { prefetchPages, load } = await freshModuleWithOnePage();
    prefetchPages();
    await flush();
    expect(idle).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
}

it("a 4g line: prefetch is scheduled and the chunk is fetched, as today", async () => {
  setConnection({ saveData: false, effectiveType: "4g" });
  const { prefetchPages, load } = await freshModuleWithOnePage();
  prefetchPages();
  await flush();
  expect(idle).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(1);
});

it("no navigator.connection (iOS Safari, Firefox): prefetch runs as today", async () => {
  delete (navigator as Navigator & { connection?: unknown }).connection;
  expect("connection" in navigator).toBe(false);
  const { prefetchPages, load } = await freshModuleWithOnePage();
  prefetchPages();
  await flush();
  expect(idle).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(1);
});

it("a navigator.connection that throws when read: prefetch runs as today", async () => {
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    get() { throw new Error("blocked"); },
  });
  const { prefetchPages, load } = await freshModuleWithOnePage();
  prefetchPages();
  await flush();
  expect(idle).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(1);
});

it("test mode still skips prefetch entirely", async () => {
  vi.stubEnv("MODE", "test");
  setConnection(undefined);
  const { prefetchPages, load } = await freshModuleWithOnePage();
  prefetchPages();
  await flush();
  expect(idle).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
});
