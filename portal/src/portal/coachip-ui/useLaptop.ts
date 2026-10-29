import { useSyncExternalStore } from "react";
import { LAPTOP_QUERY } from "./tokens";

function mql(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(LAPTOP_QUERY) : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  const m = mql();
  if (!m) return () => {};
  m.addEventListener?.("change", onChange);
  return () => m.removeEventListener?.("change", onChange);
}

const read = () => !!mql()?.matches;

/**
 * bd-sex15q.42 — true at ≥ 1024 px (the rail's width). For the few things that must not even MOUNT on a phone (the
 * coach rail's language toggle reads /me/language on mount); everything visual uses the `lg:` classes instead.
 * No matchMedia (jsdom, an old WebView) reads as a phone.
 */
export function useLaptop(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
