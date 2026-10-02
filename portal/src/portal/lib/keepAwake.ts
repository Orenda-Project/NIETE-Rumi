/**
 * bd-5rz1v — keep the screen on while a lesson is being recorded.
 *
 * The phone sits on the table for 30-40 minutes. If the screen times out, the
 * app is paused and Android hands a background app silence from the microphone.
 *
 *   NIETE app (build 1214+)  the native KeepScreen plugin (FLAG_KEEP_SCREEN_ON)
 *   browser / older app      the Screen Wake Lock API, re-taken whenever the page
 *                            becomes visible again (the browser drops it on hide)
 *
 * Neither being available is not an error: the page also tells her to keep the
 * screen open. keepScreenOn() never throws, and neither does its release.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";

type KeepScreenPlugin = { on: () => Promise<void>; off: () => Promise<void> };
type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockLike = { request: (type: "screen") => Promise<WakeLockSentinelLike> };

const KeepScreen = registerPlugin<KeepScreenPlugin>("KeepScreen");

type Env = {
  plugin: () => KeepScreenPlugin | null;
  wakeLock: () => WakeLockLike | undefined;
  doc: Document;
};

function defaultEnv(): Env {
  return {
    plugin: () => (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("KeepScreen") ? KeepScreen : null),
    wakeLock: () => (typeof navigator !== "undefined"
      ? (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock
      : undefined),
    doc: document,
  };
}

/** Turn the screen-on hold on; resolves to the function that turns it off. */
export async function keepScreenOn(env: Env = defaultEnv()): Promise<() => Promise<void>> {
  const plugin = env.plugin();
  if (plugin) {
    try {
      await plugin.on();
      return async () => { try { await plugin.off(); } catch { /* nothing to do */ } };
    } catch {
      // fall through to the web API
    }
  }

  const wakeLock = env.wakeLock();
  if (!wakeLock) return async () => {};

  let sentinel: WakeLockSentinelLike | null = null;
  let released = false;
  const take = async () => {
    try { sentinel = await wakeLock.request("screen"); } catch { sentinel = null; }
  };
  const onVisible = () => {
    if (!released && env.doc.visibilityState === "visible") void take();
  };
  await take();
  env.doc.addEventListener("visibilitychange", onVisible);

  return async () => {
    released = true;
    env.doc.removeEventListener("visibilitychange", onVisible);
    try { await sentinel?.release(); } catch { /* already gone */ }
    sentinel = null;
  };
}
