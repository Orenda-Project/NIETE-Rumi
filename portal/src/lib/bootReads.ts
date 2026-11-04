/**
 * bd-sex15q.34 — what index.html asked for at boot on a COACHIP page (the `coachip-boot` script): each answer is
 * taken once, by the app's own reader, then gone. Null when there is none (any other page, the Android app, or it
 * was taken already); an answer that was not OK arrives as null too, and the reader then asks as before.
 */
type BootKey = "config" | "me";
type BootWindow = Window & { __nieteBoot?: Partial<Record<BootKey, Promise<unknown>>> };

export function takeBoot<T = unknown>(key: BootKey): Promise<T | null> | null {
  if (typeof window === "undefined") return null;
  const boot = (window as BootWindow).__nieteBoot;
  const read = boot?.[key];
  if (!read) return null;
  delete boot[key];
  return read as Promise<T | null>;
}
